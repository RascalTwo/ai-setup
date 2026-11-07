# Product tour library choice: research (2026-10-23)

Method: npm registry (`https://registry.npmjs.org/<pkg>`), npm downloads API (`https://api.npmjs.org/downloads/point/last-week/<pkg>`, week 2026-10-12 to 2026-10-18 for nextstepjs, last-week for the rest), GitHub API (`gh api repos/...`), jsDelivr file listings and shipped `.d.ts` files, bundlephobia. Anything not checked against one of those is marked unverified.

## Baseline: demo-tour.js (85 lines, own)

Source: `~/.agents/state/kelpie/runs/ai-setup/ai-demo-work-to-me/tour/demo-tour.js`. It loads `/demo-tour.json`, draws a ring (box-shadow spotlight) and a bubble, polls every 300 ms for a `done` condition (element value equals, or text contains and changed from the baseline), advances itself, posts `{demoTour:{step,n,of,before}}` to `window.parent`, and resumes after a reload via sessionStorage. It is zero-dependency and does exactly the "wait for the user's action" job. What it lacks: focus management, ARIA, Escape and arrow keys, scroll-into-view, cut-out of the spotlight (it uses a ring plus a dim box-shadow), shadow-DOM or iframe-in-iframe targets, and handling for targets that resize or scroll in containers other than the viewport.

## Per-candidate findings

### driver.js (nilbuild/driver.js)

