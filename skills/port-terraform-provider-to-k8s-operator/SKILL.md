---
name: port-terraform-provider-to-k8s-operator
description: Port ANY Terraform provider's resource surface + acceptance-test behaviors to a Kubernetes operator (Java/Quarkus + JOSDK by default) with measured parity — CRDs with full lifecycle (create/update/out-of-band drift-heal/finalizer delete), an e2e harness against the real API, and an effort ledger. Use when the user wants to build a K8s operator for a service that has a Terraform provider, asks for "CRDs for <service>", wants "operator parity with the <X> provider", wants to port/mirror a provider's test suite, or wants to measure what building such an operator costs. Also use for resuming a partial port (parity waves, test mirroring).
---

# Port a Terraform provider to a Kubernetes operator

A Terraform provider is a machine-readable spec of a service's manageable
surface: `docs/resources/` enumerates every resource, the Go schemas define
the fields, and the acceptance tests encode years of API edge-case knowledge.
This skill turns that spec into a Kubernetes operator whose CRDs reconcile the
same surface — with one capability no Terraform provider has: continuous
drift *correction* (out-of-band changes reverted in seconds, not detected at
the next plan).

Proven end-to-end on a real build: 11 CRDs covering an IdP provider's core
surface in ~79 minutes wall-clock with 9 parallel agents and 0 integration
defects. The calibration numbers below come from that run; nothing in this
skill is specific to any particular provider or service.

## Inputs to establish before writing code

Get these from the user or the conversation; ask only for what's genuinely
undecidable:

1. **Provider**: the GitHub repo (e.g. `<org>/terraform-provider-<name>`).
2. **Target API + auth**: base URL of a LIVE instance to test against, and a
   service-account credential (client-credentials or token). No live target =
   stop and get one (a dockerized instance is fine; the provider's own CI
   usually shows how to run one).
3. **Language/runtime**: default Java 21 + Quarkus + JOSDK/QOSDK (the proven
   chassis in `references/chassis.md`). Honor an explicit Go/kubebuilder ask,
   but the chassis reference is Java-shaped.
4. **Scope**: full parity, or a named subset ("the core SSO surface")? Either
   way the capability matrix (below) keeps the claim honest.
5. **Repo home + naming rules** (org conventions, private/public, teardown
   tagging if the substrate is ephemeral).

## Phase 0 — Recon the provider (minutes, pure API calls)

```sh
gh api repos/<org>/terraform-provider-<x>/contents/docs/resources --jq '.[].name'   # the surface
gh api repos/<org>/terraform-provider-<x>/releases/latest --jq .tag_name             # pin the version you claim parity against
gh api repos/<org>/terraform-provider-<x>/contents/<provider-src-dir> --jq \
  '[.[].name] | map(select(endswith("_test.go"))) | length'                          # test-suite size
```

Also check the CI workflow (usually `.github/workflows/test.yml`) for how they
spin the target service and which versions they matrix against — you will
mirror that shape in Phase 4.

**The big lever question**: does a typed SDK for the target API exist in your
implementation language (typed representation classes for every resource)? If
yes, the port is mostly reconcile-wiring. If no, budget a client-wrapper layer
FIRST and say so in the effort ledger — it is the difference between hours and
days, and the honest headline of any measurement.

Record the surface list + version + test count; they are the denominators for
every parity claim you'll make.

## Phase 1 — Chassis (build INLINE yourself; never delegate this)

One generic reconcile lever, decided once, that every resource reuses:

