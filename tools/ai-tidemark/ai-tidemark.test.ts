// Behaviour tests for ai-tidemark. Every piece is driven the way its real caller
// drives it — the statusline wrapper as Claude Code runs it — inside a throwaway
// $HOME, with stand-ins on PATH for the programs it talks to.
import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dir;
// CAPTURE_UNDER_TEST points the suite at another copy of the wrapper — how the
// regression test was shown to fail against the pre-fix recorder.
const CAPTURE = process.env.CAPTURE_UNDER_TEST ?? join(HERE, "statusline-capture.sh");

let home: string, bin: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tidemark-"));
  bin = join(home, "bin");
  mkdirSync(bin);
  // A stand-in statusline renderer: proves the payload reached it untouched.
  writeFileSync(join(bin, "ccstatusline"), `#!/bin/sh\nprintf 'RENDERED:'; cat\n`);
  chmodSync(join(bin, "ccstatusline"), 0o755);
});

const payload = (fiveHour: [number, number] | null, weekly: [number, number]) =>
  JSON.stringify({
    version: "test",
    rate_limits: {
      ...(fiveHour && { five_hour: { used_percentage: fiveHour[0], resets_at: fiveHour[1] } }),
      seven_day: { used_percentage: weekly[0], resets_at: weekly[1] },
    },
  });

