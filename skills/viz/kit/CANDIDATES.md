# viz kit — promotion candidates

A running log of patterns noticed while building vizzes that *might* belong in the
kit. The point is to capture in the moment (cheap) but promote deliberately (a
separate review), so the kit grows from real repeated use instead of churning on
one-offs.

## How this works

- **During a viz build:** if you hand-roll something that smells generic — a
  component, a helper, a color/spacing decision you'd want consistent next time —
  add a one-line entry below. Don't stop to refactor the kit mid-build.
- **During a kit review (periodic):** scan recent vizzes + this log, and decide
  what actually graduates into `viz.js` / `viz-kit.css`. Promote a pattern once
  it's shown up in ~3+ vizzes or is clearly error-prone. Delete entries that got
  promoted or rejected.

A pattern earns promotion when it's **repeated** (re-derived across multiple
vizzes) or **error-prone** (something that caused rework). A clever one-off does
not — it just lives in its own viz.

## Format

`- [YYYY-MM-DD] <slug>: <what you re-derived> — <why it might belong in the kit>`

## Candidates

- [2026-07-16] skill-delegate-to-codex (+5 sibling posters): **"poster + dive" variant of the `--poster` template** — the stock template locks the page (`html,body{overflow:hidden}` + fixed `#fit`), so a card with a scrollable deep-dive below it needs a fork. The trap: `transform:scale()` doesn't shrink the layout box, so naively unlocking scroll reserves the full 630px and leaves a dead gap. Working fix: `transform-origin:top center` + `#fit{height:calc(630px * var(--s))}` + fit on `min(innerWidth/1200, 1)` (keeps the `--og` clip pixel-native). Re-derived across 6 vizzes and error-prone — a strong candidate for a `--poster --dive` scaffold flag rather than a hand-copied fork.

### Verdict on the poster+dive entry — VALIDATED, awaiting a build decision (2026-08-02)

Re-measured. The claim holds and is the **strongest convergence in the whole ledger**:
20 vizzes carry `viz:card`; exactly **6** are the dive fork, and all six are
**byte-identical** in the mechanism —
`#fit{ height:calc(630px * var(--s)); display:flex; justify-content:center; overflow:hidden; }`
plus `transform-origin:top center` plus `Math.min(innerWidth / 1200, 1)`. Compare
`.chip`, which was rejected for splitting four ways: this is literally the same code
six times, which is what a promotion is supposed to look like.

It cannot collapse into the stock poster as a default — the two differ in intent, not
just detail:

| | stock `--poster` | dive fork |
|---|---|---|
| page | `html,body{overflow:hidden}` | scrolls |
| `#fit` | `position:fixed;inset:0;place-items:center` | in-flow, `height:calc(630px * var(--s))` |
| `transform-origin` | `center` | `top center` |
| scale | `min(iw/1200, ih/630)` — fills the screen, upscales | `min(iw/1200, 1)` — never upscales |

On a 2560px display the stock poster scales to ~2.1 and fills; the dive variant stays
at 1 so the prose below it stays readable. Both are correct for their own job.

So it wants a `--poster --dive` scaffold (a second template + a modifier flag), not a
default and not a comment block — the failure mode is a *silent dead gap* under the
card, which is exactly the kind of thing that should be scaffolded rather than
explained. Not built yet: it adds public CLI surface, which is the owner's call.

## Promoted

- [2026-07-18] **`--c1..--c6` aliasing** → fixed by *declaration*, not by re-hueing: `--c1/--c2/--c3/--c6` are now defined as `var(--accent)/var(--good)/var(--warn)/var(--danger)`, so the aliasing is self-evident in source, cannot drift, and follows a re-theme. Renders byte-identically (verified in-browser), so the 23 files using an aliased slot are visually untouched. Added `--c7` indigo `#5d52b4` + `--c8` magenta `#b70385`, both validated ≥ΔE 15 from every intent color under CVD simulation, giving four meaning-free slots instead of two. **No orange slot exists** — the arc between `--danger` (27°) and `--warn` (80°) has nothing that clears; `#f0883e` is ΔE 1.5 from `--warn` under protanopia. Fully re-hueing the ramp remains open but is a downgrade on charm: with four intent colors occupying blue/green/amber/red, the only wide free arc is purple, so a de-aliased 7-slot ramp comes out purple-heavy (validated candidate on file: `#9136b7 #a95401 #01a597 #9e64ee #b72280 #6254dd #179dc7`, passes all five checks adjacent-pairs).

## Corpus scan — 2026-08-02 (161 vizzes, 16 containers)

Counts below are file-level (`grep -l`) over every `index.html` under every
`viz-pages/` in `$HOME`. Use them as the promotion evidence, not vibes.

- **`prefers-reduced-motion`** → **PROMOTED into `viz-kit.css`.** 108/161 vizzes
  animate; 3 guarded it. Per-viz guarding was never going to happen, so the kit
  now collapses durations to `0.01ms` (not `none`) for the 117 files that link it,
  retroactively. Durations are collapsed rather than removed so `transitionend`/
  `animationend` still fire and event-driven state machines don't deadlock.
