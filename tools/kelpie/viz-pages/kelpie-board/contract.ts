// The board's routes, shared by api.ts and app.ts. Status is `kelpie status --json` as is.
/* oxlint-disable import/no-relative-parent-imports -- the board ships inside the CLI whose output it reads */
import type { Status } from "../../status-shape.js";

export type { Loose, Row, Section, Stale, Status } from "../../status-shape.js";
export type Verb =
  | "refine"
  | "build"
  | "refine-next"
  | "build-next"
  | "pause"
  | "resume"
  | "more"
  | "less"
  | "for-agent"
  | "assign"
  | "keep"
  | "drop"
  | "later";
// What a "Needs you" card can say on your behalf, in your words: `reply` is `kelpie page`, the rest are the CLI verbs of the same name.
// `signoff-now` and `signoff-hold` are `signoff --now` and `--hold`: when the build starts.
export type Words = "approve" | "signoff" | "signoff-now" | "signoff-hold" | "reply" | "park" | "close";
export type Board = {
  status: Status;
  pages: Record<string, string>; // task id → its spec or demo page URL, where one exists
  tracker: string; // the plan in Timeline Studio, `<page>#<token>`; add `&{"task":id}` to open one task
};
export type ProjectFile = { id: string; retired: boolean; text: string };
export type ProjectOp =
  | { op: "save" | "new"; id: string; text: string }
  | { op: "retire" | "restore"; id: string }
  | { op: "move"; id: string; way: "up" | "down" };
export interface Routes {
  "/projects": { body: null; reply: ProjectFile[] };
  "/project": { body: ProjectOp; reply: { ok: boolean; out: string } };
  "/board": { body: null; reply: Board };
  "/act": { body: { verb: Verb; arg?: string; to?: string }; reply: { ok: boolean; out: string } };
  "/answer": {
    body: { verb: Words; project: string; id: string; text: string };
    reply: { ok: boolean; out: string };
  };
  "/focus": { body: { pane: string }; reply: { ok: boolean; out: string } };
}
