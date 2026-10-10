# The spec: what the change promised

When a task came through Kelpie it has a **spec**: the page where the user and the refining agent
agreed what is being built (`spec-viz` writes it). pr-viz reads the spec's `spec.json` so the review
checks the PR against what was agreed, not against criteria the reviewer invented afterwards.

Find it: the task's folder, `~/.agents/state/kelpie/runs/<project>/<task-id>/spec.json`, or the
path the task points to. No spec → skip this file; pr-viz works as before.

## spec.json

```jsonc
{
  "version": 2,                                   // bumps each time the user re-opens it
  "changes": [{ "v": 2, "what": "dropped undo; added snapping" }],   // why each version above 1 exists
  "task": { "project": "timeline-studio", "id": "ts-calendar-drag-edit", "title": "…" },
  "ask": "One line, in the agent's words.",
  "hero": { "done": ["three", "short", "ticks"], "scope": "Week view only. Month view is its own task." },
  "assumptions": [{ "id": "A1", "text": "…", "verdict": "ok" }],   // ok | kinda | fix
  "examples": [
    { "id": "E1", "kind": "should",    "text": "Drag Tuesday's 2h block to Thursday: it keeps its 2h.", "verdict": "ok" },
    { "id": "E2", "kind": "shouldnt",  "text": "Dropping on an overlap silently overwrites it.",         "verdict": "ok" }
  ],
  "plan": [{ "id": "P1", "step": "Add the drag handle to the stretch" }],
  "signedOffAt": "2026-10-10T12:00:00Z"
}
```

The page also carries `hero.slot`, `visuals` and a `visual` on each item (pictures); pr-viz ignores them. `verdict: "ok"` means the user judged it ✓. A `kinda` or `fix` that was never resolved blocks sign-off, so a
signed spec has none. `kind: "shouldnt"` is a non-example: a case that must not happen.

## What pr-viz does with it

1. **Seed `criteria`** (plan.md) from the signed `examples`, one AC each, in order: the title is
   the example's text, kept word for word. A `shouldnt` becomes an AC titled "Does not: …".
   Never reword, drop or merge one, and add your own only after these, marked as yours in `proof`.
   The trace (`trace` scene) then shows, per promised example, what proves it. An example nothing
   proves is `untested`, said plainly: the promise the user signed, unkept.
2. **Plan against what happened.** If `plan` is present, add a `compare` scene in the Proof
   chapter titled "Plan vs what happened": a row per plan step, `before` the planned step, `after`
   what the diff shows, `note` the reason when they differ. A step done as planned has the same text
   on both sides. Work the diff did that no step covers is a row with an empty `before`. The agent
   was allowed to deviate (that was agreed); the row is how the reviewer sees it and why.
3. **Say the version.** When `version` > 1, add a `chips` entry on the first Why scene, "spec v2",
   and carry the latest `changes[].what` into the Check these `feedback` line, so the reviewer
   knows the target moved.
