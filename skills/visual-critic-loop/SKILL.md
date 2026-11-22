---
name: visual-critic-loop
description: "Puts visual work (a UI, viz page, demo, 3D render, animation frame) through rounds with a no-code critic that scores screenshots and returns located, ranked issues, until nothing serious is left. Use before handing over visual work you built or changed (a viz page, demo, UI screen, 3D render), and when the user asks for a critic loop, a visual critic or an art-director pass. Skip it for a tweak too small to change how a screen reads."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  requires:
    commands: [node, claude]
    manual: [Chrome]
---

# visual-critic-loop

You are the builder. The **critic** is a separate, isolated `claude -p` call that writes no code and sees only pictures: no source, no CLAUDE.md, no skills. Each **round** it scores the screenshots 0 to 10 on legibility, layout, hierarchy and polish, and lists issues as blocker, major or minor, each with a box on the screenshot. You fix, re-shoot, and run the next round until the **stop rule** fires. The commands below run from this skill's folder.

The critic was proved before this loop existed (planted faults, repeat scoring, the user's blind picks): [proof/PROOF.md](proof/PROOF.md). The loop was then proved on 10 one-page tasks: builds that went through it won every blind pick that wasn't a tie, against the same builder alone (same file).

## Steps

1. **Write the brief.** One short paragraph: what the screens are for, and every intentional choice a stranger might take for a bug (content continuing below the window, a card meant to be screenshotted alone, a deliberately dense table). Without a brief, the critic called the intended layout of 4 of 10 clean pages a major fault; with one, it stopped. Add 0 to 5 **task checks**, one per line, for what the request specifically asked for ("the before and after sit side by side"). *Done when* the brief names the purpose and each intentional oddity, and every check is something you can see in a screenshot.
2. **Open a run folder**: `RUN=~/.agents/state/visual-critic-loop/runs/<slug>-<yyyy-mm-dd>`. Brief and checks freeze into it on round 1; later rounds reuse them and refuse new ones, so the goalposts hold still.
3. **Shoot round N** into `$RUN/shots-N/`:
   - A web page: `node shoot.ts <url> $RUN/shots-N` (1280 and 390 wide, one screen each; `--screens 3` for a page read by scrolling, `--frames 8` for motion).
   - Anything else (a 3D render, a film, a native app): save PNG screenshots there yourself, a few views at most.
4. **Run the round**: `node round.ts $RUN --brief brief.md --checks checks.md $RUN/shots-N` (round 1; drop the two flags after). It prints the score trend, the ranked issues with boxes, each check, and a last line: `CONTINUE` or `STOP <reason>`.
5. **On CONTINUE, fix** the blocker and major issues worst first, and minor ones only where cheap. The box is `x,y,width,height` in that screenshot's pixels; open the PNG when the words don't locate it. Then go to step 3 with N+1. *Done when* `round.ts` prints `STOP`.
6. **Hand over**: the score trend, the stop reason, the final screenshots, and for `plateau` or `cap` every serious item still open. Only `STOP clean` means the critic has nothing serious left; anything else, say plainly what's left.

## The stop rule

Whichever comes first, decided by `decide()` in `round.ts`:

- **clean**: no blocker or major issue left, and every task check passes.
- **plateau**: the overall score rose less than 0.5 over two rounds. The critic's own run-to-run wobble is about 0.2 SD, so a smaller rise is noise.
- **cap**: 4 rounds.

## Reference

- **Critic**: `critic.ts` pins the model (Sonnet 5.5 by default; the proof chose it over Opus 5.5 on cost with equal or better results), the effort, `prompt.md` and `schema.json`. It takes PNG only. A round costs about $0.01 to $0.03 and 6 to 10 seconds.
- **Re-prove after a change**: editing `prompt.md`, `schema.json`, the model, the effort or the brief wording in `critic.ts` changes the critic, so rerun the proof before trusting it again ([proof/PROOF.md](proof/PROOF.md)).
- **Known limits**: it's stricter than the user about small grey text, and on one page it caught a slight misalignment or a half-clipped label in only 2 or 3 of 5 runs.
