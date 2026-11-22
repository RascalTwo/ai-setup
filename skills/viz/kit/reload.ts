// The ONE live-reload channel. Both servers that inject a reload client use this:
// the dev server (server.ts) and the publish preview (viz preview). One implementation,
// so the two can't drift.
//
// WebSocket, not SSE. Chromium allows only 6 HTTP/1.1 connections per ORIGIN, and an
// EventSource holds one of them open for the entire life of the tab. Six viz tabs on
// 127.0.0.1:5180 therefore exhausted the pool and the seventh hung forever on its
// initial GET — closing a tab freed a socket and un-stuck it, which is what made the
// bug look intermittent. WebSockets live in a separate pool capped at 255 per host,
// which puts the ceiling out of practical reach.
//
// It lives in kit/ because vendorRuntime (viz create --runtime) copies kit/ wholesale into
// every repo's .runtime/, so vendored servers pick this up with no extra plumbing.

import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

// Client half. Unlike EventSource, a WebSocket NEVER reconnects on its own, so the
// retry loop is load-bearing rather than polish: without it every open tab goes
// permanently deaf the first time the server restarts — and a restart happens on
// every edit to the server itself.
// `status` is the viz's build state at injection time ("building"/"ready"/""). It rides
// the SAME websocket as reloads rather than getting a channel of its own. There is no
// visible badge: the only thing status drives is the backgrounded-tab attention signal
// on "ready". The preview server passes nothing, so it never fires there.
export function reloadSnippet(path: string, status = ""): string {
  const st = JSON.stringify(status);
  return (
    `<script>(function(){var p=${JSON.stringify(path)};` +
    // Attention signal. There is no standard "request attention" API for a tab (window.focus()
    // is blocked without a user gesture), so this is the title + favicon trick. It fires ONLY
    // while the tab is backgrounded and clears the instant it is looked at — shouting at
    // someone already watching is noise. No permission prompt, no dependency.
    // `ol` tracks a link element WE created: a page with no favicon has no href to restore,
    // and treating '' as "restore this" left the injected dot on the tab forever.
    `var ot=document.title,of=null,ol=null,on=0;` +
    `function a(v){if(on===v)return;on=v;` +
    `var l=document.querySelector("link[rel~='icon']");` +
    `if(v){document.title='● '+ot;` +
    `if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l);ol=l}` +
    `else if(of===null)of=l.getAttribute('href');` +
    `l.setAttribute('href','data:image/svg+xml,'+encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7' fill='#3fb950'/></svg>"))}` +
    `else{document.title=ot;` +
    `if(ol){ol.remove();ol=null}else if(l&&of!==null)l.setAttribute('href',of)}}` +
    `document.addEventListener('visibilitychange',function(){if(!document.hidden)a(0)});` +
    `function s(v){if(v==='ready'&&document.hidden)a(1)}` +
    `function c(){` +
    `var w=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+p);` +
    `w.onmessage=function(e){if(e.data==='reload')location.reload();` +
    `else if(e.data.indexOf('status:')===0)s(e.data.slice(7))};` +
    `w.onclose=function(){setTimeout(c,1000)}}` +
    `try{c()}catch(_){}` +
    `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){s(${st})});` +
    `else s(${st});` +
    `})();</script>`
  );
}

// Server half: a send-only WebSocket, hand-written on the raw upgrade socket so the server needs
// no `ws` package (a vendored .runtime/ has no node_modules) and the client above stays as it was.
// The wire is the 101 handshake, then unmasked server text frames; the only thing read back is
// the browser's close frame. Topics are viz ids (or "preview"); a message reaches every socket on one.
const topics = new Map<string, Set<Duplex>>();

/** The raw socket of each websocket-upgrade request, parked here by serve() in lib/server/serve.ts. */
export const upgradeSockets = new WeakMap<Request, Duplex>();

const frame = (text: string): Buffer => {
  const body = Buffer.from(text);
  const head =
    body.length < 126
      ? Buffer.from([0x81, body.length])
      : Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff]); // shortcut: no 64-bit lengths, messages are a few bytes
  return Buffer.concat([head, body]);
};

// `undefined` means the socket was taken over and the caller must return nothing; anything else
// is a real Response for a caller who wasn't a WS client at all.
export function upgradeReload(req: Request, topic: string): Response | undefined {
  const socket = upgradeSockets.get(req);
  const key = req.headers.get("sec-websocket-key");
  if (!socket || !key) return new Response("expected a websocket upgrade", { status: 426 });
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const open = topics.get(topic) ?? new Set<Duplex>();
  topics.set(topic, open.add(socket));
  socket.on("error", () => socket.destroy());
  socket.on("close", () => open.delete(socket));
  // Only a close frame (opcode 8) matters; echo it so the browser sees a clean close.
  socket.on("data", (d: Buffer) => {
    if (((d[0] ?? 0) & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0]));
  });
  return undefined;
}

// The wire protocol, both ends of it, in one place: the literal the client tests for.
const publish = (topic: string, text: string): void => {
  const out = frame(text);
  for (const s of topics.get(topic) ?? []) s.write(out);
};
export const publishReload = (topic: string): void => publish(topic, "reload");
export const publishStatus = (topic: string, status: string): void =>
  publish(topic, "status:" + status);
