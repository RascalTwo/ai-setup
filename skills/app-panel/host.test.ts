// host.ts end to end, minus the browser: this test is Claude Code on one side (an MCP client over
// stdio) and the view on the other (speaking JSON-RPC over the panel page's WebSocket).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { cspHeader } from "./lib.ts";

const dir = mkdtempSync(path.join(tmpdir(), "app-panel-host-"));
const opened = path.join(dir, "opened.txt");
const typed = path.join(dir, "typed.txt");
const sessions = path.join(dir, "sessions");
let claude: Client;

beforeAll(async () => {
  // The panel helper, faked: it only records the URL it was asked to show.
  const helper = path.join(dir, "panel");
  writeFileSync(helper, `#!/bin/sh\necho "$1" > ${opened}\n`);
  chmodSync(helper, 0o755);
  // herdr, faked: it records what would have been typed into the session's pane.
  const herdr = path.join(dir, "herdr");
  writeFileSync(herdr, `#!/bin/sh\nprintf '%s|%s|%s|%s' "$1" "$2" "$3" "$4" > ${typed}\n`);
  chmodSync(herdr, 0o755);
  writeFileSync(path.join(dir, "servers.json"), JSON.stringify({ mcpServers: { fx: { command: "bun", args: [path.join(import.meta.dir, "test/fixture-server.ts")] } } }));
  claude = new Client({ name: "claude-code", version: "0" });
  await claude.connect(new StdioClientTransport({
    command: "bun",
    args: [path.join(import.meta.dir, "host.ts")],
    env: { ...(process.env as Record<string, string>), APP_PANEL_SERVERS: path.join(dir, "servers.json"), APP_PANEL_HELPER: helper, APP_PANEL_HERDR: herdr, HERDR_PANE_ID: "p1", APP_PANEL_SESSIONS: sessions },
  }));
});
afterAll(() => (host?.ws.close(), claude.close()));

test("proxies the downstream tools, named <server>__<tool>, keeping their ui metadata", async () => {
  const { tools } = await claude.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["fx__hello", "fx__plain", "progress", "show"]);
  expect(tools.find((t) => t.name === "fx__hello")?._meta).toEqual({ ui: { resourceUri: "ui://fixture/view.html" } });
});

test("a tool without a view returns its result and opens nothing", async () => {
  const r = await claude.callTool({ name: "fx__plain", arguments: { a: 1 } });
  expect(r.content).toEqual([{ type: "text", text: 'plain:{"a":1}' }]);
  expect(existsSync(opened)).toBe(false);
});

test("an unknown tool is an error result, not a crash", async () => {
  const r = await claude.callTool({ name: "nope__x", arguments: {} });
  expect(r.isError).toBe(true);
});

// The panel page's socket (history) and a view's socket, each from the page's own origin.
const socket = (url: string, origin: string) => {
  const ws = new WebSocket(url, { headers: { origin } } as never);
  const inbox: Record<string, any>[] = [];
  ws.onmessage = (m) => inbox.push(JSON.parse(String(m.data)));
  const next = async (pred: (m: Record<string, any>) => boolean): Promise<Record<string, any>> => {
    for (let i = 0; i < 100; i++) {
      const at = inbox.findIndex(pred);
      if (at >= 0) return inbox.splice(at, 1)[0]!;
      await Bun.sleep(20);
    }
    throw new Error(`timed out; inbox: ${JSON.stringify(inbox)}`);
  };
  const send = (m: object): void => ws.send(JSON.stringify({ jsonrpc: "2.0", ...m }));
  return { ws, next, send, opened: new Promise((r) => (ws.onopen = r)) };
};
const refused = (url: string, origin: string) =>
  new Promise((r) => {
    const ws = new WebSocket(url, { headers: { origin } } as never);
    ws.onopen = () => r("open");
    ws.onerror = () => r("refused");
  });
let pageUrl: URL;
let host: ReturnType<typeof socket>;

