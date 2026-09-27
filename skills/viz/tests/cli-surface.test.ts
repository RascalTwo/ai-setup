// tests/cli-surface.test.ts — the CLI surface an agent reads: option sets, filters, the
// generated MCP tools, and the preview banner another process parses.
//
// Same isolation as cli.test.ts: VIZ_PAGES_DIR points at a throwaway library under $HOME
// (a viz's identity is its path relative to $HOME, so /tmp will not do).

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { buildProgram } from "../program.ts";
import { generateTools } from "../lib/mcp-tools.ts";

const SKILL = path.dirname(import.meta.dir);
let SANDBOX: string;
let LIB: string;
const env = () => ({ ...process.env, VIZ_PAGES_DIR: LIB, VIZ_NO_OPEN: "1", VIZ_SCAN_ROOT: SANDBOX });

beforeAll(() => {
  SANDBOX = mkdtempSync(path.join(homedir(), ".viz-surface-test-"));
  LIB = path.join(SANDBOX, ".viz-pages");
  mkdirSync(LIB, { recursive: true });
});
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

async function viz(args: string[], cwd = SANDBOX) {
  const proc = Bun.spawn(["bun", path.join(SKILL, "viz.ts"), ...args], { cwd, env: env(), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, all: stdout + stderr };
}

/** The long flags `viz <path> --help` advertises. */
async function flagsOf(...p: string[]) {
  const r = await viz([...p, "--help"]);
  return [...r.stdout.matchAll(/^\s+(--[a-z-]+)/gm)].map((m) => m[1]).filter((f) => f !== "--help");
}

describe("mirror subcommands offer only the flags they use", () => {
  test("Given mirror ls, when asked for help, then it offers no flags at all", async () => {
    expect(await flagsOf("mirror", "ls")).toEqual([]);
  });

  test("Given mirror add/update/rm, when asked for help, then each has its own set", async () => {
    expect(await flagsOf("mirror", "add")).toEqual(["--to", "--access", "--no-commit", "--examples"]);
    expect(await flagsOf("mirror", "update")).toEqual(["--to", "--access", "--listed", "--title", "--description", "--tags", "--no-commit"]);
    expect(await flagsOf("mirror", "rm")).toEqual(["--to", "--no-commit"]);
  });
});

describe("ls reports and filters approval", () => {
  test("Given one approved viz, when ls --approved filters, then only matching vizzes show and --json carries the state", async () => {
    expect((await viz(["create", "appr-yes", "--no-print"])).code).toBe(0);
    expect((await viz(["create", "appr-no", "--no-print"])).code).toBe(0);
    expect((await viz(["update", path.join(LIB, "appr-yes"), "--approved", "true", "--no-commit"])).code).toBe(0);

    const approved = JSON.parse((await viz(["ls", "--approved", "approved", "--json"])).stdout);
    expect(approved.map((r: { id: string }) => path.basename(r.id))).toEqual(["appr-yes"]);
    expect(approved[0].approved).toBe("approved");

    const never = JSON.parse((await viz(["ls", "--approved", "never", "--json"])).stdout);
    const ids = never.map((r: { id: string }) => path.basename(r.id));
    expect(ids).toContain("appr-no");
    expect(ids).not.toContain("appr-yes");
  });

  test("Given an approved viz edited since, when ls runs, then it is stale in both outputs", async () => {
    const idx = path.join(LIB, "appr-yes", "index.html");
    writeFileSync(idx, readFileSync(idx, "utf8").replace("</body>", "<p>edit</p></body>"));
    const stale = JSON.parse((await viz(["ls", "--approved", "stale", "--json"])).stdout);
    expect(stale.map((r: { id: string }) => path.basename(r.id))).toEqual(["appr-yes"]);
    expect((await viz(["ls", "--approved", "stale"])).stdout).toContain("approval stale");
  });
});

describe("hidden tags keep a viz out of ls and search by default (ADR 0020)", () => {
  const ids = (out: string) => JSON.parse(out).map((r: { id: string }) => path.basename(r.id));

  test("Given a viz tagged grill-session, when ls runs, then only --all lists it — in text and --json", async () => {
    expect((await viz(["create", "grill-q", "--no-print"])).code).toBe(0);
    expect((await viz(["create", "plain-q", "--no-print"])).code).toBe(0);
    expect((await viz(["update", path.join(LIB, "grill-q"), "--tags", "grill-session,draft", "--no-commit"])).code).toBe(0);

    expect(ids((await viz(["ls", "--json"])).stdout)).not.toContain("grill-q");
    expect(ids((await viz(["ls", "--json"])).stdout)).toContain("plain-q");
    expect((await viz(["ls"])).stdout).not.toContain("grill-q");
    expect(ids((await viz(["ls", "--all", "--json"])).stdout)).toContain("grill-q");
    expect(ids((await viz(["search", "grill-q", "--json"])).stdout)).toEqual([]);
    expect(ids((await viz(["search", "grill-q", "--all", "--json"])).stdout)).toEqual(["grill-q"]);
  });

  test("Given a library viz.config.json, when it names another tag, then it replaces the skill's list", async () => {
    const cfg = path.join(LIB, "viz.config.json");
    writeFileSync(cfg, JSON.stringify({ hiddenTags: ["draft-only"] }));
    try {
      expect((await viz(["update", path.join(LIB, "plain-q"), "--tags", "draft-only", "--no-commit"])).code).toBe(0);
      const shown = ids((await viz(["ls", "--json"])).stdout);
      expect(shown).toContain("grill-q"); // grill-session is no longer hidden
      expect(shown).not.toContain("plain-q");
    } finally {
      rmSync(cfg);
    }
  });
});

test("Given a public viz tagged grill-session, when the lobby's cards are composed, then it is built but not carded", async () => {
  const { composeCards } = await import("../lib/publish/mirrors.ts");
  const box = path.join(SANDBOX, "lobby-box");
  const page = (tag: string) => `<html><head><meta name="viz:posture" content="public"><meta name="viz:tag" content="${tag}"></head></html>`;
  for (const [slug, tag] of [["grill-l", "grill-session"], ["plain-l", "chart"]]) {
    mkdirSync(path.join(box, slug), { recursive: true });
    writeFileSync(path.join(box, slug, "index.html"), page(tag));
  }
  const { cards, unlisted } = composeCards(box);
  expect(cards.map((c) => c.slug)).toEqual(["plain-l"]);
  expect(unlisted).toBe(1);
});

describe("generated MCP tools", () => {
  const tools = generateTools(buildProgram());
  const byName = (n: string) => tools.find((t) => t.name === n)!;

  test("Given a command with --examples, when its tool is generated, then the description carries them", () => {
    expect(byName("viz_create").description).toContain("viz create repo-import-graph");
    // addHelpText('after') prose travels too
    expect(byName("viz_search").description).toContain("Searches page source");
  });

  test("Given the grouped tool, when generated, then it lists each action and points at --help", () => {
    const d = byName("viz_manage").description;
    expect(d).toContain("- mirror add *: ");
    expect(d).toContain('args: ["--help"]');
    expect(d).not.toContain("bad action");
  });

  test("Given an optional-value flag (--local [dir]), when mapped to argv, then true is the bare flag and a string is its value", () => {
    const create = byName("viz_create");
    expect(create.inputSchema.local.safeParse(true).success).toBe(true);
    expect(create.inputSchema.local.safeParse("/x").success).toBe(true);
    expect(create.toArgv({ slug: "s", local: true })).toEqual(["create", "s", "--local"]);
    expect(create.toArgv({ slug: "s", local: "/x" })).toEqual(["create", "s", "--local", "/x"]);
    expect(create.toArgv({ slug: "s", local: false })).toEqual(["create", "s"]);
  });
});

test("Given every test file, when bun test runs, then none can end the run early", () => {
  // A hand-rolled runner that exits the process stops `bun test` after that file and
  // silently skips the rest — which is how two files once hid every other suite.
  for (const f of readdirSync(import.meta.dir).filter((f) => f.endsWith(".test.ts"))) {
    const src = readFileSync(path.join(import.meta.dir, f), "utf8");
    expect(src, f).toContain('from "bun:test"');
    expect(/process\.exit\(/.test(src), f).toBe(false);
  }
});

test("Given a lobby-sealed container, when viz preview serves it, then it prints the key and then the banner the self-portrait parses", async () => {
  const site = path.join(SANDBOX, "site");
  mkdirSync(site, { recursive: true });
  expect((await viz(["create", "card", "--local", ".", "--no-print"], site)).code).toBe(0);
  const idx = path.join(site, "viz-pages", "card", "index.html");
  writeFileSync(idx, readFileSync(idx, "utf8").replace(/(name="viz:posture" content=")local/, "$1public"));
  writeFileSync(path.join(site, "viz-pages", "_private-lobby"), "");

  const proc = Bun.spawn(["bun", path.join(SKILL, "viz.ts"), "preview", "viz-pages", "--no-og"], { cwd: site, env: env(), stdout: "pipe", stderr: "pipe" });
  let out = "";
  try {
    // Read until the banner; the process never exits on its own.
    for await (const chunk of proc.stdout) {
      out += new TextDecoder().decode(chunk);
      if (/👀 Preview[\s\S]*?http:\/\/127\.0\.0\.1:\d+\//.test(out)) break;
    }
  } finally {
    proc.kill();
  }
  // The exact patterns viz-pages/viz-self-portrait/api.ts matches — change them together.
  expect(out).toMatch(/👀 Preview[\s\S]*?(http:\/\/127\.0\.0\.1:\d+\/)/);
  expect(out).toMatch(/^\s*passphrase:\s*(\S+)\s*$/m);
  expect(out).toMatch(/#staticrypt_pwd=([^&\s]+)/);
  expect(out.indexOf("passphrase:")).toBeLessThan(out.indexOf("👀 Preview"));
}, 60_000);

describe("library follow-ups", () => {
  const git = (cwd: string, ...a: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, ...a], { stdout: "pipe", stderr: "pipe" });

  test("Given a committed viz, when history --json runs, then it is an array of {hash, date, subject}", async () => {
    const repo = path.join(SANDBOX, "hist");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-q");
    expect((await viz(["create", "h", "--local", ".", "--no-print"], repo)).code).toBe(0);
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "first: with spaces");
    const r = await viz(["history", path.join(repo, "viz-pages", "h"), "--json"]);
    expect(r.code).toBe(0);
    const [c] = JSON.parse(r.stdout);
    expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(c.date))).toBe(false);
    expect(JSON.parse(r.stdout).map((x: { subject: string }) => x.subject)).toContain("first: with spaces");
  });

  test("Given a mirror title override, when mirror update sets --title \"\", then the override is cleared", async () => {
    const sink = path.join(SANDBOX, "team", "viz-pages");
    mkdirSync(sink, { recursive: true });
    expect((await viz(["create", "mir", "--no-print"])).code).toBe(0);
    const dir = path.join(LIB, "mir");
    expect((await viz(["mirror", "add", dir, "--to", sink, "--access", "public", "--no-commit"])).code).toBe(0);
    expect((await viz(["mirror", "update", dir, "--to", sink, "--title", "X", "--no-commit"])).code).toBe(0);
    expect((await viz(["mirror", "ls", dir])).stdout).toContain('"title":"X"');
    expect((await viz(["mirror", "update", dir, "--to", sink, "--title", "", "--no-commit"])).code).toBe(0);
    expect((await viz(["mirror", "ls", dir])).stdout).not.toContain("overrides");
  });

  test("Given a vendored copy edited in its sink, when the installed pre-commit hook runs, then it blocks", async () => {
    const sink = path.join(SANDBOX, "vsink", "viz-pages");
    mkdirSync(sink, { recursive: true });
    git(path.dirname(sink), "init", "-q");
    expect((await viz(["create", "vend", "--no-print"])).code).toBe(0);
    // a vendored copy must match its origin's posture
    expect((await viz(["update", path.join(LIB, "vend"), "--posture", "public", "--no-commit"])).code).toBe(0);
    expect((await viz(["vendor", "add", path.join(LIB, "vend"), "--to", sink, "--access", "public", "--no-commit"])).code).toBe(0);
    const copy = path.join(sink, "vend", "index.html");
    writeFileSync(copy, readFileSync(copy, "utf8") + "<!-- drift -->");
    git(path.dirname(sink), "add", "-A");
    const hook = Bun.spawnSync([path.join(path.dirname(sink), ".git", "hooks", "pre-commit")], { cwd: path.dirname(sink), env: env(), stdout: "pipe", stderr: "pipe" });
    expect(hook.exitCode).not.toBe(0);
  });
});

test("Given auto-og, when publish renders a card, then the command it spawns exists on disk", async () => {
  // It once pointed at lib/publish/verify.ts — never a file — and failed into an ignored
  // stderr, so every publish silently skipped the render. Pin the target, not just the intent.
  const { OG_RENDER } = await import("../lib/publish/og.ts");
  expect(existsSync(OG_RENDER[1])).toBe(true);
  const r = await viz(["verify", "--help"]);
  expect(r.stdout).toContain("--og");
});

describe("server pid: trust the live server, not a stale .server.pid", () => {
  // A stand-in for the viz server: answers /_health like it and reports a pid it controls.
  // Nothing real is started or stopped, and sync-runtimes never runs.
  const sleeper = () => Bun.spawn(["sleep", "60"]);
  const deadPid = () => {
    const p = Bun.spawnSync(["true"]);
    return p.pid;
  };
  const serverEnv = (port: number) => ({ ...env(), VIZ_PORT: String(port) });
  const run = async (port: number, ...a: string[]) => {
    const proc = Bun.spawn(["bun", path.join(SKILL, "viz.ts"), "server", ...a], { cwd: SANDBOX, env: serverEnv(port), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout, all: stdout + stderr };
  };
  const pidFile = () => path.join(LIB, ".server.pid");

  test("Given a pid file naming a dead process and nothing serving, when status and stop run, then the file is tidied and stop says not running", async () => {
    const free = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = free.port;
    free.stop(true);
    writeFileSync(pidFile(), String(deadPid()));
    const s = JSON.parse((await run(port, "status", "--json")).stdout);
    expect(s.running).toBe(false);
    expect(s.pid).toBe(null);
    expect(existsSync(pidFile())).toBe(false);

    writeFileSync(pidFile(), String(deadPid()));
    const r = await run(port, "stop");
    expect(r.code).toBe(2);
    expect(r.all).toContain("isn't running");
    expect(r.all).not.toContain("ESRCH");
  });

  test("Given a live server and a stale pid file, when status runs, then it reports the live pid and corrects the file", async () => {
    let child = sleeper();
    const srv = Bun.serve({ port: 0, fetch: () => new Response("OK", { headers: { "x-viz-mode": "live", "x-viz-pid": String(child.pid) } }) });
    try {
      writeFileSync(pidFile(), String(deadPid()));
      const s = JSON.parse((await run(srv.port, "status", "--json")).stdout);
      expect(s.pid).toBe(child.pid);
      expect(readFileSync(pidFile(), "utf8")).toBe(String(child.pid));
    } finally {
      srv.stop(true);
      child.kill();
    }
  });

  test("Given a supervisor that restarts the server, when stop kills it, then it reports the restart instead of stopped/failed", async () => {
    let child = sleeper();
    // The "supervisor": once the child dies, a new one takes its place under a new pid.
    child.exited.then(() => (child = sleeper()));
    const srv = Bun.serve({ port: 0, fetch: () => new Response("OK", { headers: { "x-viz-mode": "live", "x-viz-pid": String(child.pid) } }) });
    const first = child.pid;
    try {
      const r = await run(srv.port, "stop");
      expect(r.code).toBe(1);
      expect(r.all).toContain(`stopped pid ${first}`);
      expect(r.all).toContain("restarted by its supervisor");
    } finally {
      srv.stop(true);
      child.kill();
    }
  });
});

describe("ls flags duplicate viz:uid (ADR 0014)", () => {
  const uidOf = (dir: string) => readFileSync(path.join(dir, "index.html"), "utf8").match(/name="viz:uid" content="([^"]+)"/)![1];
  const stampUid = (dir: string, uid: string) => {
    const idx = path.join(dir, "index.html");
    writeFileSync(idx, readFileSync(idx, "utf8").replace(/(name="viz:uid" content=")[^"]+/, `$1${uid}`));
  };

  test("Given a hand-copied viz sharing a uid, when ls runs, then both are flagged naming each other; a mirror copy is not", async () => {
    for (const s of ["uid-orig", "uid-copy", "uid-mirror"]) expect((await viz(["create", s, "--no-print"])).code).toBe(0);
    const [orig, copy, mirror] = ["uid-orig", "uid-copy", "uid-mirror"].map((s) => path.join(LIB, s));
    stampUid(copy, uidOf(orig));
    stampUid(mirror, uidOf(orig));
    writeFileSync(path.join(mirror, ".mirror.json"), "{}"); // a declared copy IS its origin

    const rows = JSON.parse((await viz(["ls", "--json"])).stdout) as { id: string; uidClash: string[] }[];
    const clash = (s: string) => rows.find((r) => r.id.endsWith("/" + s))!.uidClash.map((id) => path.basename(id));
    expect(clash("uid-orig")).toEqual(["uid-copy"]);
    expect(clash("uid-copy")).toEqual(["uid-orig"]);
    expect(clash("uid-mirror")).toEqual([]);
    expect((await viz(["ls"])).stdout).toContain(`duplicate viz:uid ${uidOf(orig)}`);
  });
});
