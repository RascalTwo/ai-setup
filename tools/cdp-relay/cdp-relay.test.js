// node --test cdp-relay.test.js — runs the real relay against a fake Chrome (a ws server) and checks each rewrite.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { WebSocket, WebSocketServer } = require('ws');

const once = (ws, ev) => new Promise((r) => ws.once(ev, r));
const nextMsg = (ws) => once(ws, 'message').then((d) => JSON.parse(d));

test('relay rewrites, swallows, routes and emulates focus', async (t) => {
  const chrome = new WebSocketServer({ port: 0 });
  await once(chrome, 'listening');
  const portFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-relay-')), 'DevToolsActivePort');
  fs.writeFileSync(portFile, `${chrome.address().port}\n/devtools/browser/fake\n`);
  const upstreamSeen = [];
  let upSock;
  chrome.on('connection', (s) => { upSock = s; s.on('message', (d) => upstreamSeen.push(JSON.parse(d))); });

  const relayPort = 39000 + Math.floor(Math.random() * 1000);
  const relay = spawn(process.execPath, [path.join(__dirname, 'cdp-relay.js')],
    { env: { ...process.env, RELAY_PORT: relayPort, CHROME_PORT_FILE: portFile, RETRY_MS: '200' }, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { relay.kill(); chrome.close(); });
  await new Promise((r) => relay.stderr.on('data', (d) => /upstream connected/.test(d) && r()));

  const url = `ws://127.0.0.1:${relayPort}/devtools/browser/relay`;
  const a = new WebSocket(url), b = new WebSocket(url);
  await Promise.all([once(a, 'open'), once(b, 'open')]);
  const waitUp = async (pred) => { for (let i = 0; i < 100; i++) { const m = upstreamSeen.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 10)); } assert.fail('upstream never saw it'); };

  // createTarget gets background: true, and the response id is mapped back
  a.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } }));
  const ct = await waitUp((m) => m.method === 'Target.createTarget');
  assert.equal(ct.params.background, true);
  assert.notEqual(ct.id, 1);
  upSock.send(JSON.stringify({ id: ct.id, result: { targetId: 'T1' } }));
  assert.deepEqual(await nextMsg(a), { id: 1, result: { targetId: 'T1' } });

  // attaching to a tab the relay created turns on focus emulation for that session
  a.send(JSON.stringify({ id: 2, method: 'Target.attachToTarget', params: { targetId: 'T1', flatten: true } }));
  const at = await waitUp((m) => m.method === 'Target.attachToTarget');
  upSock.send(JSON.stringify({ id: at.id, result: { sessionId: 'S1' } }));
  assert.deepEqual(await nextMsg(a), { id: 2, result: { sessionId: 'S1' } });
  const fe = await waitUp((m) => m.method === 'Emulation.setFocusEmulationEnabled');
  assert.equal(fe.sessionId, 'S1');
  assert.equal(fe.params.enabled, true);

  // foreground and quit calls are answered locally and never reach Chrome
  for (const [id, method] of [[3, 'Page.bringToFront'], [4, 'Target.activateTarget'], [5, 'Browser.close']]) {
    a.send(JSON.stringify({ id, method, sessionId: 'S1' }));
    assert.deepEqual(await nextMsg(a), { id, result: {}, sessionId: 'S1' });
  }
  assert.ok(!upstreamSeen.some((m) => /bringToFront|activateTarget|Browser\.close/.test(m.method)));

  // session events go only to the session's owner; browser-level events go to everyone
  const bGot = [];
  b.on('message', (d) => bGot.push(JSON.parse(d)));
  upSock.send(JSON.stringify({ method: 'Page.loadEventFired', params: {}, sessionId: 'S1' }));
  assert.equal((await nextMsg(a)).method, 'Page.loadEventFired');
  upSock.send(JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'T2' } } }));
  assert.equal((await nextMsg(a)).method, 'Target.targetCreated');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(bGot.map((m) => m.method), ['Target.targetCreated']);
  a.close(); b.close();
});
