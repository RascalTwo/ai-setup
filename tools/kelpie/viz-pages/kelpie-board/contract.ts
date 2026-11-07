// The board's routes, shared by api.ts and app.ts. Status is `kelpie status --json` as is.
/* oxlint-disable import/no-relative-parent-imports -- the board ships inside the CLI whose output it reads */
import type { Status } from "../../status-shape.js";

export type { Row, Section, Status } from "../../status-shape.js";
export type Verb =
  | "refine"
  | "build"
  | "refine-next"
  | "build-next"
  | "pause"
  | "resume"
  | "more"
  | "less";
export type Board = {
  status: Status;
  pages: Record<string, string>; // task id → its spec or walkthrough page URL, where one exists
  tracker: string; // the plan in Timeline Studio, `<page>#<token>`; add `&{"task":id}` to open one task
};
export interface Routes {
  "/board": { body: null; reply: Board };
  "/act": { body: { verb: Verb; arg?: string }; reply: { ok: boolean; out: string } };
  "/focus": { body: { pane: string }; reply: { ok: boolean; out: string } };
}
