---
name: port-terraform-provider-to-powershell-dsc
description: >-
  Port a Terraform provider to a greenfield PowerShell DSC class-resource module with full
  surface parity (one [DscResource()] class per resource), hand-built Get/Test/Set
  idempotency, and LIVE behavioral tests. Use when the user wants to manage a REST service
  as PowerShell DSC / "Desired State Configuration" — especially when a hardened Windows
  shop bans Terraform/Ansible but allows PowerShell — or says "port the provider to DSC",
  "DSC resources for X", or "no MOF / no LCM / no install". Handles partial ports too.
---

# Port a Terraform provider to a PowerShell DSC module

Battle-tested on terraform-provider-keycloak v5.8.0 → 101/101 resource surface,
class-based DSC resources, proven live against a local Keycloak. The core insight
that makes it tractable is the same as the Ansible/K8s siblings:

**Port, don't invent.** A mature Terraform provider is years of pre-discovered
knowledge — every schema field, API path, verb, and server normalization is already
in its Go source. The provider is the spec: read it, don't rediscover it.

## Why DSC, and what it is (the bank pitch)

The whole reason this lane exists: Windows ships PowerShell + DSC **in the box**, so
a shop that bans Terraform and Ansible can still do IaC with **zero install**. The
resources are `[DscResource()]` PowerShell classes with three methods — `Get` (read
live state), `Test` (does reality match desired? bool), `Set` (make it so). That is
create/read/update/delete with the diff logic you write, since **there is no state
file** (the deliberate, permanent loss vs Terraform: no plan, no prune-on-removal, no
auto dependency graph — say so on the scorecard).

Two ways to run the SAME classes, both supported by the module you build:
- **Windows, in-box:** `Invoke-DscResource -Name X -ModuleName M -Method Set -Property @{...}`
  — no MOF compile, no LCM service, no install. (The classic `Configuration{}`+MOF+
  `Start-DscConfiguration`+LCM path exists but runs as SYSTEM and is legacy — avoid it.)
- **Portable / any pwsh 7 (incl. Linux CI):** call the class `Get/Test/Set` directly
  via a tiny factory function — no DSC engine at all. Same classes, `[DscResource()]`
  tag kept for the Windows path.

## TWO LESSONS THAT OVERRIDE EVERYTHING (learned the hard way)

Read `references/enforcement.md` before delegating anything. In one build these two
mistakes each cost a wasted multi-agent wave:

1. **Enforce every gate by RUNNING it yourself. Never trust an agent's self-report.**
   A "behavioral fix-wave" reported "88/93 green" and had changed nothing — 85k tokens
   across 11 agents that no-op'd. A gate that lives in a *prompt* ("test it behaviorally")
   gets gamed; a gate the *orchestrator executes* (run the audit / run the live test,
   only a real pass counts) cannot. The deterministic field audit and the live behavioral
   suite are the gates — you run them, agents don't grade themselves.

2. **Read the provider Go for types + mechanics, not just the schema for field names.**
   `terraform providers schema -json` gives the field *surface* only. It does NOT encode
   the REST path, the HTTP verb, how references resolve, or server-side transforms — those
   live in the Go and only prove out live. Two concrete traps this caused: session/token
   lifespans are **duration-strings in the schema but integer seconds in the API** (send a
   string → 400); realm roles **PUT/DELETE by name, not `/{id}`**. A field named correctly
   but typed/pathed wrong passes a name-audit and fails live. See `references/gotchas.md`.

## Phase 0 — Recon + scope (inline)

1. Shallow-clone the provider. Count surface: `ls provider/resource_*.go | grep -v _test | wc -l`.
2. Read the client layer: auth grant (usually `client_credentials` worker app OR a bearer
   token — support BOTH: `ClientId`+`ClientSecret` exchanged internally, or a passed
   `AccessToken`), token refresh, error shape, how new-resource ids come back.
3. **Test target = a LOCAL container** (the provider ships a docker-compose for its own
   acceptance tests — trim it to the minimum: often just the service + a DB). A repo script
   owns start/healthcheck/bootstrap-a-service-account/write a gitignored env file. Never a
   remote instance.
4. Dump the schema: init a stub TF config requiring the provider, `terraform providers
   schema -json > .schema-dump/schema.json` — the field checklist for the audit.
5. Confirm with the user: full parity vs subset, repo location, module name.

## Phase 1 — Framework by hand (small, copied everywhere)

Build the shared layer yourself — ~370 lines total, and every fan-out agent copies it,
so quality here multiplies. Full code in `references/framework.md`:
- `KeycloakConnectionBase` (rename per service): connection props + `GetToken()`
  (re-fetch per call — do NOT cache; short-lived admin tokens expire mid-run), `Api()`
  (list bodies auto-serialize as JSON arrays — see the single-element gotcha), `ApiGetOrNull`
  (404→$null), and `ResolveXUuid` helpers (name→uuid — the API is keyed by uuid).
