// lib/publish/preview.ts — A dependency-free static server over a built tree.
//
// Extracted from build.ts, which was 1993 lines.

// ---- Preview: a dumb local static server over a built tree (no deps, Bun.file sets
// content-types just like server.ts). Binds 127.0.0.1; port 0 ⇒ OS picks a free one. ----
// Serve the built preview tree with LIVE RELOAD: watch the source container, rebuild the
// publishable tree on any change, and push an SSE "reload" so open tabs refresh — the same
// enter-once-and-see-your-edits loop the dev server (server.ts) gives editable source, but
// here over the *publishable* snapshot, so `preview` tracks what you type.
// ponytail: naive full-tree rebuild per change, debounced; a preview is one local container,
// so this is fine — shard the rebuild only if a huge container makes it sluggish.
// Binds BEFORE the first build and returns its own origin, because a preview that seals
// against PLACEHOLDER_HOST isn't "exactly what would publish": `haveHost` false suppresses
// every share shim and OG image (publishOne:388). With the port in hand the caller can build
// against the real localhost origin, so shims exist locally — and since a shim's hash segment
// depends only on passphrase+salt (never the host), the /<slug>/<hash>/ path it produces is
// the same path that will deploy. Swap the origin and it's the shareable link.
import { PLACEHOLDER_HOST } from "./constants.ts";
import { ensureOgImage } from "./og.ts";
import { publishOne } from "./publish-one.ts";
import { buildPublishableTree } from "./tree.ts";
import { die } from "../../cli.ts";
import { readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export function servePreview(
  container: string,
  root: string,
  baseUrlOverride: string | undefined,
  opts: { noIndex?: boolean; indexTitle?: string; indexDescription?: string },
  requestedPort: number | undefined,
) {
  const RELOAD_PATH = "/_preview_reload";
  // Same channel the dev server uses — one implementation, in kit/reload.ts. A preview
  // is a single viz in a single tab, so it never hit the 6-connection cap that forced
  // the switch; it shares the code so there aren't two reload mechanisms to keep right.
  const RELOAD_SNIPPET = reloadSnippet(RELOAD_PATH);
  const RELOAD_TOPIC = "preview";

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: requestedPort ?? 0,
    websocket: reloadWebSocket,
    async fetch(req, server) {
      const url = new URL(req.url);
      // Reload channel the injected snippet listens on.
      if (url.pathname === RELOAD_PATH) return upgradeReload(server, req, RELOAD_TOPIC);
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const filePath = path.normalize(path.join(root, rel));
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        return new Response("forbidden", { status: 403 }); // refuse path escape
      }
      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      // Inject the reload client into served HTML (preview-only; the published bytes are untouched).
      if (filePath.endsWith(".html")) {
        const html = await file.text();
        const withReload = /<\/body>/i.test(html)
          ? html.replace(/<\/body>/i, RELOAD_SNIPPET + "</body>")
          : html + RELOAD_SNIPPET;
        return new Response(withReload, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response(file);
    },
  });

  // The preview's own origin — now knowable, since the server is already bound.
  const shareHost = baseUrlOverride ?? `http://127.0.0.1:${server.port}/`;

  // Rebuild → reload. Debounced so a burst of saves coalesces into one rebuild. We build into
  // a staging dir and swap only on success, so a mid-edit build error (e.g. a viz saved with
  // an undeclared posture) keeps the LAST GOOD build served instead of blanking the preview.
  // Both dirs live in os.tmpdir(), and the rename is same-filesystem.
  //
  // The build is NOT confined to those dirs, though: it also writes transient artifacts INTO
  // the container — og.auto.png (ensureOgImage → verify.ts --og) and .__viz_bundle_*.mjs
  // (inline.ts). Those land inside the watched tree, so an unguarded watcher rebuilds on its
  // own output, forever. `building` gates the whole window; the settle delay covers fs events
  // that land just after the build returns. Measured: without it, one preview of a 13-viz
  // container ran 58 rebuilds in 30s instead of 1.
  const staging = root + ".next";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let building = true; // the caller's initial build is already in flight when this returns
  // Rebuild only when the SOURCES actually differ. macOS recursive fs.watch delivers phantom
  // `change` events for files nothing wrote — reproducible on a container holding a mirrored-in
  // viz, whose index.html fires repeatedly while its mtime and size never move. Without this,
  // one preview of a 13-viz container rebuilt 69 times in 70s while idle.
  const signature = () => {
    const parts: string[] = [];
    for (const rel of readdirSync(container, { recursive: true }) as string[]) {
      const base = path.basename(rel);
      if (base === "og.auto.png" || base.startsWith(".")) continue; // build-written, not sources
      try {
        const st = statSync(path.join(container, rel));
        if (st.isFile()) parts.push(`${rel}:${st.mtimeMs}:${st.size}`);
      } catch { /* vanished mid-walk — next event re-reads */ }
    }
    return parts.sort().join("\n");
  };
  let lastSig = signature();
  const settle = () => setTimeout(() => { building = false; lastSig = signature(); }, 500);
  watch(container, { recursive: true }, (_ev, fn) => {
    if (building) return;
    // Belt-and-braces for artifacts another PROCESS also rewrites (the dev server regenerates
    // og.auto.png and inline.ts's .__viz_bundle_*.mjs), which the `building` gate can't see.
    // Hand-made og.png/og.jpg are deliberately NOT filtered — those are real source edits.
    const base = typeof fn === "string" ? path.basename(fn) : "";
    if (base === "og.auto.png" || base.startsWith(".")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      // ponytail: buildPublishableTree calls die()→process.exit on a refused build (e.g. a viz
      // saved mid-edit with no viz:posture). In a long-lived preview that would kill the server,
      // so trap exit→throw for the rebuild window; the reason is still printed (die console.errors
      // first) and we keep the last good build up. Restore exit in finally.
      const realExit = process.exit;
      (process as unknown as { exit: (c?: number) => never }).exit = (c?: number) => {
        throw new Error(`build refused (would exit ${c ?? 2})`);
      };
      if (signature() === lastSig) return; // phantom event — nothing on disk actually moved
      building = true;
      try {
        rmSync(staging, { recursive: true, force: true });
        await buildPublishableTree(container, staging, shareHost, opts);
        rmSync(root, { recursive: true, force: true });
        renameSync(staging, root);
        publishReload(server, RELOAD_TOPIC);
        console.log("↻ rebuilt — reloaded");
      } catch (e) {
        rmSync(staging, { recursive: true, force: true }); // drop the partial build
        console.error("⚠️  preview rebuild failed (kept the last good build up):", e instanceof Error ? e.message : e);
      } finally {
        process.exit = realExit;
        settle();
      }
    }, 200);
  });

  // `buildDone` reopens the watcher after the caller's initial build (see `building` above).
  return { server, shareHost, buildDone: settle };
}

// Open a URL in the OS default browser (best-effort; never throws into the caller).
export function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* opening is a nicety; the printed URL is the source of truth */
  }
}
