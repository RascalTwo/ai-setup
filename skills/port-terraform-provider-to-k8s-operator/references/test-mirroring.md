# Test mirroring — porting the provider's acceptance suite

## How Terraform providers test themselves (what you're mirroring)

Acceptance tests (`provider/*_test.go`, `TF_ACC=1`, terraform-plugin-testing)
run REAL CRUD against a live (usually dockerized) service instance:

- `resource.Test(...)` with a list of **TestSteps**: each step applies an HCL
  fixture, runs **check functions** that hit the service's admin API, and
  (critically) **re-plans expecting an empty diff** — the idempotency proof.
- `CheckDestroy` verifies the resource is really gone after teardown.
- `ImportState` steps prove existing resources can be adopted.
- CI matrixes the suite across many service versions (read their
  `.github/workflows/test.yml` for the exact shape).

You cannot execute this suite against CRDs — the engine literally shells out
to the `terraform` binary running the provider; there is no substitution seam.
Mixing languages is not the blocker; the coupling is. **Port behaviors, not
code.**

## The translation table

| Their artifact | Your artifact |
|---|---|
| HCL fixture string in `_test.go` | CR YAML fixture (mostly mechanical; scriptable for flat CRDs) |
| Check function (admin-API asserts) | `api`-helper curl+jq asserts in the verify script |
| TestStep sequence | Ordered beats in one `verify.d/NN-<resource>.sh` |
| Re-plan empty diff | **No-churn guard** (below) |
| `CheckDestroy` | Delete CR → assert 404/absent |
| `ImportState` | Adopt semantics test (create out-of-band → apply matching CR → status ready, no duplicate) |
| CI version matrix | `verify/version-matrix.sh` loop over dockerized service versions |

Rule for wave agents: before implementing resource X, read
`provider/resource_<provider>_<x>_test.go` END TO END and port every TestStep,
including the weird ones — the weird ones are where the community's years of
edge-case knowledge live. Track it in `docs/TEST-PARITY.md`:
`provider test file → your script → beats covered → gaps`.

## Harness conventions (proven; copy them)

- `verify/verify.sh`: env-driven (`API_URL` + SA creds, `KCTL` override so the
  suite runs anywhere — laptop kubectl context or `sudo k3s kubectl` on a
  host), runs `verify.d/[0-9]*.sh` in order, N/N summary, nonzero exit on any
  failure.
- `verify/lib.sh` helpers: `api_token`, `api` (method/path/body), `api_status`
  (code only), `eventually TIMEOUT DESC CMD...` (retry loop), `await_ready
  KIND NAME` (kubectl jsonpath on `.status.ready`), `pass`/`fail`.
- Each script self-contained: prerequisites via RAW API calls (never other
  CRDs — keeps scripts independent and wave-parallel), unique resource names,
  cleanup at the end, tolerate 409 on prereq re-create.
- The four beats per resource: create → CR-patch update → out-of-band
  drift-heal (tamper via raw API; eventually reverted ≤2× resync interval) →
  delete + absence assert. Add negative beats where the reconciler validates
  (missing owner resource → `ready=false` with message → clean delete).

## The no-churn guard (their "empty re-plan", your version)

After a resource reaches ready, watch the operator log (or `status.lastSync`
progression) across two resync cycles and assert **zero UPDATE actions** — a
subset-diff false positive (masked secret, server-normalized field, primitive
default) shows up as an update every cycle. This catches an entire bug class
the four beats miss. Cheap to implement: grep the operator log for the
resource's UPDATE line count before/after a 2×interval sleep.

## Portability traps (each one produced a full red suite before diagnosis)

1. **`sh -c` + bash exported functions**: `export -f` helpers are invisible to
   dash, and Ubuntu's `/bin/sh` IS dash while macOS's is bash. A suite green
   on macOS fails every `eventually sh -c "... $(api_token) ..."` on Linux —
   while the operator is perfectly healthy. Use `bash -c` everywhere, always.
   Before diagnosing "operator broken", check whether the change actually
   landed (it had, in the reference build — only the assertions were broken).
2. **zsh reserved variables**: `GID` (also `UID`, `EUID`) are read-only
   integer builtins in zsh — assigning a UUID to one throws
   "bad math expression". Prefix your locals (`GRPID`).
3. **BSD vs GNU sed**: `\b` silently doesn't match on macOS sed — verify a
   bulk substitution actually changed something (`grep -c` after).
4. **Wrapped API assert latency**: on remote hosts run assert loops with the
   token minted inside the loop (tokens expire mid-suite on slow runs).

## Version matrix (mirrors their CI)

A loop script that `podman run`s the target service at each version their CI
tests, waits for health, points the suite at it, and reports per-version N/N.
The container the harness spins is the ONLY supported target — no dual-path
remote-instance logic (the target being env vars means anyone can override it
in one line anyway; that's the entirety of the "remote" story).
