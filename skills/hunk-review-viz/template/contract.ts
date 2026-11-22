// contract.ts — the shapes the review page, its api.ts and the skill's lib/review.ts share.

/** What a reviewer can put on a hunk or a file. */
export type Mark = "ok" | "change" | "question";

/**
 * Where a hunk stands for the reviewer.
 * - unreviewed: nothing yet
 * - ok / change / question: their mark, on this exact content
 * - answered: a question the agent replied to (the content didn't change)
 * - addressed: a hunk they flagged or asked about whose content the agent then changed
 * - changed: a hunk they approved whose content then changed
 */
export type Status = "unreviewed" | Mark | "answered" | "addressed" | "changed";

export type Kind = "prod" | "test" | "lock" | "binary" | "docs";

export interface Hunk {
  /** Content fingerprint: repo, path and the changed lines, so moving it between commits keeps it. */
  fp: string;
  /** The speakable ID, e.g. "amber falcon". */
  id: string;
  header: string;
  /** The agent's sentences for this hunk from order.json's tour, each numbered by its step in story order. */
  say?: string[];
  /** Diff lines with their " ", "+" or "-" prefix. */
  lines: string[];
  status: Status;
  note?: string;
  reply?: string;
  /** The new-file line the agent's reply is about; it shows right under that line. */
  replyLine?: number;
  /** For addressed and changed hunks: the lines the reviewer marked, and the fingerprint they were on. */
  was?: { fp: string; lines: string[]; mark: Mark };
}

export interface FileView {
  repo: string;
  path: string;
  oldPath?: string;
  kind: Kind;
  binary: boolean;
  /** Fingerprint of the whole file change (its hunks' fingerprints). */
  fp: string;
  id: string;
  why?: string;
  /** The file's own mark (a flag or question on the file as a whole), with what became of it. */
  status: Status;
  note?: string;
  reply?: string;
  was?: { fp: string; lines: string[]; mark: Mark };
  hunks: Hunk[];
}

export interface CommitView {
  repo: string;
  sha: string;
  subject: string;
  body: string;
  why?: string;
  files: FileView[];
}

export interface RepoView {
  name: string;
  path: string;
  range: string;
  head?: string;
  error?: string;
}

export interface ReviewView {
  name: string;
  repos: RepoView[];
  commits: CommitView[];
  /** Marks whose content is gone with nothing in the same file to carry them to. */
  orphans: { id: string; repo: string; path: string; mark: Mark; note?: string }[];
  builtAt: string;
}

/** review.json: written by `review.ts open`, read by api.ts. */
export interface ReviewConfig {
  name: string;
  skillDir: string;
  repos: { name: string; path: string; range: string }[];
}

/** order.json: written by the agent. Commits match by subject (stable across rewrites) or SHA prefix. */
export interface OrderFile {
  /** The GitHub repo (owner/name) and PR number, for the walkthrough's links; no number links to the compare view. */
  pr?: { repo: string; number?: number };
  /** Where to look, for the PR body: each line optional, said in plain words. */
  lookHere?: { start?: string; skip?: string; unsure?: string; feedback?: string };
  /** The story: steps in reading order, each one sentence over one or more hunks (by spoken ID). `lines` windows a long hunk to new-file line ranges. */
  tour?: { hunks: string[]; say: string; lines?: [number, number][] }[];
  commits?: {
    match: string;
    repo?: string;
    why?: string;
    files?: { path: string; why?: string }[];
  }[];
}

export interface MarkRecord {
  mark: Mark;
  kind: "hunk" | "file";
  repo: string;
  path: string;
  id: string;
  lines: string[];
  note?: string;
  at: string;
}

/** .viz-data/state.json */
export interface ReviewState {
  marks: Record<string, MarkRecord>;
  replies: Record<string, { text: string; at: string; line?: number }>;
}

export interface MarkBody {
  fp: string;
  kind: "hunk" | "file";
  /** null clears the mark. */
  mark: Mark | null;
  note?: string;
  /** The fingerprint of the mark this one answers (an addressed or changed hunk's `was.fp`); it is retired. */
  replaces?: string;
}

export interface Routes {
  "/review": { body: null; reply: ReviewView };
  "/mark": { body: MarkBody; reply: { ok: true } };
  /** A file's lines at a commit (the new side), for expanding context; null when it doesn't exist there. */
  "/file": {
    body: null;
    query: { repo: string; sha: string; path: string };
    reply: { lines: string[] | null };
  };
}
