# The spec: what the change promised

When a task came through Kelpie it has a **spec**: the page where the user and the refining agent
agreed what is being built (`spec-viz` writes it). pr-viz reads the spec's `spec.json` so the review
checks the PR against what was agreed, not against criteria the reviewer invented afterwards.

Find it: the task's folder, `~/.agents/state/kelpie/runs/<project>/<task-id>/spec.json`, or the
path the task points to. No spec → skip this file; pr-viz works as before.

## spec.json

```jsonc
{
  "version": 2,                                   // bumps on each correction round and each change of mind after sign-off
  "changes": [{ "v": 2, "what": "dropped undo; added snapping" }],   // why each version above 1 exists
  "task": { "project": "timeline-studio", "id": "ts-calendar-drag-edit", "title": "…" },
  "ask": "One line, in the agent's words.",
  "demo": {
    "scope": "Week view only. Month view is its own task.",
    "page": "http://127.0.0.1:5180/.../demo-ts-calendar-drag-edit/",   // the promised demo page, embedded at the top of the spec page
    "personas": [{
      "id": "P1", "who": "Planner rearranging a week",
      "before": { "text": "Edits start and end times by hand, block by block.", "capture": "real", "visual": "<img src=\"before/P1.png\">" },   // capture: real | described (brand-new, nothing to capture)
      "after": { "text": "Drags a block to a new day and it keeps its length." },
      "verdict": "ok"
    }]
  },
  "questions": [{ "id": "Q1", "text": "…", "options": [{ "id": "A", "label": "…" }], "answer": "A" }],   // optional: what the user chose
  "assumptions": [{ "id": "A1", "text": "…", "verdict": "ok" }],   // ok | kinda | fix | lost (didn't follow it)
  "examples": [
    { "id": "E1", "kind": "should",    "persona": "P1", "text": "Drag Tuesday's 2h block to Thursday: it keeps its 2h.", "verdict": "ok" },
    { "id": "E2", "kind": "shouldnt",  "text": "Dropping on an overlap silently overwrites it.",         "verdict": "ok" }
  ],
  "plan": [{ "id": "P1", "step": "Add the drag handle to the stretch" }],
  "signedOffAt": "2026-10-10T12:00:00Z"
}
```

`demo` replaces the old `hero`: the personas are who the change alters (the AI's pick, at least one), each with what they do today (`before`) and what they will do (`after`). A persona is judged like an example. Every `should` example names its `persona` and is a step in that persona's journey, in array order; a `shouldnt` has none. The page also carries `demo.page`, `before.visual`, `visuals` and a `visual` on each item (pictures and the demo link); pr-viz ignores them. `verdict: "ok"` means the user judged it ✓. A `kinda` or `fix` that was never resolved blocks sign-off, so a
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
