---
name: spawn-herdr-tab
description: "Spawns a new herdr tab running a fresh top-level Claude Code or Codex session, with optional model, effort, and first prompt (e.g. to launch handoff docs). Use for \"spawn a herdr tab\", \"new tab\", \"open a new Claude/Codex for X\". Not a subagent."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    herdr: creates the tab and types the launch command into it
  requires:
    commands: [herdr, jq]
---

# Spawn herdr tab

A **tab** is a herdr tab with one pane running its own interactive Claude Code or Codex session: a peer, not a subagent (lives inside this session) or a background agent (`claude --bg`, no terminal). Once spawned it is a session you opened yourself, reachable with `SendMessage`.

1. **Gather the launch.** From the user's words, or by asking once for what's missing that changes the outcome:
   - **agent**: `claude` (default) or `codex`.
   - **model** and **effort**: only what the user gave. Not given → pass neither; the agent's own defaults apply.
   - **first prompt**: the task, or `read <handoff path> and continue` for a handoff. This is the session's first user message. None → the tab opens at an empty prompt.
   - **label** (short kebab-case tab name) and **cwd** (default: this session's cwd). Use a folder Claude already trusts; a new one stops at a trust prompt.
   Done when agent, prompt and label are settled; say the full launch in one line before step 2.
2. **Spawn.** Write the first prompt to a file, then run [`spawn.sh`](spawn.sh):

   ```sh
   bash <this folder>/spawn.sh --label <label> [--cwd <dir>] [--agent claude|codex] [--model <m>] [--effort <e>] [--prompt-file <file>] [--focus]
   ```

   It prints the new tab and pane ids. Flags it passes: Claude `--model`, `--effort`; Codex `-m`, `-c model_reasoning_effort=`.
3. **Verify.** After ~5 s, `herdr pane read <pane_id> | tail -15` shows the agent's UI with the prompt accepted (not a shell error). A folder-trust prompt is the user's call: tell them which tab is waiting on it. Done when every requested tab shows that; report each as `label → pane_id (agent, model, effort)`.

Several tabs (e.g. one per `/r2-handoff split` stream): repeat steps 2–3 per tab; spawning does not wait on any of them.
