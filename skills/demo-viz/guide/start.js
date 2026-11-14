// demo-viz's guide, injected into a build (or a mock): the house product tour (driver.js plus
// tour.js), its steps from steps.json, every step reported to the demo page around it, and ▶ Play's
// fake cursor (ui-narration) doing a step's moves when the page asks. Only starts when the page opens
// the app with ?tour, so the previous build beside it stays plain.
import { driver } from "./vendor/driver.js.mjs";
import { startTour } from "./tour.js";

if (new URLSearchParams(location.search).has("tour")) {
  const steps = await (await fetch(new URL("steps.json", import.meta.url))).json();
  // The app renders after its data loads: wait (up to 10 s) for the first step's target.
  const first = steps.find((s) => s.target)?.target;
  for (let i = 0; i < 100 && first && !document.querySelector(first); i++)
    await new Promise((r) => setTimeout(r, 100));
  // Put back what a demo changes, so Start over begins where step 1 expects.
  for (const s of steps) {
    const el = s.reset && document.querySelector(s.reset.sel);
    if (!el || el.value === s.reset.value) continue;
    el.value = s.reset.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const tell = (m) => parent.postMessage({ tour: m }, "*");
  const tour = startTour(driver, steps, { onStep: tell, onDone: () => tell({ done: true }) });

  // ▶ Play: the page says go to step i, do these moves, or stop. A fake cursor does them (ui-narration).
  let narrate = null;
  let run = 0; // bumped by "stop": moves of an older run give up
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const prepare = async () => {
    if (!narrate) {
      await import("./ui-narration.js");
      narrate = window.__narrate;
      if (reduced) Object.assign(narrate.CFG, { glide: 1, hold: 150, afterClick: 300 });
    }
    return narrate;
  };
  // The setter comes from the element's own prototype: a select's value set through an input's is ignored.
  const setValue = (el, value) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // ui-narration's focusAndClick clicks whatever is on top at the pointer, and over a tour step that is
  // the tour's own overlay; so this runs its choreography (frame, glide, pulse) and presses the element itself.
  const press = async (n, el, mine) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    n.highlight(el);
    await n.moveTo(x, y, n.CFG.glide);
    await n.sleep(n.CFG.hold);
    n.hideBox();
    if (mine !== run) return; // "Do it myself" mid-glide: no click
    n.clickPulse(x, y);
    el.click();
    await n.sleep(n.CFG.afterClick);
  };
  const perform = async (id, moves) => {
    const mine = run;
    const n = await prepare();
    for (const m of moves) {
      if (mine !== run) return;
      const el = await n.waitFor(() => document.querySelector(m.click ?? m.select), 5000).catch(() => null);
      if (!el) continue;
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      await press(n, el, mine);
      if (mine !== run) return;
      if ("select" in m) setValue(el, m.value);
    }
    if (mine === run) tell({ played: id });
  };
  addEventListener("message", (ev) => {
    const p = ev.source === parent && ev.data?.play;
    if (!p) return;
    if (p.stop) {
      run += 1;
      narrate?.hideBox();
    }
    if (typeof p.goto === "number") tour.moveTo(p.goto);
    if (p.moves) perform(p.id, p.moves).catch(console.error);
  });
}
