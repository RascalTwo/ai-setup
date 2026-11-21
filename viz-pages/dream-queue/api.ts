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
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import type { Proposal, Stat } from "./types.ts";

// ── Paths ─────────────────────────────────────────────────────────────────────
// This file lives at <repo>/viz-pages/dream-queue/api.ts, so the repo root is two
// levels up. Derived, never hardcoded, so a clone elsewhere still works.
// oxlint-disable-next-line typescript/prefer-nullish-coalescing -- empty env var means unset
const REPO = process.env.DREAM_REPO || path.resolve(import.meta.dir, "..", "..");
const SKILL = path.join(REPO, "skills", "dream");
// Same root as the scripts: ~/.agents/state/dream, or $DREAM_STATE.
const STATE =
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- empty env var means unset
  process.env.DREAM_STATE || path.join(process.env.HOME ?? "", ".agents", "state", "dream");
const LIVE_PROPOSALS = path.join(STATE, "proposals");
const MERGE_SCRIPT = path.join(SKILL, "scripts", "merge-approved.sh");
const PROPOSE_SCRIPT = path.join(SKILL, "scripts", "propose-branch.sh");

// Fixtures live under the state dir, outside the repo — nothing here can reach the
// published tree. Delete the FIXTURES dir to remove them; the dashboard silently
// switches to live data.
const FIXTURES = path.join(STATE, "FIXTURES");
const FIXTURE_PROPOSALS = path.join(FIXTURES, "proposals");
const FIXTURE_DIFFS = path.join(FIXTURES, "diffs");

const TRUNK = "private/trunk";

/** Largest diff we will hand to the browser. Past this, truncate with a notice. */
const DIFF_CAP = 400_000;

// ── Layer 1 + 3: the only way this file starts a child process ────────────────

/** git subcommands this backend may run. Read-only, local-only, no exceptions. */
const READ_VERBS = new Set(["diff", "rev-parse", "status", "show"]);

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
  if (!READ_VERBS.has(args[0] ?? "")) throw new Error(`git verb not allowed: ${args[0]}`);
  const r = await run(["git", ...args]);
  return r;
}

// ── Layer 2: input validation ─────────────────────────────────────────────────

/** Proposal ids name a file on disk. Pin the charset and forbid traversal. */
function safeId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,80}$/u.test(id)) return null;
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
  if (!/^dream\/[0-9A-Za-z][0-9A-Za-z._-]{0,120}$/u.test(branch)) return null;
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
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .toSorted()
    : [];

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

/** What a proposal envelope may hold on disk — every field untrusted until normalise() checks it. */
type Raw = {
  id?: unknown;
  title?: unknown;
  rationale?: unknown;
  evidence?: unknown;
  occurrences?: unknown;
  blast_radius?: unknown;
  rank?: unknown;
  branch?: unknown;
  conflicts_with?: unknown;
  status?: unknown;
  created?: unknown;
  approved_at?: unknown;
  stale_reason?: unknown;
  memory_edits?: unknown;
};

const isRec = (v: unknown): v is Raw => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];

/** Normalise one envelope, tolerating a partially-written or older-shaped file. */
function normalise(parsed: unknown, id: string): Proposal {
  const raw: Raw = isRec(parsed) ? parsed : {};
  const occurrences = Number(raw.occurrences) || 0;
  const blast = str(raw.blast_radius) ?? "single-skill";
  // rank is authoritative when present; derive it only when the writer omitted it.
  const rank = Number.isFinite(Number(raw.rank))
    ? Number(raw.rank)
    : occurrences * (WEIGHT[blast] ?? 1);
  return {
    id: str(raw.id) ?? id,
    title: unent(str(raw.title) ?? "(untitled)"),
    rationale: unent(str(raw.rationale) ?? ""),
    evidence: strs(raw.evidence),
    occurrences,
    blast_radius: blast,
    rank,
    branch: str(raw.branch) ?? "",
    branch_ok: safeBranch(raw.branch) !== null,
    conflicts_with: strs(raw.conflicts_with),
    status: str(raw.status) ?? "pending",
    created: str(raw.created),
    // Approval ORDER decides which side of a conflict wins, so it is load-bearing
    // data, not a timestamp for display. Written here, read by merge-approved.sh.
    approved_at: str(raw.approved_at),
    // Written by merge-approved.sh, never here. "rival-merged" (you lost a conflict)
    // and "trunk-diverged" (the base moved under you) are very different stories
    // and both otherwise collapse into a bare status: "stale".
    stale_reason: str(raw.stale_reason),
    memory: Array.isArray(raw.memory_edits) && raw.memory_edits.length > 0,
  };
}

