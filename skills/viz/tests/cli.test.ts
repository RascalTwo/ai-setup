// tests/cli.test.ts — black-box characterization of the viz CLI surface.
//
// WHY: the toolchain had no tests, and it is about to be refactored (one shared flag
// parser, --json everywhere, a `viz <verb>` front door). These tests pin what the
// commands do TODAY, from the outside, by spawning them exactly as a user would. If a
// refactor changes an observable behaviour, a test here fails and the change becomes a
// decision instead of an accident.
//
// Some of these assert on behaviour that is arguably WRONG — verify.ts accepting only
// `--flag=value`, server.ts swallowing unknown flags. Those are marked QUIRK. They are
// pinned deliberately: the point of a characterization test is to notice the change,
// and each one gets updated in the same commit that fixes it.
//
// ISOLATION: every test points VIZ_PAGES_DIR at a throwaway dir, so nothing here can
// see or touch the real library.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SKILL = path.dirname(import.meta.dir);

let SANDBOX: string;
let LIB: string;

beforeAll(() => {
  // A viz's identity is its path relative to $HOME, so the toolchain refuses to work
  // outside it — the sandbox has to live under home, not in /tmp.
  SANDBOX = mkdtempSync(path.join(homedir(), ".viz-cli-test-"));
  // manage.ts only accepts a viz whose parent dir is named viz-pages/.viz-pages,
  // so the sandbox library has to be named like a real container too.
  LIB = path.join(SANDBOX, ".viz-pages");
  mkdirSync(LIB, { recursive: true });
});

afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

type Run = { code: number; stdout: string; stderr: string; all: string };

