---
name: product-tour
description: Joseph's house product tour, driver.js plus a theme and steps that move on when the user acts. Use whenever a web app or page needs a tour, onboarding, guided walkthrough or spotlight steps, in a real app or injected into a build for a demo.
rascaltwo-ai-setup:
  kind: skill
  state: false
---

Every tour is driver.js 1.10.2, pinned, with this folder's `tour.js` and `theme.css` on top. Joseph chose it over Shepherd.js (AGPL or paid, blocks clicks, jumps between targets), Intro.js (AGPL), the React/Next.js-only libraries and hand-rolled guides (`ai-tour-library-choice`, research in `.scratch/tour-library/research.md` on branch `agent/ai-tour-library-choice`). driver.js has no "move on when X happens" option, so `tour.js` adds it.

## Steps

1. **Write the steps** as data, one object per step: `{ id, say, target, done? }`. `say` is HTML. `target` is a selector (leave it out for a centred bubble). `done` is the user action that ends the step:
   - `{ sel, value }`: the element's value becomes `value` (a select, an input)
   - `{ sel, text }`: the element's text changes to include `text`
   - `{ sel }`: the element appears

   Give a step a `done` whenever the user does something on it, so the tour follows them; leave it out only where they just read. In a walkthrough, `say` names where to look and what to do, never what is right.

2. **Wire it in**, by where the tour runs:
   - **A real app:** `npm install --save-exact driver.js@1.10.2`; copy `tour.js` and `theme.css` into the app's source; load `driver.js/dist/driver.css` then `theme.css`; then

     ```js
     import { driver } from "driver.js";
     import { startTour } from "./tour.js";
     startTour(driver, steps, { doneText: "Got it" });
     ```

     Re-theme with the `--tour-*` variables in the app's own CSS.
   - **Injected into a built app** (walkthrough-viz, demos, throwaway builds): copy `vendor/` beside `tour.js` and `theme.css`, so nothing loads from the network, and `import { driver } from "./vendor/driver.js.mjs"`. Report steps to the page around it with `onStep: (s) => parent.postMessage({ tour: s }, "*")` and `onDone`.

3. **Prove it in a browser** (Puppeteer or Chrome): the first bubble shows on its target; doing each step's `done` action moves the tour on by itself; a click on the app outside the target still works; the last step ends it. Done when every step was reached by doing its action, not by pressing Next.

## Upgrading driver.js

Bump the pinned version on purpose only, and replace `vendor/` with that release's `dist/driver.js.mjs`, `dist/driver.css` and `LICENSE`. Then re-run step 3 and look at the rules marked `UPGRADE CHECK` in `theme.css`: they style driver's overlay `path` and override its `pointer-events`, which a release can change without saying so. The amber edge must still glide between targets, and clicks outside the target must still reach the app.
