#!/usr/bin/env bun
// A pass-through in front of a throwaway build's own server, for the few requests a local copy
// can't answer the way production does (a cold-start ping, say): each <path> gets an empty 204, or
// with <path>=<json> that JSON; everything else, WebSockets included, goes to <upstream> untouched.
// The app and its server stay as they are. Usage: front.ts <port> <upstream origin> [path[=json]…]
import type { ServerWebSocket } from "bun";

const [port = "", upstream = "", ...rest] = process.argv.slice(2);
const stubs = new Map(rest.map((a) => [a.split("=")[0] ?? a, a.includes("=") ? a.slice(a.indexOf("=") + 1) : null]));
if (!port || !upstream) throw new Error("usage: front.ts <port> <upstream origin> [path[=json]…]");
type Link = { url: string; up?: WebSocket; queue: (string | Buffer)[] };

Bun.serve<Link>({
  port: Number(port),
  fetch: async (req, server) => {
    const u = new URL(req.url);
    if (stubs.has(u.pathname)) {
      const body = stubs.get(u.pathname);
      return body ? new Response(body, { headers: { "content-type": "application/json" } }) : new Response(null, { status: 204 });
    }
    const to = upstream + u.pathname + u.search;
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const ok = server.upgrade(req, { data: { url: to.replace(/^http/u, "ws"), queue: [] } });
      return ok ? undefined : new Response("upgrade failed", { status: 400 });
    }
    const headers = new Headers(req.headers);
    headers.delete("accept-encoding"); // fetch would hand back a decoded body under a gzip header
    const r = await fetch(to, { method: req.method, headers, body: req.body, redirect: "manual" });
    const out = new Headers(r.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  },
  websocket: {
    open(ws: ServerWebSocket<Link>) {
      const up = new WebSocket(ws.data.url);
      up.binaryType = "nodebuffer";
      ws.data.up = up;
      up.addEventListener("open", () => {
        for (const m of ws.data.queue.splice(0)) up.send(m);
      });
      up.addEventListener("message", (e: MessageEvent<string | Buffer>) => ws.send(e.data));
      up.addEventListener("close", () => ws.close());
      up.addEventListener("error", () => ws.close());
    },
    message(ws, m) {
      const up = ws.data.up;
      if (up?.readyState === WebSocket.OPEN) up.send(m);
      else ws.data.queue.push(m); // said before the upstream socket opened
    },
    close(ws) {
      ws.data.up?.close();
    },
  },
});
console.log(`:${port} → ${upstream} (stubbed: ${[...stubs.keys()].join(" ") || "none"})`);
