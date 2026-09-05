// lib/server/static.ts — Serving a viz's own files, with the reload script injected.
//
// Extracted from server.ts, which was 522 lines.

import { MODE } from "./config.ts";
import { commentOverlay, reloadScript, resolve } from "./state.ts";
import { readTape } from "../../recordings.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { frozenBanner } from "../../recordings.ts";
export async function serveStatic(slugDir: string, rel: string, id: string): Promise<Response> {
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
  return new Response(file);
}
