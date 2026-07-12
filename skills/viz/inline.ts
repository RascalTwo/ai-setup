// inline.ts — turn a served viz into ONE self-contained HTML file.
//
// The viz server makes a viz come alive with three things that aren't in the
// on-disk index.html: the /_kit/* assets (linked absolutely), the api.ts backend,
// and a server-injected reload script. A hosted static file has none of those.
// buildSelfContained() reconstructs a viewable page from the frozen tape alone:
//
//   - inline /_kit/viz-kit.css  (replace the <link> with a <style>)
//   - remap  /_kit/viz.js       (import-map → data: URL, so the page's
//                                `import ... from "/_kit/viz.js"` line is untouched)
//   - WHEN the viz has recorded api responses: inline the tape + a client-side
//     fetch shim that answers api/* from it (the shim embeds tape-key.js VERBATIM,
//     so its keys match the server's), plus a frozen-snapshot banner so the
//     recording is never mistaken for live. A purely static viz (no api, no
//     recordings) gets NONE of these — it isn't a snapshot, so it isn't labelled one.
//
// Non-api fetches (esm.sh CDN imports, etc.) pass straight through to the real
// fetch. The output is the artifact the publish step hosts (public) or seals
// with StatiCrypt (private). This is the client-side replay that ADR 0003
// deferred; ADR 0004 builds it, sharing tape-key.js to keep the two paths honest.

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { readTape, TAPE_FILE, kindFromHtml } from "./recordings.ts";

const KIT_DIR = path.join(import.meta.dir, "kit");
const TAPE_KEY_SRC = path.join(import.meta.dir, "tape-key.js");

export type BuildResult = { html: string; warnings: string[] };

// Per-mirror frame overrides (ADR 0006). Each field, when present, replaces the
// source viz's own viz:* head meta in the built artifact so a mirrored copy can
// carry a different title/description/tags than its source — without touching the
// source. Absent fields inherit (the caller resolves inheritance before calling).
export type HeadOverrides = { title?: string; description?: string; tags?: string[] };

function escAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Replace a single-valued <meta name=NAME content=...> in place, or inject one into
// <head> if absent. Used for viz:title / viz:description overrides.
function setSingleMeta(html: string, name: string, value: string): string {
  const tag = `<meta name="${name}" content="${escAttr(value)}">`;
  const re = new RegExp(`<meta\\s+name=["']${name}["'][^>]*>`, "i");
  return re.test(html) ? html.replace(re, tag) : injectIntoHead(html, tag);
}

