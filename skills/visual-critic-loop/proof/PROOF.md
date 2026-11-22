# Proof that the critic and the loop work

The critic was tested before the loop was built, on three questions, each answered beside a critic with no judgement so the result reads against chance rather than against a bar picked in advance. Runs, screenshots and the user's picks live in `~/.agents/state/visual-critic-loop/proof/`; the results page is the `critic-proof-results` viz.

## Results (2026-11-15)

| Test | Sonnet 5.5 | Opus 5.5 | No-judgement baseline |
|---|---|---|---|
| Planted faults caught, box must overlap the fault (50 faults, 10 pages) | 84% | 90% | random boxes 23%; its own boxes on the clean page 30% / 36% |
| Same, with a brief (Sonnet only) | 90% | | random boxes 17% |
| Median spread of the overall score, same screen run 5 times (20 screens) | 0.4 pts | 0.5 pts | random scorer 6.7 pts |
| Agrees with the user's blind pick of the better screen (25 decided pairs of 38) | 78%, p = 0.003 | 70%, p = 0.02 | coin flip 50% |
| Blocker or major issues per clean screen | 0.7, the user judged all 7 sampled made up; 0.3 with a brief | 0.6 | |
| Cost of the whole proof, list price | $2.45, 6 s per call | $6.74, 12 s per call | |

Sonnet was kept: level on faults and self-agreement, closer to the user, about 2.8 times cheaper.

Limits: 8 of the 10 fault pages are skill posters in one house style. The pairs the user could decide mostly had an obvious gap (one side empty or still loading), so nothing here shows the critic judging subtle differences. The fix commits used to build the pairs were a poor stand-in for taste: the user picked the fixed version on only 56% of them.

## Re-running it

From this skill's folder, with the viz server running (`P=~/.agents/state/visual-critic-loop/proof`):

1. `node proof/plant.ts <candidates.json> $P/screens 10`: renders candidate viz pages and plants 5 faults each, writing `truth.json` (each fault's kind and box).
2. `node proof/pairs.ts $P/pairs $P/screens/truth.json`: 30 before/after pairs from viz commits that say they fixed something visual, plus cross-page pairs. Decks and exports that print their own source are skipped.
3. `node proof/run.ts $P/screens/truth.json sonnet $P/runs 3 [briefs.json]` and the same with `$P/pairs/pairs.json`. It resumes, so a rerun only does what's missing. Move old verdicts aside first when the critic has changed.
4. The user picks pairs blind on a grill page (key in `$P/pairs/pick-key.json`), saved as `$P/picks.json` (`{"P1": "L" | "R" | "="}`).
5. `node proof/analyze.ts $P sonnet [opus ...]` prints every number with its baseline and writes `results.json`.

`proof/analyze.test.ts` covers the hit rule and the binomial test.

## The loop (2026-11-21)

Ten one-page tasks (`proof/loop-tasks.json`: 4 viz pages, 3 app screens, 2 demo pages, 1 three.js scene). An Opus 5.5 builder, isolated like the critic and given only the file tools, made each page once: arm A. Arm B forked that same builder session and ran the loop (`shoot.ts`, `round.ts`, fix) until it stopped, so the only difference between the two finals is the loop. Both finals were shot the same way and judged blind.

| | Loop wins | Alone wins | Ties | Sign test |
|---|---|---|---|---|
| The user's blind picks (7 pairs) | 6 | 0 | 1 | p = 0.016 |
| Opus judge, both side orders must agree (10 tasks) | 7 | 0 | 3 | p = 0.008 |

- 3 tasks were clean on the critic's first look, so the loop changed nothing and they count as ties; the user wasn't shown them. The other 7 stopped `clean` after 2 or 3 rounds; none hit `plateau` or `cap`.
- The loop also fixed things that aren't polish: on the checkout screen, a total that ignored its own discount and a pay button missing at phone width; on the CLI landing page, an install command cut off on a phone.
- Cost, list price: builder alone $3.73 for all 10; the loop added $7.15 (critic $0.37 of it, the rest the builder's fix turns) and 14 minutes. The judge cost $0.65.

Limits: the control is a builder that never looks at its work, not one that screenshots and reviews it itself, so this shows the loop beats no review, not that it beats self-review. All tasks were single pages built from scratch, and the judge's reasons sometimes match the critic's issues (both read the same screenshots).

Rerun, from this skill's folder with `L=~/.agents/state/visual-critic-loop/loop-proof`: `node proof/loop.ts proof/loop-tasks.json $L 3` (resumes per arm), build a blind pick page from `$L/<task>/final-{A,B}/` with the key in `$L/pick-key.json` (`{"T1": {"id": "...", "L": "A" | "B"}}`), save the picks as `$L/picks.json`, then `node proof/loop-judge.ts proof/loop-tasks.json $L $L/picks.json $L/pick-key.json`. `proof/loop-judge.test.ts` covers the side mapping and the sign test.
