---
name: walkthrough-viz
description: "Turns a finished build and its signed spec.json into a guided walkthrough page: the human clicks through the real running build step by step, led by a guide, reacts as they go, decides Accept or Changes once, and Sends it to the build agent. Use at the end of a build to hand it over, or when the user says \"walkthrough\", \"walk me through it\" or \"walkthrough viz\". Needs the viz skill."
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires:
    skills: [viz, product-tour]
    commands: [bun]
  integrates:
    kelpie: Send runs `kelpie page` from the task's run folder (the build agent's pane, and a comment on the task)
---

# Walkthrough viz

The human judges finished work by **doing** it on the real build, not by reading about it. The page is a **walkthrough**: the real build large, a guide that says where to look and what to do, one step at a time, the previous build beside it where behaviour changed, reactions (🎙 or 💬) filed under the step on screen, one decision at the end, and only then the agent's own notes. Send types the decision and every reaction, by step, into the build agent's pane.

Two kinds: **web** (the house `product-tour` guide injected into a throwaway build of the app; the app's source is never changed) and **cli** (a guided terminal: each step is one real command the human presses, run in a sandbox). Skill, prose and refactor changes have no walkthrough yet.

`$WALK` below is this skill's folder; `<run>` is the task's run folder, holding the signed `spec.json`.

## Steps

1. **Load viz** (Skill tool, "viz") in full mode. A walkthrough needs the live server: its stage, commands and Send are `api.ts` routes.
   **Done when:** `viz` runs and `<run>/spec.json` has `signedOffAt`.

2. **Create the page and its skeleton.**

   ```sh
   viz create walk-<task-id> --from "$WALK/template"
   rm <viz>/walk.json && bun "$WALK/from-spec.ts" <run>/spec.json <viz>/walk.json
   ```

   The skeleton has one step per ✓ `should` example, in the spec's order, each naming the example it shows. The shape of every field is `template/walk.schema.ts`, commented line by line.
   **Done when:** `<viz>/walk.json` lists a step for every ✓ example.

3. **Write the steps.** Fill every TODO. Split an example into as many steps as it takes to see it; add an intro or an outro step (no `example`) only when needed. Five or six steps is a walkthrough someone finishes in under five minutes.
   - **`say` names where to look and what to do, never what is right.** "Find Data migration (overnight): it runs Saturday 8 pm to Sunday 4 am", not "it correctly spans both days". The human judges; the guide only leads. The notes, your account and doubts, open after they decide.
   - **Web:** `target` is the control or area to spotlight. Give every step where they act a `done` (product-tour's `{sel, value}`, `{sel, text}` or `{sel}`), so the guide moves on when they do it; leave it out only where they just look. `reset` puts a control back when the guide starts (the app may remember it). `act` lists the moves the journey test makes when doing the step is more than setting `done.sel` or clicking `target` (`[{"select": "#calspan", "value": "month"}, {"click": "#calnext"}]`); pick elements that exist at any window size (a day's number, not its "+N more").
   - **Cli:** `run` is one real command; `look` the rows to highlight in its output.
   - **`before: true`** on the step where behaviour changed: the previous build (the branch's base) shows beside this one from there on (web), or runs the same command from the same start (cli).
   - **A clip, not live,** for a step that can't be ready in under 30 seconds or would touch something real (their plan, their queue, a real pane, an agent session): `clip: {src, why}` shows a recording of your own run of it in the sandbox, `src` in the viz folder (`clip/S4.txt` for terminal output, a `.webm` from `browser-capture` for a screen), and `why` in one line ("A real tick opens a Claude session in your herdr; this is my run with a fake one").
   **Done when:** `bun "$WALK/from-spec.ts" <run>/spec.json <viz>/walk.json <viz>` prints ✓ (every example shown, in order, nothing judging, no TODO, clips present).

4. **Stage the throwaway copies** in `<run>/walkthrough/`, never in a real checkout, data folder or port. Write the steps as a `stage.sh` and make `walk.json`'s `reset` run it (or the part that restores the start), so Start over is a clean start.
   - Both builds: `"$WALK/sandbox/clone-pair.sh" <repo> <branch head> <base> <dir>` makes `<dir>/now` and `<dir>/before` (base: `git merge-base <base branch> <head>`). Install, build and start each on its own free port, against its own data.
   - **Web:** after each build, `bun "$WALK/guide/inject.ts" <now>/dist <viz>/walk.json` copies product-tour into the built files and loads it; the guide starts only when the page opens the app with `?tour`. `stage` is the two URLs, and `token` a file holding the URL hash to open them with (a share token). `viz verify` counts the app's own failed requests as the page's errors: a request a local copy can't answer (a production cold-start ping) gets `"$WALK/sandbox/front.ts" <port> <app's own server> '<path>=<json>'` in front of the app's server, which answers it and passes everything else through, WebSockets included.
   - **Cli:** each side gets its own HOME, state and config, and `$WALK/sandbox` first on PATH: its `herdr` is a fake that answers and logs. `cmd` is how each side runs a step's args.
   - Worked examples, one of each kind: `fixtures/month-span/stage.sh` (Timeline Studio: its own S3 container, sync server, two web builds behind `front.ts`, a seeded demo plan) and `fixtures/kelpie-park/stage.sh` with `cmd.sh` and `record-tick.sh` (the kelpie CLI at two commits, each side its own plan, state and fake herdr; the tick step recorded as a clip). Their walk.json are in `~/.agents/state/viz/walk-fixture-*/`.
   **Done when:** the page at its URL shows the running build (web: the guide's first bubble on its target) and Start over brings it back to step 1.

5. **Set the relay and record the clips.** `relay.folder` is `<run>`: Send runs `kelpie page "<words>"` there, so Kelpie records the words on the task and types them into your pane as a `[kelpie] …` line. Outside a Kelpie run there is no pane to reach, and the page says so instead of claiming a Send. To try Send without a real task (a fixture, a rehearsal), `bun "$WALK/fixtures/kelpie-run.ts" <sandbox> <spec.json> "$HERDR_PANE_ID"` makes a throwaway Kelpie run on the sandbox's Timeline Studio and prints the `relay` block, `env` included, that points Send at it and at your pane. Run each clip step yourself in the sandbox and save what it showed.
   **Done when:** every `clip.src` exists in the viz folder.

6. **Verify.** `viz verify <url>`: the template's `tests/walk.test.ts` drives the page from `walk.json`, reaching every step by doing it (web: the step's action inside the app, never the guide's Next), then the decision gate and a Send that verify blocks, so it shows not-delivered with the words kept. Then do one walkthrough yourself, to the end, in the browser.
   **Done when:** verify is clean and you reached every step by hand.

7. **Hand it over.** Give the URL and say what they do: follow the guide, say anything the moment it strikes them, decide once at the bottom, press Send. Their decision and words arrive in your pane as a `[kelpie] Walkthrough of <commit> …: Accepted|Changes. Steps reached n/m.` line with each reaction under its step. Put what a yes does in `walk.json`'s `yes`, the same plain words as your "Approve?" line (on a deploy-on-approve project, with what `kelpie unpublished` lists): the page shows it beside Accept before anything is sent.
   **Accept approves.** Accept + Send runs `kelpie approve "<their words>"` from `relay.folder` (`template/approve.ts`), as the spec page's Sign off runs `signoff`: the words, comments included, go on the task, and Kelpie types "productionalize" into your pane, or the next tick restarts the run if the pane was closed. The page then says **Approved**, or **Not delivered** with the words kept. Make no build change after it beyond what productionalize needs. **Changes** + Send relays as below: fix what they said, stage again and hand over a fresh walkthrough.

## What the page does about Send

- Accept + Send approves the task (step 7) and then stays greyed out: there is nothing more to send. Changes + Send goes through the relay below.
- Send stays greyed out, with a line saying why, until Accept or Changes is picked; the notes stay out of the page until then.
- After Send the page says **Delivered** (in the pane and on the task), **Saved on the task; the agent gets it when it next runs.** (the agent's pane was closed; the same words on every page), or **Not delivered** with the reason, the words in a box with Copy, and Send again. Send goes through the viz kit's one relay (`viz/kit/server/kelpie-relay.ts`), as the spec page's does.
- Send relays first and doesn't wait on the feedback widget's own Send (which closes the tab and says "Sent ✓" whether or not anything reached the agent). A delivered or saved Send writes a `send` line to the page's feedback log, so the next Send carries only what was said after it.

Why: the park prototype's Send "never arrived" because no decision was picked. Its Send was disabled, and a disabled button that says nothing looked pressed (reproduced 2026-10-24, task `ai-walkthrough-viz-skill`).
