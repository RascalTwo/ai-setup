// lib/server/data.ts — Page data: what a viz's own page saves, as named JSONL logs (ADR 0019).
//
// A page appends to `_log/<name>` and the lines land in <viz>/.viz-data/<name>.jsonl, so a
// viz can collect input (answers, votes, a transcript) without its own api.ts.
// It is a DATA route, never code: it writes one fixed folder,
// names are a strict allowlist, and sizes are capped. `_files/` is the planned second
// namespace (raw uploads) and deliberately unbuilt until something needs it.
//
// Live-only like the feedback widget: frozen runs and published builds have no route, and
// .viz-data/ is git-ignored, vendor-stripped and left out of approval hashes.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = ".viz-data";
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_LINE = 1 << 20; // 1 MB per appended entry
const MAX_LOG = 10 << 20; // 10 MB per log file

export async function handleData(slugDir: string, rest: string, req: Request): Promise<Response> {
  if (rest.startsWith("_files/")) return new Response("_files is not built yet (ADR 0019)", { status: 501 });

  const name = rest.slice("_log/".length);
  if (!NAME.test(name) || name.includes("..")) return new Response("bad log name: use a-z 0-9 . _ -", { status: 400 });
  const file = path.join(slugDir, DATA_DIR, name + ".jsonl");

  if (req.method === "GET") {
    if (!existsSync(file)) return Response.json([]);
    const lines = (await Bun.file(file).text()).split("\n").filter(Boolean);
    const out: unknown[] = [];
    for (const l of lines) {
      try { out.push(JSON.parse(l)); } catch { /* a torn or hand-mangled line shouldn't 500 the page */ }
    }
    return Response.json(out);
  }

  if (req.method === "POST") {
    const text = await req.text();
    if (text.length > MAX_LINE) return new Response("entry too large (1 MB max)", { status: 413 });
    let entry: unknown;
    try { entry = JSON.parse(text); } catch { return new Response("body must be JSON", { status: 400 }); }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return new Response("body must be a JSON object", { status: 400 });
    const size = existsSync(file) ? Bun.file(file).size : 0;
    if (size + text.length > MAX_LOG) return new Response("log full (10 MB max)", { status: 413 });
    // Stamp arrival time unless the page sent its own, so every line can be put on a timeline.
    const line = JSON.stringify({ at: new Date().toISOString(), ...(entry as Record<string, unknown>) });
    mkdirSync(path.dirname(file), { recursive: true });
    await appendFile(file, line + "\n");
    return new Response(line, { status: 201, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE") {
    rmSync(file, { force: true });
    return new Response(null, { status: 204 });
  }

  return new Response("method not allowed", { status: 405 });
}
