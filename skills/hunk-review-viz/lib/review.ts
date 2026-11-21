// review.ts — everything hunk-review-viz knows: read commits from git, cut them into files and
// hunks, fingerprint each hunk by content, order them for reading, and lay the reviewer's marks
// back on top, following content that moved and spotting content that changed.
//
// Used by the page's api.ts (served by viz) and by scripts/review.ts (the agent's CLI).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kindOf } from "../../pr-viz/scripts/classify.ts";
import type {
  CommitView,
  FileView,
  Hunk,
  Kind,
  Mark,
  MarkBody,
  MarkRecord,
  OrderFile,
  RepoView,
  ReviewConfig,
  ReviewState,
  ReviewView,
  Status,
} from "../template/contract.ts";
import { words } from "./words.ts";

// ---------- git ----------

function git(repo: string, args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", repo, "-c", "core.quotePath=false", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}

/** "base...head" and "base..head" both mean "commits on head that aren't on base" here. */
export function revRange(range: string): string {
  return range.includes("...") ? range.replace("...", "..") : range;
}

// ---------- diff parsing ----------

export interface ParsedFile {
  path: string;
  oldPath?: string;
  binary: boolean;
  hunks: { header: string; lines: string[] }[];
}

/** Strips a/ or b/ and the tab git appends to a path that contains a space. */
function cleanPath(p: string): string {
  return p.replace(/\t$/, "").replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");
}

export function parseDiff(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let f: ParsedFile | undefined;
  let h: { header: string; lines: string[] } | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // The b/ path from the header is the fallback; ---/+++ and rename lines are exact.
      const m = /^diff --git a\/.* b\/(.*)$/.exec(line);
      f = { path: m?.[1] ?? "", binary: false, hunks: [] };
      files.push(f);
      h = undefined;
    } else if (!f) {
      continue;
    } else if (h && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\"))) {
      h.lines.push(line);
    } else if (line.startsWith("@@")) {
      h = { header: line, lines: [] };
      f.hunks.push(h);
    } else if (line.startsWith("rename from ")) {
      f.oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      f.path = line.slice("rename to ".length);
    } else if (line.startsWith("--- ") && !h) {
      const p = cleanPath(line.slice(4));
      if (p !== "/dev/null" && p !== f.path) f.oldPath ??= p;
    } else if (line.startsWith("+++ ") && !h) {
      const p = cleanPath(line.slice(4));
      if (p !== "/dev/null") f.path = p;
    } else if (line.startsWith("Binary files ")) {
      f.binary = true;
    }
  }
  for (const file of files) if (file.oldPath === file.path) delete file.oldPath;
  return files;
}

// ---------- fingerprints ----------

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Same repo, same path, same changed lines → same fingerprint, whatever commit it sits in. */
export function hunkFp(repo: string, path: string, lines: string[]): string {
  const changed = lines.filter((l) => l.startsWith("+") || l.startsWith("-"));
  return sha(`${repo}\0${path}\0${changed.join("\n")}`);
}

export function fileFp(repo: string, path: string, hunkFps: string[], binary: boolean): string {
  return sha(`file\0${repo}\0${path}\0${binary ? "binary" : hunkFps.join(",")}`);
}

/** How alike two hunks' changed lines are, 0 to 1 (shared lines over all lines). */
export function similarity(a: string[], b: string[]): number {
  const set = (x: string[]) => new Set(x.filter((l) => l.startsWith("+") || l.startsWith("-")).map((l) => l.trim()));
  const A = set(a);
  const B = set(b);
  if (!A.size && !B.size) return 1;
  let shared = 0;
  for (const l of A) if (B.has(l)) shared++;
  return shared / (A.size + B.size - shared);
}

// ---------- order ----------

const KIND_RANK: Record<Kind, number> = { prod: 0, test: 1, docs: 2, binary: 3, lock: 4 };

function matchCommit(o: { match: string; repo?: string }, c: { repo: string; sha: string; subject: string }) {
  if (o.repo && o.repo !== c.repo) return false;
  return c.subject === o.match || (/^[0-9a-f]{7,40}$/.test(o.match) && c.sha.startsWith(o.match));
}

// ---------- state ----------

export const emptyState = (): ReviewState => ({ marks: {}, replies: {} });

export function statePath(dir: string): string {
  return join(dir, ".viz-data", "state.json");
}

export function readState(dir: string): ReviewState {
  const p = statePath(dir);
  if (!existsSync(p)) return emptyState();
  return { ...emptyState(), ...(JSON.parse(readFileSync(p, "utf8")) as ReviewState) };
}