- Licence: MIT (npm `license` field, GitHub SPDX `MIT`). Source: https://github.com/nilbuild/driver.js and https://registry.npmjs.org/driver.js
- Framework-agnostic, zero dependencies (registry `dependencies` is empty).
- Latest: 1.10.2, published 2026-10-18 (https://registry.npmjs.org/driver.js). GitHub pushed 2026-10-18, 1 open issue, ~26.9k stars. Weekly downloads 1,390,571.
- Wait for an action / advance: no "advance when condition true" option. What exists (from the shipped `dist/driver.js.d.ts`, https://cdn.jsdelivr.net/npm/driver.js@1.10.2/dist/driver.js.d.ts): step or global `advanceOnClick`, `waitForElement` (milliseconds to wait for the target to appear), `skipMissingElement`, `disableActiveInteraction`, and imperative `driver.moveNext()`, `movePrevious()`, `moveTo(index)`, `getActiveIndex()`. For "text changed" or "element appeared" you poll or use a MutationObserver and call `moveNext()` yourself (the same shape as the baseline's 300 ms interval).
- Report the step: step and global hooks `onHighlightStarted`, `onHighlighted`, `onDeselected`, `onPopoverRender`, `onNextClick`, `onPrevClick`, `onDestroyStarted`, `onDestroyed`. Each receives `(element, step, {config, state, driver, index, reason})`. Put your step id in `step.data` (`data?: Record<string, any>`), then `window.parent.postMessage({step: step.data.id}, '*')` inside `onHighlighted`.
- Injection: jsDelivr lists `dist/driver.js.iife.js` (27,804 bytes) plus `dist/driver.css` (3,322 bytes) alongside ESM and CJS, so a plain `<script>` injection works and exposes a global. Also ships optional `checklist` and `hints` modules (`dist/checklist.iife.js`, `dist/hints.iife.js`). The checklist API has a `completeWhen?: () => boolean` per item, a sign the author is moving toward condition-based completion, but that is checklist items, not tour steps (unverified whether it can drive a tour step).
- Size: bundlephobia 27,854 B min, 8,041 B gzip (https://bundlephobia.com/api/size?package=driver.js). Unpacked package 205,581 B.
- A11y: the minified source contains `aria-label`, `aria-labelledby`, `aria-describedby`, `role`, `.focus()` calls and ArrowRight/Escape handling (grep of `dist/driver.js.mjs`). No focus trap found in that grep (not exhaustively verified). Keyboard control is toggled by `allowKeyboardControl`.
- Theming: CSS classes plus `popoverClass`, `overlayColor`, `overlayOpacity`, `stagePadding`, `stageRadius`; `onPopoverRender` hands you the popover DOM for custom markup.

### Shepherd.js (shipshapecode/shepherd)

- Licence: AGPL-3.0 OR a paid commercial licence. The current `LICENSE.md` (https://github.com/shipshapecode/shepherd/blob/master/LICENSE.md) opens "Shepherd.js is dual-licensed under AGPL-3.0 (for open source and non-commercial use) and a Commercial License (for commercial use)". Free use is limited to open-source projects, personal/non-commercial use and evaluation (30 days). It states a commercial licence is required for any revenue-generating company, including internal tools and admin panels, and for client work and white-label. GitHub reports `NOASSERTION` (custom file).
- Licence history (npm registry per-version `license` field): 13.0.3 (2024-08-05) is MIT; 14.0.1 (2024-10-10) is the first AGPL-3.0 release, and every version since is AGPL-3.0, including latest 15.3.0. Surprising: the project relicensed from MIT to AGPL with a commercial option in Oct 2024. `react-shepherd` 7.0.6 is also AGPL-3.0. Commercial price is at shepherdjs.dev/pricing (not checked).
- Framework-agnostic core (deps `@floating-ui/dom`, `deepmerge-ts`); wrappers exist (react-shepherd, others unverified).
- Latest: 15.3.0, 2026-08-24; GitHub pushed 2026-10-22; 32 open issues; 13.8k stars. Downloads 228,283/week.
- Wait for an action: `advanceOn: { selector, event }` on a step (type `StepOptionsAdvanceOn` in https://cdn.jsdelivr.net/npm/shepherd.js@15.3.0/dist/js/shepherd.d.mts). It listens for a DOM event on a selector, so it fits clicks and inputs but not "text changed" or "element appeared". Also `beforeShowPromise`, `showOn`, `skipIfMissing`-style option with `waitForElement` (ms, MutationObserver with polling fallback), `canClickTarget`, `tour.next()`, `tour.show(id)`.
- Report the step: step `when: { show() {...} }` and tour/step events (`show`, `hide`, `before-show`, `complete`, `cancel`); `this.id` gives the step id. Step `id` is a first-class option, the nicest of the group for postMessage.
- Injection: the 15.3.0 file list shows only `dist/js/shepherd.mjs`, `dist/cjs/shepherd.cjs` and `dist/css/shepherd.css`; no UMD/IIFE in the package (unverified whether older versions or the CDN build exposes a global). Injecting needs ESM `import()` from a CDN or a bundle step.
- Size: bundlephobia 44,738 B min, 15,293 B gzip. CSS 3,504 B.
- A11y: best of the vanilla group by documentation: dialog `aria-label`/`aria-labelledby` handling is documented in the types; keyboard nav (Esc, arrows) and focus handling exist (details unverified beyond that).
- Theming: CSS file, `classes`, `modalOverlayOpeningPadding/Radius`, custom `text` HTML.

### Intro.js (usablica/intro.js)

- Licence: AGPL-3.0 (npm `license` for all recent versions); README says a commercial licence from introjs.com is required for commercial projects ("If you are using Intro.js for a commercial project, you would need to get a commercial license", versions before v2.0.0 exempt). Source: https://github.com/usablica/intro.js (README "License" section; `license.md` in repo). GitHub SPDX `NOASSERTION`.
- Framework-agnostic (zero deps); React wrapper separate (unverified).
- Latest: 8.6.0, 2026-09-21; pushed 2026-09-21; 52 open issues; 23.5k stars; 90,683/week.
- Wait for an action: no built-in. API is `introJs.tour().onBeforeChange(cb).onChange(cb)`, `nextStep()`, `goToStep(n)`, `goToStepNumber(n)` (from shipped `tour.d.ts`). You poll and call `nextStep()` yourself. `disableInteraction` option exists (unverified name via grep, not found in my grep).
- Report the step: `onChange`/`onBeforeChange` callbacks (the lowercase `onchange` forms are deprecated).
- Injection: `minified/intro.min.js` (74,102 B) and `minified/introjs.min.css` (8,638 B) are shipped, so plain `<script>` works.
- Size: bundlephobia 69,411 B min, 19,205 B gzip.
- A11y/theming: themes directory in repo; a11y details unverified.

### React Joyride (gilbarbara/react-joyride)

- Licence: MIT (npm and GitHub SPDX). https://github.com/gilbarbara/react-joyride
- React-only (peer `react` and `react-dom` 16.8 to 19). Cannot be injected into a vanilla built app without shipping React plus a bundle.
- Latest: 3.2.0, 2026-07-09; pushed 2026-07-09; 4 open issues; 7.9k stars; 773,877/week.
- Wait for an action: controlled mode. Set `stepIndex` (setting it switches Joyride to controlled mode per the shipped `index.d.mts`), and advance by updating state from your own listeners; events through `onEvent` (constants `EVENTS.STEP_AFTER`, `TOUR_END`, etc.). `targetWaitTimeout` style options exist (unverified).
- Report the step: `onEvent` callback; step `data` field (unverified exact name).
- Size: bundlephobia 75,288 B min, 25,596 B gzip; ten dependencies (floating-ui, scroll, etc.).
- A11y/theming: options-based styling and custom components (details unverified).

### Reactour (@reactour/tour)

- Licence: MIT. https://github.com/elrumordelaluz/reactour
- React-only (peer React 16 to 19).
- Latest: 3.8.0, 2025-05-07 (over 17 months old); last commit 2026-05-19; 82 open issues; 4.1k stars; 99,335/week.
- Wait for an action: no built-in; you call `setCurrentStep` from `useTour()`; `disableInteraction` prop (boolean or function) controls whether the target is clickable.
- Report the step: `currentStep` from the hook, plus `afterOpen` and `beforeClose` callbacks (from shipped `index.d.ts`). No per-step shown event found.
- Size: 20,504 B min, 7,152 B gzip.

### Onborda (uixmat/onborda)

- Licence: npm says MIT, but GitHub reports no licence file detected (empty SPDX), so MIT is the package metadata only; repo LICENSE not verified.
- Next.js + React + framer-motion only (peer deps next >=13, react >=18, framer-motion >=11, @radix-ui/react-portal). Unsuitable for injection.
- Latest: 1.2.5, 2024-12-22; pushed 2026-06-08; 15 open issues; 1.4k stars; 17,774/week. Effectively stale on npm.

### NextStep / nextstepjs (enszrlu/NextStep)

- Licence: MIT (npm and GitHub). Package name is `nextstepjs` (`nextstep` does not exist on npm). https://github.com/enszrlu/NextStep
- Next.js (peer next >=13, react >=18, `motion` >=11, react-router >=7). Not injectable.
- Latest: 2.3.0, 2026-07-20; 5 open issues; 55,766/week. Unpacked 107,939 B.

### Tour Guide JS (tourguidejs)

- Two different packages: `tourguidejs` 1.1.5 (BSD-3-Clause, 2023-08-29, LikaloLLC, 169/week, effectively dead on npm though the repo was pushed 2026-03-20) and `@sjmc11/tourguidejs` 0.0.27 (MIT, 2025-05-06, 5,570/week, 14 open issues, 737 stars, deps `sass` and `@floating-ui/dom`).
- Framework-agnostic, pre-1.0, small community. Step-wait and a11y features not verified. Not recommended as a default.

### Hopscotch / Bootstrap Tour

- Hopscotch (Apache-2.0): last release 0.3.1 in 2017, GitHub repo archived (pushed 2021-11-08). Dead.
- bootstrap-tour 0.12.0: 2017-10-03, no licence field on npm, Bootstrap-dependent. Dead.

### Other credible candidates found

Nothing new beyond the list that is both current and licensed permissively for injection; `driver.js` covers the niche. (A broader web search for additional libraries was not run; unverified that nothing else, e.g. smaller newer libs, is worth a look.)

## Comparison table

| Library | Licence | Agnostic? | Latest (date) | Downloads/wk | Open issues | Advance on user action | Report step | CDN/IIFE | Min / gzip |
|---|---|---|---|---|---|---|---|---|---|
| driver.js | MIT | yes | 1.10.2 (2026-10-18) | 1.39M | 1 | `advanceOnClick`, `waitForElement`, plus own watcher calling `moveNext()` | `onHighlighted(el, step, {index})`, `step.data` | IIFE + CSS shipped | 27.9 KB / 8.0 KB |
| Shepherd.js | AGPL-3.0 or paid commercial (MIT up to 13.0.3) | yes | 15.3.0 (2026-08-24) | 228K | 32 | `advanceOn:{selector,event}` (DOM events only), `tour.next()` | `when.show`, tour `show` event, step `id` | ESM/CJS only in 15.3.0 | 44.7 KB / 15.3 KB |
| Intro.js | AGPL-3.0 or paid commercial | yes | 8.6.0 (2026-09-21) | 91K | 52 | none; `nextStep()`/`goToStep()` from own watcher | `onChange`/`onBeforeChange` | minified bundle shipped | 69.4 KB / 19.2 KB |
| React Joyride | MIT | React only | 3.2.0 (2026-07-09) | 774K | 4 | controlled `stepIndex` + own state | `onEvent` | no | 75.3 KB / 25.6 KB |
| Reactour | MIT | React only | 3.8.0 (2025-05-07) | 99K | 82 | `setCurrentStep` from own watcher | `currentStep`, `afterOpen` | no | 20.5 KB / 7.2 KB |
| Onborda | MIT per npm, no repo licence detected | Next.js only | 1.2.5 (2024-12-22) | 18K | 15 | n/a | n/a | no | 479 KB unpacked |
| nextstepjs | MIT | Next.js only | 2.3.0 (2026-07-20) | 56K | 5 | n/a | n/a | no | 108 KB unpacked |
| @sjmc11/tourguidejs | MIT | yes, pre-1.0 | 0.0.27 (2025-05-06) | 5.6K | 14 | unverified | unverified | `dist/tour.js` main | 139 KB unpacked |
| Hopscotch / Bootstrap Tour | Apache-2.0 / none | yes | 2017 | ~5K / ~2K | dead | n/a | n/a | n/a | n/a |
| Own (demo-tour.js) | yours | yes | n/a | n/a | n/a | polling `done` rules | `postMessage` already | it is a script | about 3 KB source |

## Ranked shortlist (non-own)

1. driver.js. MIT, zero dependencies, actively maintained (release 4 days before this research, 1 open issue, 1.39M weekly downloads), the only mainstream option that ships an IIFE plus CSS suitable for plain `<script>` injection, and the smallest of the vanilla libraries. It has `waitForElement` for "element appears", `moveNext()` for programmatic advance, and `onHighlighted` plus `step.data` for reporting. The gap: no declarative "advance when text changes"; you still write the watcher (the same 10 lines as the baseline).
2. Shepherd.js, but only where the licence is bought or the project is open source. Best step model (step `id`, `advanceOn`, `when.show`, `beforeShowPromise`, `waitForElement`, documented ARIA labelling). The deal-breaker for default use: AGPL-3.0 with a commercial licence required for any revenue-generating company, explicitly including client work and internal tools; and no UMD in 15.3.0. Alternative if you want a permissive second option that is not Shepherd: React Joyride (MIT), but it is React-only and unsuitable for injection into vanilla apps.

Intro.js is ruled out for the same AGPL/commercial reason as Shepherd, and has no advantage on the wait-for-action requirement.

## Case for and against building our own

For: the baseline already does the hard part this use case needs (condition-based advance, postMessage of the step id, reload resume, iframe-only activation) in 85 lines with zero dependencies and no licence question, and the walkthrough pages are throwaway-ish agent output. Every library still needs the same watcher glue for "text changed" and "element appeared", so a library saves the bubble and spotlight geometry only.

Against: the baseline has no keyboard handling, focus management or ARIA, no scroll-into-view, a fixed 600 ms start delay, 300 ms polling instead of MutationObserver, a ring rather than a real cut-out, and per-project copies drift. Client work may be judged on accessibility. driver.js gives positioning, scroll, resize, overlay cut-out and basic ARIA for 8 KB gzip under MIT, so the incremental dependency cost is small.

Suggested default (judgement, not a finding): keep the step-schema and "done rule" watcher from demo-tour.js as a thin adapter, and swap its rendering for driver.js. Try it on one walkthrough before committing; one unverified risk is whether driver.js's overlay and focus behaviour interact well with the app's own focus handling when injected into an iframe (not tested).
