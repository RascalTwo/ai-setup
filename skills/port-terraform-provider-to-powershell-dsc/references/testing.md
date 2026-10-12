# Testing paradigm — behavioral, live, orchestrator-run

Terraform providers ship acceptance tests, not mocked units: real API, real objects,
oracle = "apply twice → second is a no-op". The DSC equivalent, asserted per resource
against a LOCAL container:

```
create (Set Present) -> Test true          # applied
                     -> Test true again     # idempotent (the oracle)
drift out-of-band    -> Test false          # detects reality != desired
converge (Set)       -> Test true           # heals
delete (Set Absent)  -> Test true           # gone
```

A resource is **behaviorally green only when the orchestrator watched this cycle pass
live** — never on an agent's say-so (see enforcement.md).

## Per-family isolation: `Load-Family.ps1`

The module `.psm1` is one file, but a fix/prove agent should iterate on just its family
without loading other in-progress families. `Load-Family.ps1 -Family <name>` builds an
importable temp module = the base section of the `.psm1` (up to the first concrete class)
+ that family's scratch file + a factory scanned from its class names + the
`Invoke-<Svc>ResourceItem` function. The agent then drives its classes in isolation.

## Scaffolding & hygiene

- Each agent works in its OWN throwaway realm (`fw-<family>`), created first, deleted last
  — the local server is shared, so different realms = no data collision.
- Build parent resources with the already-proven base classes (a mapper needs a client or
  scope; a role-assignment needs users+roles; an authz policy needs an authorization-enabled
  client). Scaffold once per family.
- Drive resource ops through `Invoke-<Svc>ResourceItem` (re-fetches a token per call →
  survives long runs). If the harness makes raw admin calls, re-fetch the token frequently;
  a reused master token expires mid-run (401/403) — that's the harness, not the module.

## The harnesses to keep in the repo (proven on Keycloak)

- `Test-<Core>Lifecycle.ps1` — the single-resource oracle above (create→…→delete), the
  template every family test copies.
- `Test-Environment.ps1` — apply a real declarative `.psd1` reproducing an actual
  Terraform module, assert the resulting server state matches, re-apply idempotent, drift+heal.
  This is the adoption exhibit ("your exact TF config, in PowerShell").
- `Test-HeavyRealm.ps1` — a broad cross-section: scaffold + create→Test→delete for one
  resource per family, tallying a live pass-rate. The behavioral gate for breadth; every
  failure is a real bug (this is how the mapper name→uuid and role delete-by-name bugs
  surfaced).
- `Field-Parity-Audit.ps1` (scripts/) — the deterministic field gate.

## Blocked ≠ failed

Some resources genuinely need infra you can't run on a laptop (real LDAP/SMTP, external
IdP, enterprise-only features). Mark them `blocked` WITH the captured server error as
evidence, verify the request *shape* is correct, and put the ceiling in PARITY.md in bold.
"100% behaviorally proven locally" may top out slightly below 100% for exactly these —
that's honest, not a gap.
