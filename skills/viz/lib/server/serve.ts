// lib/server/serve.ts — the little Node plumbing the servers share: a fetch-style http server,
// a content-type table, and TypeScript stripping.
//
// Every handler here takes a web `Request` and returns a web `Response`.
// serve() is the one adapter between that and node:http, used by the dev server, the publish
// preview and the screenshot review page. Lives in lib/server/ so vendored runtimes get it.

import http from "node:http";
import { createReadStream } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { upgradeSockets } from "../../kit/reload.ts";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { ReadableStream as WebStream } from "node:stream/web";

/** Returns `undefined` only for a websocket upgrade it took over (kit/reload.ts). */
export type Fetch = (req: Request) => Response | undefined | Promise<Response | undefined>;
export type Served = { port: number; stop: () => void };

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node's web stream type and the DOM one are the same object at runtime; only the typings disagree
const webStream = (r: Readable): ReadableStream => Readable.toWeb(r) as unknown as ReadableStream;

const toRequest = (raw: http.IncomingMessage, signal: AbortSignal): Request => {
  const headers = new Headers();
  for (let i = 0; i < raw.rawHeaders.length; i += 2)
    headers.append(raw.rawHeaders[i] ?? "", raw.rawHeaders[i + 1] ?? "");
  const init: RequestInit & { duplex?: "half" } = { method: raw.method ?? "GET", headers, signal };
  if (init.method !== "GET" && init.method !== "HEAD") {
    init.body = webStream(raw);
    init.duplex = "half"; // Node's fetch refuses a streamed body without it
  }
  return new Request(`http://${raw.headers.host ?? "localhost"}${raw.url}`, init);
};

const send = async (res: http.ServerResponse, out: Response, head: boolean): Promise<void> => {
  res.statusCode = out.status;
  for (const [k, v] of out.headers) if (k !== "set-cookie") res.setHeader(k, v);
  const cookies = out.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  if (!out.body || head) {
    res.end();
    return;
  }
  // Written as it arrives, so a streaming api.ts response reaches the page chunk by chunk.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same object at runtime as the DOM stream; only the typings disagree
  await pipeline(Readable.fromWeb(out.body as unknown as WebStream), res).catch(() => {
    /* the client went away mid-body */
  });
};

/** node:http behind a fetch handler. `port: 0` lets the OS pick; the bound one is on `.port`. A
 *  port in use rejects with EADDRINUSE. There is no idle timeout on a response (a streaming one may
 *  pause as long as it likes); keep-alive sockets idle up to 255s between requests. */
export async function serve(opts: {
  hostname?: string;
  port: number;
  fetch: Fetch;
}): Promise<Served> {
  const handle = async (
    raw: http.IncomingMessage,
    res: http.ServerResponse,
    socket?: Duplex,
  ): Promise<void> => {
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const req = toRequest(raw, abort.signal);
      if (socket) upgradeSockets.set(req, socket);
      const out = await opts.fetch(req);
      if (out) await send(res, out, raw.method === "HEAD");
      else if (!socket) res.end(); // the handler took no upgrade: nothing to say
    } catch (e) {
      console.error("request failed:", e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(e instanceof Error ? e.message : String(e));
    }
    if (socket && !socket.destroyed && res.headersSent) socket.end(); // an upgrade answered with a plain response
  };
  const served = await new Promise<Served>((resolve, reject) => {
    const server = http.createServer({ keepAliveTimeout: 255_000 }, (raw, res) => {
      handle(raw, res).catch(console.error);
    });
    // The upgrade event hands over the bare socket; give the handler an ordinary response on it
    // (for a refusal) — an accepted upgrade writes its own bytes to the socket instead.
    server.on("upgrade", (raw: http.IncomingMessage, socket: Duplex) => {
      const res = new http.ServerResponse(raw);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the upgrade event's socket is typed Duplex but is always a net.Socket
      res.assignSocket(socket as import("node:net").Socket);
      handle(raw, res, socket).catch(console.error);
    });
    server.once("error", reject);
    server.listen(opts.port, opts.hostname, () => {
      server.off("error", reject);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listening on a port, never a pipe: address() is an AddressInfo
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        stop: () => {
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
  return served;
}

const TEXT = "; charset=utf-8";
const MIME: Record<string, string> = {
  ".html": "text/html" + TEXT,
  ".css": "text/css" + TEXT,
  ".js": "text/javascript" + TEXT,
  ".mjs": "text/javascript" + TEXT,
  ".ts": "text/javascript" + TEXT,
  ".json": "application/json" + TEXT,
  ".map": "application/json" + TEXT,
  ".txt": "text/plain" + TEXT,
  ".md": "text/markdown" + TEXT,
  ".csv": "text/csv" + TEXT,
  ".xml": "application/xml" + TEXT,
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};

/** The content-type for a file name, by extension; unknown ones are opaque bytes. */
export const mimeOf = (file: string): string =>
  MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** A file as a response body, optionally just the bytes `start`..`end` (inclusive). */
export const fileBody = (file: string, range?: { start: number; end: number }): ReadableStream =>
  webStream(createReadStream(file, range));

// esbuild is loaded only when it is installed: a vendored runtime (viz-pages/.runtime) has no node_modules.
let esbuild: typeof import("esbuild") | null | undefined;
function loadEsbuild(): typeof import("esbuild") | null {
  if (esbuild === undefined) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- require() is untyped; this is esbuild's own module
      esbuild = createRequire(import.meta.url)("esbuild") as typeof import("esbuild");
    } catch {
      esbuild = null;
    }
  }
  return esbuild;
}

/** TypeScript → JavaScript for the browser, with an inline source map when `sourceUrl` names the
 *  file. esbuild, not Node's `stripTypeScriptTypes`: a viz is user code and may use an enum, and the
 *  transform mode that allowed one is gone in Node 26 (measured: "must be one of: 'strip'"). */
export function stripTs(src: string, sourceUrl?: string): string {
  const eb = loadEsbuild();
  if (eb)
    return eb.transformSync(src, {
      loader: "ts",
      ...(sourceUrl ? { sourcemap: "inline", sourcefile: sourceUrl } : {}),
    }).code;
  // shortcut: a vendored runtime strips with Node's built-in strip mode — no enums, no source map;
  // it only serves vizzes (verify, which needs the map, runs from the installed skill).
  return stripTypeScriptTypes(src);
}