function render(input: string, args: string[] = []) {
  const r = Bun.spawnSync(["bash", CAPTURE, ...args], {
    stdin: new TextEncoder().encode(input),
    env: { HOME: home, PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin` },
  });
  return r.stdout.toString();
}

const stateDir = () => join(home, ".agents/state/ai-tidemark/claude-code");

// Real sessions render ~30s apart. Backdating the log's timestamps stands in for the
// wait, so any "wrote too recently" guard sees realistic spacing.
function thirtySecondsPass() {
  if (!existsSync(stateDir())) return;
  const then = new Date(Date.now() - 30_000);
  for (const f of readdirSync(stateDir())) utimesSync(join(stateDir(), f), then, then);
}

function logged() {
  const dir = stateDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"))
    .flatMap((f: string) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean))
    .map((l: string) => JSON.parse(l));
}

// ── poller ────────────────────────────────────────────────────────────────
// A stand-in for the macOS keychain CLI, answering the one query the poller makes.
function keychainHolds(token: string, expiresAt = Date.now() + 3_600_000) {
  const blob = JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt } });
  writeFileSync(join(bin, "security"), `#!/bin/sh\ncat <<'EOF'\n${blob}\nEOF\n`);
  chmodSync(join(bin, "security"), 0o755);
}

// A working fake of the usage endpoint: answers only a correctly authorised caller.
function usageEndpoint(token: string, body: object) {
  const calls: Request[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      calls.push(req);
      if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("no", { status: 401 });
      return Response.json(body);
    },
  });
  return { url: `http://127.0.0.1:${server.port}/api/oauth/usage`, calls, stop: () => server.stop(true) };
}

async function poll(apiUrl: string) {
  const p = Bun.spawn(["python3", join(HERE, "usage-poll.py")], {
    env: { HOME: home, PATH: `${bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, AI_TIDEMARK_API_URL: apiUrl },
    stdout: "pipe", stderr: "pipe",
  });
  return p.exited;
}

const USAGE = { five_hour: { utilization: 12, resets_at: "2026-09-26T22:00:00+00:00" }, seven_day: { utilization: 30, resets_at: "2026-10-03T06:00:00+00:00" } };

describe("usage poller", () => {
  it("should append the endpoint's answer as an api record when no snapshot exists yet", async () => {
    // GIVEN a signed-in Claude Code whose token is in the keychain
    keychainHolds("tok-1");

    // GIVEN the usage endpoint is reachable
    const api = usageEndpoint("tok-1", USAGE);

    // WHEN launchd runs the poller for the first time
    await poll(api.url);
    api.stop();

    // THEN one api record holds the endpoint's answer verbatim
    const recs = logged().filter((r) => r.src === "api");
    expect(recs).toHaveLength(1);
    expect(recs[0].usage).toEqual(USAGE);
  });

  // An api record as the poller writes it, `minutesAgo` old.
  function apiSnapshot(minutesAgo: number, usage: object = USAGE) {
    mkdirSync(stateDir(), { recursive: true });
    const d = new Date(Date.now() - minutesAgo * 60_000);
    const month = d.toISOString().slice(0, 7);
    writeFileSync(join(stateDir(), `${month}.jsonl`), JSON.stringify({ t: d.toISOString(), src: "api", usage }) + "\n", { flag: "a" });
  }
  const errors = () => (existsSync(join(stateDir(), "poll-errors.log")) ? readFileSync(join(stateDir(), "poll-errors.log"), "utf8") : "");

  it("should leave the endpoint alone when the last snapshot is under 15 minutes old", async () => {
    // GIVEN a snapshot taken 5 minutes ago, with no window near its reset
    keychainHolds("tok-1");
    apiSnapshot(5);
    const api = usageEndpoint("tok-1", USAGE);

    // WHEN launchd's 5-minute tick runs the poller
    await poll(api.url);
    api.stop();

    // THEN the endpoint is not called
    expect(api.calls).toHaveLength(0);

    // THEN no record is added
    expect(logged()).toHaveLength(1);
  });

  it("should poll anyway when a fresh snapshot shows a window resetting within minutes", async () => {
    // GIVEN a snapshot taken 2 minutes ago whose 5-hour window resets in 3 minutes
    keychainHolds("tok-1");
    apiSnapshot(2, { five_hour: { utilization: 40, resets_at: new Date(Date.now() + 3 * 60_000).toISOString() } });
    const api = usageEndpoint("tok-1", USAGE);

    // WHEN the poller runs
    await poll(api.url);
    api.stop();

    // THEN the window's final reading is captured before it zeroes
    expect(logged().filter((r) => r.src === "api")).toHaveLength(2);
  });

  it("should log why, and write nothing, when the keychain has no Claude Code token", async () => {
    // GIVEN a machine where Claude Code has never signed in
    writeFileSync(join(bin, "security"), "#!/bin/sh\necho 'item not found' >&2\nexit 44\n");
    chmodSync(join(bin, "security"), 0o755);
    const api = usageEndpoint("tok-1", USAGE);

    // WHEN the poller runs
    const code = await poll(api.url);
    api.stop();

    // THEN it fails visibly in the error log
    expect(errors()).toContain("keychain read failed");
    expect(code).not.toBe(0);

    // THEN no record is invented
    expect(logged()).toHaveLength(0);
  });

  it("should log the rejection when the endpoint refuses the token", async () => {
    // GIVEN a token the endpoint no longer accepts
    keychainHolds("stale-tok");
    const api = usageEndpoint("tok-1", USAGE);

    // WHEN the poller runs
    await poll(api.url);
    api.stop();

    // THEN the 401 is in the error log
    expect(errors()).toContain("HTTP 401");

    // THEN no record is written
    expect(logged()).toHaveLength(0);
  });
});

// ── codex scraper ─────────────────────────────────────────────────────────
// A Codex session rollout as Codex writes it: one JSON event per line.
function codexSession(name: string, events: { t: string; used: number }[]) {
  const dir = join(home, ".codex/sessions/2026/09/26");
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: events[0]?.t ?? "2026-09-26T00:00:00Z", type: "session_meta", payload: {} }),
    ...events.map((e) => JSON.stringify({ timestamp: e.t, type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: e.used, window_minutes: 10080, resets_at: 1_791_032_400 }, plan_type: "plus" } } })),
  ];
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}
const scrape = () => Bun.spawnSync(["python3", join(HERE, "codex-usage-scrape.py")], { env: { HOME: home, PATH: "/opt/homebrew/bin:/usr/bin:/bin" } });
const codexHistory = () => {
  const dir = join(home, ".agents/state/ai-tidemark/codex");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
};

describe("codex scraper", () => {
  it("should copy every rate-limit observation out of the session rollouts", () => {
    // GIVEN a Codex session that reported usage twice
    codexSession("a", [{ t: "2026-09-26T13:00:00Z", used: 1 }, { t: "2026-09-26T14:00:00Z", used: 3 }]);

    // WHEN the hourly scrape runs
    scrape();

    // THEN both observations are in the history, in time order
    expect(codexHistory().map((r) => r.rate_limits.primary.used_percent)).toEqual([1, 3]);
  });

  it("should neither duplicate on a rerun nor forget an observation whose rollout Codex later removed", () => {
    // GIVEN a scrape of a session that Codex then migrates away
    const path = codexSession("a", [{ t: "2026-09-26T13:00:00Z", used: 1 }]);
    scrape();
    require("node:fs").rmSync(path);

    // GIVEN a new session appears
    codexSession("b", [{ t: "2026-09-26T15:00:00Z", used: 4 }]);

    // WHEN the scrape runs again, twice
    scrape();
    scrape();

    // THEN the history holds each observation exactly once, the vanished one included
    expect(codexHistory().map((r) => r.rate_limits.primary.used_percent)).toEqual([1, 4]);
  });
});

// ── dashboard data route ──────────────────────────────────────────────────
// The page's only question to the backend is GET api/data; ask it the same way,
// with $HOME pointed at a throwaway machine.
async function dashboardData() {
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    const { default: routes } = await import(join(HERE, "../../viz-pages/ai-tidemark/api.ts") + `?${Math.random()}`);
    return await (await routes["/data"]()).json();
  } finally { process.env.HOME = saved; }
}

describe("dashboard data", () => {
  it("should offer only a Claude Code source on a machine that has only Claude Code history", async () => {
    // GIVEN the poller has recorded one snapshot and there is no Codex history
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), "2026-09.jsonl"), JSON.stringify({ t: "2026-09-26T16:13:59-05:00", src: "api", usage: USAGE }) + "\n");

    // WHEN the dashboard asks for its data
    const d = await dashboardData();

    // THEN there is exactly one source, Claude Code
    expect(d.sources.map((s: any) => s.id)).toEqual(["claude"]);

    // THEN its 5-hour and weekly readings are both there, as exact readings
    expect(d.sources[0].samples.map((s: any) => [s.w, s.v, s.q])).toEqual([[300, 12, "exact"], [10080, 30, "exact"]]);
  });

  it("should offer only a Codex source on a machine that has only Codex history", async () => {
    // GIVEN a scraped Codex session and no Claude Code history
    codexSession("a", [{ t: "2026-09-26T13:00:00Z", used: 7 }]);
    scrape();

    // WHEN the dashboard asks for its data
    const d = await dashboardData();

    // THEN there is exactly one source, Codex, carrying its plan
    expect(d.sources.map((s: any) => [s.id, s.plan])).toEqual([["codex", "plus"]]);

    // THEN its weekly reading is there
    expect(d.sources[0].samples.map((s: any) => [s.w, s.v])).toEqual([[10080, 7]]);
  });

  it("should offer no sources, without failing, on a machine with no history at all", async () => {
    // GIVEN a fresh install that has recorded nothing yet
    // WHEN the dashboard asks for its data
    const d = await dashboardData();

    // THEN it gets an empty source list to render its empty state from
    expect(d.sources).toEqual([]);
  });

  it("should collapse several sessions' stale statusline readings to the highest per five minutes", async () => {
    // GIVEN three sessions logged different stale weekly values within one minute
    mkdirSync(stateDir(), { recursive: true });
    const base = Date.parse("2026-09-26T16:00:10Z");
    writeFileSync(join(stateDir(), "2026-09.jsonl"), [16, 19, 18].map((v, i) =>
      JSON.stringify({ t: new Date(base + i * 15_000).toISOString(), src: "statusline", rate_limits: { seven_day: { used_percentage: v, resets_at: 1_791_007_200 } } })).join("\n") + "\n");

    // WHEN the dashboard asks for its data
    const d = await dashboardData();

    // THEN one lagged reading remains, the highest
    expect(d.sources[0].samples.map((s: any) => [s.v, s.q])).toEqual([[19, "lagged"]]);
  });

  it("should place the one-tier-down line from the tier Claude Code recorded, and none for a tier it does not know", async () => {
    // GIVEN a Max 20x account with some history
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), "2026-09.jsonl"), JSON.stringify({ t: "2026-09-26T16:13:59-05:00", src: "api", usage: USAGE }) + "\n");
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { organizationRateLimitTier: "default_claude_max_20x", emailAddress: "someone@example.com" } }));

    // WHEN the dashboard asks for its data
    const max20 = (await dashboardData()).sources[0].tier;

    // THEN the line marks where Max 5x would have run out: a quarter of the window
    expect(max20).toEqual({ name: "Max 20x", down: "Max 5x", line: 25 });

    // WHEN the account's tier is one the dashboard has never seen
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { organizationRateLimitTier: "default_claude_mystery" } }));

    // THEN no line is drawn rather than a guessed one
    expect((await dashboardData()).sources[0].tier).toBeNull();
  });

  it("should publish demo data that is generated, not taken from the machine it was built on", () => {
    // GIVEN a machine whose own history looks nothing like the demo
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), "2026-09.jsonl"), JSON.stringify({ t: "2026-09-26T16:13:59-05:00", src: "api", usage: { five_hour: { utilization: 99, resets_at: "2026-09-26T22:00:00+00:00" }, seven_day: { utilization: 99, resets_at: "2026-10-03T06:00:00+00:00" } } }) + "\n");
    const out = join(home, "demo.json");

    // WHEN the demo fixture is regenerated there
    Bun.spawnSync(["bun", join(HERE, "../../viz-pages/ai-tidemark/fixtures/generate.ts"), out], { env: { ...process.env, HOME: home } });

    // THEN it is byte-for-byte the committed fixture: nothing of this machine leaked in
    expect(readFileSync(out, "utf8")).toBe(readFileSync(join(HERE, "../../viz-pages/ai-tidemark/fixtures/demo.json"), "utf8"));
  });

  it("should never send anything from ~/.claude.json except the tier", async () => {
    // GIVEN a ~/.claude.json holding personal details next to the tier
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), "2026-09.jsonl"), JSON.stringify({ t: "2026-09-26T16:13:59-05:00", src: "api", usage: USAGE }) + "\n");
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { organizationRateLimitTier: "default_claude_max_20x", emailAddress: "someone@example.com", displayName: "Someone" } }));

    // WHEN the dashboard asks for its data
    const body = JSON.stringify(await dashboardData());

    // THEN none of the personal details are in the response
    expect(body).not.toContain("someone@example.com");
    expect(body).not.toContain("Someone");
  });
});

describe("statusline capture", () => {
  it("should log only the readings that advance a window when several sessions render stale values", () => {
    // GIVEN three open sessions, each rendering its own stale cache of the same weekly window
    const week = 1_790_402_400;
    const sessions = [16, 18, 19].map((v) => payload([10, 1_000], [v, week]));

    // WHEN they take turns rendering, 30s apart, three rounds each
    for (let round = 0; round < 3; round++) for (const s of sessions) { render(s); thirtySecondsPass(); }

    // THEN each new high is logged once, and the stale re-renders are not
    expect(logged().map((r) => r.rate_limits.seven_day.used_percentage)).toEqual([16, 18, 19]);
  });

  it("should hand the untouched payload to whatever statusline command it is given", () => {
    // GIVEN a user whose own statusline is a script of theirs, not ccstatusline
    writeFileSync(join(bin, "my-line"), `#!/bin/sh\nprintf 'MINE:'; cat\n`);
    chmodSync(join(bin, "my-line"), 0o755);
    const input = payload([10, 1_000], [16, 1_790_402_400]);

    // WHEN Claude Code renders through the wrapper configured with that command
    const out = render(input, ["my-line"]);

    // THEN their statusline receives exactly what Claude Code sent
    expect(out).toBe(`MINE:${input}`);

    // THEN the reading is still recorded on the way past
    expect(logged()).toHaveLength(1);
  });

  it("should record silently and succeed when no statusline command is configured", () => {
    // GIVEN a user who wants the history but no statusline
    const input = payload(null, [16, 1_790_402_400]);

    // WHEN Claude Code renders through the bare wrapper
    const r = Bun.spawnSync(["bash", CAPTURE], { stdin: new TextEncoder().encode(input), env: { HOME: home, PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin` } });

    // THEN nothing is drawn
    expect(r.stdout.toString()).toBe("");

    // THEN it exits cleanly, so Claude Code shows no error
    expect(r.exitCode).toBe(0);

    // THEN the reading is recorded
    expect(logged()).toHaveLength(1);
  });

  it("should still render, and record nothing, when the payload carries no rate limits", () => {
    // GIVEN a payload from a Claude Code session with no rate-limit data (API-key login, older version)
    const input = JSON.stringify({ version: "test", model: { display_name: "x" } });

    // WHEN it renders through the wrapper
    const out = render(input, ["ccstatusline"]);

    // THEN the statusline is unaffected
    expect(out).toBe(`RENDERED:${input}`);

    // THEN no history line is invented
    expect(logged()).toHaveLength(0);
  });

  it("should log a new window even when its percentage is lower, and ignore a session still showing the old one", () => {
    // GIVEN a 5-hour window that reached 30%
    render(payload([30, 1_000], [20, 9_000]));

    // WHEN the window resets and a fresh session shows 2% in the new window
    render(payload([2, 19_000], [20, 9_000]));

    // WHEN an old session still renders the previous window at 30%
    render(payload([30, 1_000], [20, 9_000]));

    // THEN the history holds the old window's peak and the new window's start, nothing after
    expect(logged().map((r) => [r.rate_limits.five_hour.used_percentage, r.rate_limits.five_hour.resets_at])).toEqual([[30, 1_000], [2, 19_000]]);
  });
});
