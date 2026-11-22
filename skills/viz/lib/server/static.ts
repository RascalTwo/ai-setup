// lib/server/static.ts — Serving a viz's own files, with the reload script injected.
//
// Extracted from server.ts, which was 522 lines.

import { MODE } from "./config.ts";
import { reloadScript } from "./state.ts";
import { feedbackBody, feedbackHead, presenceBody } from "./feedback-page.ts";
import { readTape } from "../../recordings.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { frozenBanner } from "../../recordings.ts";
import { withKitAlias } from "./kit-alias.ts";
import { fileBody, mimeOf, stripTs } from "./serve.ts";

/** A viz's `x.ts` as the `x.js` the browser asks for (ADR 0023): types stripped, imports left exactly
 *  as written. A MODULE (it imports or exports, `export {}` included) gets an inline source map naming
 *  `x.ts` so verify's coverage report can show its lines; a CLASSIC script gets none, and verify says
 *  it cannot be measured. */
export function servedTs(ts: string): string {
  const src = readFileSync(ts, "utf8");
  const isModule = /^\s*(?:import|export)\b/mu.test(src);
  return isModule ? stripTs(src, path.basename(ts)) : stripTs(src);
}

export function serveStatic(
  slugDir: string,
  rel: string,
  id: string,
  range?: string | null,
): Response {
  const target = rel || "index.html";
  const filePath = path.resolve(slugDir, target);
  // Block path-escape (e.g. ../../etc/passwd).
  if (!filePath.startsWith(slugDir + path.sep) && filePath !== slugDir) {
    return new Response("forbidden", { status: 403 });
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // TYPESCRIPT, SERVED AS THE .js IT BECOMES (ADR 0023). A viz writes `app.ts` and
    // references `./app.js` — the name it has once published — so a request for a .js
    // that isn't there is answered by its .ts sibling with the types stripped. A browser
    // cannot run type syntax; the checking is `viz verify`'s job, not this one's.
    const ts = filePath.replace(/\.js$/u, ".ts");
    if (ts !== filePath && existsSync(ts)) {
      return new Response(servedTs(ts), {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  }
  if (filePath.endsWith(".html")) {
    const source = readFileSync(filePath, "utf8");
    let html = withKitAlias(source);
    // Hot-reload script always; in frozen mode also a "this is a snapshot" banner. The feedback
    // widget on every page (ADR 0026): writing to this server's log route live, and to the
    // browser in a frozen run, which has no route.
    let inject = reloadScript(id);
    if (MODE === "frozen") inject += frozenBanner(readTape(slugDir).recordedAt) + feedbackBody();
    else inject += feedbackBody(id);
    inject += presenceBody();
    if (html.includes("</body>")) html = html.replace("</body>", inject + "</body>");
    else html += inject;
    const head = /<head\b[^>]*>/iu.exec(html);
    html = head
      ? html.replace(head[0], () => head[0] + feedbackHead(source))
      : feedbackHead(source) + html;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  // Byte ranges: a browser can only seek inside audio/video served with them — without, a
  // narration clip resumed mid-way silently snaps back and never plays (seen live).
  const size = statSync(filePath).size;
  const m = /^bytes=(\d*)-(\d*)$/u.exec(range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? +m[1] : Math.max(0, size - Number(m[2]));
    const end = Math.min(m[1] && m[2] ? +m[2] : size - 1, size - 1);
    if (start > end)
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(fileBody(filePath, { start, end }), {
      status: 206,
      headers: {
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
        "content-type": mimeOf(filePath),
      },
    });
  }
  return new Response(fileBody(filePath), {
    headers: {
      "accept-ranges": "bytes",
      "content-length": String(size),
      "content-type": mimeOf(filePath),
    },
  });
}