// Apply mirror frame overrides to the source HTML BEFORE any kit/tape inlining, so
// the card-reading metas downstream (and the artifact's own <head>/<title>) reflect
// the mirror's frame. viz:tag is multi-valued: clear all then re-add the override set.
function applyHeadOverrides(html: string, o: HeadOverrides): string {
  if (o.title !== undefined) {
    html = setSingleMeta(html, "viz:title", o.title);
    // Keep the visible <title> in sync for the standalone (public) artifact.
    if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
      html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escAttr(o.title)}</title>`);
    }
  }
  if (o.description !== undefined) html = setSingleMeta(html, "viz:description", o.description);
  if (o.tags !== undefined) {
    html = html.replace(/<meta\s+name=["']viz:tag["'][^>]*>\s*/gi, "");
    const tags = o.tags.map((t) => `<meta name="viz:tag" content="${escAttr(t)}">`).join("\n");
    if (tags) html = injectIntoHead(html, tags);
  }
  return html;
}

// Bundle sibling ES modules INTO the page so a viz can be authored across many
// files (./shared.js, ./challenges/*.js, …) yet still export as one self-contained
// HTML. For each <script type="module"> that pulls in a relative import — or is a
// relative `src=` module — we run Bun's bundler over its graph and inline the
// result. Absolute/protocol specifiers stay external: /_kit/* (resolved by the
// import map we inject) and http(s):// CDN imports (fetched by the browser at run
// time), so the bundle only swallows the viz's OWN sibling files. Fast path: an
// inline module with no relative import is left byte-for-byte untouched, so every
// existing single-file viz builds exactly as before.
const REL_IMPORT = /\b(?:from|import)\s*\(?\s*["']\.\.?\//; // from "./x" | import("../y")
function bundleSiblingModules(vizDir: string, html: string): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  const scriptRe = /<script\b([^>]*\btype=["']module["'][^>]*)>([\s\S]*?)<\/script>/gi;
  const externals = ["/_kit/*", "https://*", "http://*"].flatMap((p) => ["--external", p]);

  html = html.replace(scriptRe, (whole, attrs: string, body: string) => {
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    const src = srcMatch?.[1];
    // A relative <script src="./…"> module must be bundled (its file can't travel);
    // an inline module only needs bundling if it imports a sibling. Anything else
    // (absolute/protocol src, or a self-contained inline module) is left as-is.
    const relSrc = src && /^\.\.?\//.test(src);
    if (!relSrc && (src || !REL_IMPORT.test(body))) return whole;

    let entry = relSrc ? path.resolve(vizDir, src!) : path.join(vizDir, `.__viz_bundle_${createHash("sha1").update(body).digest("hex").slice(0, 8)}.mjs`);
    const isTemp = !relSrc;
    try {
      if (isTemp) writeFileSync(entry, body);
      if (!existsSync(entry)) { warnings.push(`module src="${src}" not found — left unbundled`); return whole; }
      const r = Bun.spawnSync({ cmd: [process.execPath, "build", entry, "--target=browser", ...externals], cwd: vizDir });
      if (!r.success) {
        throw new Error(`bundling ${relSrc ? src : "inline module"} failed:\n${r.stderr.toString().trim()}`);
      }
      // Bun stamps each section with a `// <path>` comment; drop the one that leaks
      // our internal temp entry name (keeps sibling-file comments, which are useful).
      const out = r.stdout.toString().replace(/^\/\/ \.__viz_bundle_[0-9a-f]+\.mjs\n/gm, "").trim();
      return `<script type="module">\n${out}\n</script>`;
    } finally {
      if (isTemp && existsSync(entry)) rmSync(entry);
    }
  });
  return { html, warnings };
}

// Same-dir asset fetches we DON'T handle by inlining: a single self-contained
// (and possibly encrypted) HTML can't carry sibling files. Modules are bundled
// (see bundleSiblingModules); relative fetch()/src to data files can't be, so
// those are surfaced as a warning rather than silently broken.
function scanUnhandledAssets(html: string): string[] {
  const warnings: string[] = [];
  // Relative fetch()/src/href to a same-dir file that isn't api/* or /_kit/*.
  const fetchRe = /fetch\(\s*["'`](?!https?:|\/_kit\/|api\/|\/)([^"'`]+)["'`]/g;
  for (const m of html.matchAll(fetchRe)) {
    warnings.push(`relative fetch("${m[1]}") — not api/*; that file won't travel in a single-file export`);
  }
  return warnings;
}

// Build the client-side fetch shim as a CLASSIC <script> (runs during head parse,
// before any deferred module executes its first fetch). tape-key.js is an ES
// module; we strip its `export` keywords so its functions live in this classic
// script's scope. The shim scopes api/* to the page's OWN base — exactly how the
// server scopes api to <vizid>/api/ — so a literal "api" segment elsewhere in the
// host path can't be misread as the api boundary.
function fetchShim(tapeJson: string): string {
  const keySrc = readFileSync(TAPE_KEY_SRC, "utf8").replace(/^export\s+/gm, "");
  return `<script>
(function(){
  const TAPE = ${tapeJson};
${keySrc}
  function lookup(key){
    const e = TAPE.entries && TAPE.entries[key];
    if (!e) return null;
    return Array.isArray(e) ? (e[e.length - 1] || null) : e; // last-write-wins
  }
  const realFetch = window.fetch.bind(window);
  // Resolve "api/" against the page's own base so the boundary is unambiguous.
  const API_BASE = new URL("api/", document.baseURI).pathname;
  window.fetch = async function(input, init){
    try {
      const raw = typeof input === "string" ? input
                : (input && input.url) ? input.url : String(input);
      const resolved = new URL(raw, document.baseURI);
      if (resolved.pathname.startsWith(API_BASE)) {
        const route = decodeURIComponent(resolved.pathname.slice(API_BASE.length));
        const method = ((init && init.method)
          || (input && input.method) || "GET").toUpperCase();
        let body = "";
        if (init && typeof init.body === "string") body = init.body;
        else if (input && typeof input.clone === "function") {
          try { body = await input.clone().text(); } catch {}
        }
        const key = keyFor(method, route, sortedQuery(resolved.searchParams), body);
        const env = lookup(key);
        if (env) return new Response(env.body, {
          status: env.status, headers: { "content-type": env.contentType } });
        return new Response("no recording for " + key, {
          status: 404, headers: { "content-type": "text/plain" } });
      }
    } catch (e) { /* fall through to the network for non-api requests */ }
    return realFetch(input, init);
  };
})();
</script>`;
}

// Import map that resolves the page's absolute /_kit/viz.js to an inlined data:
// URL — so the page's own `import ... from "/_kit/viz.js"` needs no rewriting.
// An import map must precede any module that uses it, so this goes first in head.
function vizJsImportMap(): string {
  const js = readFileSync(path.join(KIT_DIR, "viz.js"), "utf8");
  const dataUrl = "data:text/javascript;base64," + Buffer.from(js, "utf8").toString("base64");
  return `<script type="importmap">${JSON.stringify({ imports: { "/_kit/viz.js": dataUrl } })}</script>`;
}

// Frozen banner that humanizes the recording's age in-browser (so it stays
// accurate however long after export it's viewed). Mirrors recordings.ts's
// server-side banner; null recordedAt → just "Frozen snapshot". An "operational"
// viz gets the louder red variant + a "NOT current state" suffix — its frozen data
// is indistinguishable from live but stale the moment the tape was cut.
function frozenBanner(recordedAt: string | null, kind: "explanatory" | "operational" = "explanatory"): string {
  const op = kind === "operational";
  const bg = op ? "#fecaca" : "#fde68a";
  const fg = op ? "#7f1d1d" : "#78350f";
  const bd = op ? "#ef4444" : "#f59e0b";
  // Suffix carried in a data-attr so the age-humanizing script can re-append it on update.
  const suffix = op ? " — live monitoring tool, NOT current state" : "";
  return `<div id="__viz_frozen" data-at="${recordedAt ?? ""}" data-suffix="${suffix}" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;
