// tests/insight.test.ts — black-box tests for `viz ranking` and `viz urls`.
//
// Both are the CLI face of logic the self-portrait's api.ts imports (lib/library/ranking.ts,
// lib/publish/base-url.ts), so pinning them here pins the page too.
//
// ISOLATION: same as cli.test.ts — VIZ_PAGES_DIR points at a throwaway library under $HOME.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SKILL = path.dirname(import.meta.dir);
let SANDBOX: string;
let LIB: string;

beforeAll(() => {
  SANDBOX = mkdtempSync(path.join(homedir(), ".viz-insight-test-"));
  LIB = path.join(SANDBOX, ".viz-pages");
  mkdirSync(LIB, { recursive: true });
});
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

async function viz(args: string[]) {
  const proc = Bun.spawn(["bun", path.join(SKILL, "viz.ts"), ...args], {
    cwd: SANDBOX,
    env: { ...process.env, VIZ_PAGES_DIR: LIB, VIZ_NO_OPEN: "1", VIZ_SCAN_ROOT: SANDBOX },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr, all: stdout + stderr };
}

const mkViz = (container: string, slug: string, metas: Record<string, string>, files: Record<string, string> = {}) => {
  const dir = path.join(container, slug);
  mkdirSync(dir, { recursive: true });
  const head = Object.entries(metas).map(([k, v]) => `<meta name="viz:${k}" content="${v}">`).join("\n");
  writeFileSync(path.join(dir, "index.html"), `<!DOCTYPE html><html><head>\n${head}\n<title>${slug}</title></head><body></body></html>\n`);
  for (const [f, b] of Object.entries(files)) writeFileSync(path.join(dir, f), b);
  return dir;
};

describe("viz ranking", () => {
  test("Given one answered pair, when ranking --json runs, then it replays the log into that order and says it is incomplete", async () => {
    mkViz(LIB, "a-viz", { uid: "v-aaa", title: "Alpha", posture: "local" });
    mkViz(LIB, "b-viz", { uid: "v-bbb", title: "Bravo", posture: "local" });
    // Stored verdicts are relative to the SORTED pair (aaa before bbb): 1 = the second one wins.
    writeFileSync(path.join(LIB, "rankings.json"), JSON.stringify({
      version: 2, current: "best",
      lists: { best: { name: "Best", log: [["viz://v-aaa\u0001viz://v-bbb", 1]], benched: [], priority: [], updated: null } },
    }));

    const r = await viz(["ranking", "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.name).toBe("Best");
    expect(out.answered).toBe(1);
    // The bundled templates are rankable too, and nobody compared them — so the order stops there.
    expect(out.complete).toBe(false);
    expect(out.ranked.map((x: any) => x.uid)).toEqual(["v-bbb", "v-aaa"]);
  });

  test("Given an unknown dimension, when ranking --list runs, then it exits 2 naming the ones that exist", async () => {
    const r = await viz(["ranking", "--list", "nope"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no dimension "nope"');
    expect(r.stderr).toContain("best");
  });
});

describe("viz urls — fails closed", () => {
  const site = () => path.join(SANDBOX, "site", "viz-pages");
  const script = (body: string) => {
    mkdirSync(site(), { recursive: true });
    writeFileSync(path.join(site(), "base-url.sh"), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(site(), "base-url.sh"), 0o755);
  };

  test("Given no base-url.sh, when urls runs, then it exits 1 and prints no URL", async () => {
    mkdirSync(site(), { recursive: true });
    const r = await viz(["urls", site()]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no base-url.sh");
    expect(r.stdout).not.toContain("http");
  });

  test("Given a base-url.sh that prints garbage and exits 0, when urls runs, then it refuses", async () => {
    script('echo "deploy bucket not found"');
    const r = await viz(["urls", site(), "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false });
    expect(r.stderr).toContain("printed no URL");
  });

  test("Given a base-url.sh that exits non-zero, when urls runs, then it surfaces its stderr", async () => {
    script('echo "no creds" >&2; exit 3');
    const r = await viz(["urls", site()]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no creds");
  });

  test("Given a good URL and a card-public viz, when urls --json runs, then it lists that viz's share link and no others", async () => {
    script('echo "https://example.test/site/"');
    mkViz(site(), "shared", { posture: "public", title: "Shared", description: "d" }, { "og.png": "fake-png" });
    mkViz(site(), "not-shared", { posture: "public", title: "Quiet" }, { "og.png": "fake-png" });
    expect((await viz(["update", path.join(site(), "shared"), "--card-public", "true", "--no-commit"])).code).toBe(0);

    const r = await viz(["urls", site(), "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ url: "https://example.test/site", shares: ["https://example.test/site/share/shared/"] });
  });
});
