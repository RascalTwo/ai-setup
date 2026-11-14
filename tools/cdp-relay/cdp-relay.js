#!/usr/bin/env node
// cdp-relay: lets agent-browser drive the user's real, signed-in Chrome without stealing focus.
//
//   agent-browser --cdp ws://127.0.0.1:9333/devtools/browser/relay  ──▶  relay  ──one connection──▶  Chrome
//
// - Holds ONE upstream connection to Chrome (one "allow remote debugging" click per Chrome run) and shares it.
// - Target.createTarget: forces background: true, so new tabs and windows open behind the user's work.
// - Page.bringToFront, Target.activateTarget, Browser.close: answered here, never reach Chrome.
// - Tabs created through the relay get Emulation.setFocusEmulationEnabled when attached, so a hidden tab still
//   takes clicks (agent-browser issue #2146).
// - Reconnects by itself when Chrome starts or restarts (polls DevToolsActivePort every RETRY_MS).
// Binds 127.0.0.1 only. Env: RELAY_PORT (9333), CHROME_PORT_FILE, RETRY_MS (5000). Logs to stderr.
'use strict';
const fs = require('fs'), http = require('http'), net = require('net'), os = require('os'), path = require('path');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = +(process.env.RELAY_PORT || 9333);
const RETRY_MS = +(process.env.RETRY_MS || 5000);
const PORT_FILE = process.env.CHROME_PORT_FILE ||
  path.join(os.homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort');
const log = (...a) => console.error(new Date().toISOString(), ...a);

let up = null, upReady = null;        // upstream socket, and the in-flight connect promise
let nextId = 1_000_000;               // upstream ids are global so clients can't collide
const pending = new Map();            // upstream id -> { client, id, onResult } | { internal: true }
const sessionOwner = new Map();       // CDP sessionId -> client
const ours = new Set();               // targetIds created through the relay
const clients = new Set();
const stats = { createTarget: 0, swallowed: 0, focusEmu: 0, upstreamConnects: 0 };

function upstreamUrl() {
  try {
    const [port, p] = fs.readFileSync(PORT_FILE, 'utf8').trim().split('\n');
    return { port: +port, url: `ws://127.0.0.1:${port}${p}` };
  } catch {
    // Under launchd, TCC denies reading Chrome's Application Support (EPERM). Chrome also accepts the browser
    // endpoint without its per-launch id, so fall back to the port (chrome://inspect mode uses 9222 here).
    const port = +(process.env.CHROME_PORT || 9222);
    return { port, url: `ws://127.0.0.1:${port}/devtools/browser` };
  }
}

function listening(port) {
  return new Promise((res) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
  });
}

function connectUp() {
  if (up) return Promise.resolve(up);
  if (upReady) return upReady;
  upReady = new Promise((resolve, reject) => {
    const { url } = upstreamUrl();
    log('upstream connecting', url, '(Chrome may ask to allow remote debugging)');
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    ws.on('open', () => { up = ws; upReady = null; stats.upstreamConnects++; log('upstream connected'); resolve(ws); });
    ws.on('message', onUpMessage);
    ws.on('close', (code) => {
      log('upstream closed', code);
      up = null; upReady = null; pending.clear(); sessionOwner.clear(); ours.clear();
      for (const c of clients) c.close(1011, 'chrome connection closed');
    });
    ws.on('error', (e) => { log('upstream error', e.message); if (!up) { upReady = null; reject(e); } });
  });
  return upReady;
}

// Keep a connection to Chrome whenever Chrome is running, so the Allow prompt shows up when Chrome starts
// (the user is usually there), not in the middle of an unattended agent run.
let lastWhy = '';
async function keepUp() {
  if (up || upReady) return;
  let why;
  try {
    const { port } = upstreamUrl();
    if (await listening(port)) await connectUp();
    else why = `Chrome not listening on ${port}`;
  } catch (e) { why = e.message; }
  if (why && why !== lastWhy) log('waiting for Chrome:', why);   // log each new reason once, then retry quietly
  lastWhy = why || '';
}

