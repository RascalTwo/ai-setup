---
name: port-terraform-provider-to-ansible
description: >-
  Port a Terraform provider to a greenfield Ansible collection with full surface
  parity (one module per resource, *_info per data source), hand-built
  idempotency/check-mode/diff, and live acceptance tests — using parallel family
  agents and a field-parity audit that proves (not assumes) completeness. Use
  whenever the user wants Ansible modules or an Ansible collection for a service
  that has a Terraform provider (Keycloak, PingOne, Okta, Grafana, any REST-managed
  service), says "port the provider", "build an ansible collection for X",
  "ansible can't manage X natively", or wants to measure what building such a
  collection costs. Also use for partial ports (a subset of resources) — the
  workflow scales down.
---

# Port a Terraform provider to an Ansible collection

Battle-tested workflow: terraform-provider-keycloak → 131/131 surface parity
(109 resources + 22 data sources), every module live-acceptance-tested, in ~2h
of orchestrated agent time. The core insight that makes this tractable:

**Port, don't invent.** A mature Terraform provider is years of pre-discovered
knowledge: every schema field, every API quirk, every server-side normalization
is already encoded in its Go source. The provider is the spec — read it, don't
rediscover it. (Bonus: Terraform providers are usually the ecosystem's shared
source of truth — Pulumi bridges them, Crossplane upjet-generates from them —
so porting one ports the industry's best knowledge of that API.)

## Phase 0 — Recon and scope (inline, ~10 min)

1. Shallow-clone the provider. Enumerate the surface:
   `ls provider/resource_*.go | grep -v _test | wc -l` and the same for
   `data_source_*.go`. (Layout varies: some providers use `internal/provider/`
   or per-service dirs — find the files that call `schema.Resource`.)
2. Read the provider's client layer (usually one `*_client.go`): auth grant(s),
   token refresh behavior, error shape, how created-resource ids come back
   (Location header vs body).
3. Read its CI (`.github/workflows/`) and Makefile to learn how IT tests —
   you will mirror that methodology (see Testing below).
4. **Test target = a LOCAL container. Full stop.** A script in the repo owns
   it (start, healthcheck, bootstrap credentials, env file) — the provider's
   own test harness does exactly this; copy it. Never point the suite at a
   remote/deployed instance: it's ~5× slower per run (WAN+TLS on every call)
   and the suite dies when that instance does — both measured the hard way.
   The only exception is a service that genuinely cannot run in a container,
   and then the limitation goes in PARITY.md in bold.
5. Confirm scope with the user: full parity vs subset, repo location,
   collection namespace. Licensing: the port is a derivative — carry the
   provider's license (usually Apache/MPL) + a NOTICE crediting it.

## Phase 1 — Scaffold + framework (inline, by hand)

Build the shared layer yourself — it's small (ours: 318 lines total) and every
fan-out agent copies its patterns, so quality here multiplies.

- `galaxy.yml`, `meta/runtime.yml`, LICENSE + NOTICE, `.gitignore`.
- **Pre-register EVERY planned module name in the `meta/runtime.yml`
  action_groups block now** (generate from the resource file list). Two wins:
  playbooks set auth once via `module_defaults: group/<ns>.<name>.<group>`, and
  no fan-out agent ever edits a shared file (merge collisions with 16 parallel
  writers are otherwise guaranteed).
- `plugins/module_utils/<service>_api.py`: port the provider's client — token
  login per its grants, **re-login-once-and-retry on 401** (providers do this;
  long runs need it), JSON verbs relative to the API base, created-id capture,
  safe error extraction. Use `ansible.module_utils.urls.open_url` — collections
  must not require `requests`.
- `plugins/module_utils/resource.py`: a present/absent engine so check_mode
  and `--diff` are handled ONCE: hooks `read() / desired() / create() /
  update() / delete()`, declared-fields-only comparison, `SET_FIELDS` for
  order-insensitive lists, `sanitize()` for secrets.
- `plugins/doc_fragments/<service>.py` for the auth options.

Full code templates (proven, adapt the auth): **references/framework.md**.

## Phase 2 — Exemplars by hand, green before fan-out

Hand-port 2–3 resources spanning the patterns agents will meet: one simple CRUD
(e.g. group), one with sub-resource sync (e.g. role + composites), one
big-schema core resource (partial is fine; the family agent completes it).
Write the live test harness (`scripts/run-tests.sh` + one integration playbook)
and get it green. The exemplars ARE the spec for the fan-out — agents copy
them, so any flaw here is copied 100 times.

## Phase 3 — Fan-out (parallel family agents)

Group remaining resources into families by API area (~4–13 resources each) and
launch one agent per family via the Workflow tool, **dependency-chained**:
protocol mappers after clients, LDAP mappers after federation, IdP mappers
after IdPs. Independent families start immediately.

The agent prompt template, family-grouping heuristics, structured result
schema (including the quirks harvest — that's your effort-ledger evidence),
and the usage-limit-wedge recovery procedure: **references/fanout.md**.

Non-negotiable rules baked into every agent prompt:
- Provider names/semantics are law (snake_case schema keys; exhaustive vs
  additive sets; ForceNew → delete+recreate only if the provider does it).
- Server normalizations get normalized in the module — **never weaken the
  idempotency test to make it pass**.
- Secrets: `no_log=True` AND stripped from `end_state`/diff via `sanitize()`.
- Durations the provider exposes as strings become integer seconds (the API's
  native unit); TF plan/state mechanics (`import`, write-only `*_wo` attrs,
  regenerate-triggers) don't port — document each non-port in the module docs.
- No git, no shared-file edits, own test-realm namespace, block/always cleanup.
- Untestable-on-this-server is acceptable ONLY with the captured server error
  as evidence (feature gates, server-side files, removed features).

## Phase 4 — Data sources → `*_info` modules

Read-only lookups: plain AnsibleModule + the API client, `changed=False`,
`supports_check_mode=True`. **Port each data source's miss semantics from its
Go read path** — some return empty state on 404, some hard-error with specific
messages; get this per-resource, don't guess a convention. Strip secrets from
returns even where the provider exposes them as Sensitive attributes.

## Phase 5 — Prove parity (don't just claim it)

1. Preferred: **`terraform providers schema -json`** (init a stub config
   requiring the provider) — Terraform dumps every resource AND data-source's
   final *composed* schema. Run the bundled
   `scripts/field-parity-audit.py --schema-json` against it: exact, excludes
   Computed-only fields (outputs → `end_state`), follows `plugin_routing`
   redirects, and knows data-source declaration artifacts (fields declared
   optional that the DS read path never reads — verify each against the Go).
   Expect to also discover **legacy alias registrations** in the provider's
   resource map → serve them as `plugin_routing` redirects, not modules.
2. If the registry release lags the HEAD you ported, the dump misses the
   HEAD-only resources — fall back to `--provider-src` (static Go parse) for
   those; composed schemas come back NEEDS-MANUAL → small agent wave reads the
   composition and fixes/confirms with evidence.
3. Fix real gaps; expect your own hand-built exemplars to be the guilty ones.

## Phase 6 — Port the provider's own acceptance tests (behavior parity)

The provider's `resource_*_test.go` files are its real spec of *behavior* —
years of per-field update permutations and regression cases. Fan agents out
over them the same way as Phase 3: each agent reads a family's test files and
translates every scenario into playbook cases against the local container
(config A → apply → assert → config B → apply → assert...). Expect this to
cost about as much as the module port itself and to multiply suite runtime —
scale to the engagement (measured-PoC: lifecycle tests suffice, state the
depth gap honestly in PARITY.md; owned product: port the suite).

## Phase 7 — Verify + deliverables

- Full sequential sweep of every family playbook: exit 0, zero failures.
- **Replay a real end-to-end scenario** using only the new collection (the
  change your users actually make), asserting round-2 full idempotency.
- Write `EFFORT.md` (timeline, LOC, agent/token counts, quirk harvest, honest
  caveats — AI-minutes ≠ human-months; porting a mature provider is easy mode;
  ownership/CI is the recurring cost) and `PARITY.md` (the precise claim, how
  it was proven, known deltas, follow-ups). These docs are usually the point
  of the exercise.

## Testing paradigm (mirrors how providers test themselves)

Terraform providers ship acceptance tests, not mocked unit tests: real API,
real resources, and the oracle "apply twice → second plan is empty". The
Ansible equivalent, asserted per module:

create → identical re-run **must report `changed=false`** (the oracle) →
check-mode update with diff asserted AND no server mutation → real update →
absent → absent re-run not-changed. Playbook template and the full paradigm:
**references/testing.md**.

## Gotchas that will bite (read before the fan-out)

**references/gotchas.md** — the harvest from doing this for real: the
token-minted-before-realm trap, quoted-boolean component config, masked-secret
diff suppression, whole-document resources, order-nonpreserving multivalued
config, singletons where absent=reset-to-zero, Jinja `.keys()` collision on a
`keys` return, and more. Each one is a day a from-scratch team loses.
