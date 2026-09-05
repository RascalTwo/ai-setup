// lib/server/routes.ts — Turning a request into a response — the routing table.
//
// Extracted from server.ts, which was 522 lines.

import { upgradeReload } from "../../kit/reload.ts";
import { handleApi } from "./api.ts";
import { handleComments } from "./comments.ts";
import { BASE, MODE, STANDALONE } from "./config.ts";
import { rebuild, resolve, runScan, slugMap } from "./state.ts";
import { serveStatic } from "./static.ts";
import { BUNDLED, CENTRAL, HOME, allContainers, idFor } from "../../discovery.ts";
import { existsSync } from "node:fs";
import path from "node:path";
// Every path below is relative to the SKILL ROOT, not to this module. These moved two
// levels down during the decomposition and import.meta.dir moved with them — which is
// how /_kit/* started 404ing, and why the standalone-runtime detection would have
// mis-fired in a vendored copy.
const SKILL_DIR = path.resolve(import.meta.dir, "../..");
export async function handleRequest(req: Request, server: Server): Promise<Response | undefined> {
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
      const kitRoot = path.join(SKILL_DIR, "kit");
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

    // Websocket upgrade only — a plain GET here is never a real client (nothing but
    // the injected snippet ever calls it), so say 426 rather than 404.
    if (rest === "_reload") return upgradeReload(server, req, entry.id);

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
