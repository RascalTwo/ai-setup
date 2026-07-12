#!/usr/bin/env bun
// Singleton viz server. Serves vizzes from MANY roots, not one: the central
// library plus any `viz-pages/` container discovered under $HOME or registered
// by bootstrap. Each viz is identified by its path relative to $HOME, which is
// also its URL. Watches every container for changes, broadcasts SSE reload, and
// hot-loads per-viz api.ts handlers. Bound to 127.0.0.1 only — full local trust.

import { watch, existsSync, type FSWatcher } from "node:fs";
import path from "node:path";
import {
  BUNDLED,
  CENTRAL,
  HOME,
  allContainers,
  buildSlugMap,
  deepScan,
  idFor,
  readRegistry,
  writeRegistry,
  type SlugEntry,
} from "./discovery.ts";
import {
  recordKey,
  lookup,
  replay,
  writeEntry,
  envelopeFrom,
  hasTape,
  readTape,
  frozenBanner,
  kindFromHtml,
} from "./recordings.ts";

const PORT = 5180;

// Tape recorder mode, a process-level flag. frozen wins if both given.
//   --record  live api, tee every response into the viz's recordings.json
//   --frozen  serve the tape for every api call; the live backend is untouched
const MODE: "live" | "record" | "frozen" = process.argv.includes("--frozen")
  ? "frozen"
  : process.argv.includes("--record")
    ? "record"
    : "live";

// ---- Mode: one server, two configs ----
// A vendored runtime lives at <repo>/viz-pages/.runtime/. If we're running from
// there, we're STANDALONE: serve only that repo, id-base = the dir above
// viz-pages/, no $HOME scan, no central seed. Otherwise we're the CENTRAL server
// running from the skill dir: $HOME-based ids, deep scan, multi-root discovery.
const STANDALONE =
  path.basename(import.meta.dir) === ".runtime" &&
  path.basename(path.dirname(import.meta.dir)) === "viz-pages";
const STANDALONE_CONTAINER = path.dirname(import.meta.dir); // <repo>/viz-pages
const BASE = STANDALONE ? path.dirname(STANDALONE_CONTAINER) : HOME;

// Hand the skill dir down to any viz api.ts we hot-load (ADR 0009): the self-portrait
// shells out to manage.ts for mutations. Central only — a standalone .runtime has no
// manage.ts, and doesn't seed the bundled self-portrait container.
if (!STANDALONE) process.env.VIZ_SKILL_DIR = import.meta.dir;

// The containers this process serves: the one repo container when standalone,
// the discovered set (central library + registry) when central.
function currentContainers(): string[] {
  return STANDALONE ? [STANDALONE_CONTAINER] : allContainers();
}

// ---- Live state, rebuilt whenever the set of vizzes changes ----
let slugMap = new Map<string, SlugEntry>();
let sortedIds: string[] = []; // ids longest-first, for prefix matching
const watchers = new Map<string, FSWatcher>();

type Client = { controller: ReadableStreamDefaultController; id: string };
const sseClients = new Set<Client>();

// Reload script is injected per-page with the viz's id baked in — the client
// can't infer a multi-segment id from the URL the way it used to with one segment.
function reloadScript(id: string): string {
  return `<script>
(function(){
  const es = new EventSource(${JSON.stringify("/" + id + "/_reload")});
  es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
})();
</script>`;
}

// Live-only review/comment overlay (the kit's comments.js + comments.css). Dropped
// in next to the reload script, but NEVER in frozen mode — a published/static build
// carries no comment layer. The viz id rides in a data-attr so the client builds the
// right /<id>/_comments URL regardless of trailing slash, mirroring reloadScript.
function commentOverlay(id: string): string {
  return (
    `<link rel="stylesheet" href="/_kit/comments.css">` +
    `<script type="module" src="/_kit/comments.js" data-viz-comments="${id}"></script>`
  );
}

// Coalesce bursty fs events into one reload per viz per 100ms.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
function broadcastReload(id: string) {
  const existing = debounceTimers.get(id);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    id,
    setTimeout(() => {
      debounceTimers.delete(id);
      for (const client of sseClients) {
        if (client.id === id) {
          try {
            client.controller.enqueue(`data: reload\n\n`);
          } catch {}
        }
      }
    }, 100),
  );
}