- `KeycloakResourceBase : ConnectionBase`: the generic collection/{id} engine with a
  `SelfPath($rep)` hook (override for name-addressed resources) and hooks a subclass sets
  (`CollectionPath`, `LookupKeyJson/Value`, `FieldMap`, `ListFields`, `AlwaysBody`,
  `CopyIdentity`). Implements `Get`/`Test`/`Set` once.
- The module `.psm1` MUST stay a SINGLE file (DSC discovery scans it). The `.psd1`
  manifest lists every class in `DscResourcesToExport`. A `$script:...Factory` map +
  `Invoke-<Svc>ResourceItem` function powers the portable direct-call path.
- A **runner** (`Invoke-...Dsc.ps1`) that reads a declarative `.psd1` source-of-truth
  (resources by type; NO secrets — connection passed in) and loops Test-then-Set in a
  declared dependency order (you order it; no auto-graph).

## Phase 2 — Exemplars by hand, green before fan-out

Hand-port 2–3 resources spanning the shapes agents will meet, each proven live
(create→Test→drift→converge→delete): one plain CRUD (group), one with a discriminator
(client: `access_type` → `publicClient`/`bearerOnly` booleans), one relationship
(group↔role, additive), one protocol-mapper (resolves a parent name→uuid). The exemplars
ARE the spec for the fan-out — a flaw here is copied 100×.

## Phase 3 — Fan-out (parallel family agents) — GATED BY YOU

Group remaining resources into families by API area (~4–16 each). Launch one agent per
family via the Workflow tool. **Agents write to per-family scratch files, NEVER the shared
`.psm1`** (parallel edits to one file collide — this bit us). Non-negotiables in every prompt
(and see `references/fanout.md`):
- Provider Go is law: field names (json tags), REST path/verb, discriminators, computed-only
  exclusions, additive-vs-exhaustive sets. **Durations→int seconds. Roles/some resources
  address by name.**
- Class name = PascalCase of the resource minus the `<svc>_` prefix.
- Write-only secrets never read back (exclude from drift).
- **Then the orchestrator ASSEMBLES** (splice scratch files into the one `.psm1`, rebuild
  factory/manifest/runner) and runs the load-check + field audit — the agent's word is not
  the gate.

## Phase 4 — Field parity to 100% (deterministic gate)

Run `scripts/Field-Parity-Audit.ps1` (bundled) — for every resource it compares the class's
`[DscProperty]` names (normalized) against the schema's non-computed input attributes, and
excludes TF-only mechanics (`import`, `internal_id`, `*deletion_protection`). Fill every gap
with **API-correct types** (not the schema's — the duration trap). This audit is
deterministic, so it's an enforceable gate; loop until it prints 0 missing. Expect your own
hand-built exemplars (the big core resources) to be the guiltiest.

## Phase 5 — Behavioral parity to 100% (the mountain; gate = live test the ORCHESTRATOR runs)

Per family, a `Load-Family.ps1` helper loads just that family's classes (base + scratch file
+ a factory) so an agent can iterate in isolation, in its OWN throwaway realm. The cycle per
resource: scaffold parents → create → Test true → drift out-of-band → Test false → converge →
Test true → Absent → Test true. **The workflow runs the test and only a real green counts** —
never accept "I tested it." Fix by reading the Go (paths, verbs, name→uuid, config
string-booleans, per-key merge for `attributes`/freeform maps). Resources that genuinely need
absent infra (real LDAP/SMTP/external IdP/enterprise features) are `blocked` WITH the captured
error — and that ceiling goes in PARITY.md in bold. See `references/testing.md`.

## Phase 6 — Port the provider's own acceptance tests (deep behavior parity)

`resource_*_test.go` is the provider's real behavior spec — per-field update permutations,
regressions. Translate each family's scenarios into live cycles. Scale to the engagement:
measured-PoC → lifecycle cycles suffice (state the depth gap in PARITY.md); owned product →
port the suite.

## Phase 7 — Verify + deliverables

- Full sweep: module loads, every family's live cycle green, the base regression suites green.
- **Replay a real end-to-end config** through the runner using only the new module (the change
  users actually make), asserting round-2 idempotency (0 changed).
- `EFFORT.md` (timeline, LOC, agent/token counts, quirks, honest caveats — AI-swarm ≠ human
  effort; porting a mature provider is easy mode; ownership/CI is the recurring cost) and
  `PARITY.md` (the precise claim, how it was PROVEN — surface / field-audit / behavioral —
  known deltas, the state/plan/prune losses). These docs are usually the point.

## Testing paradigm & gotchas

- `references/testing.md` — the behavioral oracle, `Load-Family`, per-family realms,
  token-per-call, the enforced gate.
- `references/gotchas.md` — the real harvest: single-element JSON array unwrap (pipe +
  `-AsArray`), DSC `Get()` must return the class type, delete/update-by-name (`SelfPath`),
  name→uuid parent resolution, duration-string vs int-second, `attributes`/freeform-map
  per-key merge + PSCustomObject-vs-hashtable, single-`.psm1` collision, master-token expiry.
- `references/enforcement.md` — why the orchestrator runs every gate. Read it FIRST.
