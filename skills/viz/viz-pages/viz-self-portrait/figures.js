/* figures.js — the registry the guide renders against.
 *
 * Contract, one shape for every figure:
 *   steps            0 = a plain stop; N = scroll-scrubbed with N steps
 *   render(el, api)  el is the stop's .stop-fig; api.onStep(fn) registers the
 *                    step handler, which the guide drives from scroll or keys
 *
 * A figure never reads scroll position itself — it is handed a step index and
 * renders that index. That is what makes every figure equally driveable by
 * scrolling, by arrow keys, or by clicking a tick.
 *
 * The file split follows the bands: run = get going, good = what it can do,
 * understand + master = how it works underneath.
 */
import * as run from './fig-run.js';
import * as good from './fig-good.js';
import * as understand from './fig-understand.js';
import * as master from './fig-master.js';

export const FIGURES = {
  // 1 · Get Running
  why:       run.why,
  install:   run.install,
  ask:       run.ask,
  refine:    run.refine,

  // 2 · Get Good
  review:    good.review,
  forms:     good.forms,
  scaffolds: good.scaffolds,
  data:      good.data,
  library:   good.library,
  publish:   good.publish,
  access:    good.access,

  // 3 · Master
  session:   understand.session,
  runtime:   understand.runtime,
  internals: master.internals,
  map:       master.map,
  bars:      master.bars,
};