// A change anywhere under a container maps back to the viz whose name is the
// first path segment. Dotfiles (.git/, .server*, .discovered.json) are ignored.
// If the change is a brand-new viz dir (unknown id), refresh the map so it routes
// immediately — fs.watch otherwise only triggers reloads, not (re)discovery.
function onFsEvent(container: string, filename: string | null) {
  if (!filename) return;
  const name = filename.toString();
  // The comment overlay writes comments.json on every create/resolve/delete; that's
  // the overlay's own data, not an edit to the viz, so it must NOT reload the page
  // (a reload would nuke scroll/animation state out from under the user). The
  // overlay re-fetches its list itself after each mutation.
  if (path.basename(name) === COMMENTS_FILE) return;
  const first = name.split(path.sep)[0];
  if (!first || first.startsWith(".")) return;
  const id = idFor(path.join(container, first), BASE);
  if (!id) return;
  if (!slugMap.has(id)) scheduleRebuild();
  broadcastReload(id);
}

// Coalesce rapid map rebuilds (e.g. a burst of file creations) into one.
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 150);
}

function syncWatchers(containers: string[]) {
  for (const c of containers) {
    if (watchers.has(c) || !existsSync(c)) continue;
    try {
      watchers.set(c, watch(c, { recursive: true }, (_e, fn) => onFsEvent(c, fn)));
    } catch {}
  }
  for (const [c, w] of watchers) {
    if (!containers.includes(c)) {
      try {
        w.close();
      } catch {}
      watchers.delete(c);
    }
  }
}

// Recompute the slug map + watchers from whatever containers are known right now.
function rebuild() {
  const containers = currentContainers();
  slugMap = buildSlugMap(containers, BASE);
  sortedIds = [...slugMap.keys()].sort((a, b) => b.length - a.length);
  syncWatchers(containers);
}

// Deep-scan, union the result with the existing registry, persist, rebuild.
// Standalone serves one known container, so there's nothing to discover — just
// rebuild. (We never scan a cloner's $HOME.)
async function runScan(): Promise<number> {
  if (STANDALONE) {
    rebuild();
    return slugMap.size;
  }
  const found = await deepScan();
  const containers = [...new Set([CENTRAL, ...readRegistry(), ...found])].filter((c) =>
    existsSync(c),
  );
  await writeRegistry(containers);
  rebuild();
  return slugMap.size;
}

// Given a leading-slash-stripped request path, find the longest viz id that owns
// it. Returns the entry plus the remaining path inside the viz (or a redirect
// signal when the id was requested without its trailing slash).
function resolve(p: string): { entry: SlugEntry; rest: string } | { redirectTo: string } | null {
  for (const id of sortedIds) {
    if (p === id) return { redirectTo: "/" + id + "/" };
    if (p.startsWith(id + "/")) {
      const entry = slugMap.get(id)!;
      return { entry, rest: p.slice(id.length + 1) };
    }
  }
  return null;
}

async function handleApi(slugDir: string, route: string, req: Request): Promise<Response> {
  const rkey = await recordKey(req, route);

  // Frozen: serve the tape, never touch the live backend.
  if (MODE === "frozen") {
    const env = lookup(slugDir, rkey);
    if (env) return replay(env);
    return new Response(`no recording for ${rkey}`, { status: 404 });
  }

  // Live (and --record). On any failure, add a hint if a tape could rescue this —
  // but never auto-serve it (that silent-stale-fallback is the trap we avoid).
  const errored = (msg: string, status: number): Response => {
    if (hasTape(slugDir)) msg += `\n(a recording exists — run the server with --frozen to replay it)`;
    return new Response(msg, { status });
  };

  const apiPath = path.join(slugDir, "api.ts");
  if (!existsSync(apiPath)) return errored("api.ts not found", 404);

  // Cache-bust the import so edits to api.ts are picked up without a restart.
  // A syntax/transpile/import error throws HERE — surface it as a clean 500 with
  // the message instead of an opaque uncaught rejection ("check api before serve").
  let mod: any;
  try {
    mod = await import(apiPath + "?t=" + Date.now());
  } catch (e) {
    return errored("api.ts failed to load: " + (e as Error).message, 500);
  }
  const routes = mod.default ?? mod;
  const routeKey = "/" + route;
  const handler = routes[routeKey] ?? routes[route];
  if (typeof handler !== "function") return errored("route not found: " + routeKey, 404);

  let res: Response;
  try {
    res = await handler(req);
  } catch (e) {
    return errored("api error: " + (e as Error).message, 500);
  }

  // Record: tee a clone of the live response into the tape (best-effort).
  if (MODE === "record") {
    try {
      await writeEntry(slugDir, rkey, await envelopeFrom(res));
    } catch (e) {
      console.error("record failed for", rkey, (e as Error).message);
    }
  }
  return res;
}

