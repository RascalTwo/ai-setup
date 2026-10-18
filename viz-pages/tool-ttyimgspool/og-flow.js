// Records this page's animated link preview: og.gif (the unfurl image) and og.mp4 (og:video).
// Record from a BUILT copy of the site, not the dev server — the dev server paints its own
// overlays into the frame:
//
//   bun ~/.claude/skills/viz/viz.ts publish ../ --out /tmp/site --base-url https://rascaltwo.github.io/ai-setup --no-og
//   (cd /tmp/site && python3 -m http.server 5199 &)
//   node ~/.claude/skills/browser-capture/scripts/record-flow.js --no-kit --fps 30 --viewport 1200x630 \
//     --url http://127.0.0.1:5199/tool-ttyimgspool/ --flow ./og-flow.js --out /tmp/loop.webm
//   ffmpeg -ss 1.0 -t 23.2 -i /tmp/loop.webm -vf "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 og.gif
//   ffmpeg -ss 1.0 -t 23.2 -i /tmp/loop.webm -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -movflags faststart -an og.mp4
//
// Loads on step 3 (thumbnail inline, pointer on it) — the frame the GIF must open on.
// Play at T=1.0s; the loop is back on that frame 23.2s later (steps 3→9 at 2.5s each,
// 3.2s hold on 9, then 1→2→3). The cut is [1.0, 24.2).
module.exports = async (page) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  await page.waitForSelector('#dplay');
  // the published page's own fixed chrome (download button) is not the card
  await page.evaluate(() => { for (const el of document.querySelectorAll('body *'))
    if (getComputedStyle(el).position === 'fixed') el.style.display = 'none'; });
  await sleep(1000 - (Date.now() - t0));
  await page.evaluate(() => document.querySelector('#dplay').click());
  console.log('PLAY_AT', (Date.now() - t0) / 1000);
  await sleep(25000);
};
