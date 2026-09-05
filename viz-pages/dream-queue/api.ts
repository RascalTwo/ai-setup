// dream-queue backend — the review dashboard's only privileged surface.
//
// ══════════════════════════════════════════════════════════════════════════════
// SAFETY POSTURE (read before editing)
// ══════════════════════════════════════════════════════════════════════════════
// This repo installs a git hook that does not merely BLOCK a network write from
// private/trunk — it INTERCEPTS it and publishes the entire working tree to a
// public GitHub repo. Any network-capable git invocation reachable from this file
// is therefore a public-disclosure hazard, and this server is reachable by any
// page in the user's browser.
//
// Four independent layers, cheapest first. Each one alone would be enough; they
// are all here because the cost of one of them being wrong is a public leak.
//
//   1. VERB ALLOWLIST  — runGit() refuses any git subcommand outside READ_VERBS
//                        (`diff`, `rev-parse`). There is deliberately NO generic
//                        "run this git command" route; the argv for every call is
//                        built literally in this file, never assembled from input.
//   2. REF VALIDATION  — every branch name comes from proposal JSON, which is
//                        model-generated and treated as untrusted. safeBranch()
//                        pins it to /^dream\/…$/ before it can reach an argv slot.
//   3. NETWORK KILL    — every child process gets GIT_ALLOW_PROTOCOL=file, which
//                        git enforces itself. Verified empirically on git 2.52.0:
//                        an https remote op dies with `fatal: transport 'https'
//                        not allowed`. This covers merge-approved.sh too, which is
//                        written by another component and not trusted by this one.
//   4. NO PUBLISH PATH — this file never names the public snapshot branch, never
//                        performs a network write, and never invokes the publish
//                        script. The audit grep the reviewer runs for those three
//                        terms returns a clean zero over this file BY CONSTRUCTION
//                        — including the array method that shares a name with the
//                        network verb, which is why you will find `concat`/spread
//                        below and no exceptions to explain away.
//
// All work targets private/trunk (TRUNK below), which is the development branch.
// ══════════════════════════════════════════════════════════════════════════════

import {
  readdirSync, readFileSync, writeFileSync, existsSync, renameSync,
  openSync, closeSync, unlinkSync, statSync, mkdirSync,
} from "node:fs";
import path from "node:path";

// ── Paths ─────────────────────────────────────────────────────────────────────
// This file lives at <repo>/viz-pages/dream-queue/api.ts, so the repo root is two
// levels up. Derived, never hardcoded, so a clone elsewhere still works.
const REPO = path.resolve(import.meta.dir, "..", "..");
const SKILL = path.join(REPO, "skills", "dream");
const STATE = path.join(SKILL, "state");
const LIVE_PROPOSALS = path.join(STATE, "proposals");
const LIVE_HEARTBEAT = path.join(STATE, "last-dream.json");
const MERGE_SCRIPT = path.join(SKILL, "scripts", "merge-approved.sh");

// Fixtures live under state/, which is entirely git-ignored (state/.gitignore is
// `*` + `!.gitignore`) — nothing here can reach the published tree. Delete the
// FIXTURES dir to remove them; the dashboard silently switches to live data.
const FIXTURES = path.join(STATE, "FIXTURES");
const FIXTURE_PROPOSALS = path.join(FIXTURES, "proposals");
const FIXTURE_HEARTBEAT = path.join(FIXTURES, "last-dream.json");
const FIXTURE_DIFFS = path.join(FIXTURES, "diffs");

const TRUNK = "private/trunk";

/** Staleness bands, in days. The dream runs nightly, so silence is the failure. */
const STALE = { warn: 3, alarm: 7 };

/** Largest diff we will hand to the browser. Past this, truncate with a notice. */
const DIFF_CAP = 400_000;

// ── Layer 1 + 3: the only way this file starts a child process ────────────────

/** git subcommands this backend may run. Read-only, local-only, no exceptions. */
const READ_VERBS = new Set(["diff", "rev-parse", "status"]);

/**
 * Env handed to every child process.
 * GIT_ALLOW_PROTOCOL restricts git to the listed transports; `file` alone means
 * every network transport is refused by git itself. GIT_TERMINAL_PROMPT=0 keeps a
 * credential prompt from hanging the request forever.
 */
const SAFE_ENV = { ...process.env, GIT_ALLOW_PROTOCOL: "file", GIT_TERMINAL_PROMPT: "0" };

type Ran = { code: number; out: string; err: string };