- **The import snippet in `SKILL.md` IS the kit's discovery surface.** Adoption
  tracks presence in that one copy-paste line almost perfectly, not usefulness:
  `arrowMarkers` 48 · `saveHash`/`loadHash` 40 · `labelBox` 32 · `connect` 27 ·
  `side` 25 · `esc` 21 · `vizAudit` 10 — all listed. Not listed: `center` 6 ·
  `figureLifecycle` 1 · `stepper` **0** · `twoAxis` **0** · `vizEnv` **0**.
  `stepper` was promoted *because* ~20 vizzes hand-rolled it, then got zero uses
  because it never reached the snippet. **Lesson: promotion isn't done until the
  helper is in the SKILL.md import line.** Fixed 2026-08-02.
- **THE LEVER IS "OVERRIDE, DON'T RESTATE" — not more components.** Tested whether
  duplication is just the 43 non-kit vizzes. **It isn't.** Normalised per population
  (118 link the kit, 43 don't), kit users redefine kit components at the *same or a
  higher* rate: `.legend` 31 kit-linked redefs vs 15 non-kit; `.pill` 27 vs 8;
  `.foot` 30 vs 5. Adding `.chip`/`.step`/`.wrap` to the kit would inherit the same
  ~25% override rate, so promotion is a weak lever and this list should get *shorter*,
  not longer.
  The mechanism, measured on the 31 kit-linked `.legend` overrides: **6 change one
  property (correct usage); 17 restate six to eight** — i.e. they retype the kit's own
  `display:flex` (23), `flex-wrap:wrap` (23) and `gap` (25) values unchanged, because
  they needed one thing the kit doesn't provide and restating felt safer than a
  one-property override. **The one thing is outer spacing:** `margin`/`margin-top`
  appears 20 times, `padding` 4; the kit's `.legend` has none.
  Two cheap fixes, in order: (1) say **"override the property, don't restate the
  rule"** where components are introduced — it generalises to every component, costs
  one line, and is the actual defect; (2) decide whether kit components may own outer
  margin at all (they currently don't, which is orthodox, and is also why 20 files
  went around them).
- **TOKEN DRIFT is real but is a different, narrower problem — and it IS the non-kit
  population.** Only **3 of 37** files that invent a synonym token link the kit at all,
  so this is not a discipline failure inside kit-using vizzes; it is that ~27% of
  vizzes never load the kit, and outside it you invent a whole vocabulary. Not legacy:
  26 of those 43 were touched after the kit existed.
  ~100 custom-property definitions across the corpus are **synonyms for tokens the
  kit already has**, so a "duplicated component" usually can't be replaced by a kit
  component: the kit rule resolves `var(--border)` and the page only defines
  `--line`, so the border vanishes. Ranked drift:
  `--line` 25 → `--border` · `--stop` 12 → `--danger` · `--caution` 12 → `--warn` ·
  `--ink-dim` 10 / `--ink-faint` 9 → `--muted` / `--faint` ·
  `--rule` 8 / `--rule-faint` 6 → `--border` · `--paper` 13 / `--navy-0` 7 → `--bg` / `--panel` ·
  `--blue` 14 / `--green` 6 / `--violet` 5 → `--c1` / `--c2` / `--c7`.
  That last group is the worst: naming a token by **hue** rather than by **meaning**
  is precisely what the `--c1==--accent` aliasing warning above is about, and it
  guarantees the viz can't be re-themed.
  Genuine gap found in the same pass: **`--maxw` (6)** — the kit has no content-measure
  token, which is also why `.wrap` got re-derived at a dozen max-widths.
  Fix should be a **check, not an alias** — aliasing `--line: var(--border)` rewards the
  drift and doubles the token surface forever. Same shape as the hero nudge: catch it
  at authorship.
- **`.chip` (53 definitions) — does NOT converge; do not promote as-is.** First pass
  called this the strongest candidate on count alone; reading the bodies killed it.
  `display` splits four ways (inline-flex 16, flex 10, inline-block 9, **grid 7**) and
  only 8 of 53 are `text-transform:uppercase`. The `grid`/`flex` ones are a **container**
  wearing the same class name as an inline tag — two components, one name. Promoting
  the union would ship a component that is wrong for most of its call sites.
  Salvageable core if anyone wants it: `border-radius:999px` (19) +
  `border:1px solid var(--border)` (12+) + `background:var(--panel-2)` (14) — but that
  is `.pill` without the uppercase, so the honest move is a `.pill.plain` modifier,
  not a new component.
- **`.wrap` (52) — promote, with the number as a token.** The structure converges
  hard (`margin: 0 auto` in 50 of 52); the measure does **not** (12+ distinct
  max-widths, the most common appearing in only 8 files). So the duplication is the
  boilerplate, not the number — ship `.wrap { max-width: var(--maxw, 1200px);
  margin: 0 auto }` and add `--maxw` (independently found missing: 6 vizzes invented
  it). Per-viz tuning then costs one token, not a restated rule.
- **`.stat` / `.stat-row`** — the KPI tile (big number + label + optional delta).
  Cross-check against the `dataviz` skill's stat-tile anatomy before promoting, so
  the kit and that skill don't specify two different tiles.
- **REJECTED — `.lede` / `.eyebrow` / `.kicker`.** The names carry no shared meaning
  across the corpus, so there is nothing to promote: `.lede` is 12.5px in 9 files,
  11px in 8, **16px in 7** — an 11px lede and a 16px lede are opposite components (a
  caption vs a standfirst). `.kicker` is 19px in 9 and 13px in 6. Promoting any of
  these would pick one viz's meaning and impose it on the rest.
- **`.foot` (35) — the one survivor of that group.** Genuinely tight: 13px (11),
  12px (10), 12.5px (7) — all the same "small muted footer line". Weakest-but-real
  candidate, and note 30 of its 35 definitions are in kit-linked files, so it should
  land as a component *plus* the "override, don't restate" rule, or it will just be
  redefined too.
- **`.step`** (30) — the walkthrough step row. Should land *with* `stepper()`, as
  its default rendering, or `stepper()` keeps being invisible.
- **REJECTED — `.tier` / `.lane` / `.rail`.** Guessed these were one idea under three
  names; they are three loose ideas, and each is inconsistent *with itself*. `.tier`
  splits `display:flex` (10) vs `inline-block` (6); `.rail` splits
  `position:relative` (7) vs `absolute` (6) — that is a layout contract, not a style
  detail, so there is no union to ship. Swimlane scaffolding may still be a real gap,
  but it needs a designed model, not a harvest of these three names.
- **Not a candidate:** `.legend` (46 redefinitions) *exists* in the kit and its rule
  is **correct** — `display:flex; flex-wrap:wrap; gap; font-size; color` is exactly
  what the corpus converges on. Nothing to add but outer spacing; see the
  "override, don't restate" entry above, which is the real defect.
- **`verify.interactions.ts`** — 4 files corpus-wide against 44 vizzes with
  keyboard handlers and 108 that animate. Not a kit gap; a *docs* gap. Most
  interactive vizzes are being verified in their initial state only.

## Open — needs a decision

- [2026-07-18, **re-measured and corrected 2026-08-02**] **The intent palette collapses
  under CVD — but not where this entry originally said, and not for a fixable reason.**

  Original claim: `--warn`/`--good` are ΔE 5.1 apart under protanopia, fix by moving
  `--warn`. Re-measured with CIEDE2000 over Machado 2009 severity-1.0 simulations
  (script kept out of the repo; reproduce from the table below):

  | pair | normal | protan | deutan | tritan |
  |---|---|---|---|---|
  | good/**danger** | 71.7 | 19.7 | **3.1** | 70.1 |
  | good/warn | 36.5 | **5.9** | 8.2 | 53.4 |
  | warn/danger | 34.6 | 18.5 | **6.7** | 16.2 |
  | accent/good | 53.2 | 52.5 | 51.1 | **11.2** |

  The worst pair is **`--good` vs `--danger` at ΔE 3.1 under deuteranopia** — success
  vs error, the most meaning-critical pair in the set, effectively identical to the
  most common form of colour blindness. The original entry missed it entirely, so
  "move `--warn`" would not have fixed the real problem.

  **Root cause, and why re-hueing can't fix it:** `--accent` L\*=66.9, `--good` 66.8,
  `--warn` 67.0 — three of the four intent colours sit within **0.2 L\*** of each
  other. Equal lightness is what makes them collapse: when CVD destroys the red/green
  axis, lightness is the only channel left. Measured, `--good`'s a\* goes −55.3 → −4.4
  under deuteranopia and `--danger`'s +63.0 → −4.9; they land on top of each other,
  ΔL\* 1.8.

  Best achievable by splitting lightness while keeping the hue families and 4.5:1
  contrast on `--bg`: min ΔE **11.2** (from 3.1) at `--good:#59fc6f` / `--danger:#e14941`
  — still under the ≥15 bar used for the categorical ramp, needs a near-neon green,
  drops `--danger` contrast to 4.7:1, and changes 138 files.

  **Therefore the fix is not a colour change.** Never signal with colour alone (WCAG
  2.2 SC 1.4.1) — pair status with a glyph or label. The cheap way to make that the
  default rather than a discipline: bake the glyph into the existing `.pill.good` /
  `.pill.warn` / `.pill.danger` modifiers, so signalling by colour alone becomes the
  thing you have to opt *out* of. Not built — needs a decision, and it is the one item
  on this list with a 138-file blast radius.
- [2026-07-18] **`--faint`** (third text tier) — 72 files had re-derived one at half a dozen grays.
- [2026-07-18] **`.swatch.dot`** — 25 files abandoned `.swatch` and hand-rolled a round dot at five sizes; the missing shape was the blocker, not the component.
- [2026-07-18] **`.pill`** + intent modifiers — the `border-radius:999px` + `text-transform:uppercase` badge recurred in ~120 files.
- [2026-07-18] **`stepper()`** — ~20 vizzes hand-rolled arrow-key stepping, each getting a different subset of clamp / preventDefault / pause-on-manual-nav / hash-persistence right.
