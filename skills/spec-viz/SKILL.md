---
name: spec-viz
description: "Alias for grill-me-viz's spec mode: turns a task into a spec page the user judges before any building starts (hero, examples, assumptions, plan, film, gated sign-off). Use when a Kelpie refine run drafts a task, or the user says \"spec viz\", \"spec this\", \"agree the spec\". Needs the viz skill."
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires:
    skills: [grill-me-viz, viz]
    commands: [bun]
  integrates:
    kelpie: the sign-off button runs `kelpie signoff`; the spec's folder is the task's run folder
    pr-viz: reads spec.json (pr-viz/reference/spec.md)
---

# Spec viz

This is now **spec mode of `grill-me-viz`**. Load that skill (Skill tool, "grill-me-viz") and follow its
"Spec mode" section; the name stays so Kelpie, `pr-viz` and old notes still find it.