test("a tool with a view: result to Claude, view in the one panel, bridged to its server, messages typed into the pane", async () => {
  const r = await claude.callTool({ name: "fx__hello", arguments: { who: "you" } });
  expect(r.content).toEqual([{ type: "text", text: 'hello:{"who":"you"}' }]);
  for (let i = 0; i < 50 && !existsSync(opened); i++) await Bun.sleep(20);
  pageUrl = new URL(readFileSync(opened, "utf8").trim());
  expect(await (await fetch(pageUrl)).text()).toContain("<select");
  expect((await fetch(new URL("/", pageUrl))).status).toBe(404); // no key, no page

  // The page's socket gets the history; any other origin, or a missing key, is refused.
  expect(await refused(`ws://${pageUrl.host}/ws${pageUrl.search}`, "https://evil.example")).toBe("refused");
  expect(await refused(`ws://${pageUrl.host}/ws`, pageUrl.origin)).toBe("refused");
  host = socket(`ws://${pageUrl.host}/ws${pageUrl.search}`, pageUrl.origin);
  await host.opened;
  const h = await host.next((m) => m.panel === "history");
  expect(h.items.map((i: { title: string }) => i.title)).toEqual(["fx · hello"]);
  expect(h.current).toBe(h.items[0].id);
  const csp = (await fetch(h.items[0].sandbox)).headers.get("content-security-policy");
  expect(new URL(h.items[0].sandbox).origin).not.toBe(pageUrl.origin);
  expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://cdn.example");

  // Be the view.
  const viewUrl = `ws://${pageUrl.host}/ws?view=${h.current}`;
  expect(await refused(viewUrl, "https://evil.example")).toBe("refused");
  const v = socket(viewUrl, pageUrl.origin);
  await v.opened;
  expect((await v.next((m) => m.method === "ui/notifications/sandbox-resource-ready")).params.html).toBe("<p>fixture view</p>");
  v.send({ id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "v", version: "0" }, appCapabilities: {} } });
  expect((await v.next((m) => m.id === 1)).result.hostInfo.name).toBe("app-panel");
  v.send({ method: "ui/notifications/initialized", params: {} });
  expect((await v.next((m) => m.method === "ui/notifications/tool-input")).params.arguments).toEqual({ who: "you" });
  expect((await v.next((m) => m.method === "ui/notifications/tool-result")).params.content[0].text).toBe('hello:{"who":"you"}');

  // The view calls its own server's tool through the bridge.
  v.send({ id: 2, method: "tools/call", params: { name: "plain", arguments: { from: "view" } } });
  expect((await v.next((m) => m.id === 2)).result.content[0].text).toBe('plain:{"from":"view"}');

  // Background state starts nothing, then rides along with the next message, typed into this session's pane.
  v.send({ id: 3, method: "ui/update-model-context", params: { content: [{ type: "text", text: "zoom 2" }] } });
  await v.next((m) => m.id === 3);
  expect(existsSync(typed)).toBe(false);
  v.send({ id: 4, method: "ui/message", params: { role: "user", content: [{ type: "text", text: "make it bigger" }] } });
  expect((await v.next((m) => m.id === 4)).result).toEqual({});
  for (let i = 0; i < 50 && !existsSync(typed); i++) await Bun.sleep(20);
  expect(readFileSync(typed, "utf8")).toBe("agent|prompt|p1|[app-panel · fx · hello] make it bigger\n(the view's state: zoom 2)");

  // The view's own size reaches the page; asking to close folds the panel.
  v.send({ method: "ui/notifications/size-changed", params: { width: 340, height: 300 } });
  expect(await v.next((m) => m.panel === "size")).toEqual({ panel: "size", width: 340, height: 300 });
  v.send({ method: "ui/notifications/request-teardown", params: {} });
  expect(await v.next((m) => m.panel === "close")).toEqual({ panel: "close" });
  v.ws.close();
});

test("show puts HTML in the same panel as the newest view, keeps the older one in the list, and gives the page panel.send", async () => {
  const r = await claude.callTool({ name: "show", arguments: { html: "<!doctype html><html><head><title>Deploys</title></head><body>hi</body></html>", width: 9999 } });
  expect(r.content).toEqual([{ type: "text", text: 'Showing "Deploys" in the panel.' }]);
  const h = await host.next((m) => m.panel === "history");
  expect(h.items.map((i: { title: string }) => i.title)).toEqual(["fx · hello", "Deploys"]);
  expect(h.current).toBe(h.items[1].id);
  expect(h.items[1].width).toBe(760); // clamped
  expect((await fetch(h.items[1].sandbox)).headers.get("content-security-policy")).toContain("connect-src 'self' https: http: wss: ws:");

  const v = socket(`ws://${pageUrl.host}/ws?view=${h.current}`, pageUrl.origin);
  await v.opened;
  const html = (await v.next((m) => m.method === "ui/notifications/sandbox-resource-ready")).params.html as string;
  expect(html.startsWith(`<!doctype html><html><head><meta name="color-scheme" content="light dark"><style>:where(html){background:Canvas;color:CanvasText`)).toBe(true);
  expect(html).toContain("window.panel = { send:");
  v.ws.close();

  // The older view is still there to open again from the list.
  const again = socket(`ws://${pageUrl.host}/ws?view=${h.items[0].id}`, pageUrl.origin);
  await again.opened;
  expect((await again.next((m) => m.method === "ui/notifications/sandbox-resource-ready")).params.html).toBe("<p>fixture view</p>");
  again.ws.close();
});

