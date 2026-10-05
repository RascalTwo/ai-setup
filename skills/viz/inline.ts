// inline.ts — turn a served viz into ONE self-contained HTML file.
//
// The viz server makes a viz come alive with three things that aren't in the
// on-disk index.html: the /_kit/* assets (linked absolutely), the api.ts backend,
// and a server-injected reload script. A hosted static file has none of those.
// buildSelfContained() reconstructs a viewable page from the frozen tape alone:
//
//   - inline /_kit/viz-kit.css  (replace the <link> with a <style>)
//   - remap  /_kit/viz.js       (import-map → data: URL, so the page's
//                                `import ... from "@viz/kit"` line is untouched)
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

import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { readTape, TAPE_FILE } from "./recordings.ts";
import { insideViz } from "./lib/render/narration.ts";

const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
};

const KIT_DIR = path.join(import.meta.dir, "kit");
const TAPE_KEY_SRC = path.join(import.meta.dir, "tape-key.js");

type TtsCue = { src: string };
type TtsManifest = { cues: TtsCue[]; tracks?: { cues: TtsCue[] }[] };
const isTtsCues = (v: unknown): v is TtsCue[] =>
  Array.isArray(v) && v.every((c: unknown) => typeof field(c, "src") === "string");
const isTtsManifest = (v: unknown): v is TtsManifest => {
  const tracks = field(v, "tracks");
  return (
    isTtsCues(field(v, "cues")) &&
    (tracks === undefined ||
      (Array.isArray(tracks) && tracks.every((t: unknown) => isTtsCues(field(t, "cues")))))
  );
};

export type BuildResult = { html: string; warnings: string[] };

// Per-mirror frame overrides (ADR 0006). Each field, when present, replaces the
// source viz's own viz:* head meta in the built artifact so a mirrored copy can
// carry a different title/description/tags than its source — without touching the
// source. Absent fields inherit (the caller resolves inheritance before calling).
export type HeadOverrides = { title?: string; description?: string; tags?: string[] };

/** One property of a parsed-JSON value, still `unknown`: file contents are checked before they are trusted. */
const field = (v: unknown, k: string): unknown =>
  typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined;

