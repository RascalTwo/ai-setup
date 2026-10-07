import {
  buildRail,
  buildBands,
  positionRail,
  watchScroll,
  scrollScrub,
  jumpTo,
  stopFromHash,
} from "./guide.js";
import { FIGURES } from "./figures.js";

buildRail(document.querySelector("#guide-rail")!);
buildBands(document.querySelector("#guide-bands")!, FIGURES);

// Mount each figure and wire its step handler to the scrub driver. A figure
// never reads scroll itself — it is handed an index and renders it, which is
// what makes scroll, arrow keys and tick-clicks all drive the same code path.
for (const [id, fig] of Object.entries(FIGURES)) {
  const el = document.querySelector<HTMLElement>(`#fig-${CSS.escape(id)}`)!;
  // Assigned inside render(), which flow analysis can't see, hence the cast.
  let onStep = null as ((i: number) => void) | null;
  try {
    fig.render(el, {
      onStep: (fn) => {
        onStep = fn;
      },
    });
  } catch (err) {
    // One broken figure must not take the whole journey down with it.
    el.innerHTML = '<p class="fig-foot">This figure failed to render — see the console.</p>';
    console.error('[guide] figure "' + id + '" failed:', err);
    continue;
  }
  if (fig.steps && onStep) scrollScrub(id, { n: fig.steps, onStep });
}

// The rail measures real document geometry, so it can only be laid out once
// the guide is actually visible — a display:none panel measures as zero.
const relayout = () => requestAnimationFrame(positionRail);
addEventListener("guide:shown", (e) => {
  relayout();
  // dashboard.ts dispatches a CustomEvent whose detail is { stop?: string | null }.
  /* c8 ignore next -- dashboard.ts always dispatches guide:shown as a CustomEvent with an object detail; the checks only narrow `unknown` */
  const detail: unknown = e instanceof CustomEvent ? e.detail : null;
  /* c8 ignore next -- dashboard.ts always dispatches guide:shown as a CustomEvent with an object detail; the checks only narrow `unknown` */
  const stop = detail && typeof detail === "object" && "stop" in detail ? detail.stop : null;
  if (typeof stop === "string" && stop) requestAnimationFrame(() => jumpTo(stop));
});
addEventListener("load", () => {
  relayout();
  // Restore a deep link like #guide&stop=posture once geometry is real.
  const s = stopFromHash();
  if (s) requestAnimationFrame(() => jumpTo(s));
});
relayout();
watchScroll();
// Last, so awaiting it delays nothing above: re-lay out once web fonts change glyph widths.
if (document.fonts) {
  await document.fonts.ready;
  relayout();
}