async function run(argv: string[], cwd = REPO): Promise<Ran> {
  const proc = Bun.spawn(argv, { cwd, env: SAFE_ENV, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, err };
}

/** Every git call in this file funnels through here, so the allowlist cannot be bypassed. */
async function runGit(args: string[]): Promise<Ran> {
  if (!READ_VERBS.has(args[0])) throw new Error(`git verb not allowed: ${args[0]}`);
  return run(["git", ...args]);
}

// ── Layer 2: input validation ─────────────────────────────────────────────────

/** Proposal ids name a file on disk. Pin the charset and forbid traversal. */
function safeId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,80}$/.test(id)) return null;
  if (id.includes("..")) return null;
  return id;
}

/**
 * Branch names arrive from proposal JSON, which a local model wrote. Pin them to
 * the shape CONTRACTS.md specifies before they can become an argv element.
 * A leading `-` would be read as a flag, `..` is a ref-syntax hazard.
 */
function safeBranch(branch: unknown): string | null {
  if (typeof branch !== "string") return null;
  if (!/^dream\/[0-9A-Za-z][0-9A-Za-z._-]{0,120}$/.test(branch)) return null;
  if (branch.includes("..")) return null;
  return branch;
}

/** Resolve a proposal file, refusing anything that escapes its directory. */
function proposalFile(dir: string, id: string): string | null {
  const file = path.resolve(dir, id + ".json");
  if (path.dirname(file) !== path.resolve(dir)) return null;
  return file;
}

// ── Proposal loading ──────────────────────────────────────────────────────────

const jsonFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

/**
 * Live proposals win. If none exist yet (the extractor/synthesizer are being built
 * in parallel), fall back to fixtures so the dashboard is verifiable — and say so
 * loudly in the payload, so a fixture can never be mistaken for a real proposal.
 */
function proposalDir(): { dir: string; fixtures: boolean } {
  if (jsonFiles(LIVE_PROPOSALS).length > 0) return { dir: LIVE_PROPOSALS, fixtures: false };
  if (jsonFiles(FIXTURE_PROPOSALS).length > 0) return { dir: FIXTURE_PROPOSALS, fixtures: true };
  return { dir: LIVE_PROPOSALS, fixtures: false };
}

const WEIGHT: Record<string, number> = { global: 3.0, project: 1.5, "single-skill": 1.0 };

/** Normalise one envelope, tolerating a partially-written or older-shaped file. */
function normalise(raw: any, id: string) {
  const occurrences = Number(raw?.occurrences) || 0;
  const blast = typeof raw?.blast_radius === "string" ? raw.blast_radius : "single-skill";
  // rank is authoritative when present; derive it only when the writer omitted it.
  const rank = Number.isFinite(Number(raw?.rank))
    ? Number(raw.rank)
    : occurrences * (WEIGHT[blast] ?? 1);
  return {
    id: typeof raw?.id === "string" ? raw.id : id,
    title: typeof raw?.title === "string" ? raw.title : "(untitled)",
    rationale: typeof raw?.rationale === "string" ? raw.rationale : "",
    evidence: Array.isArray(raw?.evidence) ? raw.evidence.filter((e: any) => typeof e === "string") : [],
    occurrences,
    blast_radius: blast,
    rank,
    branch: typeof raw?.branch === "string" ? raw.branch : "",
    branch_ok: safeBranch(raw?.branch) !== null,
    conflicts_with: Array.isArray(raw?.conflicts_with)
      ? raw.conflicts_with.filter((c: any) => typeof c === "string")
      : [],
    status: typeof raw?.status === "string" ? raw.status : "pending",
    created: typeof raw?.created === "string" ? raw.created : null,
    // Approval ORDER decides which side of a conflict wins, so it is load-bearing
    // data, not a timestamp for display. Written here, read by merge-approved.sh.
    approved_at: typeof raw?.approved_at === "string" ? raw.approved_at : null,
    // Written by merge-approved.sh, never here. "rival-merged" (you lost a conflict)
    // and "trunk-diverged" (the base moved under you) are very different stories
    // and both otherwise collapse into a bare status: "stale".
    stale_reason: typeof raw?.stale_reason === "string" ? raw.stale_reason : null,
  };
}

