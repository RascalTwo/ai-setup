# The spec: what the change promised

When a task came through Kelpie it has a **spec**: the page where the user and the refining agent
agreed what is being built (`spec-viz` writes it). r2-pr reads the spec's `spec.json` so the PR is checked against what was agreed, not against criteria the reviewer invented afterwards.

Find it: the task's folder, `~/.agents/state/kelpie/runs/<project>/<task-id>/spec.json`, or the
path the task points to. No spec → skip this file.

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

`demo` replaces the old `hero`: the personas are who the change alters (the AI's pick, at least one), each with what they do today (`before`) and what they will do (`after`). A persona is judged like an example. Every `should` example names its `persona` and is a step in that persona's journey, in array order; a `shouldnt` has none. The page also carries `demo.page`, `before.visual`, `visuals` and a `visual` on each item (pictures and the demo link); r2-pr ignores them. `verdict: "ok"` means the user judged it ✓. A `kinda` or `fix` that was never resolved blocks sign-off, so a
signed spec has none. `kind: "shouldnt"` is a non-example: a case that must not happen.

## What r2-pr does with it

1. **Proven from the examples.** The Proven line carries one criterion per signed example, in order, its text word for word. A `shouldnt` becomes "Does not: …". Never reword, drop or merge one, and add your own only after these. Each says what proves it; an example nothing proves says so plainly ("not proven yet"): the promise the user signed, unkept.
2. **Plan vs what happened.** If `plan` is present, Evidence opens with a table under that title: a row per plan step, with the planned step, what the diff did, and why they differ when they do. A step done as planned has the same text in both columns. Work the diff did that no step covers is a row with an empty plan cell. The agent was allowed to deviate (that was agreed); the row is how the reviewer sees it and why.
3. **Say the version.** When `version` > 1, Why ends with "Spec v2: <the latest `changes[].what`>", so the reviewer knows the target moved.
