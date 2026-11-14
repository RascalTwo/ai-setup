---
name: demo-viz
description: "Demos a change by persona on a viz page, before beside after, with a fake cursor that plays it: a promised demo (a throwaway mock) in a refine run, a live demo (the real build) at the end of every build, where the human reacts as they go, decides Accept or Changes once, and Sends it to the build agent. Use for \"demo\", \"demo viz\", \"walk me through it\", \"walkthrough\", at build end to hand over, and in refine to make the promised demo. Needs the viz skill."
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires:
    skills: [viz, product-tour, ui-narration]
    commands: [bun]
  integrates:
    kelpie: Send runs `kelpie page` (or `kelpie approve`) from the task's run folder (the build agent's pane, and a comment on the task)
---

# Demo viz

The human judges a change by seeing whose life it changes, never by watching a command run: a command is not a person. A **persona** is someone whose experience the change alters (a user, an admin, a developer, the human as operator of their agents); `spec.json`'s `demo.personas` names them. When only developers are affected, show their experience, still as impact (what their work was like, what it is like now).

The page opens with the **impact summary** (walk.json's `impact`, a live page's top line; a promised demo's lives in the spec's `ask`): 2 or 3 plain sentences on who is affected, their life before, their life after, and why it matters. No commands, paths or data shapes. Bad: "`kelpie park` sets the task back to unrefined and moves it to the refine queue." Good: "When you set a task aside to rethink it, it now waits in the refine queue instead of being built. Before, a task you weren't sure about kept going, and you found out when it was done."

Under it, each persona's **before** beside their **after**, a short guide that says where to look and what to do, and **▶ Play**, which does the steps for the human with a fake cursor (the `ui-narration` skill's) and hands control back at ✋ Do it myself. The walkthrough is **at most 3 steps per persona**, the ones where the human sees that life change; a longer one loses someone reviewing with half their attention. Everything technical (the other examples, commands, data, measurements) goes in the notes, which open after the decision.

A demo is made twice. The **promised** demo comes in a refine run, before anything is built: the after is a throwaway mock with fake data, the before a real capture wherever one exists, and it sits at the top of the spec page, where the human judges it. The **live** demo comes at the end of every build: the real build, large, the previous build beside it, the promise one toggle away, every place the build differs from the promise marked, reactions (🎙 or 💬) filed under the persona and step on screen, one decision for the whole demo, and only then the agent's own notes. Send types the decision and every reaction, by step, into the build agent's pane.

**There is no fallback.** Every change gets a demo. When none can be set up, or before and after show no difference, stop: say so and why in plain words with your recommendation, and hand over with `kelpie review "<those words>"`. A PR draft, a code film or screenshots do not stand in for it. A single step that cannot be walked through by its nature (a real tick that opens a session, a recording of something slow) is a `clip` or a `capture` with its `why`; a broken demo is never that reason.

## Kinds

`kind` in walk.json says what the live demo runs. Pick by the change:

| Change | Usually | `kind` | The demo |
|---|---|---|---|
| Web app | user, admin | `web` | the real build with the guide (the house `product-tour`, injected into a throwaway build whose source is never changed), the previous build beside it |
| CLI | user, developer | `cli` | a guided terminal: each step is one real command the human presses, run in a sandbox on both versions |
| Skill, prompt or agent instructions | the human as operator | `agent` | the same prompt run against the old and the new version in a sandbox, two transcripts side by side, differing lines marked |
| Refactor or developer-only | developer | `dev` | the same developer task done in both checkouts, with measured numbers (steps, files touched, time, errors) as paired bars |

`$DEMO` below is this skill's folder; `<run>` is the task's run folder, holding `spec.json`; `<viz>` is the demo's viz folder.

## Steps

1. **Load viz** (Skill tool, "viz") in full mode. The page needs the live server: its stage, commands and Send are `api.ts` routes.
   **Done when:** `viz` runs and `<run>/spec.json` names `demo.personas`. Live also needs `signedOffAt`; promised works from the draft.

2. **Create the page and its skeleton.** `<mode>` is `promised` or `live`.

   ```sh
   viz create demo-<task-id> --from "$DEMO/template"
   rm <viz>/walk.json && bun "$DEMO/from-spec.ts" <run>/spec.json <viz>/walk.json --mode <mode>
   ```

   The skeleton copies the personas and has one step per `should` example, persona by persona in each persona's journey order, each naming its example and persona; a live skeleton pre-fills each step's `promised` from the example. It is the longest the walkthrough could be: step 3 cuts it down. The shape of every field is `template/walk.schema.ts`, commented line by line.
   **Done when:** `<viz>/walk.json` lists the steps to cut from.