// ---- Anchored comment layer (review/feedback). ----
// Comments persist as a BARE ARRAY in comments.json beside the viz's index.html,
// scoped to the dir the request resolved to — so every viz is commentable for free,
// with zero per-viz setup. Lifecycle: the user creates (POST, status "open") and
// deletes (DELETE, after reviewing); the agent resolves (PATCH, status "resolved"
// + an optional one-line `resolution` note). Last-write-wins; single local user, so
// no locking. This route is only reached in live mode (the overlay that calls it
// isn't injected when frozen, and handleRequest gates it on MODE !== "frozen").
const COMMENTS_FILE = "comments.json";

async function readComments(slugDir: string): Promise<Record<string, unknown>[]> {
  const f = Bun.file(path.join(slugDir, COMMENTS_FILE));
  if (!(await f.exists())) return [];
  try {
    const arr = JSON.parse(await f.text());
    return Array.isArray(arr) ? arr : [];
  } catch {
    return []; // a hand-mangled file shouldn't 500 the overlay
  }
}

async function writeComments(slugDir: string, arr: unknown[]): Promise<void> {
  await Bun.write(path.join(slugDir, COMMENTS_FILE), JSON.stringify(arr, null, 2) + "\n");
}

async function handleComments(slugDir: string, rest: string, req: Request): Promise<Response> {
  const arr = await readComments(slugDir);

  if (req.method === "GET") return Response.json(arr);

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = String(body.text ?? "").trim();
    if (!text) return new Response("text required", { status: 400 });
    const comment = {
      id: "c" + Math.random().toString(36).slice(2, 8),
      text,
      status: "open",
      vizState: typeof body.vizState === "string" ? body.vizState : "",
      anchor: body.anchor && typeof body.anchor === "object" ? body.anchor : {},
      createdAt: new Date().toISOString(),
    };
    arr.push(comment);
    await writeComments(slugDir, arr);
    return Response.json(comment, { status: 201 });
  }

  // PATCH / DELETE address a single comment by id: _comments/<id>.
  const id = rest.startsWith("_comments/") ? rest.slice("_comments/".length) : "";
  const idx = id ? arr.findIndex((c) => c.id === id) : -1;
  if (idx === -1) return new Response("comment not found", { status: 404 });

  if (req.method === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.status === "open" || body.status === "resolved") arr[idx].status = body.status;
    if (typeof body.resolution === "string") arr[idx].resolution = body.resolution;
    await writeComments(slugDir, arr);
    return Response.json(arr[idx]);
  }

  if (req.method === "DELETE") {
    const [removed] = arr.splice(idx, 1);
    await writeComments(slugDir, arr);
    return Response.json(removed);
  }

  return new Response("method not allowed", { status: 405 });
}

