// lib/server/static.ts — Serving a viz's own files, with the reload script injected.
//
// Extracted from server.ts, which was 522 lines.

import { MODE } from "./config.ts";
import { feedbackOverlay, reloadScript } from "./state.ts";
import { readTape } from "../../recordings.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { frozenBanner } from "../../recordings.ts";

const tsStrip = new Bun.Transpiler({ loader: "ts" });

/** A viz's `x.ts` as the `x.js` the browser asks for (ADR 0023). A MODULE (it imports or exports)
 *  is built one file at a time with an inline source map, imports left exactly as written, which is
 *  what publish's bundle runs too, and lets verify's coverage report `x.ts` lines. A CLASSIC script
 *  is only stripped: the bundler turns top-level `const` into `var`, which in a classic script
 *  would put it on `window`. */
export async function servedTs(ts: string): Promise<string> {
  const src = await Bun.file(ts).text();
  // A module is a file with an import or export statement — `export {}` included, which scan()
  // reports as no exports at all.
  if (!/^\s*(?:import|export)\b/m.test(src)) return tsStrip.transformSync(src);
  const built = await Bun.build({ entrypoints: [ts], external: ["*"], sourcemap: "inline", target: "browser", format: "esm" });
  if (!built.success || !built.outputs[0]) return tsStrip.transformSync(src);
  // The map names its source relative to this process's cwd; name it beside the script instead.
  return (await built.outputs[0].text()).replace(/(sourceMappingURL=data:application\/json;base64,)(\S+)/, (_, head: string, b64: string) => {
    const map = JSON.parse(Buffer.from(b64, "base64").toString());
    map.sources = [path.basename(ts)];
    return head + Buffer.from(JSON.stringify(map)).toString("base64");
  });
}

export async function serveStatic(slugDir: string, rel: string, id: string, range?: string | null): Promise<Response> {
  const target = rel || "index.html";
  const filePath = path.resolve(slugDir, target);
  // Block path-escape (e.g. ../../etc/passwd).
  if (!filePath.startsWith(slugDir + path.sep) && filePath !== slugDir) {
    return new Response("forbidden", { status: 403 });
  }
  if (!existsSync(filePath)) {
    // TYPESCRIPT, SERVED AS THE .js IT BECOMES (ADR 0023). A viz writes `app.ts` and
    // references `./app.js` — the name it has once published — so a request for a .js
    // that isn't there is answered by its .ts sibling with the types stripped. A browser
    // cannot run type syntax; the checking is `viz verify`'s job, not this one's.
    const ts = filePath.replace(/\.js$/, ".ts");
    if (ts !== filePath && existsSync(ts)) {
      return new Response(await servedTs(ts), {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  }
  const file = Bun.file(filePath);
  if (filePath.endsWith(".html")) {
    let html = await file.text();
    // Hot-reload script always; in frozen mode also a "this is a snapshot" banner;
    // live mode also gets the feedback widget (absent from frozen builds).
    let inject = reloadScript(id);
    if (MODE === "frozen") inject += frozenBanner(readTape(slugDir).recordedAt);
    else inject += feedbackOverlay(id);
    if (html.includes("</body>")) html = html.replace("</body>", inject + "</body>");
    else html += inject;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  // Byte ranges: a browser can only seek inside audio/video served with them — without, a
  // narration clip resumed mid-way silently snaps back and never plays (seen live).
  const size = file.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? +m[1] : Math.max(0, size - +m[2]!);
    const end = Math.min(m[1] && m[2] ? +m[2] : size - 1, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": String(end - start + 1), "content-type": file.type },
    });
  }
  return new Response(file, { headers: { "accept-ranges": "bytes" } });
}