- **Connection**: CRs resolve their target instance from a namespaced Secret
  (`connectionRef`, defaulting to a well-known name in the CR's namespace) —
  one operator, many target instances, creds never in CRs or git.
- **Spec shape**: typed fields for the commonly-used knobs (model them on the
  provider's schema) + a free-form `additionalConfig` overlay (a `JsonNode`
  with `@PreserveUnknownFields`) deep-merged over the representation — full
  API-field reach without a typed field for everything.
- **Reconcile**: serialize desired (NON_NULL) → overlay `additionalConfig` →
  fetch live → absent ⇒ create + re-fetch id; present ⇒ subset-diff (every
  desired field must match live) ⇒ merge-update on drift.
- **Lifecycle**: finalizer-backed delete via the framework's Cleaner, with
  `deletePolicy: delete|orphan`; periodic resync (~30s max reconcile
  interval) makes out-of-band drift heal autonomously.
- **Status contract**: `ready`, `message`, `resourceId`, `lastSync`,
  `observedGeneration` — errors propagate (framework retries with backoff)
  while an error-status handler records the message.

Full code shapes, build files, deploy manifests, and the sharp-edge list:
**read `references/chassis.md` before writing the first file.**

Then build **one or two exemplar resources end-to-end green** against the live
target before any fan-out. The exemplar exists to eat the chassis bugs once —
in the reference build both chassis defects surfaced in the first exemplar's
e2e run and nine parallel implementations inherited the fixes for free. Write
`docs/PATTERN.md` in the repo (the per-resource contract agents will follow)
as part of this phase; the reference build's PATTERN.md is the template.

## Phase 2 — E2E harness (part of the chassis, not an afterthought)

`verify/verify.sh` runs every `verify/verify.d/NN-<resource>.sh` in order
against the REAL target API — no mocks anywhere. Each script is
self-contained (creates its own prerequisites via raw API calls, never via
other CRDs) and tests the four beats: **create → update-via-CR-patch →
out-of-band drift-heal → delete (assert gone)**. Conventions, helpers, and
portability traps (they bit the reference build): `references/test-mirroring.md`.

## Phase 3 — Parity waves (parallel agent fan-out)

- **Group many-to-one**: providers explode variants into separate resources
  (N `*_protocol_mapper` types, M vendor-flavored `*_identity_provider`
  wrappers); one CRD with a type/provider field covers a family. Expect the
  CRD count to be ~⅓–½ of the provider's resource count at full parity.
- **Sort waves by business value**, not alphabet — mechanical same-shape
  resources parallelize cheaply; domains needing new chassis ground (a
  different API sub-tree, a components/plugin API, tree-shaped resources)
  get an exemplar-first hour before their wave fans out.
- **One agent per resource, isolated git worktree, PATTERN.md as the
  contract, compile-only in the worktree** (integration e2e runs once after
  merge, by you). Agent prompt template, worktree gotchas, and merge cadence:
  `references/orchestration.md`.
- After each wave: merge, rebuild, run the FULL suite, update the capability
  matrix, commit.

## Phase 4 — Mirror the provider's test suite

The provider's acceptance tests are the highest-value artifact in the entire
repo — each `*_test.go` is a behavioral spec whose fixtures translate ~1:1 to
CR YAML and whose check functions read as assertion checklists. You cannot
run them (the test engine shells out to the `terraform` binary), but you can
port every behavior. Method, translation table, the no-churn guard, and the
dockerized version matrix that mirrors their CI: `references/test-mirroring.md`.
Track coverage in `docs/TEST-PARITY.md` (provider test file → your script →
beats covered) so "mirrored" is a checklist, not a vibe.

## Phase 5 — Measure and stay honest (this is a deliverable, not overhead)

- **`EFFORT.md`**: start the clock at recon; record wall-clock, LOC, agent
  count, defect count, and the caveats that must travel with the number
  (AI-orchestrated PoC ≠ production; typed-SDK-for-free vs wrapper-needed;
  ownership-forever is the recurring cost). Ledger format: the reference
  build's EFFORT.md.
- **`docs/CAPABILITY-MATRIX.md`**: provider resource → your CRD, row by row,
  with ✅/⚠️/❌ and the parity fraction against the pinned provider version.
  Never claim parity without this file.
- **PoC boundary**: no admission webhooks, metrics, CRD versioning, or HA
  tuning unless asked — but LIST them as the production tax so the effort
  number is never quoted naked.

## Deployment & GitOps (when asked to make it "real")

JVM-mode image (layered Dockerfile), CRDs from the build output, a Deployment
+ scoped RBAC manifest, image loaded node-local for PoC clusters. For a
GitOps story: CRs in a git repo watched by Flux/Argo (merge = deploy), one
namespace per environment×instance with its own connection Secret, prune +
finalizers so git revert IS the rollback. The drift-heal demo (edit the
resource in the target's admin UI, watch the operator revert it in ≤30s) is
the single most persuasive artifact this produces — script it.

## Order of reading

1. This file (you're done).
2. `references/chassis.md` — before writing any code.
3. `references/orchestration.md` — before launching the first wave.
4. `references/test-mirroring.md` — when writing the harness (Phase 2) and
   again at Phase 4.
