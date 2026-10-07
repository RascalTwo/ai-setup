# Verifying more than one state

A plain run only ever sees state 1, which is how nearly every interactive viz in the
corpus shipped unlooked-at past its opening frame. To drive a click/modal/step before
the shot, drop a file **in the viz dir** named `verify.interactions.ts`:

```ts
export default async (page, { shot }) => {
  await shot("closed");              // → read <viz>/.verify/closed.png
  await page.click(".accordion");
  await shot("open");                // → read <viz>/.verify/open.png
};
```

`viz verify` auto-detects and runs it (no flag) after load, before the final screenshot.
It's per-viz and disposable: delete it when you're done.

**The audit samples twice when an interactions file is present** — once on the opening frame
before your script runs, once on whatever state it left behind — labelling each finding
`[opening]` or `[after interactions]`. Without an interactions file there is one sample and
findings are unlabelled. Density/census numbers come from the final state, matching
`latest.png`.

**You are not limited to the one `latest.png`.** `page` is the raw Puppeteer page, and
`shot(name)` writes an extra `<viz>/.verify/<name>.png` with the path resolved for you. Snap
before *and* after a click, snap each tab, snap each step of an animation — then read
those PNGs.