3. **Write the impact, then the steps.** Fill every TODO. Write `impact` first (live; see above), then keep at most 3 steps per persona: the examples where their before and after differ most. Delete the other steps and, live, name each dropped example by id in `notes` (one line: what it checks, and that you checked it). Intro and outro steps count toward the 3.
   - **`say` names where to look and what to do, never what is right.** "Find Data migration (overnight): it runs Saturday 8 pm to Sunday 4 am", not "it correctly spans both days". The human judges; the guide only leads. The notes, your account and doubts, open after they decide.
   - **Web:** `target` is the control or area to spotlight. Give every step where they act a `done` (product-tour's `{sel, value}`, `{sel, text}` or `{sel}`), so the guide moves on when they do it; leave it out only where they just look. `reset` puts a control back when the guide starts. ▶ Play replays a step as its `act`, else the value of `done.sel`, else a click on `target`; `act` lists the moves (`[{"select": "#calspan", "value": "month"}, {"click": "#calnext"}]`) when doing the step is more than that. Pick elements that exist at any window size (a day's number, not its "+N more").
   - **Cli:** `run` is one real command; `look` the rows to highlight in its output. Play presses each Run button in turn.
   - **Agent:** each step's `clip` holds both transcripts, `src` (the new version's) and `before` (the old one's); `look` marks the lines that differ. Next advances both transcripts in step.
   - **Dev:** each step with an example carries `measure`, `[{label, before, after, unit}]`, numbers you took doing the same task in both checkouts. Each pair is drawn as two bars on its own scale.
   - **`before: true`** on the step where behaviour changed: the previous build shows beside this one from there on (web), or runs the same command from the same start (cli). An agent demo always shows both.
   - **`promised`** (live): the HTML of what the spec promised for this step, behind a toggle. **`differs`** (live): one plain sentence on how the build differs from that promise, written for every step where it does; the page marks the step ≠ in the persona strip, the step strip and a banner. Compare against the spec's example, and list every difference, including the small ones.
   - **A clip, not live,** for a step that can't be ready in under 30 seconds or would touch something real (their plan, their queue, a real pane, an agent session): `clip: {src, why}` shows a recording of your own run of it in the sandbox, `src` in the viz folder (`clip/S4.txt` for terminal output, a `.webm` from `browser-capture` for a screen), and `why` in one line ("A real tick opens a Claude session in your herdr; this is my run with a fake one").
   **Done when:** `bun "$DEMO/from-spec.ts" <run>/spec.json <viz>/walk.json <viz>` prints ✓: an `impact`, 1 to 3 steps per persona in journey order, every other ✓ example named in `notes`, nothing judging, no TODO, `differs` steps carrying their `promised`, agent steps with both clips, dev steps measured, clip and capture files present.

4. **Make the stage.**

   **Promised: build the mock** in `<viz>/mock/`, a throwaway static page with fake data that is clickable on every persona's journey; never in a real checkout. Point each step's `target`, `done` and `act` at its elements, then `bun "$DEMO/guide/inject.ts" <viz>/mock <viz>/walk.json`, and set `stage` to `{"now": "mock/index.html", "before": null}`. The before is a real capture wherever one exists: run the current app, CLI or agent, save a screenshot, terminal output or transcript in `<viz>/before/`, and name it in the step's `capture` (an agent step's `clip.before`); when the current app runs on its own port, `stage.before` is its URL instead. A persona whose work is brand new has nothing to capture: the spec's persona card carries the description. Pictures stand in only where nothing can be clicked (agent transcripts, CLI output): there `clip` holds the fake after and the real before. A promised walk.json has no `relay`, `yes` or `notes`.
   **Done when:** the page shows the mock with the guide's first bubble on its target, every persona's steps can be reached by doing them, and each persona with a real before shows it.

   **Live: stage throwaway copies** in `<run>/demo/`, never in a real checkout, data folder or port. Write the steps as a `stage.sh` and make `walk.json`'s `reset` run it (or the part that restores the start), so Start over is a clean start.
   - Both builds: `"$DEMO/sandbox/clone-pair.sh" <repo> <branch head> <base> <dir>` makes `<dir>/now` and `<dir>/before` (base: `git merge-base <base branch> <head>`). Install, build and start each on its own free port, against its own data.
   - **Web:** after each build, `bun "$DEMO/guide/inject.ts" <now>/dist <viz>/walk.json` copies product-tour and the ui-narration cursor into the built files and loads them; the guide starts only when the page opens the app with `?tour`. `stage` is the two URLs, and `token` a file holding the URL hash to open them with (a share token). `viz verify` counts the app's own failed requests as the page's errors: a request a local copy can't answer (a production cold-start ping) gets `"$DEMO/sandbox/front.ts" <port> <app's own server> '<path>=<json>'` in front of the app's server, which answers it and passes everything else through, WebSockets included.
   - **Cli:** each side gets its own HOME, state and config, and `$DEMO/sandbox` first on PATH: its `herdr` is a fake that answers and logs. `cmd` is how each side runs a step's args.
   - **Agent:** run the same prompt in a sandbox against the previous and the new version of the skill, prompt or instructions (its own HOME, a fake `herdr`, nothing real), once per step, and save each transcript.
   - **Dev:** pick one real developer task, do it in `<dir>/before` and `<dir>/now`, and note the numbers.
   - Worked examples: `fixtures/month-span/stage.sh` (web; Timeline Studio: its own S3 container, sync server, two builds behind `front.ts`, a seeded demo plan) and `fixtures/kelpie-park/stage.sh` with `cmd.sh` and `record-tick.sh` (cli; the kelpie CLI at two commits, each side its own plan, state and fake herdr; the tick step recorded as a clip). Each fixture's `spec.json` shows the shape a demo is made from.
   **Done when:** the page at its URL shows the running build (web: the guide's first bubble on its target) and Start over brings it back to step 1.

5. **Set the relay and record the clips** (live; skip the relay when promised). `relay.folder` is `<run>`: Send runs `kelpie page "<words>"` there, so Kelpie records the words on the task and types them into your pane as a `[kelpie] …` line. Outside a Kelpie run there is no pane to reach, and the page says so instead of claiming a Send. To try Send without a real task (a fixture, a rehearsal), `bun "$DEMO/fixtures/kelpie-run.ts" <sandbox> <spec.json> "$HERDR_PANE_ID"` makes a throwaway Kelpie run on the sandbox's Timeline Studio and prints the `relay` block, `env` included, that points Send at it and at your pane. Run each clip step yourself in the sandbox and save what it showed.
   **Done when:** every `clip.src`, `clip.before` and `capture` exists in the viz folder.

6. **Verify.** `viz verify <url>`: the template's `tests/walk.test.ts` drives the page from `walk.json`, reaching every step by doing it (web: the step's action inside the app, never the guide's Next), then ▶ Play through to the last step and ✋ Do it myself; live adds the decision gate and a Send that verify blocks, so it shows not-delivered with the words kept. Then do one demo yourself, to the end, in the browser, and press ▶ Play once and watch the cursor do each step.
   **Done when:** verify is clean and you reached every step by hand and saw Play do it.

7. **Hand it over.**
   **Promised:** give the URL to `spec-viz`: it is spec.json's `demo.page`, and the spec page embeds it at the top. There is no Accept or Send here; the human judges each persona on the spec page.
   **Live:** your handover opens with the impact summary (its first line is one sentence of it, which the board shows as the card's headline), then the URL and what they do: pick a persona, follow the guide or press ▶ Play, say anything the moment it strikes them, decide once at the bottom, press Send. Their decision and words arrive in your pane as a `[kelpie] Demo of <commit> …: Accepted|Changes. Steps reached n/m.` line with each reaction under its persona and step. Put what a yes does in `walk.json`'s `yes`, the same plain words as your "Approve?" line (on a deploy-on-approve project, with what `kelpie unpublished` lists): the page shows it beside Accept before anything is sent.
   **Accept approves.** Accept + Send runs `kelpie approve "<their words>"` from `relay.folder` (`template/approve.ts`), as the spec page's Sign off runs `signoff`: the words, comments included, go on the task, and Kelpie types "productionalize" into your pane, or the next tick restarts the run if the pane was closed. The page then says **Approved**, or **Not delivered** with the words kept. Make no build change after it beyond what productionalize needs. **Changes** + Send relays as below: fix what they said, stage again and hand over a fresh demo.

## What ▶ Play does

- Each step's moves are replayed with a visible cursor: web, the cursor inside the app does the step's `act` (else the `done.sel` value, else a click on `target`); cli, dev and agent, the cursor presses the guide's button, which runs the step's command on both sides or advances both transcripts. Steps with nothing to do (look-only) just dwell.
- Play, pause, back and forward, a position (`n / m`), the arrow keys and the persona buttons are the viz kit's `stepper` plus `template/play.ts`. Back and forward move the guide, not the build; Start over rewinds the build.
- ✋ Do it myself stops the cursor at once, mid-glide included, and leaves the build where it is for the human to carry on. `prefers-reduced-motion` turns the glide into a jump and the smooth scrolling off.
- The cursor is `ui-narration`'s: a web build carries its copy beside its guide (`inject.ts` puts it there); the page's own guided terminal loads it from its `api/narrate` route.

## What the page does about Send (live)

- Accept + Send approves the task (step 7) and then stays greyed out: there is nothing more to send. Changes + Send goes through the relay below.
- Send stays greyed out, with a line saying why, until Accept or Changes is picked; the notes stay out of the page until then.
- After Send the page says **Delivered** (in the pane and on the task), **Saved on the task; the agent gets it when it next runs.** (the agent's pane was closed; the same words on every page), or **Not delivered** with the reason, the words in a box with Copy, and Send again. Send goes through the viz kit's one relay (`viz/kit/server/kelpie-relay.ts`), as the spec page's does.
- Send relays first and doesn't wait on the feedback widget's own Send (which closes the tab and says "Sent ✓" whether or not anything reached the agent). A delivered or saved Send writes a `send` line to the page's feedback log, so the next Send carries only what was said after it.
- A promised page hides the decision and Send, and, framed in the spec page, hides its own header.

Why: the park prototype's Send "never arrived" because no decision was picked. Its Send was disabled, and a disabled button that says nothing looked pressed (reproduced 2026-10-24, task `ai-walkthrough-viz-skill`).
