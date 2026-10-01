// lib/testing/shots.ts — screenshots waiting for a person: list, approve, reject, and the review page.
//
// A viz's tests park every new or changed screenshot in tests/__screenshots__/.pending/ (preload.ts).
// Approving moves it over the baseline; rejecting deletes it. The page (review.html, its script
// review.ts) is where a person looks first — side by side, swipe at any angle, blend, flicker, and
// an intensity diff.

import path from "node:path";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";

const tsStrip = new Bun.Transpiler({ loader: "ts" });

export type Pending = { name: string; kind: "new" | "changed" };

const dirs = (vizDir: string) => {
  const shots = path.join(path.resolve(vizDir), "tests", "__screenshots__");
  return { shots, pending: path.join(shots, ".pending") };
};

export function listPending(vizDir: string): Pending[] {
  const { shots, pending } = dirs(vizDir);
  if (!existsSync(pending)) return [];
  return readdirSync(pending).filter((f) => f.endsWith(".png")).sort()
    .map((f) => ({ name: f.slice(0, -4), kind: existsSync(path.join(shots, f)) ? "changed" : "new" }));
}

/** "all" or one name. Returns the names acted on. */
export function decide(vizDir: string, which: string, approve: boolean): string[] {
  const { shots, pending } = dirs(vizDir);
  const names = listPending(vizDir).map((p) => p.name).filter((n) => which === "all" || n === which);
  for (const n of names) {
    const from = path.join(pending, n + ".png");
    if (approve) renameSync(from, path.join(shots, n + ".png"));
    else rmSync(from);
  }
  return names;
}

/** The review page for one viz, on a free local port. Resolves with its URL; runs until the process ends. */
export function serveReview(vizDir: string): string {
  const { shots, pending } = dirs(vizDir);
  const page = Bun.file(path.join(import.meta.dir, "review.html"));
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/favicon.ico") return new Response(null, { status: 204 });
      if (u.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (u.pathname === "/review.js") {
        const js = tsStrip.transformSync(await Bun.file(path.join(import.meta.dir, "review.ts")).text());
        return new Response(js, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }
      if (u.pathname === "/list") return Response.json({ viz: path.basename(vizDir), pending: listPending(vizDir) });
      const img = u.pathname.match(/^\/img\/(baseline|pending)\/([\w.-]+)$/);
      if (img) {
        const f = Bun.file(path.join(img[1] === "baseline" ? shots : pending, img[2] + ".png"));
        return (await f.exists()) ? new Response(f, { headers: { "cache-control": "no-store" } }) : new Response("gone", { status: 404 });
      }
      const act = u.pathname.match(/^\/(approve|reject)\/([\w.-]+)$/);
      if (act && req.method === "POST") return Response.json({ done: decide(vizDir, act[2]!, act[1] === "approve") });
      return new Response("not found", { status: 404 });
    },
  });
  return `http://127.0.0.1:${server.port}/`;
}
