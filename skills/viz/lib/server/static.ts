// lib/server/static.ts — Serving a viz's own files, with the reload script injected.
//
// Extracted from server.ts, which was 522 lines.

import { MODE } from "./config.ts";
import { commentOverlay, reloadScript, resolve } from "./state.ts";
import { readTape } from "../../recordings.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { frozenBanner } from "../../recordings.ts";
export async function serveStatic(slugDir: string, rel: string, id: string, range?: string | null): Promise<Response> {
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
    if (MODE === "frozen") inject += frozenBanner(readTape(slugDir).recordedAt);
    else inject += commentOverlay(id);
    if (html.includes("</body>")) html = html.replace("</body>", inject + "</body>");
    else html += inject;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  // Byte ranges: a browser can only seek inside audio/video served with them — without, a
  // narration clip resumed mid-way silently snaps back and never plays (seen live).
  const size = file.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    const end = Math.min(m[1] && m[2] ? +m[2] : size - 1, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": String(end - start + 1), "content-type": file.type },
    });
  }
  return new Response(file, { headers: { "accept-ranges": "bytes" } });
}
