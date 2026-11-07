// The shape of `kelpie status --json`. No imports, so the board (viz-pages/kelpie-board) can share it.
export type Section = "building" | "refining" | "waiting" | "buildQueue" | "refineQueue" | "blocked" | "finished";
export type Row = {
  id: string; label: string; section: Section; refine: boolean; pane: string | null;
  at: string | null; // Kelpie's last comment on it: when it last moved
  note: string; due: string | null; rank: number | null; blockedBy: string[];
  whyNotBuild: string | null; whyNotRefine: string | null; // null = its button works
};
export type ProjectStatus = { id: string; priority: number | null; pastGate: boolean; active: boolean; paused: boolean; dredge: string | null; rows: Row[] };
export type Status = { paused: boolean; gate: { open: boolean; why: string }; active: number; ship: string | null; projects: ProjectStatus[] };
