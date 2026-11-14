// The shape of `kelpie status --json`. No imports, so the board (viz-pages/kelpie-board) can share it.
export type Section = "building" | "refining" | "waiting" | "buildQueue" | "refineQueue" | "blocked" | "finished";
export type Row = {
  id: string; label: string; section: Section; refine: boolean; pane: string | null;
  at: string | null; // Kelpie's last comment on it: when it last moved
  note: string; due: string | null; rank: number | null; blockedBy: string[];
  whyNotBuild: string | null; whyNotRefine: string | null; // null = its button works
  // Waiting on you (not "your reply is on its way"): which handoff it is, and its text without the `[dispatch]` header.
  handoff: "review" | "questions" | "stalled" | "idle" | null; handover: string | null;
};
export type ProjectStatus = { id: string; priority: number | null; pastGate: boolean; active: boolean; paused: boolean; publishes: boolean; dredge: string | null; rows: Row[] };
export type Loose = { id: string; label: string; status: string; project: string | null }; // status: todo | running | paused
// "Still want this?": a queued task untouched for 14 days. Each answer is a CLI command the board runs as is.
export type Stale = { id: string; label: string; project: string; touched: string; keep: string; drop: string; later: string };
export type Status = {
  paused: boolean; gate: { open: boolean; why: string }; active: number; ship: string | null; projects: ProjectStatus[];
  // Open tasks Kelpie never runs: For Agent but in no project's colour; in a project but not For Agent; neither.
  stale: Stale[]; // across the projects shown, least recently touched first
  outside: { orphan: Loose[]; notAgent: Loose[]; other: Loose[] };
};
