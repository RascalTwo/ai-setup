/* Disposable — walks the guide and shoots every stop, plus a couple of
 * mid-scrub states, because a plain verify run only ever sees state 1.
 * Delete once the rebuild is signed off. */
export default async (page, { shot }) => {
  const stops = ['why', 'install', 'ask', 'refine',
                 'review', 'forms', 'scaffolds', 'data', 'library', 'publish', 'access',
                 'session', 'runtime', 'internals', 'map', 'bars'];

  for (const id of stops) {
    // Scrubbed stops are tall and pinned; land ~40% in so the figure has
    // actually advanced past its opening step.
    await page.evaluate((sid) => {
      const el = document.getElementById('stop-' + sid);
      if (!el) return;
      const scrub = el.classList.contains('scrub');
      const run = Math.max(1, el.offsetHeight - window.innerHeight);
      window.scrollTo({ top: el.offsetTop + (scrub ? run * 0.4 : -20), behavior: 'instant' });
    }, id);
    await new Promise(r => setTimeout(r, 320));
    await shot(id);
  }

  // Every install tab. A plain run only ever sees the first one, and the whole point of
  // the tabs is that the OTHER ways in are documented — an unseen tab is an undocumented
  // install path. Shoot each so a regression in one is visible.
  for (const way of ['agents', 'chat', 'none', 'dev']) {
    await page.evaluate((w) => {
      const el = document.getElementById('stop-install');
      if (el) window.scrollTo({ top: el.offsetTop - 20, behavior: 'instant' });
      const tab = document.querySelector(`.inst-tab[data-way="${w}"]`);
      if (tab) (tab as HTMLElement).click();
    }, way);
    await new Promise(r => setTimeout(r, 260));
    await shot(`install-${way}`);
  }

  // A late step of the runtime tracer, on a non-default scenario.
  await page.evaluate(() => {
    const btns = document.querySelectorAll('#rt-picker button');
    if (btns[3]) (btns[3] as HTMLElement).click();
    const el = document.getElementById('stop-runtime');
    if (el) {
      const run = Math.max(1, el.offsetHeight - window.innerHeight);
      window.scrollTo({ top: el.offsetTop + run * 0.85, behavior: 'instant' });
    }
  });
  await new Promise(r => setTimeout(r, 320));
  await shot('runtime-late');

  // The five-bar "show me" highlight.
  await page.evaluate(() => {
    const b = document.querySelector('.bar[data-bar="4"] .bar-show');
    if (b) (b as HTMLElement).click();
  });
  await new Promise(r => setTimeout(r, 260));
  await shot('bars-lit');
};
