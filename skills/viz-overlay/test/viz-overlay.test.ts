// The real binary on a real screen: show, the page contract, a click on a hit region, list, stop,
// owner exit, and the exit codes. macOS with Accessibility for the terminal; `bun test` in this skill.
// The overlay draws over your screen for a few seconds while it runs.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain JS module, shipped for pages to copy
import { fromSnapshot } from "../page/standalone.js";

const dir = join(import.meta.dir, "..");
const bin = join(dir, "helper", "viz-overlay");
const page = `file://${join(import.meta.dir, "page.html")}`;
const tmp = process.env["TMPDIR"] ?? "/tmp";
const click = join(tmp, "vo-click");
// No pane, so messages stay in the log; a throwaway owner so the overlay's lifetime is ours to end.
const env = (owner: number) => ({ ...process.env, HERDR_PANE_ID: "", VIZ_OVERLAY_OWNER_PID: String(owner), VIZ_OVERLAY_SESSION: "e2e-test" });

const run = (args: string[], e: Record<string, string | undefined> = process.env) => {
  const p = Bun.spawnSync([bin, ...args], { env: e, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

type Line = { event: string; text?: string; by?: string; reason?: string };
const lines = (log: string): Line[] => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line);
const sent = (log: string) => lines(log).filter((l) => l.event === "send").map((l) => JSON.parse(l.text ?? "{}") as Record<string, unknown>);

async function until<T>(what: string, f: () => T | undefined, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

const owners: Bun.Subprocess[] = [];
const owner = () => { const p = Bun.spawn(["sleep", "120"]); owners.push(p); return p; };

beforeAll(() => {
  expect(Bun.spawnSync([join(dir, "helper", "build")]).exitCode).toBe(0);
  if (!existsSync(click))
    expect(Bun.spawnSync(["swiftc", "-O", join(import.meta.dir, "click.swift"), "-o", click], { env: { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" } }).exitCode).toBe(0);
}, 180_000); // swiftc -O takes a while
afterAll(() => { owners.forEach((p) => p.kill()); run(["stop", "--session"], { ...process.env, VIZ_OVERLAY_SESSION: "e2e-test" }); });

test("logic", () => {
  const p = Bun.spawnSync([join(dir, "helper", "test")], { stdout: "pipe", stderr: "pipe" });
  expect(p.stdout.toString() + p.stderr.toString()).toContain("logic: all passed");
}, 120_000);

test("bad input exits 2, an unknown target app exits 3", () => {
  expect(run(["show", page, "--when", "sometimes"]).code).toBe(2);
  expect(run(["show", page, "--element", "Save"]).code).toBe(2);
  expect(run(["show", "not-a-viz-anywhere"]).code).toBe(2);
  const r = run(["show", page, "--target", "no-such-app-xyz", "--no-raise"]);
  expect(r.code).toBe(3);
  expect(r.err).toContain("no running app matches");
});

test("show: page contract, a hit-region click, list, and the owner's exit ends it", async () => {
  const o = owner();
  const snap = join(tmp, `vo-snap-${Date.now()}.json`);
  const r = run(["show", `${page}?track=Finder`, "--when", "always", "--title", "e2e", "--save-snapshot", snap, "--json"], env(o.pid));
  expect(r.code).toBe(0);
  const rec = JSON.parse(r.out) as { id: number; log: string; title: string };
  expect(rec.title).toBe("e2e");

  const init = await until("init", () => sent(rec.log).find((m) => m["what"] === "init"));
  expect(init).toMatchObject({ title: "e2e", origin: { x: 0, y: 0 }, overlayAttr: true });
  await until("shown", () => sent(rec.log).find((m) => m["what"] === "visibility" && m["visible"] === true));
  expect(await until("loaded", () => sent(rec.log).find((m) => m["what"] === "loaded"))).toMatchObject({ closeButton: true });
  expect(lines(rec.log).some((l) => l.event === "key")).toBe(false); // the autofocused field must not take the keyboard from your app
  const missing = await until("missing app state", () => sent(rec.log).find((m) => m["what"] === "track-missing"));
  expect(missing["state"]).toMatchObject({ gone: true, shown: false, error: "no running app matches 'no-such-app-xyz'" });
  const finder = await until("Finder state", () => sent(rec.log).find((m) => m["what"] === "track"));
  expect((finder["state"] as { gone: boolean }).gone).toBe(false);
  const els = await until("elements", () => sent(rec.log).find((m) => m["what"] === "elements"), 15_000);
  expect(els["count"]).toBeGreaterThan(0);

  // The snapshot replays through standalone.js the way the live host answered.
  const saved = await until("snapshot with elements", () => { const j = existsSync(snap) && JSON.parse(readFileSync(snap, "utf8")); return j?.elements?.length ? j : undefined; });
  const stand = fromSnapshot(saved);
  expect(await new Promise((ok) => stand.track({ app: "Finder" }, ok))).toMatchObject({ gone: false });
  expect(await new Promise((ok) => stand.track({ app: "elsewhere" }, ok))).toMatchObject({ gone: true });
  expect((await stand.elements("Finder", { role: "AXMenuBarItem" })).length).toBe(els["count"]);

  const front = () => Bun.spawnSync(["lsappinfo", "info", "-only", "name", Bun.spawnSync(["lsappinfo", "front"]).stdout.toString().trim()]).stdout.toString();
  const before = front();
  expect(Bun.spawnSync([click, "90", "137"]).exitCode).toBe(0); // the test page's hit button
  await until("click", () => sent(rec.log).find((m) => m["what"] === "clicked"));
  expect(front()).toBe(before); // the click didn't activate the overlay

  expect(JSON.parse(run(["list", "--json"]).out).map((x: { id: number }) => x.id)).toContain(rec.id);
  o.kill();
  await until("owner exit", () => lines(rec.log).find((l) => l.event === "closed" && l.by === "owner exited"));
  await until("registry cleared", () => !JSON.parse(run(["list", "--json"]).out).some((x: { id: number }) => x.id === rec.id) || undefined);
}, 40_000);

test("a click into a cross-origin iframe takes the keyboard, and the app in front stays in front", async () => {
  // Another origin, like app-panel's sandboxed views: focus inside it never reaches the page.
  const inner = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(`<!doctype html><input id="i" style="font:16px system-ui;width:240px" oninput="parent.postMessage(i.value, '*')">`, { headers: { "content-type": "text/html" } }) });
  try {
    const o = owner();
    const frame = `file://${join(import.meta.dir, "frame.html")}?inner=${encodeURIComponent(inner.url.href)}`;
    const rec = JSON.parse(run(["show", frame, "--when", "always", "--json"], env(o.pid)).out) as { id: number; log: string };
    await until("ready", () => lines(rec.log).find((l) => l.event === "ready"));
    await Bun.sleep(500); // the frame loads and its rect reaches the host
    const front = Bun.spawnSync(["lsappinfo", "front"]).stdout.toString();
    expect(Bun.spawnSync([click, "120", "140", "hi"]).exitCode).toBe(0);
    expect(await until("typed in the frame", () => sent(rec.log).find((m) => m["what"] === "inner" && m["value"] === "hi"))).toBeTruthy();
    expect(Bun.spawnSync(["lsappinfo", "front"]).stdout.toString()).toBe(front);
    o.kill();
  } finally {
    inner.stop(true);
  }
}, 20_000);

test("stop ends an overlay by id", async () => {
  const o = owner();
  const rec = JSON.parse(run(["show", page, "--when", "always", "--json"], env(o.pid)).out) as { id: number; log: string };
  expect(run(["stop", String(rec.id)]).out).toContain(`stopped ${rec.id}`);
  expect(lines(rec.log).at(-1)).toMatchObject({ event: "closed", by: "stopped" });
  expect(run(["stop", String(rec.id)]).code).toBe(3);
}, 20_000);

test("update: JSON values reach the page, from an argument or stdin; --no-close drops the ✕", async () => {
  const o = owner();
  const rec = JSON.parse(run(["show", page, "--when", "always", "--no-close", "--json"], env(o.pid)).out) as { id: number; log: string };
  expect(await until("loaded", () => sent(rec.log).find((m) => m["what"] === "loaded"))).toMatchObject({ closeButton: false });
  expect(run(["update", String(rec.id), '{"step":1}']).code).toBe(0);
  expect(await until("data", () => sent(rec.log).find((m) => m["what"] === "data"))).toMatchObject({ value: { step: 1 } });
  expect(Bun.spawnSync([bin, "update", String(rec.id), "-"], { stdin: Buffer.from('"two"') }).exitCode).toBe(0);
  await until("data from stdin", () => sent(rec.log).find((m) => m["what"] === "data" && m["value"] === "two"));
  expect(run(["update", String(rec.id), "{nope"]).code).toBe(2);
  expect(run(["update", "999999", "1"]).code).toBe(3);
  o.kill();
}, 20_000);

test("standalone.js matches a spec whatever its key order", async () => {
  const state = { rect: { x: 1, y: 2, width: 3, height: 4 }, gone: false, shown: true, covered: false };
  const o = fromSnapshot({ title: "t", tracks: [{ spec: { app: "Finder", element: { role: "button", label: "back" } }, state }] });
  expect(await new Promise((ok) => o.track({ element: { label: "back", role: "button" }, app: "Finder" }, ok))).toEqual(state);
  expect(o.standalone).toBe(true);
  expect(await new Promise((ok) => fromSnapshot({ data: { step: 2 } }).on("data", ok))).toEqual({ step: 2 });
});
