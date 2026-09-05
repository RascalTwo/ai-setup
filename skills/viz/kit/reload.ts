// The ONE live-reload channel. Both servers that inject a reload client use this:
// the dev server (server.ts) and the publish preview (build.ts). One implementation,
// so the two can't drift.
//
// WebSocket, not SSE. Chromium allows only 6 HTTP/1.1 connections per ORIGIN, and an
// EventSource holds one of them open for the entire life of the tab. Six viz tabs on
// 127.0.0.1:5180 therefore exhausted the pool and the seventh hung forever on its
// initial GET — closing a tab freed a socket and un-stuck it, which is what made the
// bug look intermittent. WebSockets live in a separate pool capped at 255 per host,
// which puts the ceiling out of practical reach.
//
// It lives in kit/ because vendorRuntime (bootstrap.ts) copies kit/ wholesale into
// every repo's .runtime/, so vendored servers pick this up with no extra plumbing.

import type { Server, WebSocketHandler } from "bun";

export type ReloadData = { topic: string };

// Client half. Unlike EventSource, a WebSocket NEVER reconnects on its own, so the
// retry loop is load-bearing rather than polish: without it every open tab goes
// permanently deaf the first time the server restarts — and a restart happens on
// every edit to the server itself.
export function reloadSnippet(path: string): string {
  return (
    `<script>(function(){var p=${JSON.stringify(path)};function c(){` +
    `var w=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+p);` +
    `w.onmessage=function(e){if(e.data==='reload')location.reload()};` +
    `w.onclose=function(){setTimeout(c,1000)}}` +
    `try{c()}catch(_){}})();</script>`
  );
}

// Server half. `undefined` means Bun took the socket over and the caller must return
// nothing; anything else is a real Response for a caller who wasn't a WS client at all.
export function upgradeReload(server: Server, req: Request, topic: string): Response | undefined {
  if (server.upgrade<ReloadData>(req, { data: { topic } })) return undefined;
  return new Response("expected a websocket upgrade", { status: 426 });
}

export const reloadWebSocket: WebSocketHandler<ReloadData> = {
  // This channel is idle BY DESIGN — it carries nothing at all until you save a file.
  // Bun's 120s default would therefore close every connection on a quiet page and,
  // with the retry loop above, leave every open tab reconnecting on a loop forever.
  idleTimeout: 960,
  open(ws) {
    ws.subscribe(ws.data.topic);
  },
};

// The wire protocol, both ends of it, in one place: the literal the client tests for.
export const publishReload = (server: Server, topic: string) => server.publish(topic, "reload");