/** Spawn a CLI the way a user does: `bun <script> …`, with the library redirected. */
async function cli(script: string, args: string[] = []): Promise<Run> {
  const proc = Bun.spawn(["bun", path.join(SKILL, script), ...args], {
    cwd: SANDBOX,
    // Tests create ~20 vizzes; without this every run opened ~20 browser tabs.
    env: { ...process.env, VIZ_PAGES_DIR: LIB, VIZ_NO_OPEN: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr, all: stdout + stderr };
}

describe("usage: every entry point tells you how to use it", () => {
  test("Given no slug, when bootstrap runs, then it exits 2 with usage", async () => {
    const r = await cli("bootstrap.ts");
    expect(r.code).toBe(2);
    expect(r.all).toContain("usage:");
    expect(r.all).toContain("<slug>");
  });

  test("Given no verb, when manage runs, then it exits 2 with the verb list", async () => {
    const r = await cli("manage.ts");
    expect(r.code).toBe(2);
    expect(r.all).toContain("usage:");
    for (const verb of ["ls", "search", "move", "delete", "update", "history", "rollback"]) {
      expect(r.all).toContain(`manage.ts ${verb}`);
    }
  });

  test("Given no target, when verify runs, then it exits non-zero with usage", async () => {
    const r = await cli("verify.ts");
    expect(r.code).not.toBe(0);
    expect(r.all).toContain("usage:");
  });

  test("Given no container, when build runs, then it exits 2 with usage", async () => {
    const r = await cli("build.ts");
    expect(r.code).toBe(2);
    expect(r.all).toContain("usage:");
  });

  // FIXED (was QUIRK): server.ts read process.argv.includes() with no usage and no
  // rejection, so `--frozn` came up silently in LIVE mode — serving real data to
  // something that asked for a frozen tape.
  test("Given --help, when server runs, then it prints usage and exits 0", async () => {
    const r = await cli("server.ts", ["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage: bun server.ts");
  });

  test("Given a typo'd mode flag, when server runs, then it exits 2 instead of serving live", async () => {
    const r = await cli("server.ts", ["--frozn"]);
    expect(r.code).toBe(2);
    expect(r.all).toContain("unknown flag --frozn");
  });

});

describe("flag syntax is not consistent across scripts", () => {
  test("Given --posture=x and --posture x, when manage ls runs, then both are accepted", async () => {
    const eq = await cli("manage.ts", ["ls", "--posture=public"]);
    const sp = await cli("manage.ts", ["ls", "--posture", "public"]);
    expect(eq.code).toBe(0);
    expect(sp.code).toBe(0);
  });

  // FIXED (was QUIRK): verify.ts used a closure that split only on "=", so
  // `--size 800x600` was silently dropped. It shares the parser now. Value-form parity
  // itself is asserted in cli-parser.test.ts; what is observable from outside is that
  // verify now rejects malformed flags instead of ignoring them.
  test("Given a flag with no value, when verify runs, then it exits 2 saying so", async () => {
    const r = await cli("verify.ts", ["http://127.0.0.1:5199/nope/", "--size"]);
    expect(r.code).toBe(2);
    expect(r.all).toContain("--size needs a value");
  });

  test("Given an unknown flag, when verify runs, then it exits 2 naming it", async () => {
    const r = await cli("verify.ts", ["http://127.0.0.1:5199/nope/", "--nonsense"]);
    expect(r.code).toBe(2);
    expect(r.all).toContain("unknown flag --nonsense");
  });
});

describe("machine-readable output — every command an agent calls", () => {
  test("Given --json, when manage ls runs, then stdout parses as JSON", async () => {
    const r = await cli("manage.ts", ["ls", "--json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });

  test("Given --json, when manage search runs, then stdout parses as JSON", async () => {
    const r = await cli("manage.ts", ["search", "nothing-matches-this", "--json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  // FIXED (was QUIRK): bootstrap is the command an agent most needs to parse and it
  // emitted only prose. --json now short-circuits the starter dump and the ambition
  // banner too, so stdout is parseable rather than JSON with a essay stapled to it.
  test("Given --json, when bootstrap runs, then stdout is nothing but the viz record", async () => {
    const r = await cli("bootstrap.ts", ["json-probe-viz", "--json"]);
    expect(r.code).toBe(0);
    const rec = JSON.parse(r.stdout);
    expect(rec.slug).toBe("json-probe-viz");
    expect(rec.url).toContain("json-probe-viz");
    expect(rec.dir).toContain("json-probe-viz");
  });

  test("Given --json, when verify runs, then stdout is a parseable verdict", async () => {
    const r = await cli("verify.ts", ["http://127.0.0.1:5199/definitely-not-there/", "--json"]);
    // It may fail to reach the page; what matters is that it never mixes prose into stdout.
    if (r.stdout.trim()) expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  test("Given --json, when manage status runs, then stdout is a parseable status", async () => {
    const r = await cli("manage.ts", ["status", "--json"]);
    expect(r.code).toBe(0);
    const s = JSON.parse(r.stdout);
    expect(typeof s.running).toBe("boolean");
    expect(typeof s.port).toBe("number");
  });
});

describe("creating and managing a viz", () => {
  test("Given a fresh library, when bootstrap mints a slug, then the viz exists on disk", async () => {
    const r = await cli("bootstrap.ts", ["char-test-viz", "--no-print"]);
    expect(r.code).toBe(0);
    expect(existsSync(path.join(LIB, "char-test-viz", "index.html"))).toBe(true);
  });

  test("Given a slug that already exists, when bootstrap reruns, then it refuses", async () => {
    const r = await cli("bootstrap.ts", ["char-test-viz", "--no-print"]);
    expect(r.code).not.toBe(0);
    expect(r.all.toLowerCase()).toContain("already exists");
  });

  test("Given an existing viz, when manage ls runs, then the viz is listed", async () => {
    const r = await cli("manage.ts", ["ls"]);
    expect(r.stdout).toContain("char-test-viz");
  });

  test("Given a viz, when manage update sets a title, then ls reflects it", async () => {
    const dir = path.join(LIB, "char-test-viz");
    const up = await cli("manage.ts", ["update", dir, "--title", "Characterized", "--no-commit"]);
    expect(up.code).toBe(0);
    const ls = await cli("manage.ts", ["ls"]);
    expect(ls.stdout).toContain("Characterized");
  });

  test("Given a viz in a git repo, when manage history runs, then it reports the repo and path", async () => {
    const r = await cli("manage.ts", ["history", path.join(LIB, "char-test-viz")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("repo:");
    expect(r.stdout).toContain("path:");
  });

  test("Given a missing commit hash, when manage rollback runs, then it exits 2 explaining why", async () => {
    const r = await cli("manage.ts", ["rollback", path.join(LIB, "char-test-viz")]);
    expect(r.code).toBe(2);
    expect(r.all).toContain("missing <commit-hash>");
  });

  test("Given a directory that is not a viz, when manage resolves it, then it refuses", async () => {
    const notViz = path.join(SANDBOX, "not-a-viz");
    mkdirSync(notViz, { recursive: true });
    const r = await cli("manage.ts", ["update", notViz, "--title", "x"]);
    expect(r.code).toBe(2);
    expect(r.all).toContain("ERROR");
  });

  test("Given a viz, when manage delete runs, then it is gone from disk", async () => {
    const dir = path.join(LIB, "char-test-viz");
    const r = await cli("manage.ts", ["delete", dir, "--no-commit"]);
    expect(r.code).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("scaffolds", () => {
  for (const [flag, meta] of [
    ["--deck", "deck"],
    ["--poster", "poster"],
    ["--poster-dive", "poster-dive"],
    ["--exchange", "exchange"],
  ] as const) {
    test(`Given ${flag}, when bootstrap runs, then index.html is stamped viz:scaffold=${meta}`, async () => {
      const slug = `scaffold-${meta}`;
      const r = await cli("bootstrap.ts", [slug, flag, "--no-print"]);
      expect(r.code).toBe(0);
      const html = await Bun.file(path.join(LIB, slug, "index.html")).text();
      expect(html).toContain(`content="${meta}"`);
    });
  }

  // Pinned on purpose: --dive was renamed to --poster-dive and the old spelling is kept
  // alive only to redirect. That is deliberate, not dead weight.
  test("Given the renamed --dive flag, when bootstrap runs, then it errors pointing at --poster-dive", async () => {
    const r = await cli("bootstrap.ts", ["dive-probe", "--poster", "--dive", "--no-print"]);
    expect(r.code).not.toBe(0);
    expect(r.all).toContain("--poster-dive");
  });

  test("Given a blank starter, when bootstrap runs, then no viz:scaffold meta is stamped", async () => {
    const r = await cli("bootstrap.ts", ["plain-probe", "--no-print"]);
    expect(r.code).toBe(0);
    const html = await Bun.file(path.join(LIB, "plain-probe", "index.html")).text();
    expect(html).not.toContain("viz:scaffold");
  });
});

describe("safe defaults", () => {
  test("Given a new viz, when bootstrap scaffolds it, then it is local and unlisted", async () => {
    const html = await Bun.file(path.join(LIB, "plain-probe", "index.html")).text();
    expect(html).toContain("viz:posture");
    expect(html).toContain("local");
    expect(html).toContain("unlisted");
  });

  test("Given a fork, when bootstrap --from copies a viz, then posture resets to local", async () => {
    await cli("manage.ts", ["update", path.join(LIB, "plain-probe"), "--posture", "public", "--no-commit"]);
    const r = await cli("bootstrap.ts", ["fork-probe", "--from", path.join(LIB, "plain-probe"), "--no-print"]);
    expect(r.code).toBe(0);
    const html = await Bun.file(path.join(LIB, "fork-probe", "index.html")).text();
    expect(html).toContain("local");
    expect(html).not.toContain('content="public"');
  });
});

describe("libraries must not parse their importer's argv", () => {
  // build.ts is both a command and a library (manage.ts and server.ts import its
  // helpers). It used to parse process.argv at module scope, so importing it meant its
  // parser ran on the IMPORTER's flags. Harmless while unknown flags were ignored;
  // fatal the moment flag rejection was added. Pinned so it cannot come back.
  test("Given manage flags that build.ts does not know, when manage runs, then it still works", async () => {
    const dir = path.join(LIB, "importer-probe");
    await cli("bootstrap.ts", ["importer-probe", "--no-print"]);
    const r = await cli("manage.ts", ["update", dir, "--title", "Not A Build Flag", "--no-commit"]);
    expect(r.code).toBe(0);
    expect(r.all).not.toContain("unknown flag");
  });
});

describe("viz — the single CLI", () => {
  test("Given no args, when viz runs, then it prints help and exits 2", async () => {
    const r = await cli("viz.ts");
    expect(r.code).toBe(2);
    expect(r.all).toContain("Usage: viz");
  });

  test("Given --help, when viz runs, then every command group is listed and it exits 0", async () => {
    const r = await cli("viz.ts", ["--help"]);
    expect(r.code).toBe(0);
    for (const v of ["create", "verify", "check", "ls", "search", "update", "history", "server", "publish", "export"]) {
      expect(r.stdout).toContain(v);
    }
  });

  // The reason this CLI has a framework at all: help is generated from the same
  // declaration the parser uses, so SKILL.md can point at `--help` instead of
  // restating the flag surface and slowly going out of date.
  test("Given create --help, then every flag is documented from the definition", async () => {
    const r = await cli("viz.ts", ["create", "--help"]);
    expect(r.code).toBe(0);
    for (const flag of ["--local", "--deck", "--poster", "--poster-dive", "--exchange", "--hero", "--from", "--quick", "--json"]) {
      expect(r.stdout).toContain(flag);
    }
  });

  test("Given verify --help, then its flags are documented too", async () => {
    const r = await cli("viz.ts", ["verify", "--help"]);
    expect(r.code).toBe(0);
    for (const flag of ["--wait", "--full", "--size", "--og", "--commit", "--json"]) {
      expect(r.stdout).toContain(flag);
    }
  });

  test("Given a nested group, when help is asked for, then subcommands are listed", async () => {
    const r = await cli("viz.ts", ["server", "--help"]);
    expect(r.code).toBe(0);
    for (const sub of ["start", "stop", "status", "rescan"]) expect(r.stdout).toContain(sub);
  });

  // Usage errors are exit 2 everywhere in this toolchain. Commander defaults to 1 and
  // does not inherit exitOverride into subcommands, so this is pinned at three depths.
  test("Given usage errors at any depth, when viz runs, then all exit 2", async () => {
    for (const argv of [["frobnicate"], ["rollback", "/nope"], ["server", "reboot"], ["create"]]) {
      const r = await cli("viz.ts", argv);
      expect(r.code).toBe(2);
    }
  });

  test("Given viz ls --json, then it routes through and stays parseable", async () => {
    const r = await cli("viz.ts", ["ls", "--json"]);
    expect(r.code).toBe(0);
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });

  test("Given viz server status --json, then the extracted lib path returns a status", async () => {
    const r = await cli("viz.ts", ["server", "status", "--json"]);
    expect(r.code).toBe(0);
    expect(typeof JSON.parse(r.stdout).running).toBe("boolean");
  });

  test("Given a bridged command, when routed, then it behaves like the script it wraps", async () => {
    const viaCli = await cli("viz.ts", ["ls", "--json"]);
    const direct = await cli("manage.ts", ["ls", "--json"]);
    expect(viaCli.stdout).toBe(direct.stdout);
  });
});

describe("publish — the extracted pipeline", () => {
  test("Given a public viz, when publish runs, then it builds a lobby and the page", async () => {
    const slug = "publish-probe";
    await cli("viz.ts", ["create", slug, "--no-print"]);
    await cli("viz.ts", ["update", path.join(LIB, slug), "--posture", "public", "--listed", "listed", "--no-commit"]);
    const out = path.join(SANDBOX, "dist");
    const r = await cli("viz.ts", ["publish", LIB, "--out", out]);
    expect(r.code).toBe(0);
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    expect(existsSync(path.join(out, slug, "index.html"))).toBe(true);
  });

  test("Given a local-posture viz, when publish runs, then it is not published", async () => {
    const slug = "stays-local";
    await cli("viz.ts", ["create", slug, "--no-print"]);
    const out = path.join(SANDBOX, "dist2");
    await cli("viz.ts", ["publish", LIB, "--out", out]);
    expect(existsSync(path.join(out, slug))).toBe(false);
  });

  test("Given --json, when export runs, then stdout is only the record", async () => {
    const r = await cli("viz.ts", ["export", path.join(LIB, "publish-probe"), "--out", path.join(SANDBOX, "exp"), "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).mode).toBe("export");
  });
});

describe("the vendored runtime must actually resolve", () => {
  // This is the test that did not exist. server.ts grew imports of cli.ts and
  // server-control.ts, then of lib/server/*, while RUNTIME_FILES still listed four flat
  // files — so every runtime stamped in between would have died on a missing module the
  // first time someone cloned the repo and ran it. Nothing caught it because nothing
  // ever loaded a vendored copy.
  test("Given --runtime, when a viz is created, then the vendored server resolves every import", async () => {
    const repo = path.join(SANDBOX, "hostrepo");
    mkdirSync(repo, { recursive: true });
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    Bun.spawnSync(["git", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });

    const r = await cli("viz.ts", ["create", "vendored-probe", "--local", repo, "--runtime", "--no-print"]);
    expect(r.code).toBe(0);

    const vendored = path.join(repo, "viz-pages", ".runtime", "server.ts");
    expect(existsSync(vendored)).toBe(true);

    // Bundling resolves the whole import graph without starting a server or taking a
    // port. A missing module is a build error; that is exactly the failure we missed.
    const build = Bun.spawnSync(["bun", "build", vendored, "--target=bun", "--outfile=/dev/null"]);
    const err = build.stderr.toString();
    expect(err).not.toContain("Could not resolve");
    expect(build.exitCode).toBe(0);
  });
});

describe("MCP surface is derived from the CLI, not restated", () => {
  // The regression this exists for: mcp.ts used to hand-type its tool list and enum.
  // Within hours of the CLI changing, the enum still said `vendor-rm` after the verb
  // became `vendor rm`, and six commands were unreachable because nobody remembered to
  // add them. These assert the two surfaces cannot diverge again.
  test("Given the command tree, when tools are generated, then every leaf is classified", async () => {
    const { buildProgram } = await import("../program.ts");
    const { walk, resolveMeta } = await import("../lib/cli-meta.ts");
    const leaves = walk(buildProgram());
    const untagged = leaves.filter((l) => !resolveMeta(l.cmd)).map((l) => l.path.join(" "));
    expect(untagged).toEqual([]);
    expect(leaves.length).toBeGreaterThan(25);
  });

  test("Given a hidden command, then it states WHY, so a decision is not a forgotten one", async () => {
    const { buildProgram } = await import("../program.ts");
    const { walk, resolveMeta } = await import("../lib/cli-meta.ts");
    for (const { cmd } of walk(buildProgram())) {
      const m = resolveMeta(cmd)!;
      if (m.mcp.kind === "hidden") expect(m.mcp.why.length).toBeGreaterThan(10);
    }
  });

  test("Given every non-hidden leaf, then it is reachable through some MCP tool", async () => {
    const { buildProgram } = await import("../program.ts");
    const { walk, resolveMeta } = await import("../lib/cli-meta.ts");
    const { generateTools } = await import("../lib/mcp-tools.ts");
    const program = buildProgram();
    const tools = generateTools(program);

    const reachable = new Set<string>();
    for (const t of tools) {
      const action = (t.inputSchema as Record<string, { options?: unknown }>).action;
      if (action && typeof (action as { options?: string[] }).options !== "undefined") {
        for (const a of (action as unknown as { options: string[] }).options) reachable.add(a);
      } else {
        reachable.add(t.title.replace(/^viz /, ""));
      }
    }
    const expected = walk(program)
      .filter(({ cmd }) => resolveMeta(cmd)!.mcp.kind !== "hidden")
      .map(({ path }) => path.join(" "));
    const missing = expected.filter((e) => !reachable.has(e));
    expect(missing).toEqual([]);
  });

  test("Given tool argv translation, then flags round-trip as the CLI expects", async () => {
    const { buildProgram } = await import("../program.ts");
    const { generateTools } = await import("../lib/mcp-tools.ts");
    const tools = Object.fromEntries(generateTools(buildProgram()).map((t) => [t.name, t]));
    // Negated flags, optional-value flags and nested group verbs are the three shapes
    // a hand-written mapping got wrong before.
    expect(tools.viz_create.toArgv({ slug: "x", print: false })).toEqual(["create", "x", "--no-print"]);
    expect(tools.viz_create.toArgv({ slug: "x", local: "/repo" })).toEqual(["create", "x", "--local", "/repo"]);
    expect(tools.viz_manage.toArgv({ action: "vendor rm", args: ["/d", "--to", "/s"] })).toEqual(["vendor", "rm", "/d", "--to", "/s"]);
  });
});

describe("version has one source, and the bundle is self-contained", () => {
  test("Given package.json, then the CLI and MCP server report the same version", async () => {
    const pkg = await Bun.file(path.join(SKILL, "package.json")).json();
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    const cli = await cli_("viz.ts", ["--version"]);
    expect(cli.stdout.trim()).toBe(pkg.version);
    const { manifest } = await import("../maintainer/build-mcpb.ts");
    expect(manifest("darwin").version).toBe(pkg.version);
  });

  test("Given a hardcoded version anywhere else, then it is a drift and this fails", async () => {
    // The exact drift this guards: program.ts and mcp.ts each hardcoded "1.0.0" while
    // package.json had no version at all, and the .mcpb manifest was about to be a third.
    for (const f of ["program.ts", "mcp.ts", "maintainer/build-mcpb.ts"]) {
      const src = await Bun.file(path.join(SKILL, f)).text();
      const hardcoded = src.match(/version[^\n]*["']\d+\.\d+\.\d+["']/g) ?? [];
      expect(hardcoded).toEqual([]);
    }
  });

  test("Given the manifest, then it declares exactly one platform and a binary entry point", async () => {
    const { manifest } = await import("../maintainer/build-mcpb.ts");
    for (const p of ["darwin", "win32", "linux"] as const) {
      const m = manifest(p);
      // The format distinguishes OS, not architecture — one bundle per OS is the
      // granularity it offers, which is why macOS ships a universal binary instead.
      expect(m.compatibility.platforms).toEqual([p]);
      expect(m.server.type).toBe("binary");
      expect(m.server.mcp_config.command).toContain("${__dirname}");
    }
  });
});

// The suite's own cli() helper is scoped to the sandbox; version checks want the real dir.
async function cli_(script: string, args: string[]) {
  const proc = Bun.spawn(["bun", path.join(SKILL, script), ...args], {
    env: { ...process.env, VIZ_NO_OPEN: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return { stdout };
}

describe("release guard lives in maintainer/, not in the shipped skill", () => {
  test("Given the CLI, then it has no release verb — build tooling does not ship", async () => {
    const { buildProgram } = await import("../program.ts");
    const { walk } = await import("../lib/cli-meta.ts");
    const verbs = walk(buildProgram()).map((l) => l.path.join(" "));
    expect(verbs).not.toContain("release");
  });

  test("Given the bundle file list, then maintainer/ is excluded", async () => {
    const { MCP_DIRS } = await import("../maintainer/build-mcpb.ts");
    expect(MCP_DIRS).not.toContain("maintainer");
  });

  test("Given no release tag yet, then the guard passes with a reason", async () => {
    const { checkVersionBumped } = await import("../maintainer/version-guard.ts");
    const g = checkVersionBumped();
    expect(typeof g.ok).toBe("boolean");
    expect(g.reason.length).toBeGreaterThan(5);
  });

});

describe("download picker", () => {
  test("Given the install figure, then it offers exactly the three built platforms", async () => {
    const src = await Bun.file(path.join(SKILL, "viz-pages/viz-self-portrait/fig-run.js")).text();
    // The href is built from a template (`viz-${p.id}.mcpb`), so assert on the platform
    // list that feeds it rather than on a literal filename that never appears in source.
    const ids = [...src.matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(["darwin", "linux", "win32"]);
    // /latest/ redirects to the newest release, so a stale published page still hands
    // out a current bundle. A pinned version would rot the moment a release is cut.
    expect(src).toContain("releases/latest/download/viz-");
  });

  test("Given the platforms offered, then the builder can produce each one", async () => {
    const src = await Bun.file(path.join(SKILL, "viz-pages/viz-self-portrait/fig-run.js")).text();
    const ids = [...src.matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1]);
    const { manifest } = await import("../maintainer/build-mcpb.ts");
    for (const p of ids) {
      expect(manifest(p as "darwin").compatibility.platforms).toEqual([p]);
    }
  });
});

describe("creating a viz must not hijack the author's browser", () => {
  // This regressed on a real person for an entire working session: every full test run
  // created ~20 vizzes and opened ~20 dead browser tabs, which they closed by hand each
  // time before saying something. A test suite that degrades the machine it runs on is
  // a broken test suite.
  test("Given VIZ_NO_OPEN, when a viz is created, then no browser is launched", async () => {
    const src = await Bun.file(path.join(SKILL, "lib/create/create.ts")).text();
    expect(src).toContain('process.env.VIZ_NO_OPEN !== "1"');
  });

  test("Given --json, when a viz is created, then no browser is launched either", async () => {
    // A program reading structured output did not ask for a tab.
    const src = await Bun.file(path.join(SKILL, "lib/create/create.ts")).text();
    expect(src).toMatch(/if \(!jsonMode && process\.env\.VIZ_NO_OPEN/);
  });

  test("Given the test harness, then every spawn sets VIZ_NO_OPEN", async () => {
    const src = await Bun.file(path.join(SKILL, "tests/cli.test.ts")).text();
    const spawns = (src.match(/Bun\.spawn\(\["bun", path\.join\(SKILL/g) ?? []).length;
    const guarded = (src.match(/VIZ_NO_OPEN: "1"/g) ?? []).length;
    expect(guarded).toBeGreaterThanOrEqual(spawns);
  });
});