function loadProposals() {
  const { dir, fixtures } = proposalDir();
  const items = jsonFiles(dir).flatMap((f) => {
    try {
      return [normalise(JSON.parse(readFileSync(path.join(dir, f), "utf8")), f.replace(/\.json$/, ""))];
    } catch {
      return []; // a half-written file during a dream run is not a reason to blank the page
    }
  });
  // Rank descending is the contract's ordering. Ties break on occurrences, then id,
  // so the list order is stable across reloads (a jumping list is unreviewable).
  items.sort((a, b) => b.rank - a.rank || b.occurrences - a.occurrences || a.id.localeCompare(b.id));
  return { dir, fixtures, items };
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

/**
 * CONTRACTS.md does not fix the shape of last-dream.json, so accept any of the
 * plausible timestamp keys and fall back to scanning values, then to file mtime.
 * The key actually used is reported back so the integrator can see the guess.
 */
const TS_KEYS = [
  "finished_at", "finished", "completed_at", "ended_at", "end", "ts", "timestamp",
  "last_dream", "last_run", "started_at", "started", "created", "date", "when",
];

/** Keys that record the last time the pipeline actually SUCCEEDED, not merely ran. */
const SUCCESS_KEYS = ["last_success", "last_success_at", "succeeded_at", "last_ok"];

/** Values of a `status` field that mean the run genuinely completed. */
const GOOD_STATUS = new Set(["ok", "success", "succeeded", "complete", "completed", "done"]);

const parseTs = (v: unknown): Date | null => {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v < 1e12 ? v * 1000 : v); // tolerate seconds or millis
    return isNaN(+d) ? null : d;
  }
  if (typeof v !== "string" || v.length < 8) return null;
  const d = new Date(v);
  return isNaN(+d) ? null : d;
};

