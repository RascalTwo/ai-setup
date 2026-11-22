#!/usr/bin/env node
// A pass-through in front of a throwaway build's own server, for the few requests a local copy
// can't answer the way production does (a cold-start ping, say): each <path> gets an empty 204, or
// with <path>=<json> that JSON; everything else, WebSockets included, goes to <upstream> untouched.
// The app and its server stay as they are. Usage: front.ts <port> <upstream origin> [path[=json]…]
import http from "node:http";
import net from "node:net";

const [port = "", upstream = "", ...rest] = process.argv.slice(2);
const stubs = new Map(rest.map((a) => [a.split("=")[0] ?? a, a.includes("=") ? a.slice(a.indexOf("=") + 1) : null]));
if (!port || !upstream) throw new Error("usage: front.ts <port> <upstream origin> [path[=json]…]");
const up = new URL(upstream);

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://front");
  if (stubs.has(u.pathname)) {
    const body = stubs.get(u.pathname);
    if (body) res.writeHead(200, { "content-type": "application/json" }).end(body);
    else res.writeHead(204).end();
    return;
  }
  const headers = { ...req.headers, host: up.host };
  delete headers["accept-encoding"]; // the upstream's body is passed on as it is, so ask for it plain
  const out = http.request(
    { host: up.hostname, port: up.port, method: req.method, path: u.pathname + u.search, headers },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.statusMessage, r.headers);
      r.pipe(res);
    },
  );
  out.on("error", () => res.writeHead(502).end("upstream unreachable"));
  req.pipe(out);
});

// A WebSocket upgrade is not parsed here: the handshake and every frame after it are the same bytes
// in both directions, so the connection is piped to the upstream as it came.
server.on("upgrade", (req, socket, head) => {
  const to = net.connect(Number(up.port), up.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i] === "Host" ? up.host : req.rawHeaders[i + 1]}`);
    to.write(`${lines.join("\r\n")}\r\n\r\n`);
    to.write(head);
    socket.pipe(to).pipe(socket);
  });
  to.on("error", () => socket.destroy());
  socket.on("error", () => to.destroy());
});

server.listen(Number(port), () => {
  console.log(`:${port} → ${upstream} (stubbed: ${[...stubs.keys()].join(" ") || "none"})`);
});
