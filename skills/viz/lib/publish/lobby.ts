// lib/publish/lobby.ts — The lobby's own share card — the OG image the site root unfurls into.
//
// Extracted from build.ts, which was 1993 lines.

import { escHtml } from "./meta.ts";
import { ogTagsFor } from "./og.ts";
import { die } from "../../cli.ts";
import { HOME, idFor } from "../../discovery.ts";
import { KeyEntry, getOrCreate } from "../../keystore.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const LOBBY_MARKER = "_private-lobby";
export async function readLobby(container: string): Promise<KeyEntry | null> {
  if (!existsSync(path.join(container, LOBBY_MARKER))) return null;
  const id = idFor(container);
  // Fail closed: a lobby was requested but we can't key it — refuse rather than fall
  // back to publishing everything in the clear (that would leak a site meant to be sealed).
  if (!id) {
    die(`ERROR: ${LOBBY_MARKER} present but ${container} is outside $HOME — cannot key the lobby.\nMove the container under your home directory, or remove the marker.`, 2);
  }
  return getOrCreate(id + "#lobby");
}

// ---- Lobby hero — the "meta" OG card the site root unfurls into ------------
// A viz gets a rich link preview from its own hero.html/og image; the LOBBY is its own
// shareable surface, so it gets one too — auto-generated, and meta: a 1200×630 montage
// that SHOWCASES the vizzes it contains (a wall of their hero thumbnails under the site
// title). Rendered with the same headless Chrome verify.ts uses for og.auto.png, written
// into the dist as _thumbs/lobby-og.png. Best-effort: no Chrome → text-only card, build
// still succeeds. Only for a PUBLIC lobby with a real --base-url (a sealed lobby's head is
// encrypted; a placeholder host can't emit an absolute og:image crawlers accept).
export function chromePath(): string | null {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const c of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ]) if (existsSync(c)) return c;
  return null;
}

export const THUMB_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
export function dataUri(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return `data:${THUMB_MIME[ext] ?? "image/png"};base64,${readFileSync(file).toString("base64")}`;
}

// The montage page: a grid of the hero thumbnails at THEIR OWN 1.91:1 aspect — never cropped.
// Fully DYNAMIC: for the actual viz count, we pick the column count that makes the tiles as
// large as they can be (max tile size = max coverage) so the heroes fill as much of the
// 1200×630 frame as possible while staying whole. Rows are centered, so a short last row sits
// balanced instead of leaving a corner gap. A slim caption (title + count) sits on its own
// strip below the images. Up to 20 tiles; beyond that a "+N" tile stands in for the rest —
// past ~20 the thumbnails get too small to read.
export function lobbyHeroHtml(title: string, subtitle: string, thumbSrcs: string[]): string {
  const CAP = 20;
  const cells = thumbSrcs.slice(0, CAP).map((src) => `<div class="c"><img src="${src}" alt=""></div>`);
  const extra = thumbSrcs.length - CAP;
  if (extra > 0) cells.push(`<div class="c more">+${extra}</div>`);
  const n = cells.length;

  // Pick the column count that makes the tiles biggest. Each tile keeps the hero aspect
  // (AR); for every candidate `cols` a tile is bounded by BOTH the available width and the
  // available height (the grid area above the caption) — take the arrangement whose tiles
  // come out largest. Bigger tiles ⇒ more total area covered, for any count.
  const AR = 1200 / 630, GAP = 16, PAD = 30, CAP_H = 76;
  const availW = 1200 - PAD * 2, availH = 630 - CAP_H - PAD * 2;
  let best = { cols: 1, tw: 0, th: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const twByW = (availW - (cols - 1) * GAP) / cols;
    const twByH = ((availH - (rows - 1) * GAP) / rows) * AR;
    const tw = Math.min(twByW, twByH);
    if (tw > best.tw) best = { cols, tw: Math.floor(tw), th: Math.floor(tw / AR) };
  }

  const cap = (title || subtitle)
    ? `<div class="cap">${title ? `<span class="t">${escHtml(title)}</span>` : ""}${subtitle ? `<span class="s">${escHtml(subtitle)}</span>` : ""}</div>`
    : "";
  // Flex-wrap (not fixed grid columns) so each row — including a short last one — is centered.
  // The grid is exactly availW wide and each tile is sized so `cols` fit per row, so it wraps
  // predictably at the chosen column count.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden;background:#0d1117;color:#e6edf3;
    display:flex;flex-direction:column;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .mosaic{flex:1;display:flex;align-items:center;justify-content:center;padding:${PAD}px;min-height:0}
  .grid{width:${availW}px;display:flex;flex-wrap:wrap;gap:${GAP}px;justify-content:center;align-content:center}
  .c{width:${best.tw}px;height:${best.th}px;border-radius:12px;overflow:hidden;
    border:1px solid #30363d;background:#0b1220;flex:0 0 auto}
  .c img{width:100%;height:100%;object-fit:contain;display:block}
  .c.more{display:flex;align-items:center;justify-content:center;color:#c9d1d9;
    font:700 40px/1 ui-monospace,SFMono-Regular,Menlo,monospace;background:linear-gradient(135deg,#11203a,#1b2942)}
  .cap{height:${CAP_H}px;flex:0 0 auto;display:flex;align-items:center;gap:16px;
    padding:0 ${PAD}px;border-top:1px solid #21262d}
  .cap .t{font-size:30px;font-weight:800;letter-spacing:-0.02em}
  .cap .s{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;
    letter-spacing:.14em;text-transform:uppercase;color:#8b949e}
  </style></head><body>
  <div class="mosaic"><div class="grid">${cells.join("")}</div></div>
  ${cap}
  </body></html>`;
}

// Render lobbyHeroHtml to a 1200×630 PNG at outPng. Returns false on any failure (no
// Chrome, launch/render error) so the caller degrades to a text-only card, never breaks.
export async function renderLobbyOg(thumbAbsPaths: string[], title: string, subtitle: string, outPng: string): Promise<boolean> {
  const exe = chromePath();
  if (!exe) return false;
  const html = lobbyHeroHtml(title, subtitle, thumbAbsPaths.map(dataUri));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath: exe, headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15000 });
    mkdirSync(path.dirname(outPng), { recursive: true });
    await page.screenshot({ path: outPng, fullPage: false });
    return true;
  } catch {
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// The lobby's own OG/Twitter head tags (mirrors ogTagsFor, minus the per-viz image
// provenance dance — the montage is always at a known dist path). Absent imageUrl → a
// text-only card that still unfurls.
export function lobbyOgTags(og: { title: string; description: string; pageUrl?: string; imageUrl?: string }): string {
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escHtml(og.title)}">`,
    og.description ? `<meta property="og:description" content="${escHtml(og.description)}">` : "",
    og.pageUrl ? `<meta property="og:url" content="${escHtml(og.pageUrl)}">` : "",
    og.imageUrl ? `<meta property="og:image" content="${escHtml(og.imageUrl)}">` : "",
    og.imageUrl ? `<meta property="og:image:width" content="1200">` : "",
    og.imageUrl ? `<meta property="og:image:height" content="630">` : "",
    `<meta name="twitter:card" content="${og.imageUrl ? "summary_large_image" : "summary"}">`,
    og.description ? `<meta name="description" content="${escHtml(og.description)}">` : "",
  ].filter(Boolean).join("\n");
}
