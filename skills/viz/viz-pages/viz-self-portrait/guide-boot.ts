import { buildRail, buildBands, positionRail, watchScroll, scrollScrub, jumpTo, stopFromHash } from './guide.js';
import { FIGURES } from './figures.js';

buildRail(document.getElementById('guide-rail')!);
buildBands(document.getElementById('guide-bands')!, FIGURES);

// Mount each figure and wire its step handler to the scrub driver. A figure
// never reads scroll itself — it is handed an index and renders it, which is
// what makes scroll, arrow keys and tick-clicks all drive the same code path.
for (const [id, fig] of Object.entries(FIGURES)) {
  const el = document.getElementById('fig-' + id)!;
  // Assigned inside render(), which flow analysis can't see, hence the cast.
  let onStep = null as ((i: number) => void) | null;
  try {
    fig.render(el, { onStep: fn => { onStep = fn; } });
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
addEventListener('guide:shown', e => {
  relayout();
  if (e.detail?.stop) requestAnimationFrame(() => jumpTo(e.detail.stop!));
});
addEventListener('load', () => {
  relayout();
  // Restore a deep link like #guide&stop=posture once geometry is real.
  const s = stopFromHash();
  if (s) requestAnimationFrame(() => jumpTo(s));
});
if (document.fonts?.ready) document.fonts.ready.then(relayout);
relayout();
watchScroll();
