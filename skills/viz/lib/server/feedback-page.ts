// lib/server/feedback-page.ts — what puts the feedback widget on a page (ADR 0026): every live page
// (static.ts) and every self-contained build (inline.ts), unless a build's page opts
// out. Hero cards don't go through either path, and film renders hide the widget (capture.ts).
// The presence layer (kit/presence.js: everyone on the same viz, live) rides along with it.

import { createHash } from "node:crypto";

/** A page keeps the widget out of its builds with <meta name="viz:feedback" content="off">. Live pages always carry it. */
export const feedbackOptedOut = (html: string): boolean =>
  /<meta\b(?=[^>]*\bname=["']viz:feedback["'])(?=[^>]*\bcontent=["']off["'])[^>]*>/iu.test(html);

/**
 * First in <head>: the page stamp (a hash of its source; local mode keeps answers per stamp, and a
 * copy names it), and WebGL contexts kept readable so a crop can draw a 3D scene. That has to run
 * before the page's own scripts create their contexts, so it is a classic inline script.
 */
export function feedbackHead(source: string): string {
  const stamp = createHash("sha256").update(source).digest("hex").slice(0, 10);
  return (
    `<script data-viz-stamp="${stamp}">(function(){var g=HTMLCanvasElement.prototype.getContext;` +
    `HTMLCanvasElement.prototype.getContext=function(t,o){return g.call(this,t,/webgl/.test(String(t))?` +
    `Object.assign({},o,{preserveDrawingBuffer:true}):o)}})();</script>`
  );
}

/** Before </body>: the widget. `id` names the viz on a live page (its log route); a build has none and saves in the browser. */
export const feedbackBody = (id?: string): string =>
  `<link rel="stylesheet" href="/_kit/feedback.css">` +
  `<script type="module" src="/_kit/feedback.js"${id ? ` data-viz-feedback="${id}"` : ""}></script>`;

/**
 * Before </body>, after the widget: the presence layer. Unconditional here; the page itself checks
 * <meta name="viz:presence" content="off">, and a render or verify run (navigator.webdriver) stays out.
 */
export const presenceBody = (): string => `<script type="module" src="/_kit/presence.js"></script>`;
