// Poster mechanics — `/_kit/poster.js`. Load as a module; it self-runs.
//
//   <link rel="stylesheet" href="/_kit/poster.css">
//   <script type="module" src="/_kit/poster.js"></script>
//
// Sets `--s` on documentElement — the single value that drives BOTH the card's
// scale and, in dive mode, the height `#fit` reserves for it. Everything else
// about why is in poster.css; this is just the one number.
//
// Mode comes from the body class, so the same file serves both templates:
//   .og-poster        scale to fit both axes (the card is the whole page)
//   .og-poster.poster-dive  scale to WIDTH only    (the card tops a scrollable page)
//
// Capped at 1 so the --og shot stays pixel-native instead of being upscaled.

const fit = () => {
  const dive = document.body.classList.contains("og-poster-dive");
  const s = dive
    ? Math.min(innerWidth / 1200, 1)
    : Math.min(innerWidth / 1200, innerHeight / 630);
  document.documentElement.style.setProperty("--s", s);
};

addEventListener("resize", fit);
fit();