height:26px;line-height:26px;font:12px/26px ui-monospace,SFMono-Regular,Menlo,monospace;
color:${fg};background:${bg};border-bottom:1px solid ${bd};text-align:center;
letter-spacing:.02em;${op ? "font-weight:700;" : ""}box-shadow:0 1px 4px rgba(0,0,0,.12)">&#9208;&#65039; Frozen snapshot${suffix}</div>
<script>(function(){
  const el=document.getElementById("__viz_frozen"),at=el&&el.dataset.at,suf=(el&&el.dataset.suffix)||"";
  if(!at)return; const then=Date.parse(at); if(isNaN(then))return;
  const s=Math.max(0,Math.round((Date.now()-then)/1000));
  const u=[[86400,"day"],[3600,"hour"],[60,"minute"]]; let age="moments ago";
  for(const [n,name] of u){const k=Math.floor(s/n); if(k>=1){age=k+" "+name+(k===1?"":"s")+" ago";break;}}
  el.innerHTML="&#9208;&#65039; Frozen snapshot &middot; recorded "+age+suf;
})();</script>`;
}

// Insert `snippet` right after the opening <head> (or prepend if there's none).
function injectIntoHead(html: string, snippet: string): string {
  const m = html.match(/<head[^>]*>/i);
  if (m) return html.replace(m[0], m[0] + "\n" + snippet);
  return snippet + "\n" + html;
}

// Insert `snippet` right before </body> (or append if there's none).
function injectBeforeBodyEnd(html: string, snippet: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, snippet + "\n</body>");
  return html + "\n" + snippet;
}

// Minimal "save a copy" affordance stamped into EVERY built artifact. Because the
// built page is already ONE self-contained file, downloading it == saving the exact
// bytes being served — so the handler fetches the page's own URL (pristine source,
// pre-mutation) and saves it, falling back to the live DOM when that fetch is blocked
// (e.g. re-downloading from an offline file:// copy). Riding the page (not the index)
// is the whole point: unlisted vizzes have no index entry, but they still have a page.
// Icon-only by request — the label lives in title/aria, never on screen.
function downloadButton(): string {
  return `<a id="__viz_dl" href="#" role="button" aria-label="Save a copy of this page"
