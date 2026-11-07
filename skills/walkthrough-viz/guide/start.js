// walkthrough-viz's guide, injected into a throwaway build: the house product tour (driver.js plus
// tour.js), its steps from steps.json, and every step reported to the walkthrough page around it.
// It only starts when the page opens the app with ?tour, so the previous build beside it stays plain.
import { driver } from "./vendor/driver.js.mjs";
import { startTour } from "./tour.js";

if (new URLSearchParams(location.search).has("tour")) {
  const steps = await (await fetch(new URL("steps.json", import.meta.url))).json();
  // The app renders after its data loads: wait (up to 10 s) for the first step's target.
  const first = steps.find((s) => s.target)?.target;
  for (let i = 0; i < 100 && first && !document.querySelector(first); i++)
    await new Promise((r) => setTimeout(r, 100));
  // Put back what a walkthrough changes, so Start over begins where step 1 expects.
  for (const s of steps) {
    const el = s.reset && document.querySelector(s.reset.sel);
    if (!el || el.value === s.reset.value) continue;
    el.value = s.reset.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const tell = (m) => parent.postMessage({ tour: m }, "*");
  startTour(driver, steps, { onStep: tell, onDone: () => tell({ done: true }) });
}