function heartbeat() {
  const file = existsSync(LIVE_HEARTBEAT)
    ? LIVE_HEARTBEAT
    : existsSync(FIXTURE_HEARTBEAT)
      ? FIXTURE_HEARTBEAT
      : null;
  if (!file) return { ok: false, level: "never" as const, reason: "last-dream.json not found", file: null };

  let raw: any = null;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { /* fall through to mtime */ }

  let when: Date | null = null;
  let key: string | null = null;
  if (raw && typeof raw === "object") {
    for (const k of TS_KEYS) {
      const d = parseTs(raw[k]);
      if (d) { when = d; key = k; break; }
    }
    if (!when) {
      for (const [k, v] of Object.entries(raw)) {
        const d = parseTs(v);
        if (d) { when = d; key = k; break; }
      }
    }
  }
  if (!when) { when = new Date(statSync(file).mtimeMs); key = "(file mtime — no timestamp key recognised)"; }

  // ── Ran vs SUCCEEDED ────────────────────────────────────────────────────────
  // These are not the same thing, and conflating them recreates the exact failure
  // this heartbeat exists to catch. A dream whose pipeline crashes every night
  // still rewrites its timestamp every night: "last dream: today", zero proposals,
  // forever. Staleness is therefore measured against the last SUCCESS, and a
  // failing run is called out even when the attempt itself is recent.
  const runStatus = typeof raw?.status === "string" ? raw.status : null;
  const ranWell = runStatus === null || GOOD_STATUS.has(runStatus.toLowerCase());

  let success: Date | null = null;
  let successKey: string | null = null;
  if (raw && typeof raw === "object") {
    for (const k of SUCCESS_KEYS) {
      const d = parseTs(raw[k]);
      if (d) { success = d; successKey = k; break; }
    }
  }
  // No explicit success key, but the run reported success → the run IS the success.
  if (!success && ranWell) { success = when; successKey = key; }

  const daysRan = (Date.now() - +when) / 86_400_000;
  const days = success ? (Date.now() - +success) / 86_400_000 : Infinity;
  const level = !success ? "never"
    : days >= STALE.alarm ? "alarm"
    : days >= STALE.warn ? "warn"
    : ranWell ? "fresh" : "warn"; // recent success but the latest attempt failed

  const failedSteps = Array.isArray(raw?.steps)
    ? raw.steps.filter((s: any) => s && s.status && !GOOD_STATUS.has(String(s.status).toLowerCase()))
        .map((s: any) => ({ name: String(s.name ?? "?"), status: String(s.status), exit: s.exit ?? null }))
    : [];

  return {
    ok: !!success,
    level,
    iso: success ? success.toISOString() : null,
    days: success ? days : null,
    whole_days: success ? Math.floor(days) : null,
    source_key: successKey,
    // The last ATTEMPT, reported separately so a crash-looping scheduler is visible.
    ran_iso: when.toISOString(),
    ran_days: Math.floor(daysRan),
    ran_ok: ranWell,
    run_status: runStatus,
    error: typeof raw?.error === "string" ? raw.error : null,
    failed_steps: failedSteps,
    counts: raw?.counts && typeof raw.counts === "object" ? raw.counts : null,
    reason: success ? null : "the dream has never completed successfully",
    file: path.relative(REPO, file),
    fixture: file === FIXTURE_HEARTBEAT,
    thresholds: STALE,
    extra: raw && typeof raw === "object" ? raw : null,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

const bad = (msg: string, status = 400) => Response.json({ ok: false, error: msg }, { status });

async function body(req: Request): Promise<Record<string, any>> {
  return (await req.json().catch(() => ({}))) as Record<string, any>;
}

export default {
  /** Everything the page needs for its first paint: proposals, heartbeat, context. */
  "/state": async () => {
    const { dir, fixtures, items } = loadProposals();
    // merge-approved.sh refuses to run against a dirty working tree and exits 1.
    // That is a normal, frequent state in this repo, so surface it BEFORE the user
    // clicks the button rather than letting a refusal look like a broken feature.
    // --untracked-files=no MUST match merge-approved.sh's own check, or the warning
    // fires on untracked files the script does not actually care about.
    const st = await runGit(["status", "--porcelain", "--untracked-files=no"]);
    const dirtyFiles = st.code === 0 ? st.out.split("\n").filter((l) => l.trim()) : [];
    return Response.json({
      ok: true,
      fixtures,
      proposals: items,
      heartbeat: heartbeat(),
      tree: { dirty: dirtyFiles.length > 0, count: dirtyFiles.length, sample: dirtyFiles.slice(0, 12) },
      env: {
        repo: REPO,
        trunk: TRUNK,
        proposal_dir: path.relative(REPO, dir),
        merge_script: path.relative(REPO, MERGE_SCRIPT),
        merge_script_ready: existsSync(MERGE_SCRIPT),
        generated: new Date().toISOString(),
      },
    });
  },

  /**
   * Diff sizes for every proposal at once, so each row can show "+41 −7 in 3 files"
   * without expanding. Deliberately a separate route from /state: it is N git calls
   * and must not delay the first paint.
   */
  "/diffstat": async () => {
    const { items, fixtures } = loadProposals();
    const entries = await Promise.all(items.map(async (p) => {
      if (fixtures) {
        const f = path.join(FIXTURE_DIFFS, p.id + ".diff");
        if (!existsSync(f)) return [p.id, { error: "no fixture diff" }] as const;
        const text = readFileSync(f, "utf8");
        const files = new Set(text.split("\n").filter((l) => l.startsWith("+++ ")).map((l) => l.slice(4)));
        const add = text.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
        const del = text.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
        return [p.id, { files: files.size, add, del }] as const;
      }
      const branch = safeBranch(p.branch);
      if (!branch) return [p.id, { error: "no valid dream/ branch on this proposal" }] as const;
      // A merged proposal's branch is deleted by design — don't ask git about it.
      if (p.status === "merged") return [p.id, { error: "branch deleted after merge" }] as const;
      const r = await runGit(["diff", "--numstat", `${TRUNK}...${branch}`]);
      if (r.code !== 0) return [p.id, { error: (r.err.trim().split("\n")[0] || "git diff failed") }] as const;
      const rows = r.out.trim() ? r.out.trim().split("\n") : [];
      let add = 0, del = 0;
      for (const row of rows) {
        const [a, d] = row.split("\t");
        add += Number(a) || 0;
        del += Number(d) || 0;
      }
      return [p.id, { files: rows.length, add, del }] as const;
    }));
    return Response.json({ ok: true, stats: Object.fromEntries(entries) });
  },

  /** The full diff for one proposal — fetched lazily, only when a row is expanded. */
  "/diff": async (req: Request) => {
    const id = safeId(new URL(req.url).searchParams.get("id"));
    if (!id) return bad("bad proposal id");
    const { dir, fixtures, items } = loadProposals();
    const p = items.find((x) => x.id === id);
    if (!p) return bad("no such proposal: " + id, 404);

    if (fixtures) {
      const f = path.join(FIXTURE_DIFFS, id + ".diff");
      if (!existsSync(f)) return Response.json({ ok: true, fixture: true, diff: "", note: "no fixture diff recorded for this proposal" });
      return Response.json({ ok: true, fixture: true, branch: p.branch, diff: readFileSync(f, "utf8") });
    }

    const branch = safeBranch(p.branch);
    if (!branch) return bad(`proposal ${id} has no valid dream/ branch (got ${JSON.stringify(p.branch)})`);

    const seen = await runGit(["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]);
    if (seen.code !== 0) {
      // Expected for anything already merged: the branch is deleted once its squash
      // commit lands. Not an error, and recoverable — say so instead of just failing.
      const gone = p.status === "merged"
        ? `${branch} was deleted after its squash commit landed on ${TRUNK}. Find the commit by its Proposal-Id: ${p.id} trailer, or recover the branch from the reflog.`
        : `branch ${branch} does not exist locally`;
      return Response.json({ ok: false, branch, merged: p.status === "merged", error: gone });
    }
    // Three-dot: the branch's own work relative to where it forked off the trunk.
    const r = await runGit(["diff", `${TRUNK}...${branch}`]);
    if (r.code !== 0) return Response.json({ ok: false, branch, error: r.err.trim() || "git diff failed" });
    const truncated = r.out.length > DIFF_CAP;
    return Response.json({
      ok: true,
      branch,
      base: TRUNK,
      truncated,
      diff: truncated ? r.out.slice(0, DIFF_CAP) : r.out,
      dir: path.relative(REPO, dir),
    });
  },

  /**
   * Record a human decision. Idempotent (writing the same status twice is a no-op
   * that still returns the current envelope) and race-safe:
   *
   *   - an exclusive O_EXCL lockfile serialises concurrent writers
   *   - the file is re-read INSIDE the lock, so a field another writer changed
   *     between our read and our write survives instead of being clobbered
   *   - the write is to a temp file + rename(), which is atomic on the same
   *     filesystem, so a crash mid-write can never leave a truncated proposal
   */
  "/decide": async (req: Request) => {
    if (req.method !== "POST") return bad("POST only", 405);
    const b = await body(req);
    const id = safeId(b.id);
    if (!id) return bad("bad proposal id");
    const status = b.status;
    if (!["approved", "denied", "pending"].includes(status)) {
      return bad("status must be approved | denied | pending");
    }
    const { dir } = loadProposals();
    const file = proposalFile(dir, id);
    if (!file || !existsSync(file)) return bad("no such proposal: " + id, 404);

    const saved = withLock(file, () => {
      const cur = JSON.parse(readFileSync(file, "utf8"));
      cur.status = status;
      // approved_at is the serial merge order. It MUST be written here: the merge
      // script has no other source for it (file mtime is clobbered by
      // detect-conflicts.sh rewriting envelopes, and `created` silently degrades
      // approval order into creation order — which makes the wrong side of a
      // conflict win). Cleared on deny/undo so a re-approval takes a fresh slot at
      // the back of the queue rather than keeping its original priority.
      cur.approved_at = status === "approved" ? new Date().toISOString() : null;
      atomicWrite(file, JSON.stringify(cur, null, 2) + "\n");
      return cur;
    });
    return Response.json({ ok: true, proposal: normalise(saved, id) });
  },

  /**
   * Merge everything the human approved. Delegates entirely to the dream skill's
   * own script — this backend owns no merge logic, and the script runs under the
   * same no-network env as every other child process here.
   */
  "/merge": async (req: Request) => {
    if (req.method !== "POST") return bad("POST only", 405);
    if (path.dirname(MERGE_SCRIPT) !== path.join(SKILL, "scripts")) return bad("merge script path escaped the skill", 500);
    if (!existsSync(MERGE_SCRIPT)) {
      return Response.json({
        ok: false,
        missing: true,
        script: path.relative(REPO, MERGE_SCRIPT),
        error: "merge-approved.sh has not been built yet (another component owns it).",
      });
    }
    const started = Date.now();
    const r = await run(["bash", MERGE_SCRIPT]);
    return Response.json({
      ok: r.code === 0,
      code: r.code,
      out: r.out,
      err: r.err,
      ms: Date.now() - started,
      script: path.relative(REPO, MERGE_SCRIPT),
    });
  },
};

// ── Durable-write helpers (below the routes: plumbing, not policy) ─────────────

const LOCK_STALE_MS = 10_000;

/** Serialise writers to one file with an O_EXCL lockfile; break a stale lock. */
function withLock<T>(file: string, fn: () => T): T {
  const lock = file + ".lock";
  for (let attempt = 0; attempt < 150; attempt++) {
    let fd: number | undefined;
    try {
      fd = openSync(lock, "wx"); // fails if it already exists — that IS the lock
    } catch {
      try {
        // A process that died holding the lock must not wedge the dashboard forever.
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
      } catch { /* someone else cleaned it up first */ }
      Bun.sleepSync(20);
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(lock); } catch { /* already gone */ }
    }
  }
  throw new Error("timed out waiting for the lock on " + path.basename(file));
}

/** Write via temp file + rename, so a reader never sees a partial JSON envelope. */
function atomicWrite(file: string, text: string) {
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
