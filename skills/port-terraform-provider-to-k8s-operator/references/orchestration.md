# Orchestration — parallel waves, effort ledger, merge cadence

The reference build's fan-out produced 9 resources from 9 parallel agents with
ZERO integration defects. That result came from structure, not luck. The
structure:

## Why it parallelizes

The chassis (built inline, first) decides everything hard ONCE: connection
handling, diff semantics, status contract, error/retry, delete policy, harness
helpers. After that each resource is three self-contained files in its own
package + one self-contained verify script — no shared-file edits, no
cross-agent dependencies. QOSDK discovers reconcilers via CDI, so there is no
central registration file to conflict on. If your framework has one, generate
or shard it.

## Pre-flight checklist (before launching any wave)

- Exemplar resource(s) e2e green against the live target.
- `docs/PATTERN.md` committed: package layout, the sync contract, e2e script
  conventions, numbering scheme (leave gaps: 10, 20, 30...), the sharp-edge
  list, and the RULES block (below).
- The provider's test files enumerated so each agent prompt can name the exact
  `_test.go` to port.

## The agent prompt template (adapt, don't shrink)

Every dispatch carries: (1) the repo path and an ORDER to read PATTERN.md,
the exemplar package, the chassis classes, and two existing verify scripts
FIRST; (2) the resource's spec fields, typed out — model them on the
provider's schema for that resource, decide sub-resource sync semantics
(null = unmanaged; exact-set convergence when present; protect built-ins) in
the prompt, not in the agent's head; (3) the exact provider test file to read
and port; (4) implementation notes for the API quirks you already know
(create-returns-no-body, id-required-on-update, masked fields); (5) the e2e
script beats, enumerated; (6) the RULES block:

- Do NOT touch common/, other packages, build files, or other verify scripts.
- Build must pass (`mvn -q package -DskipTests`) and the CRD must appear in
  the build output. Do NOT run kubectl/kind/e2e — no cluster from a worktree;
  integration runs after merge.
- chmod +x the verify script.
- Commit on your branch with a conventional message.
- Final message = raw data: branch, files, build result, gaps/deviations,
  API surprises. (Surprises feed the next wave's prompts — read them.)

## Worktree mechanics + the known trap

Launch agents with worktree isolation, one per resource. **Trap**: the
harness may cut the worktree from your CWD's repo, not the target repo. Put
the recovery in the prompt: "if your worktree lacks the operator sources,
create your own: `cd <repo> && git worktree add .claude/worktrees/<name> -b
agent/<name> main` and work there." In the reference build all agents
self-recovered because the first one's recovery became the visible convention.

Merging: agent branches share no files → merges are trivial. Merge as each
agent lands (don't barrier), rebuild, then run the FULL suite once after the
wave completes. Clean up: `git worktree remove` + delete `agent/*` branches
after merge. Verify `git ls-files | grep -c '.claude'` is 0 before pushing.

## Wave design

- Wave 1: the mechanically-same-shaped resources (most of the surface).
- Later waves: domains needing new chassis ground (different API sub-tree,
  plugin/component APIs, tree-shaped resources like nested flows) — build one
  exemplar inline for the new ground FIRST, then fan out its siblings.
- Scale worked in practice: 7 agents ≈ 4–6 min each, all parallel; a wave
  including merges + full e2e ≈ 20–40 min wall.

## Effort ledger discipline (the measurement IS a deliverable)

- Timestamp phase boundaries as they happen (recon start, chassis green,
  wave launches, suite green, deploy green) — reconstruct nothing.
- Record per-agent durations and token counts from the completion
  notifications at the moment they arrive.
- Count defects by phase: chassis defects found by the exemplar, integration
  defects found at merge (target: zero), harness defects found on new
  platforms.
- LOC via `find src -name '*.java' | xargs wc -l` + harness LOC, at the end.
- Write `EFFORT.md` with the caveats attached to the headline number:
  AI-orchestrated PoC ≠ production-hardened; a typed SDK was (or wasn't)
  free; porting a mature provider is easy mode — the provider already
  discovered every API trap; OWNERSHIP is the recurring cost.

## Sibling skill

`port-terraform-provider-to-ansible` is the same porting doctrine targeting an
Ansible collection instead of an operator (same recon phase, same
family/wave fan-out, same field-parity honesty). If the user wants both, run
the recon once and share the surface enumeration + quirk knowledge between
builds.