test("progress: one view per task, updated in place; the command wraps a command and finishes it by exit code", async () => {
  const be = async (id: string) => {
    const v = socket(`ws://${pageUrl.host}/ws?view=${id}`, pageUrl.origin);
    await v.opened;
    await v.next((m) => m.method === "ui/notifications/sandbox-resource-ready");
    v.send({ id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "v", version: "0" }, appCapabilities: {} } });
    await v.next((m) => m.id === 1);
    v.send({ method: "ui/notifications/initialized", params: {} });
    return v;
  };
  const input = (v: Awaited<ReturnType<typeof be>>) => v.next((m) => m.method === "ui/notifications/tool-input").then((m) => m.params.arguments);

  await claude.callTool({ name: "progress", arguments: { title: "Build", stages: ["fetch", "compile"], stage: "fetch", eta: 60 } });
  const h = await host.next((m) => m.panel === "history");
  expect(h.items.at(-1).title).toBe("Build");
  const v = await be(h.current);
  const first = await input(v);
  expect(first).toMatchObject({ title: "Build", stage: "fetch", status: "running" });
  expect(first.due - first.started).toBe(60000);

  // The next stage updates the open view, keeps what it knew, and adds no list entry.
  await claude.callTool({ name: "progress", arguments: { title: "Build", stage: "compile" } });
  expect(await input(v)).toMatchObject({ stage: "compile", stages: ["fetch", "compile"], started: first.started });
  await claude.callTool({ name: "progress", arguments: { title: "Build", status: "done" } });
  expect((await input(v)).status).toBe("done");
  expect(host.ws.readyState).toBe(WebSocket.OPEN);
  v.ws.close();

  // Stages with estimates: names and estimates kept apart, and a stage that starts takes its planned eta.
  await claude.callTool({ name: "progress", arguments: { title: "Plan", stages: [{ name: "a", eta: 5 }, "b"], stage: "a" } });
  const plan = await be((await host.next((m) => m.panel === "history")).current);
  const p0 = await input(plan);
  expect(p0).toMatchObject({ stages: ["a", "b"], estimates: [5, null] });
  expect(p0.due - p0.stageStarted).toBe(5000);
  plan.ws.close();

  // The command, through this session's file: a failing command is a new view, ending red with its stderr.
  const file = JSON.parse(readFileSync(path.join(sessions, "p1.json"), "utf8")).url as string;
  expect((await fetch(file, { method: "POST", body: "{}", headers: { origin: "https://evil.example" } })).status).toBe(404);
  expect((await fetch(file.replace(/key=\w+/, "key=nope"), { method: "POST", body: "{}" })).status).toBe(404);
  const run = Bun.spawn(["bun", path.join(import.meta.dir, "progress.ts"), "--title", "Build", "--eta", "2m", "--", "sh", "-c", "echo boom >&2; exit 3"], {
    env: { ...(process.env as Record<string, string>), HERDR_PANE_ID: "p1", APP_PANEL_SESSIONS: sessions }, stderr: "pipe",
  });
  expect(await run.exited).toBe(3);
  expect(await new Response(run.stderr).text()).toContain("boom");
  const h2 = await host.next((m) => m.panel === "history");
  expect(h2.items.filter((i: { title: string }) => i.title === "Build")).toHaveLength(2);
  const v2 = await be(h2.current);
  expect(await input(v2)).toMatchObject({ status: "failed", note: "exit 3\nboom", eta: 120 });
  v2.ws.close();
});

test("show refuses anything but exactly one of html or an http(s) url", async () => {
  for (const args of [{}, { html: "x", url: "https://a.example" }, { url: "file:///etc/passwd" }])
    expect((await claude.callTool({ name: "show", arguments: args })).isError).toBe(true);
});

test("cspHeader drops sources that could inject directives", () => {
  const h = cspHeader({ resourceDomains: ["https://ok.example", "evil; script-src *", "'unsafe-hashes'"] });
  expect(h).toContain("https://ok.example");
  expect(h).not.toContain("evil");
  expect(h).not.toContain("unsafe-hashes");
  expect(cspHeader()).toContain("frame-src 'none'");
});
