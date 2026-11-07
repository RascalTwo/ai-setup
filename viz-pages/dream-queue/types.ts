// Shapes shared by api.ts (which produces them) and queue.ts (which renders them).
// A file of its own so the page can import them without pulling the backend's node types in.

/** A proposal as the page sees it: every field present and of its stated type. */
export type Proposal = {
  id: string;
  title: string;
  rationale: string;
  evidence: string[];
  occurrences: number;
  blast_radius: string;
  rank: number;
  branch: string;
  branch_ok: boolean;
  conflicts_with: string[];
  status: string;
  created: string | null;
  approved_at: string | null;
  stale_reason: string | null;
};

/** One row's diff size for /diffstat: counts, "from a plan file", or why it can't be sized. */
export type Stat = { files: number; add: number; del: number } | { plan: true } | { error: string };