async function serveStatic(slugDir: string, rel: string, id: string): Promise<Response> {
  const target = rel || "index.html";
  const filePath = path.resolve(slugDir, target);
  // Block path-escape (e.g. ../../etc/passwd).
  if (!filePath.startsWith(slugDir + path.sep) && filePath !== slugDir) {
    return new Response("forbidden", { status: 403 });
  }
  if (!existsSync(filePath)) {
    return new Response("not found", { status: 404 });
  }
  const file = Bun.file(filePath);
  if (filePath.endsWith(".html")) {
    let html = await file.text();
    // Hot-reload script always; in frozen mode also a "this is a snapshot" banner;
    // live mode also gets the anchored-comment overlay (absent from frozen builds).
    let inject = reloadScript(id);
    if (MODE === "frozen") inject += frozenBanner(readTape(slugDir).recordedAt, kindFromHtml(html));
    else inject += commentOverlay(id);
    if (html.includes("</body>")) html = html.replace("</body>", inject + "</body>");
    else html += inject;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response(file);
}

// ---- Boot: serve immediately from the registry fast-path, then scan in bg ----
rebuild();
runScan().catch((e) => console.error("initial scan failed:", e));

// Request handler, shared by both modes. Named (not an inline server method) so
// the listen loop below can retry it on a higher port in standalone mode.
async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/_health") return new Response("OK");

    // Re-run the deep scan on demand (Rescan button on the home page).
    if (pathname === "/_rescan") {
      const slugs = await runScan();
      return Response.json({ containers: allContainers().length, slugs });
    }

    // Cheap map rebuild (no deep scan) — bootstrap pings this right after creating
    // a viz so it routes immediately without waiting for the next scan.
    if (pathname === "/_refresh") {
      rebuild();
      return Response.json({ slugs: slugMap.size });
    }

    const segments = pathname.split("/").filter(Boolean);

    // Shared kit assets (viz-kit.css, viz.js, ...) live alongside this server in
    // the skill's kit/ dir — served at /_kit/* so any viz links them absolutely.
    if (segments[0] === "_kit") {
      const kitRoot = path.join(import.meta.dir, "kit");
      const rel = segments.slice(1).join("/") || "README.md";
      const filePath = path.resolve(kitRoot, rel);
      if (!filePath.startsWith(kitRoot + path.sep) && filePath !== kitRoot) {
        return new Response("forbidden", { status: 403 });
      }
      if (!existsSync(filePath)) return new Response("not found", { status: 404 });
      const ext = path.extname(filePath);
      const ctype =
        { ".css": "text/css", ".js": "text/javascript", ".md": "text/markdown" }[ext] ??
        "application/octet-stream";
      return new Response(Bun.file(filePath), {
        headers: { "content-type": ctype + "; charset=utf-8" },
      });
    }

    // Root: the self-portrait is the real home page; it ships in the skill's bundled
    // container, with the old central location as a fallback for libraries that still
    // hold their own copy. Standalone has neither, so it always lists.
    if (segments.length === 0) {
      if (!STANDALONE) {
        // idFor returns a truthy id for any path under $HOME, present or not — so
        // `||` would always pick the (often unbuilt) BUNDLED id. Take the first id
        // that's actually in the slug map instead.
        const spId = [
          idFor(path.join(BUNDLED, "viz-self-portrait"), BASE),
          idFor(path.join(CENTRAL, "viz-self-portrait"), BASE),
        ].find((id) => id && slugMap.has(id));
        if (spId) return Response.redirect("/" + spId + "/", 302);
      }
      const list = [...slugMap.keys()]
        .sort()
        .map((id) => `<li><a href="/${id}/">${id}</a></li>`)
        .join("");
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>viz</title>` +
          `<style>body{font:14px ui-monospace,monospace;padding:2rem;max-width:50rem}` +
          `a{color:#06c;text-decoration:none}a:hover{text-decoration:underline}</style>` +
          `<h1>viz pages</h1><ul>${list || "<li><em>none yet</em></li>"}</ul>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    const p = pathname.replace(/^\/+/, "");
    const hit = resolve(p);
    if (!hit) return new Response("not found", { status: 404 });
    if ("redirectTo" in hit) return Response.redirect(hit.redirectTo, 302);

    const { entry, rest } = hit;

    if (rest === "_reload") {
      const id = entry.id;
      const stream = new ReadableStream({
        start(controller) {
          const client: Client = { controller, id };
          sseClients.add(client);
          controller.enqueue(`: connected\n\n`);
          req.signal.addEventListener("abort", () => {
            sseClients.delete(client);
            try {
              controller.close();
            } catch {}
          });
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    if (rest === "api" || rest.startsWith("api/")) {
      const route = rest.replace(/^api\/?/, "");
      return handleApi(entry.dir, route, req);
    }

    // Anchored comment layer — live-only, so a frozen run exposes no _comments
    // route (matching the overlay being absent). Scoped to the resolved viz dir.
    if ((rest === "_comments" || rest.startsWith("_comments/")) && MODE !== "frozen") {
      return handleComments(entry.dir, rest, req);
    }

    return serveStatic(entry.dir, rest, entry.id);
}

// ---- Listen. Central is pinned to 5180 (bootstrap probes that exact port).
// Standalone tries 5180 and walks up to the next free port, so a standalone
// spot-check can coexist with a running central server. ----
let boundPort = PORT;
const maxPort = STANDALONE ? PORT + 50 : PORT;
for (;;) {
  try {
    // idleTimeout maxed (255s, Bun's ceiling): a streaming api.ts response can
    // pause for many seconds (model inference, slow command) without Bun closing
    // the idle connection, so backends needn't hand-roll keep-alive heartbeats.
    Bun.serve({ hostname: "127.0.0.1", port: boundPort, idleTimeout: 255, fetch: handleRequest });
    break;
  } catch (e) {
    const inUse =
      (e as { code?: string })?.code === "EADDRINUSE" || /EADDRINUSE|in use/i.test(String(e));
    if (inUse && boundPort < maxPort) {
      boundPort++;
      continue;
    }
    throw e;
  }
}

console.log(
  `viz server running at http://127.0.0.1:${boundPort}  ` +
    `(mode=${STANDALONE ? "standalone" : "central"}, base=${BASE}` +
    `${MODE === "live" ? "" : ", tape=" + MODE})`,
);
