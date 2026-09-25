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
// `status` is the viz's build state at injection time ("building"/"ready"/""). It rides
// the SAME websocket as reloads rather than getting a channel of its own: a reload wipes
// the page, so the badge has to be re-seeded from the server on every load anyway, and
// the client already ignores any frame that isn't the literal "reload". The preview
// server passes nothing and therefore renders no badge — a preview is deployable bytes,
// not a work-in-progress.
export function reloadSnippet(path: string, status = ""): string {
  const st = JSON.stringify(status);
  return (
    `<script>(function(){var p=${JSON.stringify(path)};` +
    `var b=document.createElement('div');b.id='viz-status';b.setAttribute('role','status');` +
    `b.style.cssText='position:fixed;left:12px;bottom:12px;z-index:2147483646;` +
    `font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px 10px;` +
    `border-radius:999px;background:#1c2333;border:1px solid #30363d;` +
    `box-shadow:0 2px 8px rgba(0,0,0,.4);opacity:0;transition:opacity .3s;pointer-events:none';` +
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
    `var t;function s(v){if(!v)return;if(!b.isConnected&&document.body)document.body.appendChild(b);` +
    `var done=v==='ready';b.textContent=(done?'● ':'◐ ')+v;` +
    `b.style.color=done?'#3fb950':'#d29922';b.style.opacity='1';clearTimeout(t);` +
    `if(done)t=setTimeout(function(){b.style.opacity='0'},4000);` +
    `if(done&&document.hidden)a(1)}` +
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
export const publishStatus = (server: Server, topic: string, status: string) =>
  server.publish(topic, "status:" + status);
