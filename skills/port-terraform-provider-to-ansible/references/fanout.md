# Fan-out orchestration

## Family grouping

Group resources by API area so each agent amortizes learning one endpoint
neighborhood (~4–13 resources/family). From the Keycloak port (adapt names):
core container (realm), container sub-configs, keystores/components, identity
objects (users/groups/roles + memberships), clients, protocol mappers,
authorization sub-resources, federation + its mappers, IdPs + their mappers,
auth flows, misc/new-features.

**Dependency-chain the families**: mappers need clients; federation mappers
need federation; IdP mappers need IdPs; permission families may need users.
Express chains as `agent(head).then(() => parallel([dependents...]))` inside
one `parallel()` — independents start immediately, nothing waits that doesn't
have to.

## Pre-flight (before launching anything)

- All module names pre-registered in meta/runtime.yml (agents NEVER edit
  shared files — meta, README, module_utils, other families' files, git).
- Exemplars green, harness proven, local server up.
- Structured result schema so results aggregate mechanically.

## Agent prompt skeleton (fill the <>)

```
You are porting one resource family of terraform-provider-<x> to the greenfield
Ansible collection <ns>.<name>. Port FAITHFULLY — the provider is the spec.

REPO (write here): <path>
PROVIDER SOURCE (read-only spec): <clone path> — for each resource read
provider/resource_<x>_<name>.go AND its API-client counterpart <x>/<name>.go.

READ FIRST (the established pattern — copy it exactly):
- plugins/module_utils/{<x>_api,resource}.py
- plugins/modules/<the exemplars> ; tests/integration/test_exemplars.yml ; scripts/run-tests.sh

YOUR FAMILY: <key>  Resources: <list>  Family notes: <quirk hints, fixtures>

For EACH resource write plugins/modules/<x>_<name>.py:
- Full DOCUMENTATION (every provider schema field as a snake_case option with the
  provider's exact name), EXAMPLES, RETURN (end_state); doc fragment for auth.
- Subclass ResourceModule; params_to_api with camelCase overrides; SET_FIELDS
  for set-semantics lists; secrets no_log=True AND stripped via sanitize().
- Provider semantics are law: exhaustive vs additive sets, ForceNew ->
  delete+recreate only if the provider does it, server normalization gets
  normalized in the module — never weaken the idempotency test.
- Durations exposed as strings become integer seconds. TF plan/state mechanics
  (import, *_wo, regenerate-triggers) don't port — document each non-port.

TEST: tests/integration/test_<family>.yml modeled on the exemplar: module_defaults
group auth from env; fixtures namespaced test-<family>* only; block/always cleanup;
per module: create -> identical re-run asserted NOT changed (hard requirement) ->
check-mode update with diff asserted and no mutation -> real update -> absent ->
absent re-run NOT changed. Prereqs outside your family: existing modules or raw
uri in setup only.

RUN: scripts/run-tests.sh tests/integration/test_<family>.yml until failed=0.
Never print secret values.

HARD RULES: no git; no edits to meta/runtime.yml, README, LICENSE, module_utils/*,
other families' files. A module_utils bug: work around locally, report in quirks.

Return the structured result. quirks = effort-ledger material: what was hard,
what surprised you, where provider and live server disagreed.
```

Result schema: `{modules: [str], test_playbook: str, green: bool, recap: str,
quirks: [str], untestable: [{module, reason}]}` — require `green` to mean
"final PLAY RECAP failed=0", and treat quirks as a first-class deliverable
(they become EFFORT.md and every one is a from-scratch team's lost day).

## Recovery: interrupted runs (usage limits, crashes)

Parallel heavy agents can hit the platform usage limit mid-run; they freeze on
the refusal text while the workflow shows "running". Recovery that works:

1. Stop the workflow task.
2. Add one line to the agent prompt: *"A prior attempt was interrupted — some
   of your family's files may already exist in unknown states. Read what
   exists, audit it against the spec, fix/complete it — do not blindly rewrite
   good work, and do not trust that existing files are finished."*
3. Relaunch with `resumeFromRunId` once the limit window resets. File-side
   work survives; completed agents replay from cache.

## Data-source wave (after resources)

Same pattern, smaller: `*_info` modules, one exemplar hand-built first. Key
instruction: **port each data source's miss semantics from its Go read path**
(null-on-404 vs hard error with the provider's exact message — it varies
per data source, don't impose a convention).

## Parity-proof wave (after everything)

1. Preferred: `terraform providers schema -json` (init a stub config requiring
   the provider) → run the bundled `scripts/field-parity-audit.py
   --schema-json` — exact, composed schemas included, audits data sources too.
   It also **descends into nested blocks**: it reports `NESTED-FREEFORM`
   (provider enumerates a typed sub-block but the module left it a passthrough
   `type='dict'`) and `NESTED-MISSING-SUB` (some sub-fields absent). A nested
   block only shows up where the provider itself enumerates it (has `nested_type`/
   `block_types`), so "enumerate only where Terraform enumerates" is enforced for
   free — genuinely-opaque provider blocks never register as debt. Legitimate
   passthroughs (dynamic-key maps, whole-document JSON exports, TF-operation
   timeout blocks) go in the script's `NESTED_EXCEPTIONS` with rationale, exactly
   like `DS_ARTIFACTS`.
   Watch for: legacy alias registrations in provider.go (→ Ansible
   `plugin_routing` redirects, not duplicate modules) and data-source
   attributes declared optional but never read in the DS read path
   (declaration artifacts — verify against the Go, then add to the script's
   DS_ARTIFACTS with a comment).
2. If the registry release lags the HEAD you ported: the dump audits the
   released surface; HEAD-only resources need the static/manual path.
3. Fallback for unreleased/private providers: `--provider-src` static Go parse;
   composed schemas come back NEEDS-MANUAL → send a small agent wave to read
   the composition and fix/confirm with evidence.