title="Save a copy" style="position:fixed;bottom:14px;right:14px;z-index:2147483646;
width:34px;height:34px;display:flex;align-items:center;justify-content:center;
border-radius:8px;background:rgba(20,20,22,.55);color:#fff;opacity:.35;
backdrop-filter:blur(4px);transition:opacity .15s;text-decoration:none"
onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.35">
<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/>
<line x1="12" y1="15" x2="12" y2="3"/></svg></a>
<script>(function(){
  var a=document.getElementById("__viz_dl");
  var name=(document.title||"visualization").toLowerCase()
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"visualization";
  function save(text){
    var url=URL.createObjectURL(new Blob([text],{type:"text/html"}));
    var t=document.createElement("a"); t.href=url; t.download=name+".html";
    document.body.appendChild(t); t.click(); t.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  a.addEventListener("click",function(e){
    e.preventDefault();
    fetch(location.href).then(function(r){return r.text();}).then(save)
      .catch(function(){ save("<!DOCTYPE html>\\n"+document.documentElement.outerHTML); });
  });
})();</script>`;
}

// Produce the self-contained HTML for the viz at `vizDir`. Pure: reads files,
// returns a string + warnings; writes nothing (the caller owns output + sealing).
export function buildSelfContained(vizDir: string, overrides?: HeadOverrides): BuildResult {
  const indexPath = path.join(vizDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`no index.html in ${vizDir} — nothing to export`);
  }
  let html = readFileSync(indexPath, "utf8");
  // Mirror frame overrides (ADR 0006) apply first, on the raw source, so every
  // downstream step (kit inlining, card metas, <title>) sees the mirror's frame.
  if (overrides) html = applyHeadOverrides(html, overrides);
  // Bundle the viz's own sibling ES modules into the page before anything else,
  // so multi-file vizzes export as one self-contained artifact (kit + CDN stay external).
  const bundled = bundleSiblingModules(vizDir, html);
  html = bundled.html;
  const warnings = [...bundled.warnings, ...scanUnhandledAssets(html)];

  // 1. Inline the kit stylesheet in place of its <link>.
  const css = readFileSync(path.join(KIT_DIR, "viz-kit.css"), "utf8");
  const linkRe = /<link\b[^>]*href=["']\/_kit\/viz-kit\.css["'][^>]*>/i;
  if (linkRe.test(html)) {
    html = html.replace(linkRe, `<style>\n${css}\n</style>`);
  }

  // 2. Head injections. The import map (kit JS) is ALWAYS needed. The tape +
  //    fetch shim + frozen banner are only meaningful when the viz actually has
  //    recorded api responses to replay — a purely static viz (no api.ts, no
  //    recordings) gets none of them, so it's never mislabelled a "snapshot".
  const tape = readTape(vizDir);
  const hasRecordings = Object.keys(tape.entries).length > 0;

  let head = vizJsImportMap();
  // Stamp the artifact as a static/self-contained build. Env-aware vizzes read this
  // (kit vizEnv()) to know there's no live server behind them — so live-data UI can
  // show a "run me locally" placeholder instead of probing /_health or spinning.
  head += "\n" + "<script>window.__VIZ_STATIC__=true;</script>";
  if (hasRecordings) head += "\n" + fetchShim(JSON.stringify(tape));
  html = injectIntoHead(html, head);

  // 3. Frozen-snapshot banner before </body> — recordings only (see above).
  if (hasRecordings) {
    html = injectBeforeBodyEnd(html, frozenBanner(tape.recordedAt, kindFromHtml(html)));
  }

  // Warn only when the viz actually calls api/* but ships no tape to replay it —
  // a static viz with no api calls needs no recordings and shouldn't be nagged.
  const usesApi = /fetch\(\s*["'`]api\//.test(html);
  if (usesApi && !hasRecordings) {
    warnings.push(
      existsSync(path.join(vizDir, TAPE_FILE))
        ? `${TAPE_FILE} has no entries — api/* calls will 404 in the export (record a tape first?)`
        : `no ${TAPE_FILE} — api/* calls will 404 in the export (record a tape first?)`,
    );
  }

  // 4. "Save a copy" button — every built artifact, so listed and unlisted vizzes
  //    are equally self-downloadable (the button rides the page, not the index).
  html = injectBeforeBodyEnd(html, downloadButton());
  return { html, warnings };
}