function escAttr(s: string): string {
  return s.replaceAll(
    /[&<>"]/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

// Replace a single-valued <meta name=NAME content=...> in place, or inject one into
// <head> if absent. Used for viz:title / viz:description overrides.
function setSingleMeta(html: string, name: string, value: string): string {
  const tag = `<meta name="${name}" content="${escAttr(value)}">`;
  const re = new RegExp(`<meta\\s+name=["']${name}["'][^>]*>`, "iu");
  return re.test(html) ? html.replace(re, tag) : injectIntoHead(html, tag);
}

// Apply mirror frame overrides to the source HTML BEFORE any kit/tape inlining, so
// the card-reading metas downstream (and the artifact's own <head>/<title>) reflect
// the mirror's frame. viz:tag is multi-valued: clear all then re-add the override set.
function applyHeadOverrides(source: string, o: HeadOverrides): string {
  let html = source;
  if (o.title !== undefined) {
    html = setSingleMeta(html, "viz:title", o.title);
    // Keep the visible <title> in sync for the standalone (public) artifact.
    if (/<title[^>]*>[\s\S]*?<\/title>/iu.test(html)) {
      html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/iu, `<title>${escAttr(o.title)}</title>`);
    }
  }
  if (o.description !== undefined) html = setSingleMeta(html, "viz:description", o.description);
  if (o.tags !== undefined) {
    html = html.replaceAll(/<meta\s+name=["']viz:tag["'][^>]*>\s*/giu, "");
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
const REL_IMPORT = /\b(?:from|import)\s*\(?\s*["']\.\.?\//u; // from "./x" | import("../y")
function bundleSiblingModules(
  vizDir: string,
  source: string,
): { html: string; warnings: string[] } {
  let html = source;
  const warnings: string[] = [];
  const scriptRe = /<script\b([^>]*\btype=["']module["'][^>]*)>([\s\S]*?)<\/script>/giu;
  // A bare specifier the page's import map names ("three") is the BROWSER's to resolve. Left to the bundler it
  // is either swallowed whole into the export (installed here) or fails the build (not installed there).
  const mapped = [
    ...html.matchAll(/<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/giu),
  ]
    .flatMap((m) => {
      try {
        const imports = field(JSON.parse(m[1]!), "imports");
        return typeof imports === "object" && imports !== null ? Object.keys(imports) : [];
      } catch {
        return [];
      }
    })
    .flatMap((k) => (k.endsWith("/") ? [k + "*"] : [k, k + "/*"]));
  const externals = [
    "/_kit/*",
    "@viz/kit",
    "@viz/kit/*",
    "https://*",
    "http://*",
    ...mapped,
  ].flatMap((p) => ["--external", p]);

  html = html.replace(scriptRe, (whole, attrs: string, body: string) => {
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/iu);
    const src = srcMatch?.[1];
    // A relative <script src="./…"> module must be bundled (its file can't travel);
    // an inline module only needs bundling if it imports a sibling. Anything else
    // (absolute/protocol src, or a self-contained inline module) is left as-is.
    // Relative means no leading "/" and no scheme — "pr-viz.js" is as local as "./pr-viz.js".
    const relSrc = src && !/^(\/|[a-z][\w+.-]*:)/iu.test(src);
    if (!relSrc && (src || !REL_IMPORT.test(body))) return whole;

    let entry = relSrc
      ? path.resolve(vizDir, src)
      : path.join(
          vizDir,
          `.__viz_bundle_${createHash("sha1").update(body).digest("hex").slice(0, 8)}.mjs`,
        );
    // `src="./app.js"` written in TypeScript (ADR 0023): bundle the .ts. Bun compiles it
    // and resolves its `./x.js` imports to `x.ts` itself, so the export is plain JS.
    if (relSrc && !existsSync(entry) && existsSync(entry.replace(/\.js$/u, ".ts")))
      entry = entry.replace(/\.js$/u, ".ts");
    const isTemp = !relSrc;
    try {
      if (isTemp) writeFileSync(entry, body);
      if (!existsSync(entry)) {
        warnings.push(`module src="${src}" not found — left unbundled`);
        return whole;
      }
      const r = Bun.spawnSync({
        cmd: [process.execPath, "build", entry, "--target=browser", ...externals],
        cwd: vizDir,
      });
      if (!r.success) {
        throw new Error(
          `bundling ${relSrc ? src : "inline module"} failed:\n${r.stderr.toString().trim()}`,
        );
      }
      // Bun stamps each section with a `// <path>` comment; drop the one that leaks
      // our internal temp entry name (keeps sibling-file comments, which are useful).
      const out = r.stdout
        .toString()
        .replaceAll(/^\/\/ \.__viz_bundle_[0-9a-f]+\.mjs\n/gmu, "")
        .trim();
      return `<script type="module">\n${out}\n</script>`;
    } finally {
      if (isTemp && existsSync(entry)) rmSync(entry);
    }
  });
  // A relative CLASSIC <script src> (no type=module) can't travel either. It is inlined as-is,
  // in place: bundling would turn it into a module and change when it runs and what it makes
  // global. Written in TypeScript (`src="./x.js"` backed by x.ts), its types are stripped.
  html = html.replaceAll(
    /<script\b(?![^>]*\btype=["']module["'])([^>]*)\bsrc=["'](?!\/|[a-z][\w+.-]*:)([^"']+)["']([^>]*)><\/script>/giu,
    (whole, pre: string, src: string, post: string) => {
      let file = path.resolve(vizDir, src);
      if (!existsSync(file) && existsSync(file.replace(/\.js$/u, ".ts")))
        file = file.replace(/\.js$/u, ".ts");
      if (!existsSync(file)) {
        warnings.push(`script src="${src}" not found — left as a link`);
        return whole;
      }
      const code = readFileSync(file, "utf8");
      const js = file.endsWith(".ts") ? classicStrip.transformSync(code) : code;
      return `<script${pre}${post}>\n${js.replaceAll(/<\/script/giu, "<\\/script")}\n</script>`;
    },
  );
  return { html, warnings };
}
const classicStrip = new Bun.Transpiler({ loader: "ts" });

// Same-dir asset fetches we DON'T handle by inlining: a single self-contained
// (and possibly encrypted) HTML can't carry sibling files. Modules are bundled
// (see bundleSiblingModules); relative fetch()/src to data files can't be, so
// those are surfaced as a warning rather than silently broken.
function scanUnhandledAssets(html: string): string[] {
  const warnings: string[] = [];
  // Relative fetch()/src/href to a same-dir file that isn't api/* or /_kit/*.
  const fetchRe = /fetch\(\s*["'`](?!https?:|\/_kit\/|api\/|\/)([^"'`]+)["'`]/gu;
  for (const m of html.matchAll(fetchRe)) {
    warnings.push(
      `relative fetch("${m[1]}") — not api/*; that file won't travel in a single-file export`,
    );
  }
  return warnings;
}

// viz:bundle — local files the page fetch()es at runtime, declared by the page:
//   <meta name="viz:bundle" content="plan.json hunks.json scenes/">
// A single-file export can't carry sibling files, so these are embedded and a classic script
// answers the page's fetch() for them from the embedded copy. A directory takes its files
// recursively (dotfiles skipped). Everything else still warns, as before.
function bundleOf(
  html: string,
  vizDir: string,
): { files: Record<string, { type: string; b64: string }>; paths: string[] } {
  const spec = /<meta\s+name=["']viz:bundle["']\s+content=["']([^"']*)["']/iu.exec(html)?.[1] ?? "";
  const files: Record<string, { type: string; b64: string }> = {};
  const add = (rel: string) => {
    const abs = path.join(vizDir, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const n of readdirSync(abs)) if (!n.startsWith(".")) add(path.posix.join(rel, n));
      return;
    }
    files[rel] = { type: Bun.file(abs).type, b64: readFileSync(abs).toString("base64") };
  };
  for (const rel of spec.split(/\s+/u).filter(Boolean)) {
    const clean = rel.replace(/^\.?\//u, "").replace(/\/$/u, "");
    if (insideViz(vizDir, clean)) add(clean);
  }
  return { files, paths: Object.keys(files) };
}
function bundleShim(files: Record<string, { type: string; b64: string }>): string {
  return `<script>
(function(){
  const FILES = ${JSON.stringify(files).replaceAll("<", "\\u003c")};
  const BASE = new URL("./", document.baseURI).pathname;
  const realFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    try {
      const raw = typeof input === "string" ? input : (input && input.url) ? input.url : String(input);
      const u = new URL(raw, document.baseURI);
      const rel = u.pathname.startsWith(BASE) ? decodeURIComponent(u.pathname.slice(BASE.length)) : null;
      const f = rel !== null && FILES[rel];
      if (f) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        return Promise.resolve(new Response(bytes, { status: 200, headers: { "content-type": f.type } }));
      }
    } catch (e) {}
    return realFetch(input, init);
  };
})();
</script>`;
}

// Build the client-side fetch shim as a CLASSIC <script> (runs during head parse,
// before any deferred module executes its first fetch). tape-key.js is an ES
// module; we strip its `export` keywords so its functions live in this classic
// script's scope. The shim scopes api/* to the page's OWN base — exactly how the
// server scopes api to <vizid>/api/ — so a literal "api" segment elsewhere in the
// host path can't be misread as the api boundary.
function fetchShim(tapeJson: string): string {
  const keySrc = readFileSync(TAPE_KEY_SRC, "utf8").replaceAll(/^export\s+/gmu, "");
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

// Import map that resolves the page's absolute /_kit/*.js specifiers to inlined data:
// URLs — so the page's own `import ... from "@viz/kit"` (or the older "/_kit/<name>.js") needs no rewriting.
//
// Scanned from the page rather than hardcoded to viz.js. `/_kit/` is a dev-server route
// that does not exist on a static host, so any kit module left unmapped 404s — and when
// that module is the one rendering the page (exchange.js, deck.js, poster.js) the result
// is a silent blank page, not a degraded one. viz.js is always mapped, matching the
// previous behaviour, since a kit module may import it.
//
// Followed transitively so a kit module importing another kit module is covered too.
// Unknown names are left unmapped rather than silently dropped, so a typo stays visible
// as a 404 (same policy as inlineKitCss).
//
// An import map must precede any module that uses it, so this goes first in head.
const KIT_JS_REF = /["'`]\/_kit\/([A-Za-z0-9._-]+\.js)["'`]/gu;
// The alias a viz writes (lib/server/kit-alias.ts): `@viz/kit` is viz.js, `@viz/kit/<name>.js` any other kit file.
const KIT_ALIAS_REF = /["'`]@viz\/kit(?:\/([A-Za-z0-9._-]+\.js))?["'`]/gu;
function kitImportMap(html: string): string {
  // Each kit module becomes a data: URL. A data: module can't resolve "/_kit/x.js" (a data: URL
  // has no path to resolve against), so a kit module's own kit imports are rewritten to the
  // imported module's data: URL — dependencies first, memoised.
  const uri = new Map<string, string>();
  const dataUri = (name: string, seen = new Set<string>()): string | null => {
    if (uri.has(name)) return uri.get(name)!;
    const file = path.join(KIT_DIR, name);
    if (!existsSync(file) || seen.has(name)) return null;
    seen.add(name);
    const js = readFileSync(file, "utf8").replace(KIT_JS_REF, (whole, dep: string) => {
      const d = dataUri(dep, seen);
      return d ? JSON.stringify(d) : whole;
    });
    const u = "data:text/javascript;base64," + Buffer.from(js, "utf8").toString("base64");
    uri.set(name, u);
    return u;
  };
  const imports: Record<string, string> = {};
  const names = new Set([
    "viz.js",
    ...[...html.matchAll(KIT_JS_REF)].map((m) => m[1]!),
    ...[...html.matchAll(KIT_ALIAS_REF)].map((m) => m[1] ?? "viz.js"),
  ]);
  for (const name of names) {
    const u = dataUri(name);
    if (!u) continue;
    imports[`/_kit/${name}`] = u; // still the spelling of `<script src>` pages and the kit's own imports
    imports[name === "viz.js" ? "@viz/kit" : `@viz/kit/${name}`] = u;
  }
  return `<script type="importmap">${JSON.stringify({ imports })}</script>`;
}

// Frozen banner that humanizes the recording's age in-browser (so it stays
// accurate however long after export it's viewed). Mirrors recordings.ts's
// server-side banner; null recordedAt → just "Frozen snapshot".
function frozenBanner(recordedAt: string | null): string {
  return `<div id="__viz_frozen" data-at="${recordedAt ?? ""}" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;
height:26px;line-height:26px;font:12px/26px ui-monospace,SFMono-Regular,Menlo,monospace;
color:#78350f;background:#fde68a;border-bottom:1px solid #f59e0b;text-align:center;
letter-spacing:.02em;box-shadow:0 1px 4px rgba(0,0,0,.12)">&#9208;&#65039; Frozen snapshot</div>
<script>(function(){
  const el=document.getElementById("__viz_frozen"),at=el&&el.dataset.at;
  if(!at)return; const then=Date.parse(at); if(isNaN(then))return;
  const s=Math.max(0,Math.round((Date.now()-then)/1000));
  const u=[[86400,"day"],[3600,"hour"],[60,"minute"]]; let age="moments ago";
  for(const [n,name] of u){const k=Math.floor(s/n); if(k>=1){age=k+" "+name+(k===1?"":"s")+" ago";break;}}
  el.innerHTML="&#9208;&#65039; Frozen snapshot &middot; recorded "+age;
})();</script>`;
}

// Insert `snippet` right after the opening <head> (or prepend if there's none).
function injectIntoHead(html: string, snippet: string): string {
  const m = html.match(/<head[^>]*>/iu);
  if (m) return html.replace(m[0], m[0] + "\n" + snippet);
  return snippet + "\n" + html;
}

// Insert `snippet` right before </body> (or append if there's none).
function injectBeforeBodyEnd(html: string, snippet: string): string {
  if (/<\/body>/iu.test(html)) return html.replace(/<\/body>/iu, snippet + "\n</body>");
  return html + "\n" + snippet;
}

// Minimal "save a copy" affordance stamped into EVERY built artifact. Because the
// built page is already ONE self-contained file, downloading it == saving the exact
// bytes being served — so the handler fetches the page's own URL (pristine source,
// pre-mutation) and saves it, falling back to the live DOM when that fetch is blocked
// (e.g. re-downloading from an offline file:// copy). Riding the page (not the index)
// is the whole point: unlisted vizzes have no index entry, but they still have a page.
// Icon-only by request — the label lives in title/aria, never on screen.
//
// SEALED pages are the exception: fetching a StatiCrypt page returns the ciphertext
// shell, so the saved copy would demand the password all over again. StatiCrypt
// document.write()s the plaintext, so the decrypted page IS this DOM — snapshot it
// at parse time and save that instead. The saved file is therefore UNENCRYPTED: a
// reader who already unlocked the page can pass it on freely. That's the point.
// ponytail: parse-time snapshot, not the original bytes — a viz whose classic (non-
// module) scripts already mutated the DOM saves those mutations too. Module scripts,
// which is what the kit and nearly every viz uses, are deferred and haven't run yet.
// The seal marker is built by concatenation on purpose: written as one literal it
// would appear verbatim in every page's own source, so an UNSEALED page would match
// itself and never take the exact-bytes path.
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
  var plain="<!DOCTYPE html>\\n"+document.documentElement.outerHTML;
  function save(text){
    var url=URL.createObjectURL(new Blob([text],{type:"text/html"}));
    var t=document.createElement("a"); t.href=url; t.download=name+".html";
    document.body.appendChild(t); t.click(); t.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  a.addEventListener("click",function(e){
    e.preventDefault();
    fetch(location.href).then(function(r){return r.text();})
      .then(function(t){ save(t.indexOf("staticrypt"+"Config")>0?plain:t); })
      .catch(function(){ save(plain); });
  });
})();</script>`;
}

// Produce the self-contained HTML for the viz at `vizDir`. Pure: reads files,
// returns a string + warnings; writes nothing (the caller owns output + sealing).
/**
 * Replace every `<link rel=stylesheet href="/_kit/<name>.css">` with the file's
 * contents inline.
 *
 * `/_kit/` is a dev-server route; it does not exist on a static host, so any kit
 * stylesheet left as a link 404s and the page renders unstyled. This is exported
 * because `hero.html` needs it too — it is published as a standalone page but does
 * NOT go through buildSelfContained, and the scaffolded hero links both viz-kit.css
 * and viz-og.css.
 *
 * Matching is by name rather than hardcoded to viz-kit.css so viz-og.css (and any
 * future kit stylesheet) is covered. Unknown /_kit/ names are left alone rather than
 * silently dropped, so a typo stays visible as a 404 instead of vanishing.
 */
export function inlineKitCss(html: string): string {
  return html.replaceAll(/<link\b[^>]*>/giu, (tag) => {
    if (!/\brel=["']?stylesheet\b/iu.test(tag)) return tag;
    const name = tag.match(/\bhref=["']\/_kit\/([A-Za-z0-9._-]+\.css)["']/iu)?.[1];
    if (!name) return tag;
    const file = path.join(KIT_DIR, name);
    if (!existsSync(file)) return tag;
    return `<style>\n${readFileSync(file, "utf8")}\n</style>`;
  });
}

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
  const declared = bundleOf(html, vizDir).paths;
  const warnings = [
    ...bundled.warnings,
    ...scanUnhandledAssets(html).filter((w) => !declared.some((p) => w.includes(`"${p}"`))),
  ];

  // 1. Inline the kit stylesheets in place of their <link>s.
  html = inlineKitCss(html);

  // 1b. Inline the viz's OWN stylesheets the same way — the CSS counterpart of
  //     bundleSiblingModules. A <link href="../shared/engine.css"> used to be left
  //     verbatim: the file never travels with the single-file artifact, so the
  //     export 404s it and renders unstyled, silently. Only *relative* hrefs that
  //     resolve to a real file are inlined; absolute (/_kit/…), protocol-relative
  //     and remote hrefs are untouched, so existing vizzes build byte-identically.
  html = html.replaceAll(/<link\b[^>]*>/giu, (tag) => {
    if (!/\brel=["']?stylesheet\b/iu.test(tag)) return tag;
    const href = tag.match(/\bhref=["']([^"']+)["']/iu)?.[1];
    if (
      !href ||
      /^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(href) ||
      href.startsWith("data:") ||
      href.startsWith("/")
    )
      return tag;
    const file = path.resolve(vizDir, href);
    if (!existsSync(file)) {
      warnings.push(
        `stylesheet "${href}" not found — left as a link, which will 404 in the export`,
      );
      return tag;
    }
    return `<style>\n${readFileSync(file, "utf8")}\n</style>`;
  });

  // 1c. Inline the viz's OWN images, for exactly the reason 1b exists: a
  //     <img src="logo.svg"> or a background url("bg.jpg") never travels with the
  //     single-file artifact, so the export 404s it and renders half-styled —
  //     silently, because nothing was checking. Relative refs to a real file
  //     become data: URIs; absolute, protocol-relative and remote ones are left
  //     alone, so vizzes without local images build byte-identically.
  //     Caveat: url() inside an *external* stylesheet resolves against the viz
  //     dir here, not against that stylesheet's own directory.
  const IMG_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
  };
  const isLocalRef = (u: string) =>
    !!u &&
    !/^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(u) &&
    !u.startsWith("data:") &&
    !u.startsWith("/") &&
    !u.startsWith("#");
  const asDataUri = (ref: string): string | null => {
    const clean = ref.split(/[?#]/u)[0]!;
    const mime = IMG_MIME[path.extname(clean).toLowerCase()];
    if (!mime) return null;
    const file = path.resolve(vizDir, clean);
    if (!existsSync(file)) {
      warnings.push(`image "${ref}" not found — left as a link, which will 404 in the export`);
      return null;
    }
    return `data:${mime};base64,` + readFileSync(file).toString("base64");
  };
  html = html.replaceAll(/<img\b[^>]*>/giu, (tag) => {
    const m = tag.match(/\bsrc=(["'])([^"']+)\1/iu);
    if (!m || !isLocalRef(m[2]!)) return tag;
    const uri = asDataUri(m[2]!);
    return uri ? tag.replace(m[0], `src="${uri}"`) : tag;
  });
  html = html.replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, (block) =>
    block.replaceAll(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/giu,
      (whole: string, _q: string, ref: string) => {
        if (!isLocalRef(ref)) return whole;
        const uri = asDataUri(ref);
        return uri ? `url("${uri}")` : whole;
      },
    ),
  );

  // 2. Head injections. The import map (kit JS) is ALWAYS needed. The tape +
  //    fetch shim + frozen banner are only meaningful when the viz actually has
  //    recorded api responses to replay — a purely static viz (no api.ts, no
  //    recordings) gets none of them, so it's never mislabelled a "snapshot".
  const tape = readTape(vizDir);
  const hasRecordings = Object.keys(tape.entries).length > 0;

  let head = kitImportMap(html);
  // An import map resolves specifiers inside `import` statements — it does NOT touch a
  // <script>'s src, which the browser fetches as a plain URL against the document base.
  // So `<script type="module" src="/_kit/deck.js">` shipped mapped-but-still-absolute and
  // 404'd on every static host, and since deck.js is what renders the slides, the page came
  // out blank with its whole DOM present. (Found live: three decks served an empty frame.)
  // Rewriting the tag into an inline module puts the specifier back on the import path,
  // where the map above applies. Runs after kitImportMap so the scan still sees the src.
  html = html.replaceAll(
    /<script([^>]*)\ssrc=["'](\/_kit\/[A-Za-z0-9._-]+\.js)["']([^>]*)>\s*<\/script>/giu,
    (_m, before, spec, after) =>
      `<script${before}${after}>import ${JSON.stringify(spec)};</script>`,
  );
  // Stamp the artifact as a static/self-contained build. Env-aware vizzes read this
  // (kit vizEnv()) to know there's no live server behind them — so live-data UI can
  // show a "run me locally" placeholder instead of probing /_health or spinning.
  head += "\n<script>window.__VIZ_STATIC__=true;</script>";
  if (hasRecordings) head += "\n" + fetchShim(JSON.stringify(tape));
  const bundle = bundleOf(html, vizDir);
  if (bundle.paths.length > 0) head += "\n" + bundleShim(bundle.files);
  // Narration (kit narrate()): no Kokoro and no .tts/ on a static host, so the compiled
  // manifest travels inline with its clips as data: URLs. Compiled by `viz verify`, never here.
  const ttsManifest = path.join(vizDir, ".tts", "manifest.json");
  const script = statSync(path.join(vizDir, "narration.json"), { throwIfNoEntry: false });
  if (script && existsSync(ttsManifest)) {
    // no script → a leftover .tts/ is not narration
    const tts: unknown = JSON.parse(readFileSync(ttsManifest, "utf8"));
    if (!isTtsManifest(tts))
      throw new Error(
        `${ttsManifest} is not a compiled narration manifest — run \`viz verify\` to rebuild it`,
      );
    const inlineCues = (cues: { src: string }[]) =>
      cues.filter((c) => {
        const file = insideViz(vizDir, c.src); // never inline a file from outside the viz
        if (file && existsSync(file))
          return (c.src =
            `data:${AUDIO_MIME[path.extname(file).toLowerCase()] ?? "audio/mpeg"};base64,` +
            readFileSync(file).toString("base64"));
        warnings.push(
          `narration clip "${c.src}" is missing or outside the viz — left out of the export`,
        );
        return false;
      });
    tts.cues = inlineCues(tts.cues);
    for (const track of tts.tracks ?? []) track.cues = inlineCues(track.cues);
    head += `\n<script>window.__vizTts=${JSON.stringify(tts).replaceAll("<", "\\u003c")};</script>`;
    if (script.mtimeMs > statSync(ttsManifest).mtimeMs) {
      warnings.push(
        "narration.json changed since its clips were compiled — run `viz verify` first or the export ships the old narration",
      );
    }
  }
  html = injectIntoHead(html, head);

  // 3. Frozen-snapshot banner before </body> — recordings only (see above).
  if (hasRecordings) {
    html = injectBeforeBodyEnd(html, frozenBanner(tape.recordedAt));
  }

  // Warn only when the viz actually calls api/* but ships no tape to replay it —
  // a static viz with no api calls needs no recordings and shouldn't be nagged.
  const usesApi = /fetch\(\s*["'`]api\//u.test(html);
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