function reply(client, id, result, sessionId) {
  const m = { id, result };
  if (sessionId) m.sessionId = sessionId;
  client.send(JSON.stringify(m));
}

function focusEmulate(sessionId) {
  const id = nextId++;
  pending.set(id, { internal: true });
  up.send(JSON.stringify({ id, method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true }, sessionId }));
  stats.focusEmu++;
}

function onUpMessage(data) {
  let m; try { m = JSON.parse(data); } catch { return; }
  if (m.id !== undefined) {                                   // a response
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (p.internal) return;
    if (p.onResult && m.result) p.onResult(m.result);
    m.id = p.id;
    if (p.client.readyState === WebSocket.OPEN) p.client.send(JSON.stringify(m));
    return;
  }
  if (m.method === 'Target.attachedToTarget' && m.params?.sessionId) {   // auto-attached child sessions
    const owner = m.sessionId && sessionOwner.get(m.sessionId);
    if (owner) sessionOwner.set(m.params.sessionId, owner);
    if (ours.has(m.params.targetInfo?.targetId)) focusEmulate(m.params.sessionId);
  }
  if (m.sessionId) {                                          // session events go to the session's owner only
    const owner = sessionOwner.get(m.sessionId);
    if (owner && owner.readyState === WebSocket.OPEN) owner.send(data.toString());
    return;
  }
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(data.toString());   // browser-level events
}

function onClientMessage(client, data) {
  let m; try { m = JSON.parse(data); } catch { return; }
  const { method, sessionId } = m;
  if (method === 'Page.bringToFront' || method === 'Target.activateTarget' || method === 'Browser.close') {
    stats.swallowed++; log('swallowed', method);
    return reply(client, m.id, {}, sessionId);
  }
  if (!up) return client.send(JSON.stringify({ id: m.id, error: { code: -32000, message: 'cdp-relay: not connected to Chrome' } }));
  const entry = { client, id: m.id };
  if (method === 'Target.createTarget') {
    m.params = { ...(m.params || {}), background: true };
    stats.createTarget++;
    entry.onResult = (r) => ours.add(r.targetId);
  }
  if (method === 'Target.attachToTarget') {
    const target = m.params?.targetId;
    entry.onResult = (r) => {
      if (!r.sessionId) return;
      sessionOwner.set(r.sessionId, client);
      if (ours.has(target)) focusEmulate(r.sessionId);
    };
  }
  if (sessionId && !sessionOwner.has(sessionId)) sessionOwner.set(sessionId, client);
  const upId = nextId++;
  pending.set(upId, entry);
  m.id = upId;
  up.send(JSON.stringify(m));
}

const server = http.createServer((req, res) => {
  const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (req.url.startsWith('/json/version'))   // minimal discovery, so `--cdp 9333` works too
    return json({ Browser: 'Chrome (via cdp-relay)', 'Protocol-Version': '1.3', webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/browser/relay` });
  if (req.url.startsWith('/stats')) return json({ ...stats, clients: clients.size, upstream: !!up });
  res.statusCode = 404; res.end();
});

const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
wss.on('connection', async (client) => {
  try { await connectUp(); } catch { client.close(1011, 'chrome not reachable'); return; }
  clients.add(client);
  log('client connected, clients =', clients.size);
  client.on('message', (d) => onClientMessage(client, d));
  client.on('close', () => {
    clients.delete(client);
    for (const [s, c] of sessionOwner) if (c === client) sessionOwner.delete(s);
    for (const [i, p] of pending) if (p.client === client) pending.delete(i);
    log('client disconnected, clients =', clients.size);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`cdp-relay listening on ws://127.0.0.1:${PORT}/devtools/browser/relay`);
  keepUp();
  setInterval(keepUp, RETRY_MS).unref();
});