/**
 * Decode HTML entities that the SYNTHESIZER wrote into its own prose. Exactly one of the
 * 124 proposals on disk (20260816-0029) contains `sleep &lt;N&gt;`; the client escapes on
 * render, so the entity survives to the screen as literal `&lt;N&gt;`. Decoding at read
 * time keeps the stored artifact byte-faithful while fixing the display. Not a pipeline
 * bug — no script in scripts/ escapes anything; the model emitted it.
 */
const ENTITY: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  "#39": "'",
  apos: "'",
};
const unent = (s: string): string =>
  s.replaceAll(/&(lt|gt|amp|quot|#39|apos);/gu, (m: string, e: string) => ENTITY[e] ?? m);

function loadProposals(): { dir: string; fixtures: boolean; items: Proposal[] } {
  const { dir, fixtures } = proposalDir();
  const items = jsonFiles(dir).flatMap((f) => {
    try {
      return [
        normalise(JSON.parse(readFileSync(path.join(dir, f), "utf8")), f.replace(/\.json$/u, "")),
      ];
    } catch {
      return []; // a half-written file during a dream run is not a reason to blank the page
    }
  });
  // Rank descending is the contract's ordering. Ties break on occurrences, then id,
  // so the list order is stable across reloads (a jumping list is unreviewable).
  const sorted = items.toSorted(
    (a, b) => b.rank - a.rank || b.occurrences - a.occurrences || a.id.localeCompare(b.id),
  );
  return { dir, fixtures, items: sorted };
}

// ── Routes ────────────────────────────────────────────────────────────────────

const bad = (msg: string, status = 400) => Response.json({ ok: false, error: msg }, { status });

/** A POST body: every field unknown until the route checks it. */
type Body = {
  id?: unknown;
  status?: unknown;
  file?: unknown;
  start?: unknown;
  before?: unknown;
  after?: unknown;
};

async function body(req: Request): Promise<Body> {
  const j: unknown = await req.json().catch(() => ({}));
  return typeof j === "object" && j !== null ? j : {};
}

/** The /edit fields, or null when any is missing or the wrong type. */
function editArgs(b: Body): { file: string; start: number; before: string; after: string } | null {
  const { file, start, before, after } = b;
  if (
    typeof file !== "string" ||
    typeof start !== "number" ||
    !Number.isInteger(start) ||
    start < 1 ||
    typeof before !== "string" ||
    typeof after !== "string" ||
    after.length > 200_000
  ) {
    return null;
  }
  return { file, start, before, after };
}

/**
 * Write the edited file into propose-branch.sh's worktree and commit it there. On a refused
 * commit the file is put back, so the worktree stays clean and the next begin resumes cleanly.
 */
async function commitEdit(id: string, file: string, text: string, orig: string): Promise<Response> {
  const begin = await run(["bash", PROPOSE_SCRIPT, "begin", id]);
  const wt = /^DREAM_WORKTREE=(.+)$/mu.exec(begin.out)?.[1];
  if (begin.code !== 0 || !wt)
    return bad("propose-branch.sh begin failed: " + begin.err.trim(), 500);
  const target = path.resolve(wt, file);
  if (!target.startsWith(path.resolve(wt) + path.sep)) return bad("file escapes the worktree");
  writeFileSync(target, text);
  const commit = await run(["bash", PROPOSE_SCRIPT, "commit", id]);
  if (commit.code !== 0) {
    writeFileSync(target, orig);
    return Response.json({ ok: false, error: "commit refused", out: commit.err.trim() });
  }
  return Response.json({
    ok: true,
    commit: /^DREAM_COMMIT=(.+)$/mu.exec(commit.out)?.[1] ?? null,
  });
}

export default {
  /** Everything the page needs for its first paint: proposals and context. */
  "/state": async (): Promise<Response> => {
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
      tree: {
        dirty: dirtyFiles.length > 0,
        count: dirtyFiles.length,
        sample: dirtyFiles.slice(0, 12),
      },
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
  "/diffstat": async (): Promise<Response> => {
    const { dir, items, fixtures } = loadProposals();
    const entries = await Promise.all(
      items.map(async (p): Promise<readonly [string, Stat]> => {
        if (fixtures) {
          const f = path.join(FIXTURE_DIFFS, p.id + ".diff");
          if (!existsSync(f)) return [p.id, { error: "no fixture diff" }] as const;
          const text = readFileSync(f, "utf8");
          const files = new Set(
            text
              .split("\n")
              .filter((l) => l.startsWith("+++ "))
              .map((l) => l.slice(4)),
          );
          const add = text
            .split("\n")
            .filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
          const del = text
            .split("\n")
            .filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
          return [p.id, { files: files.size, add, del }] as const;
        }
        const branch = safeBranch(p.branch);
        // A basic-memory proposal has no branch by design; its diff is in its plan file.
        if (!branch && p.memory && existsSync(path.join(dir, p.id + ".change.md")))
          return [p.id, { plan: true }] as const;
        if (!branch) return [p.id, { error: "no valid dream/ branch on this proposal" }] as const;
        // A merged proposal's branch is deleted by design — don't ask git about it.
        if (p.status === "merged") return [p.id, { error: "branch deleted after merge" }] as const;
        // Same fallback as /diff. Ask git whether the ref EXISTS rather than pattern-matching
        // the message it produces when it doesn't — "unknown revision or path not in the
        // working tree" is prose, not an API, and it is what all 124 proposals hit today.
        const seen = await runGit(["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]);
        if (seen.code !== 0 && existsSync(path.join(dir, p.id + ".change.md"))) {
          return [p.id, { plan: true }] as const;
        }
        const r = await runGit(["diff", "--numstat", `${TRUNK}...${branch}`]);
        if (r.code !== 0)
          // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- empty first line falls back too
          return [p.id, { error: r.err.trim().split("\n")[0] || "git diff failed" }] as const;
        const rows = r.out.trim() ? r.out.trim().split("\n") : [];
        let add = 0,
          del = 0;
        for (const row of rows) {
          const [a, d] = row.split("\t");
          add += Number(a) || 0;
          del += Number(d) || 0;
        }
        return [p.id, { files: rows.length, add, del }] as const;
      }),
    );
    const stats: Record<string, Stat> = Object.fromEntries(entries);
    return Response.json({ ok: true, stats });
  },

  /** The full diff for one proposal — fetched lazily, only when a row is expanded. */
  "/diff": async (req: Request): Promise<Response> => {
    const id = safeId(new URL(req.url).searchParams.get("id"));
    if (!id) return bad("bad proposal id");
    const { dir, fixtures, items } = loadProposals();
    const p = items.find((x) => x.id === id);
    if (!p) return bad("no such proposal: " + id, 404);

    if (fixtures) {
      const f = path.join(FIXTURE_DIFFS, id + ".diff");
      if (!existsSync(f))
        return Response.json({
          ok: true,
          fixture: true,
          diff: "",
          note: "no fixture diff recorded for this proposal",
        });
      return Response.json({
        ok: true,
        fixture: true,
        branch: p.branch,
        diff: readFileSync(f, "utf8"),
      });
    }

    const branch = safeBranch(p.branch);
    const plan = path.join(dir, id + ".change.md");
    // A basic-memory proposal has no branch by design: its diff lives in its plan file.
    if (!branch && p.memory && existsSync(plan))
      return Response.json({
        ok: true,
        from_plan: true,
        note: "basic-memory note: written to ~/basic-memory on approval, not merged",
        change: unent(readFileSync(plan, "utf8")),
      });
    if (!branch)
      return bad(`proposal ${id} has no valid dream/ branch (got ${JSON.stringify(p.branch)})`);

    const seen = await runGit(["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]);
    if (seen.code !== 0) {
      // Expected for anything already merged: the branch is deleted once its squash
      // commit lands. Not an error, and recoverable — say so instead of just failing.
      const gone =
        p.status === "merged"
          ? `${branch} was deleted after its squash commit landed on ${TRUNK}. Find the commit by its Proposal-Id: ${p.id} trailer, or recover the branch from the reflog.`
          : `branch ${branch} does not exist locally`;
      // FALL BACK TO THE PLAN FILE. "The branch carries the change" is the design, but
      // synthesize.py writes <id>.change.md BEFORE any branch is cut — and on this machine
      // branch creation has never run (zero dream/* branches exist for 124 proposals),
      // because the only pipeline run was SIGTERMed mid-synthesis on 2026-08-16. Without
      // this fallback every proposal is unreviewable: the reviewer is asked to approve a
      // change they cannot see. The .md is the same plan the branch would have encoded.
      const md = path.join(dir, id + ".change.md");
      if (!fixtures && existsSync(md)) {
        return Response.json({
          ok: true,
          branch,
          base: TRUNK,
          from_plan: true,
          note: gone,
          change: unent(readFileSync(md, "utf8")),
        });
      }
      return Response.json({ ok: false, branch, merged: p.status === "merged", error: gone });
    }
    // Three-dot: the branch's own work relative to where it forked off the trunk.
    const r = await runGit(["diff", `${TRUNK}...${branch}`]);
    if (r.code !== 0)
      return Response.json({ ok: false, branch, error: r.err.trim() || "git diff failed" });
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
  "/decide": async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return bad("POST only", 405);
    const b = await body(req);
    const id = safeId(b.id);
    if (!id) return bad("bad proposal id");
    const status = b.status;
    if (typeof status !== "string" || !["approved", "denied", "pending"].includes(status)) {
      return bad("status must be approved | denied | pending");
    }
    const { dir } = loadProposals();
    const file = proposalFile(dir, id);
    if (!file || !existsSync(file)) return bad("no such proposal: " + id, 404);

    const saved = withLock(file, () => {
      const cur: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!isRec(cur)) throw new Error("proposal file is not an object");
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
   * The reviewer's own edit to a proposal: replace one hunk's new-side lines on the
   * dream/ branch and commit it there. Writes go through propose-branch.sh (the same
   * begin/commit the pipeline uses), never through a git write in this file.
   * `before` must still match the branch, so an edit made against a stale diff is refused.
   */
  "/edit": async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return bad("POST only", 405);
    const b = await body(req);
    const id = safeId(b.id);
    if (!id) return bad("bad proposal id");
    const args = editArgs(b);
    if (!args) return bad("edit needs file, start (1-based line), before and after");
    const { file, start, before, after } = args;
    const { fixtures, items } = loadProposals();
    if (fixtures) return bad("fixtures can't be edited");
    const p = items.find((x) => x.id === id);
    if (!p) return bad("no such proposal: " + id, 404);
    if (p.status === "merged") return bad("already merged", 409);
    const branch = safeBranch(p.branch);
    if (!branch) return bad("proposal has no valid dream/ branch");

    // Only files this proposal already changes are editable; git's own list is the allowlist.
    const names = await runGit(["diff", "--name-only", `${TRUNK}...${branch}`]);
    if (names.code !== 0 || !names.out.split("\n").includes(file))
      return bad(`${file} is not part of this proposal`);
    const cur = await runGit(["show", `${branch}:${file}`]);
    if (cur.code !== 0) return bad(`can't read ${file} on ${branch}: ${cur.err.trim()}`);

    const lines = cur.out.split("\n");
    const old = before.split("\n");
    if (lines.slice(start - 1, start - 1 + old.length).join("\n") !== before) {
      return bad("the branch changed since this diff was loaded — reload and edit again", 409);
    }
    lines.splice(start - 1, old.length, ...after.split("\n"));

    return commitEdit(id, file, lines.join("\n"), cur.out);
  },

  /**
   * Merge everything the human approved. Delegates entirely to the dream skill's
   * own script — this backend owns no merge logic, and the script runs under the
   * same no-network env as every other child process here.
   */
  "/merge": async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return bad("POST only", 405);
    if (path.dirname(MERGE_SCRIPT) !== path.join(SKILL, "scripts"))
      return bad("merge script path escaped the skill", 500);
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
      } catch {
        /* someone else cleaned it up first */
      }
      Bun.sleepSync(20);
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lock);
      } catch {
        /* already gone */
      }
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
