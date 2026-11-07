// Types shared by pr-viz.ts and its sibling modules: plan.json, the build's JSON files, and the
// page's hash. Type-only, so the browser never fetches this file.

// ---- plan.json ----
// "look" is Where to look; "check" is Check these ("verdict" is the older name for it).
export type Section = "why" | "what" | "look" | "how" | "proof" | "risk" | "check" | "verdict";
/** A tone-<name> class from pr-viz.css ("good", "bad", "info", "muted", "teal", …). */
export type Tone = string;

export interface Plan {
  pr?: { number?: number; title?: string; repo?: string; url?: string; head?: string };
  /** Acceptance criteria. */
  criteria?: Criterion[];
  /** The older name for `criteria`. */
  behaviors?: Criterion[];
  /** Glossary for {{c:id|words}} marks: id → definition. */
  concepts?: Record<string, string>;
  /** The title of the scene that alone tells a stranger what the PR does. */
  hero?: string;
  /** Where to look: the four lines a reviewer reads before the diff (r2-pr's body carries them too). */
  lookHere?: LookHere;
  scenes?: PlanScene[];
}
export interface LookHere {
  start?: string;
  skip?: string;
  unsure?: string;
  feedback?: string;
}
export interface Criterion {
  id: string;
  title: string;
  status?: string;
  proof?: string[];
  gap?: string;
}

/** Fields every scene kind has. `at` on an item is the say line (0-based) it appears on. */
export interface SceneBase {
  title: string;
  section?: Section;
  heading?: string | false;
  subheading?: string;
  /** The script: one beat per line. "[words](target)" marks point at things as they're spoken. */
  say?: string[];
  /** Picked for the short cut. */
  short?: boolean;
  /** false keeps it off the poster. */
  poster?: boolean;
  zoom?: number;
}
export interface Card {
  title: string;
  body?: string;
  badge?: string;
  tone?: Tone;
  at?: number;
}
export interface TourEntry {
  say: string;
  hunk?: string;
  hunks?: string[];
  order?: string[];
  lines?: [number, number][];
}
export type PlanScene = SceneBase &
  (
    | { kind: "statement"; big: string; sub?: string; chips?: string[] }
    | {
        kind: "compare";
        beforeLabel?: string;
        afterLabel?: string;
        rows?: { label?: string; before?: string; after?: string; note?: string; at?: number }[];
      }
    | {
        kind: "chat";
        messages?: { who: "q" | "a"; text: string; badge?: string; tone?: Tone; at?: number }[];
      }
    | {
        kind: "pipeline";
        rows: {
          label?: string;
          steps: string[];
          group?: { label: string; from: number; to: number };
          note?: string;
          at?: number;
        }[];
      }
    | {
        kind: "rules";
        rows?: { name: string; in: string; out: string; test?: string; at?: number }[];
      }
    | {
        kind: "bars";
        rows?: {
          label: string;
          sub?: string;
          parts: { n: number; tone?: Tone; text?: string }[];
          tag?: string;
          at?: number;
        }[];
        limit?: { n: number; label?: string };
        legend?: { tone?: Tone; text: string }[];
        note?: string;
      }
    | { kind: "cards"; items?: Card[] }
    | {
        kind: "steps";
        nodes?: { title: string; sub?: string; tone?: Tone; at?: number }[];
        items?: Card[];
      }
    | { kind: "checklist"; items?: string[] }
    | { kind: "trace" }
    | { kind: "look"; rows?: (keyof LookHere)[] }
    | { kind: "tour"; entries?: TourEntry[]; view?: "3d" }
    | {
        kind: "flow";
        from?: { label?: string; text?: string };
        via?: string;
        to?: { label?: string; mode?: "drop" | "keep"; badge?: string; tone?: Tone };
        ask?: { q?: string; a: string; badge?: string; tone?: Tone };
        cards?: Card[];
      }
    | { kind: "callgraph"; helpers?: string[] }
    | { kind: "fixture"; pages?: { file: string; page?: number; at?: number }[] }
    | { kind: "custom"; html: string; js?: string }
  );
/** A scene as placed in the film: its index, its lines, and its first beat. */
export type Scene = PlanScene & {
  i: number;
  lines: string[];
  b0: number;
  slots?: Record<number, number>;
};
export type SceneOf<K extends Scene["kind"]> = Extract<Scene, { kind: K }>;
/** A custom scene's module: `export default (el, scene, { mode, kit }) => …`. */
export type CustomModule = (
  el: HTMLElement,
  s: SceneOf<"custom">,
  ctx: { mode: Mode; kit: (name: string) => Promise<unknown> },
) => unknown;

// ---- hunks.json, callgraph.json, fixtures.json (written by build.ts) ----
/** [op, old line number, new line number, text]. */
export type Line = [op: "+" | "-" | " ", old: number | null, now: number | null, text: string];
export interface Hunk {
  id: string;
  file: string;
  header?: string;
  add: number;
  del: number;
  newStart?: number;
  lines: Line[];
}
export interface Diff {
  files: { path: string; kind: string; add: number; del: number; hunks: Hunk[] }[];
}
export type CGNode = { id: string; name: string; changed?: boolean } & (
  | { kind: "helper"; copies: { path: string; line: number }[] }
  | { kind: "entry" | "caller"; path: string; depth?: number }
);
export interface CallGraph {
  helper: string;
  nodes: CGNode[];
  edges: { from: string; to: string }[];
  tests?: Record<string, [test: string, via: string][]>;
}
export interface FixturePage {
  png: string;
  dpi: number;
  size: [number, number];
  crop: [number, number, number, number];
  mediabox: [number, number, number, number];
  annots: { rect: [number, number, number, number]; uri: string }[];
  malformed: { kind: string; detail?: string }[];
}
export interface Fixture {
  copies: string[];
  pages?: FixturePage[];
}

export type Mode = "film" | "review" | "poster";
/** What the page keeps in the URL hash. */
export interface Hash {
  mode: Mode;
  cut: "short";
  chapter: number;
  autoplay: boolean;
  only: boolean;
  scene: number;
  t: number;
}
/** What a "viz-frame" event from film() carries. */
export interface FrameDetail {
  t: number;
  start: (beat: number) => number;
}
