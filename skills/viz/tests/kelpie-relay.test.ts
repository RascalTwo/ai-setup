// The kit's one Kelpie relay (kit/server/kelpie-relay.ts) and the panel's `_relay` route (lib/server/relay.ts),
// against a stand-in Kelpie that records every call: Send must run `kelpie page` exactly once, or never.
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { relay, SAVED } from "../kit/server/kelpie-relay.ts";
import { handleRelay } from "../lib/server/relay.ts";

const post = (body: unknown = {}, ua = "Mozilla/5.0") =>
  new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua },
    body: JSON.stringify(body),
  });

/** A Kelpie state folder with one run, and a stand-in `kelpie` that answers the way FAKE_KELPIE says. */
function sandbox(mode: "told" | "nopane" | "fail" = "told") {
  const state = realpathSync(mkdtempSync(path.join(tmpdir(), "kelpie-relay-"))); // macOS: /var is /private/var
  const folder = path.join(state, "runs", "proj", "task");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, ".task.json"), '{"project":"proj","id":"task"}');
  const calls = path.join(state, "calls.jsonl");
  const cli = path.join(state, "kelpie.ts");
  writeFileSync(
    cli,
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (${JSON.stringify(mode)} === "fail") { console.error("Timeline Studio /api/commands: 404 no such task"); process.exitCode = 1; } else
console.log(${JSON.stringify(mode)} === "nopane" ? "The agent has no live pane; the next tick picks the comment up." : "Told the agent.");`,
  );
  const env = { KELPIE_STATE: state, KELPIE_CLI: cli };
  const called = (): { argv: string[]; cwd: string }[] =>
    existsSync(calls)
      ? readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the stand-in writes these lines
          .map((l) => JSON.parse(l) as { argv: string[]; cwd: string })
      : [];
  return { state, folder, env, called };
}

describe("the kit's Kelpie relay", () => {
  test("Given a live run, when Send relays, then kelpie page runs once from the run folder and it says delivered", () => {
    const s = sandbox();
    expect(relay(post(), "Changes. S3: the button's too small", s.folder, s.env)).toEqual({
      outcome: "delivered",
      ok: true,
      message: "Told the agent.",
    });
    expect(s.called()).toEqual([
      { argv: ["page", "Changes. S3: the button's too small"], cwd: s.folder },
    ]);
  });

  test("Given the agent's pane is closed, when Send relays, then it says saved in the words every page uses", () => {
    const s = sandbox("nopane");
    expect(relay(post(), "x", s.folder, s.env)).toEqual({
      outcome: "saved",
      ok: true,
      message: SAVED,
    });
    expect(SAVED).toBe("Saved on the task; the agent gets it when it next runs.");
  });

  test("Given kelpie page fails, when Send relays, then it says failed with Kelpie's reason", () => {
    const s = sandbox("fail");
    expect(relay(post(), "x", s.folder, s.env)).toEqual({
      outcome: "failed",
      ok: false,
      message: "kelpie page failed: Timeline Studio /api/commands: 404 no such task",
    });
  });

  test("Given a folder outside Kelpie's runs, or one without .task.json, when Send relays, then it says no run and never runs kelpie", () => {
    const s = sandbox();
    const bare = path.join(s.state, "runs", "proj", "bare");
    mkdirSync(bare);
    for (const folder of [s.state, bare, undefined]) {
      const r = relay(post(), "x", folder, s.env);
      expect(r.outcome).toBe("no-run");
      expect(r.message).toContain("is not a Kelpie run folder, so there is no agent to send to");
    }
    expect(s.called()).toEqual([]);
  });

  test("Given viz verify or a page test, when Send relays, then it is refused and kelpie never runs", () => {
    const s = sandbox();
    expect(relay(post({}, "Mozilla/5.0 VizAutomation"), "x", s.folder, s.env).outcome).toBe(
      "refused",
    );
    expect(relay(new Request("http://x/"), "x", s.folder, s.env).outcome).toBe("refused"); // a GET
    expect(s.called()).toEqual([]);
  });
});

describe("the panel's _relay route", () => {
  const page = (run?: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "relay-page-"));
    writeFileSync(
      path.join(dir, "index.html"),
      `<!doctype html><html><head><meta charset="utf-8" />${run ? `\n<meta name="viz:kelpie-run" content="${run}" />` : ""}<title>Grill</title></head></html>`,
    );
    return dir;
  };

  test("Given a page tagged with its run, when the panel sends, then Kelpie gets its words once, from that run", async () => {
    const s = sandbox();
    const old = { ...process.env };
    Object.assign(process.env, s.env);
    try {
      const r = await handleRelay(page(s.folder), post({ words: "Sent from the viz page" }));
      expect(r.outcome).toBe("delivered");
    } finally {
      process.env = old;
    }
    expect(s.called()).toEqual([{ argv: ["page", "Sent from the viz page"], cwd: s.folder }]);
  });

  test("Given a page with no run tag, when the panel sends, then it says no run and kelpie never runs", async () => {
    const s = sandbox();
    expect((await handleRelay(page(), post({ words: "x" }))).outcome).toBe("no-run");
    expect(s.called()).toEqual([]);
  });
});