export function writeState(dir: string, state: ReviewState): void {
  const p = statePath(dir);
  mkdirSync(join(dir, ".viz-data"), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${p}.tmp`, p); // a reader never sees half a file
}

export function readConfig(dir: string): ReviewConfig {
  return JSON.parse(readFileSync(join(dir, "review.json"), "utf8")) as ReviewConfig;
}

function readOrder(dir: string): OrderFile {
  const p = join(dir, "order.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as OrderFile) : {};
}

// ---------- build ----------

interface RawCommit {
  repo: string;
  sha: string;
  subject: string;
  body: string;
  files: ParsedFile[];
}

function readCommits(repo: { name: string; path: string; range: string }): { view: RepoView; commits: RawCommit[] } {
  const view: RepoView = { name: repo.name, path: repo.path, range: repo.range };
  try {
    const range = revRange(repo.range);
    view.head = git(repo.path, ["rev-parse", "--short", range.split("..")[1] || "HEAD"]).trim();
    const shas = git(repo.path, ["rev-list", "--reverse", "--no-merges", range]).split("\n").filter(Boolean);
    const commits = shas.map((s) => {
      const out = git(repo.path, ["show", "--no-color", "--no-ext-diff", "-M", "-U3", "--format=%H%x00%s%x00%b%x00", s]);
      const [full = s, subject = "", body = "", diff = ""] = out.split("\0");
      return { repo: repo.name, sha: full.trim(), subject, body: body.trim(), files: parseDiff(diff) };
    });
    return { view, commits };
  } catch (e) {
    view.error = e instanceof Error ? e.message : String(e);
    return { view, commits: [] };
  }
}

/** Reads every range, orders it, and lays the reviewer's marks on it. */
export function buildReview(dir: string): ReviewView {
  const cfg = readConfig(dir);
  const order = readOrder(dir);
  const state = readState(dir);
  const read = cfg.repos.map(readCommits);
  const raw = read.flatMap((r) => r.commits);

  // Commits: the agent's order first, then the rest repo by repo in git order.
  const ordered: { c: RawCommit; o?: NonNullable<OrderFile["commits"]>[number] }[] = [];
  const used = new Set<RawCommit>();
  for (const o of order.commits ?? []) {
    const c = raw.find((x) => !used.has(x) && matchCommit(o, x));
    if (c) {
      used.add(c);
      ordered.push({ c, o });
    }
  }
  for (const c of raw) if (!used.has(c)) ordered.push({ c });

  // IDs: a word pair per fingerprint; a clash in this review gets a third word.
  const idOf = new Map<string, string>();
  const taken = new Map<string, string>();
  const nameFor = (fp: string) => {
    const known = idOf.get(fp);
    if (known) return known;
    let id = words(fp);
    if (taken.has(id) && taken.get(id) !== fp) id = words(fp, true);
    taken.set(id, fp);
    idOf.set(fp, id);
    return id;
  };

  const commits: CommitView[] = ordered.map(({ c, o }) => {
    const files: FileView[] = c.files.map((pf) => {
      const hunks: Hunk[] = pf.hunks.map((ph) => {
        const fp = hunkFp(c.repo, pf.path, ph.lines);
        return { fp, id: nameFor(fp), header: ph.header, lines: ph.lines, status: "unreviewed" as Status };
      });
      const ffp = fileFp(c.repo, pf.path, hunks.map((x) => x.fp), pf.binary);
      const file: FileView = {
        repo: c.repo,
        path: pf.path,
        kind: kindOf(pf.path, pf.binary),
        binary: pf.binary,
        fp: ffp,
        id: nameFor(ffp),
        status: "unreviewed",
        hunks,
      };
      if (pf.oldPath) file.oldPath = pf.oldPath;
      const why = o?.files?.find((x) => x.path === pf.path)?.why;
      if (why) file.why = why;
      return file;
    });
    // Files: the agent's listed order first, then by kind (code, tests, docs, binaries, lockfiles).
    const listed = (o?.files ?? []).map((x) => x.path);
    const rank = (f: FileView) => {
      const i = listed.indexOf(f.path);
      return i >= 0 ? i : listed.length + KIND_RANK[f.kind] * 1000;
    };
    files.sort((a, b) => rank(a) - rank(b));
    const view: CommitView = { repo: c.repo, sha: c.sha, subject: c.subject, body: c.body, files };
    if (o?.why) view.why = o.why;
    return view;
  });

  const orphans = applyMarks(commits, state);
  return { name: cfg.name, repos: read.map((r) => r.view), commits, orphans, builtAt: new Date().toISOString() };
}

/**
 * Lays marks on the built review. A mark whose fingerprint is present applies as is. A mark whose
 * content is gone moves to the most alike unmarked hunk (or file) at the same repo and path, which
 * shows as `changed` (it was approved) or `addressed` (it was flagged or asked about).
 * Returns the marks with nowhere to go.
 */
export function applyMarks(commits: CommitView[], state: ReviewState): ReviewView["orphans"] {
  const hunks = commits.flatMap((c) => c.files.flatMap((f) => f.hunks.map((h) => ({ h, f }))));
  const files = commits.flatMap((c) => c.files);
  const present = new Set([...hunks.map((x) => x.h.fp), ...files.map((f) => f.fp)]);
  const reply = (fp: string) => state.replies[fp]?.text;
  const setReply = (t: Hunk | FileView, fp: string) => {
    const r = state.replies[fp];
    if (!r) return;
    t.reply = r.text;
    if (r.line !== undefined && "lines" in t) t.replyLine = r.line;
  };

  const own = (t: Hunk | FileView, rec: MarkRecord, fp: string) => {
    const r = reply(fp);
    t.status = rec.mark === "question" && r ? "answered" : rec.mark;
    if (rec.note) t.note = rec.note;
    setReply(t, fp);
  };
  for (const { h } of hunks) {
    const rec = state.marks[h.fp];
    if (rec) own(h, rec, h.fp);
  }
  for (const f of files) {
    const rec = state.marks[f.fp];
    if (rec) own(f, rec, f.fp);
  }

  const orphans: ReviewView["orphans"] = [];
  // Flags and questions first: if two old marks want the same successor, the reviewer's note wins.
  const gone = Object.entries(state.marks)
    .filter(([fp]) => !present.has(fp))
    .sort(([, a], [, b]) => (a.mark === "ok" ? 1 : 0) - (b.mark === "ok" ? 1 : 0));
  for (const [fp, rec] of gone) {
    const carry = (t: Hunk | FileView) => {
      t.status = rec.mark === "ok" ? "changed" : "addressed";
      t.was = { fp, lines: rec.lines, mark: rec.mark };
      if (rec.note) t.note = rec.note;
      setReply(t, fp);
    };
    if (rec.kind === "file") {
      const f = files.find((x) => x.repo === rec.repo && x.path === rec.path && x.status === "unreviewed");
      if (f) carry(f);
      else orphans.push(orphanOf(rec));
      continue;
    }
    // A successor must share at least one changed line: a mark on a hunk that was deleted outright
    // is reported as gone, not pinned on an unrelated hunk that happens to sit in the same file.
    let best: Hunk | undefined;
    let score = 0;
    for (const { h, f } of hunks) {
      if (f.repo !== rec.repo || f.path !== rec.path || h.status !== "unreviewed") continue;
      const s = similarity(h.lines, rec.lines);
      if (s > score) {
        best = h;
        score = s;
      }
    }
    if (best) carry(best);
    else orphans.push(orphanOf(rec));
  }
  return orphans;
}

function orphanOf(rec: MarkRecord): ReviewView["orphans"][number] {
  const o: ReviewView["orphans"][number] = { id: rec.id, repo: rec.repo, path: rec.path, mark: rec.mark };
  if (rec.note) o.note = rec.note;
  return o;
}

// ---------- writing marks ----------

/** Records a mark from the page. Looks the target up in a fresh build so the record carries its content. */
export function setMark(dir: string, body: MarkBody): void {
  const state = readState(dir);
  if (body.replaces) delete state.marks[body.replaces];
  if (body.mark === null) {
    delete state.marks[body.fp];
  } else {
    const view = buildReview(dir);
    const target = findTarget(view, body.fp);
    if (!target) throw new Error(`nothing in this review has fingerprint ${body.fp}`);
    const rec: MarkRecord = {
      mark: body.mark,
      kind: body.kind,
      repo: target.file.repo,
      path: target.file.path,
      id: target.hunk ? target.hunk.id : target.file.id,
      lines: target.hunk ? target.hunk.lines : target.file.hunks.flatMap((h) => h.lines),
      at: new Date().toISOString(),
    };
    if (body.note) rec.note = body.note;
    state.marks[body.fp] = rec;
  }
  writeState(dir, state);
}

export function findTarget(view: ReviewView, fp: string): { file: FileView; hunk?: Hunk } | undefined {
  for (const c of view.commits)
    for (const file of c.files) {
      if (file.fp === fp) return { file };
      const hunk = file.hunks.find((h) => h.fp === fp);
      if (hunk) return { file, hunk };
    }
  return undefined;
}

/** Finds a hunk or file by its spoken ID. */
export function findById(view: ReviewView, id: string): { file: FileView; hunk?: Hunk } | undefined {
  for (const c of view.commits)
    for (const file of c.files) {
      if (file.id === id) return { file };
      const hunk = file.hunks.find((h) => h.id === id);
      if (hunk) return { file, hunk };
    }
  return undefined;
}

const FILE_CAP = 20_000;

/** A file's lines at a commit, for expanding context. null when the path doesn't exist there (deleted) or is too long. */
export function fileAt(dir: string, repoName: string, sha: string, path: string): string[] | null {
  const repo = readConfig(dir).repos.find((r) => r.name === repoName);
  if (!repo || !/^[0-9a-f]{7,40}$/.test(sha)) return null;
  try {
    const lines = git(repo.path, ["show", `${sha}:${path}`]).split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines.length > FILE_CAP ? null : lines;
  } catch {
    return null;
  }
}

/** The agent's answer to a flag or question, shown on the hunk. Keyed by the fingerprint marked. */
export function setReply(dir: string, fp: string, text: string, line?: number): void {
  const state = readState(dir);
  state.replies[fp] = { text, at: new Date().toISOString(), ...(line === undefined ? {} : { line }) };
  writeState(dir, state);
}

export type { Mark };
