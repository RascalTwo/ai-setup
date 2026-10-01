// pr-viz.ts — renders plan.json as a narrated film (the default), a review document
// (hash {"mode":"review"}) or a poster (hash {"mode":"poster"}). One set of scenes, three ways
// to read them: the film plays them with narration; the review page lays the same scenes out
// with the transcript, the full diff, and "reviewed" checkboxes; the poster is the review page
// with only the pictures — every scene finished, one image a PR can show (scripts/stills.ts).
//
// Scene kinds and their fields: pr-viz/reference/scenes.md. The types below are the same
// shapes, as this file reads them.

import { $, $$, esc, loadHash, saveHash, type Manifest } from "/_kit/viz.js";
import { film, type CursorFrame, type Film } from "/_kit/film.js";
import type { HLJSApi } from "highlight.js";

// ---- plan.json ----
type Section = "why" | "what" | "how" | "proof" | "risk" | "verdict";
/** A tone-<name> class from pr-viz.css ("good", "bad", "info", "muted", "teal", …). */
type Tone = string;

interface Plan {
  pr?: { number?: number; title?: string; repo?: string; url?: string; head?: string };
  /** Acceptance criteria. */
  criteria?: Criterion[];
  /** The older name for `criteria`. */
  behaviors?: Criterion[];
  /** Glossary for {{c:id|words}} marks: id → definition. */
  concepts?: Record<string, string>;
  /** The title of the scene that alone tells a stranger what the PR does. */
  hero?: string;
  scenes?: PlanScene[];
}
interface Criterion { id: string; title: string; status?: string; proof?: string[]; gap?: string }

/** Fields every scene kind has. `at` on an item is the say line (0-based) it appears on. */
interface SceneBase {
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
interface Card { title: string; body?: string; badge?: string; tone?: Tone; at?: number }
interface TourEntry { say: string; hunk?: string; hunks?: string[]; order?: string[]; lines?: [number, number][] }
type PlanScene = SceneBase & (
  | { kind: "statement"; big: string; sub?: string; chips?: string[] }
  | { kind: "compare"; beforeLabel?: string; afterLabel?: string; rows?: { label?: string; before?: string; after?: string; note?: string; at?: number }[] }
  | { kind: "chat"; messages?: { who: "q" | "a"; text: string; badge?: string; tone?: Tone; at?: number }[] }
  | { kind: "pipeline"; rows: { label?: string; steps: string[]; group?: { label: string; from: number; to: number }; note?: string; at?: number }[] }
  | { kind: "rules"; rows?: { name: string; in: string; out: string; test?: string; at?: number }[] }
  | { kind: "bars"; rows?: { label: string; sub?: string; parts: { n: number; tone?: Tone; text?: string }[]; tag?: string; at?: number }[];
      limit?: { n: number; label?: string }; legend?: { tone?: Tone; text: string }[]; note?: string }
  | { kind: "cards"; items?: Card[] }
  | { kind: "steps"; nodes?: { title: string; sub?: string; tone?: Tone; at?: number }[]; items?: Card[] }
  | { kind: "checklist"; items?: string[] }
  | { kind: "trace" }
  | { kind: "tour"; entries?: TourEntry[]; view?: "3d" }
  | { kind: "flow"; from?: { label?: string; text?: string }; via?: string; to?: { label?: string; mode?: "drop" | "keep"; badge?: string; tone?: Tone };
      ask?: { q?: string; a: string; badge?: string; tone?: Tone }; cards?: Card[] }
  | { kind: "callgraph"; helpers?: string[] }
  | { kind: "fixture"; pages?: { file: string; page?: number; at?: number }[] }
  | { kind: "custom"; html: string; js?: string }
);
/** A scene as placed in the film: its index, its lines, and its first beat. */
type Scene = PlanScene & { i: number; lines: string[]; b0: number; slots?: Record<number, number> };
type SceneOf<K extends Scene["kind"]> = Extract<Scene, { kind: K }>;
/** A custom scene's module: `export default (el, scene, { mode, kit }) => …`. */
type CustomModule = (el: HTMLElement, s: SceneOf<"custom">, ctx: { mode: Mode; kit: (name: string) => Promise<unknown> }) => unknown;

// ---- hunks.json, callgraph.json, fixtures.json (written by build.ts) ----
/** [op, old line number, new line number, text]. */
type Line = [op: "+" | "-" | " ", old: number | null, now: number | null, text: string];
interface Hunk { id: string; file: string; header?: string; add: number; del: number; newStart?: number; lines: Line[] }
interface Diff { files: { path: string; kind: string; add: number; del: number; hunks: Hunk[] }[] }
type CGNode = { id: string; name: string; changed?: boolean } & (
  | { kind: "helper"; copies: { path: string; line: number }[] }
  | { kind: "entry" | "caller"; path: string; depth?: number });
interface CallGraph { helper: string; nodes: CGNode[]; edges: { from: string; to: string }[]; tests?: Record<string, [test: string, via: string][]> }
interface FixturePage {
  png: string; dpi: number; size: [number, number]; crop: [number, number, number, number]; mediabox: [number, number, number, number];
  annots: { rect: [number, number, number, number]; uri: string }[]; malformed: { kind: string; detail?: string }[];
}
interface Fixture { copies: string[]; pages?: FixturePage[] }

type Mode = "film" | "review" | "poster";
/** What the page keeps in the URL hash. */
interface Hash { mode: Mode; cut: "short"; chapter: number; autoplay: boolean; only: boolean; scene: number; t: number }
/** What a "viz-frame" event from film() carries. */
interface FrameDetail { t: number; start: (beat: number) => number }

declare global { interface Window { hljs?: HLJSApi } }
declare const hljs: HLJSApi;

const plan: Plan = await fetch("plan.json").then((r) => r.json());
const diff: Diff = await fetch("hunks.json").then((r) => (r.ok ? r.json() : { files: [] }), () => ({ files: [] }));
// Add-on output (addons/, written by build.ts when the change has Python code / PDF fixtures).
const callgraphs: { graphs: CallGraph[] } = await fetch("callgraph.json").then((r) => (r.ok ? r.json() : { graphs: [] }), () => ({ graphs: [] }));
const fixtures: { fixtures: Record<string, Fixture> } = await fetch("fixtures.json").then((r) => (r.ok ? r.json() : { fixtures: {} }), () => ({ fixtures: {} }));
const ptName = (x: string) => String(x).replace(/[^\w.-]/g, "_");

// Acceptance criteria ("behaviors" is the older name for the same list).
const criteria = plan.criteria ?? plan.behaviors ?? [];
const hunkById = new Map(diff.files.flatMap((f) => f.hunks.map((h): [string, Hunk] => [h.id, h])));
const hunkOrder = new Map(diff.files.flatMap((f) => f.hunks).map((h, i): [string, number] => [h.id, i]));

// ---- syntax highlighting (highlight.js, the viz kit's pick — reference/assets/code-highlighting.md) ----
// A hunk is highlighted as one text, so a docstring spanning lines colours correctly, then split
// back into lines with every open <span> closed at each line end and reopened on the next.
const HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0";
document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${HLJS}/styles/atom-one-dark.min.css">`);
await new Promise((ok) => document.head.append(Object.assign(document.createElement("script"), { src: `${HLJS}/highlight.min.js`, onload: ok, onerror: ok })));
const LANG: Record<string, string> = { py: "python", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", go: "go", rs: "rust",
  java: "java", kt: "kotlin", rb: "ruby", cs: "csharp", php: "php", sh: "bash", bash: "bash", yml: "yaml", yaml: "yaml", json: "json",
  toml: "ini", ini: "ini", md: "markdown", css: "css", scss: "scss", html: "xml", xml: "xml", sql: "sql", tf: "ini", dockerfile: "dockerfile" };
const langOf = (file: string) => LANG[(/\.([\w]+)$/.exec(file)?.[1] ?? file.split("/").pop()!).toLowerCase()];
function splitBalanced(html: string) {
  const out: string[] = [], stack: string[] = [];
  let cur = "";
  for (const t of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+/g) ?? []) {
    if (t === "\n") { out.push(cur + "</span>".repeat(stack.length)); cur = stack.join(""); }
    else if (t.startsWith("<span")) { stack.push(t); cur += t; }
    else if (t === "</span>") { stack.pop(); cur += t; }
    else cur += t;
  }
  return [...out, cur];
}
const codeOf = new Map<string, string[]>(); // hunk id → highlighted line HTML, same order as h.lines
function code(h: Hunk, k: number) {
  if (!codeOf.has(h.id)) {
    const lang = langOf(h.file), text = h.lines.map((l) => l[3]).join("\n");
    const html = window.hljs && lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : esc(text);
    codeOf.set(h.id, splitBalanced(html));
  }
  return codeOf.get(h.id)![k] ?? "";
}
// One numbering on screen — the file as it will be. A removed line shows no number (its old
// one is in data-old, for pointers: "-42"), so "-62 +88" never reads as two different files.
const lineHTML = (h: Hunk, l: Line) => `<span class="l ${l[0] === "+" ? "add" : l[0] === "-" ? "del" : ""}"${l[0] === "-" ? ` data-old="${l[1]}"` : ""}><em>${l[0] === "-" ? "" : l[2] ?? ""}</em><i>${l[0] === " " ? " " : l[0]}</i>${code(h, h.lines.indexOf(l)) || " "}</span>`;
const mode: Mode = (["review", "poster"] as (Mode | undefined)[]).includes(loadHash<Hash>().mode) ? loadHash<Hash>().mode! : "film";
const poster = mode === "poster";
document.title = `${plan.pr?.number ? `#${plan.pr.number} ` : ""}${plan.pr?.title ?? "Change review"}`;

// Pointer marks in say lines: "[finds every link](L40-41)" is spoken as "finds every link" while
// lines 40–41 light up; "(@name)" points at an element with data-pt="name" instead.
const MARK = /\[([^\]]+)\]\(([^)]+)\)/g;
const spoken = (line: string) => line.replace(MARK, "$1");

// Inline markup for every text field: **strong**, `code`, {{c:concept-id|words}} (a glossary hover).
// Takes anything and String()s it, as a plan's text fields sometimes hold a number.
const md = (s: unknown = "") => esc(String(s))
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\{\{c:([\w-]+)\|([^}]+)\}\}/g, (_: string, id: string, t: string) => `<abbr title="${esc(plan.concepts?.[id] ?? "")}">${t}</abbr>`)
  .replace(MARK, "<u>$1</u>")
  .replace(/\n/g, "<br>");
const tone = (t: Tone | undefined) => (t ? ` tone-${t}` : "");
// The kit keeps page state in the hash as JSON (saveHash/loadHash); mode links use the same.
const hashFor = (obj: Partial<Hash>) => "#" + encodeURIComponent(JSON.stringify(obj));
const go = (obj: Partial<Hash>) => { location.hash = hashFor(obj).slice(1); location.reload(); };

// ---- beats: every say line (or tour entry) is one beat, numbered across the whole film ----
let next = 1;
const scenes = (plan.scenes ?? []).map((s, i): Scene => {
  const lines = s.kind === "tour" ? (s.entries ?? []).map((e) => e.say) : (s.say ?? []);
  const sc: Scene = { ...s, i, lines, b0: next };
  if (s.kind === "tour") {
    // Unique hunks: a long one walked in windows (`lines`) is still one hunk.
    const n = new Set((s.entries ?? []).flatMap((e) => e.hunks ?? [e.hunk])).size;
    const windowed = (s.entries ?? []).some((e) => e.lines);
    sc.heading ??= "Diff tour";
    sc.subheading ??= windowed
      ? `all ${n} production hunks, in ${lines.length} steps · long files in excerpts; the review page has every line`
      : `every changed line of code · all ${n} production hunks, in ${lines.length} steps`;
  }
  next += lines.length;
  return sc;
});
// ---- the short cut (hash {"cut":"short"}): Why, the headline What, the Verdict ----
// For whoever won't sit through the full film. Scenes keep the beat numbers above, so the cut
// reuses the full film's compiled clips and says nothing new. `"short": true` on scenes picks
// them by hand; without any, the first Why and first What scenes, the hero, and the Verdict.
const flagged = scenes.filter((s) => s.short);
const first = (sec: Section) => scenes.find((x) => (x.section ?? "what") === sec);
const shortScenes = flagged.length ? flagged
  : scenes.filter((s) => s === first("why") || s === first("what") || s.title === plan.hero || s.section === "verdict");
const filmScenes = loadHash<Hash>().cut === "short" ? shortScenes : scenes;

/**
 * When an item appears: on the scene's `line` (0-based) if given, else item i on line i while
 * lines last. Items that share a line queue up on it, 0.7s apart, in the order they're drawn.
 */
function at(s: Scene, i: number, line?: number, extra = 0) {
  const l = line ?? Math.min(i, s.lines.length - 1);
  s.slots ??= {};
  const k = (s.slots[l] = (s.slots[l] ?? -1) + 1);
  return `data-b="${s.b0 + l}" data-d="${(0.3 + 0.7 * k + extra).toFixed(2)}"`;
}

// ---- word diff for compare: unchanged words muted, changed words marked ----
function wordDiff(a: string, b: string) {
  // Words, whitespace and punctuation are separate tokens, so "Rectangle." vs "Rectangle (url)."
  // marks only the added "(url)", not the word next to it.
  // (Sentence punctuation only at a word's end — a URL's dots stay inside the URL.)
  const tok = (x: string) => String(x).split(/(\s+|[()[\]"']|[.,;:!?](?=\s|$))/).filter((t) => t !== "");
  const A = tok(a), B = tok(b);
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const left: [string, boolean][] = [], right: [string, boolean][] = []; // [token, changed]
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { left.push([A[i++]!, false]); right.push([B[j++]!, false]); }
    else if (j < B.length && (i >= A.length || L[i]![j + 1]! >= L[i + 1]![j]!)) right.push([B[j++]!, true]);
    else left.push([A[i++]!, true]);
  }
  // One highlight per changed phrase: glue (a space, a comma) between two changes joins the run,
  // so the mark never breaks mid-phrase; then each run is one <del>/<ins>.
  const runs = (side: [string, boolean][], tag: string) => {
    const glue = (t: string) => /^(\s+|[.,;:!?()[\]"'])$/.test(t);
    side.forEach((x, k) => { if (!x[1] && glue(x[0]) && side[k - 1]?.[1] && side.slice(k + 1).find((y) => !glue(y[0]) || y[1])?.[1]) x[1] = true; });
    let out = "", open = false;
    for (const [t, ch] of side) {
      if (ch && !open) { out += `<${tag}>`; open = true; }
      if (!ch && open) { out += `</${tag}>`; open = false; }
      out += md(t);
    }
    return out + (open ? `</${tag}>` : "");
  };
  return [runs(left, "del"), runs(right, "ins")] as const;
}

// ---- renderers: one HTML string per kind, identical in both modes ----
const R: { [K in Scene["kind"]]: (s: SceneOf<K>) => string } = {
  statement: (s) => `<div class="k-statement"><div class="big" ${at(s, 0)}>${md(s.big)}</div>${s.sub ? `<div class="sub" ${at(s, 0, 0)}>${md(s.sub)}</div>` : ""}
    <div class="chips">${(s.chips ?? []).map((c, i) => `<span ${at(s, i + 1)}>${md(c)}</span>`).join("")}</div></div>`,

  compare: (s) => `<div class="k-compare">${(s.rows ?? []).map((r, i) => {
    const [l, rt] = wordDiff(r.before ?? "", r.after ?? "");
    return `<div class="row" data-pt="${i + 1}" ${at(s, i, r.at)}>${r.label ? `<div class="lbl">${md(r.label)}</div>` : ""}
      <div class="pair"><div class="side before"><span class="tag">${md(s.beforeLabel ?? "Before")}</span><div class="txt">${l || "<i>(nothing)</i>"}</div></div>
      <div class="side after" ${at(s, i, r.at, 0.8)}><span class="tag">${md(s.afterLabel ?? "After")}</span><div class="txt">${rt || "<i>(nothing)</i>"}</div></div></div>
      ${r.note ? `<div class="note">${md(r.note)}</div>` : ""}</div>`;
  }).join("")}</div>`,

  chat: (s) => `<div class="k-chat">${(s.messages ?? []).map((m, i) => `<div class="bubble ${m.who === "q" ? "q" : "a"}" ${at(s, i, m.at)}>${md(m.text)}${m.badge ? ` <span class="badge${tone(m.tone)}">${md(m.badge)}</span>` : ""}</div>`).join("")}</div>`,

  pipeline: (s) => `<div class="k-pipeline">${(s.rows ?? []).map((r, ri) => {
    const prev = new Set(s.rows[ri - 1]?.steps ?? []), nxt = new Set(s.rows[ri + 1]?.steps ?? []);
    const cls = (st: string) => (ri > 0 ? (prev.has(st) ? "same" : "new") : nxt.size && !nxt.has(st) ? "old" : "same");
    // group: { label, from, to } — a dashed box around steps from..to (0-based), e.g. the two
    // steps an old library call did inside itself, labelled with that call.
    const g = r.group;
    return `<div class="prow" ${at(s, ri, r.at)}><div class="plbl">${md(r.label ?? "")}</div><div class="steps">${r.steps.map((st, k) =>
      `${k && !(g && k === g.from) ? '<span class="ar">→</span>' : ""}${g && k === g.from ? `${k ? '<span class="ar">→</span>' : ""}<span class="grp"><span class="glbl">${md(g.label)}</span>` : ""}<span class="step ${cls(st)}" data-step="${esc(st)}">${md(st)}</span>${g && k === g.to ? "</span>" : ""}`).join("")}</div>${r.note ? `<div class="note">${md(r.note)}</div>` : ""}</div>`;
  }).join("")}<svg class="links"></svg></div>`,

  rules: (s) => `<div class="k-rules">${(s.rows ?? []).map((r, i) => `<div class="rrow" data-pt="${i + 1}" ${at(s, i, r.at)}><div class="name">${md(r.name)}</div>
    <div class="in">${md(r.in)}</div><div class="to">→</div><div class="out">${md(r.out)}</div>${r.test ? `<div class="test">✓ ${md(r.test)}</div>` : ""}</div>`).join("")}</div>`,

  bars: (s) => {
    const max = Math.max(...(s.rows ?? []).map((r) => r.parts.reduce((a, p) => a + p.n, 0)), s.limit?.n ?? 0, 1);
    // limit: a dashed threshold across every bar ({ n, label }), e.g. a size cap a change can cross.
    const lim = (first: boolean) => (s.limit ? `<span class="limit" style="left:${(s.limit.n / max) * 100}%">${first ? `<b>${md(s.limit.label ?? String(s.limit.n))}</b>` : ""}</span>` : "");
    return `<div class="k-bars">${(s.rows ?? []).map((r, i) => `<div class="brow" data-pt="${i + 1}" ${at(s, i, r.at)}><div class="blbl">${md(r.label)}${r.sub ? `<small>${md(r.sub)}</small>` : ""}</div>
      <div class="btrack">${r.parts.map((p) => `<span class="bar${tone(p.tone)}" style="--w:${(p.n / max) * 100}%">${md(p.text ?? String(p.n))}</span>`).join("")}${lim(i === 0)}</div>${r.tag ? `<div class="btag">${md(r.tag)}</div>` : ""}</div>`).join("")}
      ${s.legend ? `<div class="legend" ${at(s, (s.rows ?? []).length)}>${s.legend.map((l) => `<span><i class="bar${tone(l.tone)}"></i>${md(l.text)}</span>`).join("")}</div>` : ""}
      ${s.note ? `<div class="bnote" ${at(s, (s.rows ?? []).length + 1)}>${md(s.note)}</div>` : ""}</div>`;
  },

  cards: (s) => `<div class="k-cards">${(s.items ?? []).map((c, i) => `<div class="card${tone(c.tone)}" data-pt="${i + 1}" ${at(s, i, c.at)}>${c.badge ? `<span class="badge${tone(c.tone)}">${md(c.badge)}</span>` : ""}<b>${md(c.title)}</b><div>${md(c.body ?? "")}</div></div>`).join("")}</div>`,

  steps: (s) => `<div class="k-steps"><div class="line" ${at(s, 0)}></div><div class="nodes">${(s.nodes ?? []).map((n, i) => `<div class="node${tone(n.tone)}" data-pt="${i + 1}" ${at(s, i, n.at)}><i></i><b>${md(n.title)}</b><small>${md(n.sub ?? "")}</small></div>`).join("")}</div>
    ${s.items ? `<div class="k-cards small">${s.items.map((c, i) => `<div class="card${tone(c.tone)}" ${at(s, i + (s.nodes ?? []).length, c.at)}><b>${md(c.title)}</b><div>${md(c.body ?? "")}</div></div>`).join("")}</div>` : ""}</div>`,

  checklist: (s) => `<div class="k-check">${(s.items ?? []).map((c, i) => `<div ${at(s, i)}>${md(c)}</div>`).join("")}</div>`,

  // Trace: every acceptance criterion, what proves it, and how well — built from plan.criteria.
  trace: (s) => `<div class="k-trace">${criteria.map((b, i) => `<div class="trow st-${b.status ?? "tested"}" data-pt="${esc(b.id)}" ${at(s, i)}>
    <span class="bid">${esc(b.id)}</span><span class="btitle">${md(b.title)}</span>
    <span class="ev">${(b.proof ?? []).map((p) => `<span>${md(p)}</span>`).join("")}${b.gap ? `<span class="gap">${md(b.gap)}</span>` : ""}</span></div>`).join("")}</div>`,

  // The diff tour: one entry per beat, each fading out as the next arrives. An entry shows
  // one hunk, or several: identical bodies (a helper copied into three modules) are drawn once
  // and labelled with every file; different ones stack.
  tour: (s) => {
    const entries = s.entries ?? [], total = entries.length;
    const changed = (h: Hunk) => h.lines.filter((l) => l[0] !== " ").map((l) => l[0] + l[3].trim()).filter((x) => x.length > 1);
    // Same code in several files (a helper copied per module): drawn once, labelled with every
    // file; anything a copy changes beyond the shared code is shown under it, so nothing hides.
    const sameCode = (a: Hunk, b: Hunk) => { const A = new Set(changed(a)), B = changed(b); const hit = B.filter((x) => A.has(x)).length;
      return hit >= 0.8 * Math.min(A.size, B.length) && hit > 2; };
    // On film, only the changed lines and one line either side ("⋯" marks a gap).
    const trim = (h: Hunk, only?: Set<Line>) => { const keep = h.lines.map((l, j) => (only ? only.has(l) : h.lines.slice(Math.max(0, j - 1), j + 2).some((x) => x[0] !== " ")));
      const out: (Line | null)[] = []; let gap = false;
      h.lines.forEach((l, j) => { if (keep[j]) { if (gap && out.length) out.push(null); out.push(l); gap = false; } else gap = true; });
      return out; };
    // A window onto a long hunk (a whole new file): only the new-file lines in `lines`, so one
    // file can be walked over several beats. Without one, the changed lines and their context.
    const win = (h: Hunk, e: TourEntry) => (e.lines ? trim(h, new Set(h.lines.filter((l) => l[2] !== null && e.lines!.some(([a, b]) => l[2]! >= a && l[2]! <= b)))) : trim(h));
    const pre = (h: Hunk, rows: (Line | null)[]) => `<pre>${rows.map((l) => (l === null ? `<span class="l gap">⋯</span>` : lineHTML(h, l))).join("")}</pre>`;
    const t3d = s.view === "3d"; // a 3D tour keeps every panel standing; the camera moves instead
    return `<div class="k-tour${t3d ? " t3d" : ""}">${entries.map((e, i) => {
      // Hunks on one beat read top to bottom in file order (diff order), whatever order the plan
      // lists them in — an import listed after its use would read backwards.
      const hs = ((e.hunks ?? [e.hunk!]).map((id) => hunkById.get(id)).filter(Boolean) as Hunk[]).sort((a, b) => hunkOrder.get(a.id)! - hunkOrder.get(b.id)!);
      const groups: Hunk[][] = [];
      for (const h of hs) { const g = groups.find((g) => sameCode(g[0]!, h) || sameCode(h, g[0]!)); g ? g.push(h) : groups.push([h]); }
      return `<div class="hunk" data-b="${s.b0 + i}" data-d="0.1"${i < total - 1 && !t3d ? ` data-x="${s.b0 + i + 1}"` : ""}>
        <div class="hhead">${i + 1} / ${total}</div>
        ${groups.map((g, gi) => {
          const rep = g.reduce((a, b) => (changed(b).length > changed(a).length ? b : a)), shared = new Set(changed(rep));
          // Another change in the file just shown: no second header (that read as a second file) —
          // a gap marker saying how much is skipped, and which function this change is in.
          const prev = groups[gi - 1];
          if (g.length === 1 && prev?.length === 1 && prev[0]!.file === rep.file) {
            // Counted from the lines actually on screen, so the numbers either side agree with it.
            const shown = (h: Hunk) => win(h, e).filter((l) => l && l[2]).map((l) => l![2]!);
            const end = Math.max(...shown(prev[0]!)), next = Math.min(...shown(rep));
            return `<div class="hgap">⋯ lines ${end + 1}–${next - 1} not shown${rep.header ? ` · in <code>${esc(rep.header.replace(/:$/, ""))}</code>` : ""} ⋯</div>${pre(rep, win(rep, e))}`;
          }
          const also = groups.slice(gi + 1).filter((x) => x.length === 1 && x[0]!.file === rep.file).length;
          const extra = g.filter((h) => h !== rep).map((h) => {
            // Blank lines are shared by nature — only a copy's real extra lines count as its own.
            const own = new Set(h.lines.filter((l) => l[0] !== " " && l[3].trim() && !shared.has(l[0] + l[3].trim())));
            return own.size ? `<div class="hfile only"><span class="file">only in ${esc(h.file)}</span></div>${pre(h, trim(h, own))}` : "";
          }).join("");
          return `<div class="hfile"><span class="file">${[rep, ...g.filter((h) => h !== rep)].map((x) => esc(x.file)).join("<br>")}</span>${g.length > 1 ? `<span class="same">same code in ${g.length} files</span>` : also ? `<span class="same">${also + 1} changes in this file</span>` : ""}<span class="stat">+${rep.add} −${rep.del}</span></div>
          ${pre(rep, win(rep, e))}${extra}`;
        }).join("")}
        <div class="say">${md(e.say)}</div></div>`;
    }).join("")}</div>`;
  },

  // Flow: something passes through a step and loses (or keeps) parts of itself — v1's page →
  // index → answer, as a kind. In from.text, [[words|detail]] marks a token (a link's words and
  // its URL). to.mode "drop": details strike through and collapse out as the arrow fires, and
  // the result keeps only the words; "keep": they carry across, green. Beats: line 0 the source,
  // line 1 the arrow and result, line 2 the question/answer (fewer lines compress onto the last).
  flow: (s) => {
    const TOK = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
    const line = (k: number) => s.b0 + Math.min(k, s.lines.length - 1);
    const keep = s.to?.mode === "keep";
    let i = 0;
    // The source shows the details only when losing them is the point ("drop"); a kept one is
    // as hidden on the page as a real link's URL, and appears only on the other side.
    const from = md(s.from?.text ?? "").replace(TOK, (_: string, w: string, d: string) => { const k = i++;
      if (keep) return `<a class="lnk">${w}</a>`;
      return `<a class="lnk">${w}</a><span class="drop" data-b="${line(0)}" data-d="${(1.2 + 0.2 * k).toFixed(2)}"${keep ? "" : ` data-fx="${line(1)}" data-fd="${(0.9 + 0.1 * k).toFixed(2)}"`}><span class="url">${d}</span></span>`; });
    const to = md(s.from?.text ?? "").replace(TOK, (_: string, w: string, d: string) => (keep ? `${w} <span class="url">(${d})</span>` : w));
    const a = s.ask;
    return `<div class="k-flow${keep ? " keep" : ""}">
      <div class="flow">
        <div class="card" data-pt="from" data-b="${line(0)}" data-d="0.2">${s.from?.label ? `<div class="lbl">${md(s.from.label)}</div>` : ""}<p>${from}</p></div>
        <div class="arrow" data-b="${line(1)}" data-d="0.3">→${s.via ? `<small>${md(s.via)}</small>` : ""}</div>
        <div class="card" data-pt="to" data-b="${line(1)}" data-d="1.2">${s.to?.label ? `<div class="lbl">${md(s.to.label)}</div>` : ""}<p class="${keep ? "" : "mut"}">${to}</p>${s.to?.badge ? `<div class="tobadge"><span class="badge${tone(s.to.tone)}">${md(s.to.badge)}</span></div>` : ""}</div>
      </div>
      ${a ? `<div class="k-chat">${a.q ? `<div class="bubble q" data-pt="q" data-b="${line(2)}" data-d="0.2">${md(a.q)}</div>` : ""}<div class="bubble a" data-pt="a" data-b="${line(2)}" data-d="${a.q ? 1.2 : 0.3}">${md(a.a)}${a.badge ? ` <span class="badge${tone(a.tone)}">${md(a.badge)}</span>` : ""}</div></div>` : ""}
      ${s.cards ? `<div class="k-cards flowcards">${s.cards.map((c, k) => `<div class="card${tone(c.tone)}" data-pt="card${k + 1}" data-b="${line(c.at ?? 2)}" data-d="${(0.3 + 2.6 * k).toFixed(2)}">${c.badge ? `<span class="badge${tone(c.tone)}">${md(c.badge)}</span>` : ""}<b>${md(c.title)}</b><div>${md(c.body ?? "")}</div></div>`).join("")}</div>` : ""}
    </div>`;
  },

  // Call graph (python_callgraph add-on): who reaches the new function — entry points on the
  // left, the new code on the right. Green = changed in this PR, amber = unchanged but now reaches
  // new behaviour (the blast radius a reviewer can't see in the diff). One graph per helper.
  callgraph: (s) => `<div class="k-callgraph">${(s.helpers ?? []).map((name, gi) => {
    const g = callgraphs.graphs.find((x) => x.helper === name);
    if (!g) return `<p class="mut">no call graph for ${esc(name)} — run build.ts with a checkout</p>`;
    const depth = (n: CGNode) => (n.kind === "helper" ? 0 : n.depth ?? 1), D = Math.max(...g.nodes.map(depth));
    const cols = Array.from({ length: D + 1 }, (_, c) => g.nodes.filter((n) => depth(n) === D - c));
    const mod = (p: string | undefined) => (p ?? "").split("/")[1] ?? "";
    const tests = Object.values(g.tests ?? {}).reduce((a, t) => a + new Set(t.map((x) => x[0])).size, 0);
    return `<div class="cg" data-cg="${gi}" ${at(s, gi)}><div class="cgcols">${cols.map((col) => `<div class="cgcol">${col.map((n) => `<div class="cgnode ${n.kind} ${n.changed ? "changed" : "affected"}" data-node="${esc(n.id)}" data-pt="${ptName(n.kind === "helper" ? n.name : `${mod(n.path)}.${n.name}`)}">
        <b>${esc(n.name)}</b><small>${n.kind === "helper" ? `same code in ${n.copies.length} modules` : esc(mod(n.path))}</small></div>`).join("")}</div>`).join("")}</div>
      <svg class="cgedges" data-edges='${esc(JSON.stringify(g.edges.map((e) => [e.from, e.to])))}'></svg>
      <div class="cgfoot">${tests} tests reach it · <span class="changed">■</span> changed here <span class="affected">■</span> unchanged, now reaches new code</div></div>`;
  }).join("")}</div>`,

  // PDF fixture (pdf_fixtures add-on): the real test file's page, with its real link rectangles
  // and URLs, and the entries that are malformed. What the tests feed the code, visibly.
  fixture: (s) => `<div class="k-fixture">${(s.pages ?? []).map((ref, i) => {
    const fx = fixtures.fixtures[ref.file], pg = fx?.pages?.[(ref.page ?? 1) - 1];
    if (!pg) return `<p class="mut">no fixture ${esc(ref.file)} p${ref.page ?? 1} — run build.ts with a checkout</p>`;
    const [cx0, cy0, cx1, cy1] = pg.crop, cw = cx1 - cx0, ch = cy1 - cy0, k = pg.dpi / 72, [mx0, , , my1] = pg.mediabox;
    const pct = (px: number, py: number): [number, number] => [((px - cx0) / cw) * 100, ((py - cy0) / ch) * 100];
    const rects = pg.annots.map((a, j) => { const [l, t] = pct((a.rect[0] - mx0) * k, (my1 - a.rect[3]) * k), [r, b] = pct((a.rect[2] - mx0) * k, (my1 - a.rect[1]) * k);
      return `<div class="fxlink" data-pt="${ptName(ref.file)}-link${j + 1}" style="left:${l}%;top:${t}%;width:${r - l}%;height:${b - t}%"><span>${j + 1}</span></div>`; }).join("");
    // URLs go in a numbered legend under the page — labels on the page would cover its own text.
    const legend = pg.annots.map((a, j) => `<span><i>${j + 1}</i>${esc(a.uri) || "<em>no URI</em>"}</span>`).join("");
    return `<div class="fxpage" data-pt="${ptName(ref.file)}" ${at(s, i, ref.at)}><div class="fxhead"><code>${esc(ref.file)}</code> page ${ref.page ?? 1}${fx!.copies.length > 1 ? ` · identical in ${fx!.copies.length} modules` : ""}</div>
      <div class="fximg" style="aspect-ratio:${cw}/${ch}"><img data-fetch="${esc(pg.png)}" style="left:${(-cx0 / cw) * 100}%;top:${(-cy0 / ch) * 100}%;width:${(pg.size[0] / cw) * 100}%">${rects}</div>
      ${legend ? `<div class="fxlegend">${legend}</div>` : ""}
      ${pg.malformed.length ? `<div class="fxbad" data-pt="${ptName(ref.file)}-malformed">${pg.malformed.map((m) => `<span>✕ ${esc(m.kind)}${m.detail ? ` ${esc(m.detail)}` : ""}</span>`).join("")}</div>` : ""}</div>`;
  }).join("")}</div>`,

  // Custom: an HTML fragment (+ optional module) for the one visual a PR needs. Inside it,
  // data-r="k" means "appear on this scene's k-th line" (0-based); data-rx="k" fades out there.
  custom: (s) => `<div class="k-custom" data-src="${esc(s.html)}"></div>`,
};

// Images the page ships as files (rendered PDF fixtures) load through fetch(), so a single-file
// export (viz:bundle) can answer them; all are in before the film starts, so renders have them.
async function hydrateImages(root: ParentNode) {
  await Promise.all($$<HTMLImageElement>("img[data-fetch]", root).map(async (img) => {
    const blob = await fetch(img.dataset["fetch"]!).then((r) => (r.ok ? r.blob() : null), () => null);
    if (blob) { img.src = URL.createObjectURL(blob); await img.decode().catch(() => {}); }
  }));
}

async function hydrateCustom(root: ParentNode) {
  for (const el of $$(".k-custom", root)) {
    const s = scenes[+el.closest<HTMLElement>("[data-scene]")!.dataset["scene"]!] as SceneOf<"custom">;
    // Parsed inert first (a <template> loads nothing), then stylesheets and modules go through
    // fetch() — so a single-file export (viz:bundle) can answer them; a live <link> or import()
    // would ask the network for a file that isn't there.
    const tpl = document.createElement("template");
    tpl.innerHTML = await fetch(el.dataset["src"]!).then((r) => r.text());
    for (const l of $$('link[rel="stylesheet"]', tpl.content)) l.replaceWith(Object.assign(document.createElement("style"), { textContent: await fetch(l.getAttribute("href")!).then((r) => r.text()) }));
    el.append(tpl.content);
    for (const x of $$("[data-r],[data-rx],[data-rfx]", el)) {
      if (x.dataset["r"] !== undefined) x.dataset["b"] = String(s.b0 + +x.dataset["r"]);
      if (x.dataset["rx"] !== undefined) x.dataset["x"] = String(s.b0 + +x.dataset["rx"]);
      if (x.dataset["rfx"] !== undefined) x.dataset["fx"] = String(s.b0 + +x.dataset["rfx"]);
    }
    if (s.js) {
      const src = await fetch(s.js).then((r) => r.text());
      // Awaited, so a scene that loads a library (three.js) is drawn before the film starts. `kit`
      // imports a /_kit/ module: a blob-URL module can't resolve that path itself.
      await ((await import(URL.createObjectURL(new Blob([src], { type: "text/javascript" })))) as { default?: CustomModule }).default?.(el, s, { mode, kit: (name) => import(`/_kit/${name}`) });
    }
  }
}

// Pipeline connectors: a line from each step to the identical step in the next row — "this part
// didn't change" at a glance. Layout offsets, not getBoundingClientRect: rows slide in with a
// transform, and a rect taken mid-slide would bend every line. (.k-pipeline is the offsetParent.)
function drawLinks(root: ParentNode) {
  const pos = (el: HTMLElement, pipe: HTMLElement) => { let x = 0, y = 0; for (let e: HTMLElement | null = el; e && e !== pipe; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };
  for (const pipe of $$(".k-pipeline", root)) {
    const svg = $<SVGSVGElement>("svg.links", pipe)!, rows = $$(".prow", pipe);
    let paths = "";
    rows.forEach((row, ri) => {
      if (!ri) return;
      for (const st of $$(".step.same", row)) {
        const up = $$(".step", rows[ri - 1]).find((u) => u.dataset["step"] === st.dataset["step"]);
        if (!up) continue;
        const a = pos(up, pipe), b = pos(st, pipe);
        const x1 = a.x + a.w / 2, y1 = a.y + a.h + 4, x2 = b.x + b.w / 2, y2 = b.y - 4;
        paths += `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}"/>`;
      }
    });
    svg.setAttribute("viewBox", `0 0 ${pipe.offsetWidth} ${pipe.offsetHeight}`);
    svg.innerHTML = paths;
  }
  // Call graph edges: caller's right edge → callee's left edge, same offset measure.
  for (const cg of $$(".k-callgraph .cg", root)) {
    const svg = $<SVGSVGElement>("svg.cgedges", cg)!, node = (id: string) => $$(".cgnode", cg).find((n) => n.dataset["node"] === id);
    let paths = "";
    for (const [from, to] of JSON.parse(svg.dataset["edges"]!) as [string, string][]) {
      const a = node(from), b = node(to);
      if (!a || !b) continue;
      const p = pos(a, cg), q = pos(b, cg), x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = q.x, y2 = q.y + q.h / 2;
      paths += `<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2 - 6},${y2}"/><path class="head" d="M${x2 - 12},${y2 - 6} L${x2 - 2},${y2} L${x2 - 12},${y2 + 6}"/>`;
    }
    svg.setAttribute("viewBox", `0 0 ${cg.offsetWidth} ${cg.offsetHeight}`);
    svg.innerHTML = paths;
  }
}

// Film mode: scale each scene (and each diff-tour step) to fill the stage without spilling,
// so neither a sparse scene nor a long hunk needs a hand-tuned zoom. plan "zoom" still wins.
function autofit(stage: HTMLElement) {
  // Measured at zoom 1, then scaled so the content just fits its box (between 0.5× and max).
  // Content size, not scrollHeight: a box's scrollHeight never reports less than the box, so it
  // can say "too big" but never "room to spare".
  const extent = (el: HTMLElement) => Math.max(1, ...([...el.children] as HTMLElement[]).map((c) => c.offsetTop + c.offsetHeight));
  // Fit the height; width reflows (text wraps into the narrower zoomed box), so it only
  // matters if something rigid then spills sideways — back off until it doesn't.
  const fit = (el: HTMLElement, box: HTMLElement, max: number) => {
    el.style.zoom = "1";
    let z = Math.max(0.5, Math.min(max, box.clientHeight / extent(el)));
    for (;;) {
      el.style.zoom = z.toFixed(2);
      if (z <= 0.5 || (el.scrollWidth <= el.clientWidth + 2 && extent(el) <= box.clientHeight / (el === box ? 1 : z) + 2)) break;
      z -= 0.05;
    }
  };
  for (const sc of $$(".scene", stage)) {
    if ($(".t3d", sc)) continue; // a 3D tour: panels keep their natural size and the camera frames them
    for (const hk of $$(".k-tour .hunk", sc)) fit(hk, hk.parentNode as HTMLElement, 1.25);
    if (sc.dataset["zoom"] === undefined) fit(sc, sc, 1.4);
  }
}

// A 3D diff tour (tour "view": "3d", film only): the same hunk panels — highlighting, pointer
// boxes and all — stand in space, laid out by where the code lives. x = the module (first path
// segment under modules/, packages/, …), z = tour order, so the camera walks the change the way
// the narration does. Code that's the same in several modules gets a panel in each. An entry with
// "hunks": [] is an overview: the camera pulls up over everything. Drawn from t on viz-frame.
async function tour3d(stage: HTMLElement) {
  const tour = $(".k-tour.t3d", stage);
  if (!tour) return;
  const THREE = await import("https://esm.sh/three@0.160.0");
  const { CSS3DRenderer, CSS3DObject } = await import("https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS3DRenderer.js");
  const { CSS2DRenderer, CSS2DObject } = await import("https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js");
  type Vec3 = [number, number, number];
  type View = { pos: Vec3; look: Vec3 };
  type Panel = { x: number; z: number; h: number; w: number; xs?: number[] | null };
  type Piece = { files: string[]; same?: boolean; els: Element[]; used?: boolean };
  const s = scenes[+tour.closest<HTMLElement>("[data-scene]")!.dataset["scene"]!] as SceneOf<"tour">;
  const W = 1760, H = 820, COL = 2000, ROW = 1300, fov = 40;
  const modOf = (f: string) => { const p = f.split("/"); return /^(modules|packages|apps|services|libs)$/.test(p[0]!) ? p[1]! : p[0]!; };
  const entries = (s.entries ?? []).map((e) => (e.hunks ?? [e.hunk!]).map((id) => hunkById.get(id)).filter(Boolean) as Hunk[]);
  const mods = [...new Set(entries.flat().map((h) => modOf(h.file)))];
  const colX = (m: string) => (mods.indexOf(m) - (mods.length - 1) / 2) * COL;

  const renderer = new CSS3DRenderer();
  renderer.setSize(W, H);
  const labels = new CSS2DRenderer(); // screen-size text pinned to 3D points: readable at any distance
  labels.setSize(W, H);
  labels.domElement.className = "t3d-labels";
  tour.append(renderer.domElement, labels.domElement);
  const world = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(fov, W / H, 1, 60000);
  const panels: (Panel | null)[] = []; // per entry, what the camera frames: { x, z, h, w }; null for an overview
  const spots: { x: number; z: number; h: number; i: number; el: HTMLElement; o: InstanceType<typeof CSS3DObject> }[] = [];  // every panel standing, copies included: [{ x, z, h, i }]
  const add = (el: HTMLElement, x: number, y: number, z: number, rx = 0) => { const o = new CSS3DObject(el); o.position.set(x, y, z); o.rotation.x = rx; world.add(o); return o; };
  const div = (cls: string, html = "", css = "") => Object.assign(document.createElement("div"), { className: cls, innerHTML: html, style: css });
  const lane = (m: string) => mods.indexOf(m);
  const put = (el: HTMLElement, m: string, i: number) => { const h = el.offsetHeight, w = div("t3d-panel"); w.append(el); spots.push({ x: colX(m), z: -i * ROW, h, i, el: w, o: add(w, colX(m), -h / 2, -i * ROW) }); return h; };
  $$(":scope > .hunk", tour).forEach((hk, i) => {
    const hs = entries[i];
    if (!hs?.length) { hk.style.display = "none"; panels.push(null); return; }
    const z = -i * ROW;
    // Pieces: each file header and what follows it. Same code in several files goes to every lane
    // that has it; anything else to its own file's lane.
    const pieces: Piece[] = [];
    for (const c of [...hk.children]) {
      const files = c.matches(".hfile") && $(".file", c)?.innerHTML.replace(/^only in /, "").split("<br>");
      if (files) pieces.push({ files, same: !!$(".same", c)?.textContent.startsWith("same code"), els: [] });
      (pieces.at(-1) ?? (pieces[0] = { files: [hs[0]!.file], els: [] })).els.push(c);
    }
    // In a lane, pieces stack top to bottom in file order — the imports sit above the code using them.
    const order = (m: string, pc: Piece) => Math.min(...hs.filter((h) => modOf(h.file) === m && pc.files.includes(h.file)).map((h) => hunkOrder.get(h.id)!));
    const lanes = new Map<string, { pc: Piece; at: number }[]>();
    for (const pc of pieces) for (const m of new Set(pc.files.map(modOf))) {
      if (!lanes.has(m)) lanes.set(m, []);
      lanes.get(m)!.push({ pc, at: order(m, pc) });
    }
    const ms = [...lanes.keys()].sort((a, b) => lane(a) - lane(b));
    const heights = new Map(ms.map((m): [string, number] => {
      const shell = hk.cloneNode(false) as HTMLElement; // same data-b: every lane's pieces arrive together
      for (const { pc } of lanes.get(m)!.sort((a, b) => a.at - b.at)) {
        for (const el of pc.els) shell.append(pc.used ? el.cloneNode(true) : el); // copies: highlights play on each
        pc.used = true;
      }
      tour.append(shell);
      return [m, put(shell, m, i)];
    }));
    hk.remove();
    const x0 = colX(ms[0]!), x1 = colX(ms.at(-1)!), hmax = Math.max(...heights.values());
    const sameLanes = pieces.find((pc) => pc.same) && [...new Set(pieces.find((pc) => pc.same)!.files.map(modOf))].sort((a, b) => lane(a) - lane(b));
    if (sameLanes && sameLanes.length > 2) {
      // A helper copied into three or more modules: read the middle copy, the others peeking in either side.
      const mid = sameLanes[Math.floor(sameLanes.length / 2)]!;
      panels.push({ x: colX(mid), z, h: heights.get(mid)!, w: 1480 * 1.3 });
    } else {
      // "order" on the entry reads the lanes in the order the narration names them.
      const seq = (s.entries![i]!.order ?? ms).filter((m) => heights.has(m));
      panels.push({ x: (x0 + x1) / 2, z, h: hmax, w: x1 - x0 + 1480, xs: ms.length > 1 ? seq.map(colX) : null });
    }
  });
  // The ground: a lane per module, and each module's own code path painted down its lane from
  // panel to panel, numbered by tour step — lines follow the code, not the camera.
  const FLOOR = -1150, depth = entries.length * ROW;
  for (const m of mods) {
    add(div("t3d-strip", "", `width:${COL - 120}px;height:${depth + ROW}px`), colX(m), FLOOR, -depth / 2 + ROW / 2, -Math.PI / 2);
    const name = new CSS2DObject(div("t3d-lane", esc(m).replace(/-/g, "-<br>"))); // broken at hyphens: narrow enough for the lane
    name.position.set(colX(m), FLOOR, ROW * 0.6); // the near end, where the lanes are widest
    world.add(name);
    const path = spots.filter((p) => p.x === colX(m)).sort((a, b) => a.i - b.i);
    path.forEach((r, j) => {
      add(div("t3d-stop", String(r.i + 1)), r.x, FLOOR + 2, r.z + 260, -Math.PI / 2);
      const q = path[j + 1];
      if (q) add(div("t3d-route", "", `width:${r.z - q.z}px`), r.x, FLOOR + 1, (r.z + q.z) / 2 + 260, -Math.PI / 2).rotation.z = Math.PI / 2;
    });
  }
  // The route map, in the heading band: a row per module, the tour's steps left to right, each
  // module's code path along its row, the current stops lit and their modules named.
  const SX = 40, RY = 26, LW = 250, mx = (i: number) => LW + 14 + i * SX, my = (x: number) => 14 + (x / COL + (mods.length - 1) / 2) * RY;
  const mini = div("t3d-mini", `<svg width="${mx(entries.length - 1) + 16}" height="${mods.length * RY + 6}">
    ${mods.map((m, k) => `<text data-m="${k}" x="${LW}" y="${14 + k * RY + 6}">${esc(m)}</text><line x1="${LW + 8}" x2="${mx(entries.length - 1) + 8}" y1="${14 + k * RY}" y2="${14 + k * RY}"/>`).join("")}
    ${mods.map((m) => spots.filter((p) => p.x === colX(m)).sort((a, b) => a.i - b.i)).map((path) => `<polyline points="${path.map((p) => `${mx(p.i)},${my(p.x)}`).join(" ")}"/>`).join("")}
    ${spots.map((p) => `<circle data-i="${p.i}" data-m="${Math.round(p.x / COL + (mods.length - 1) / 2)}" cx="${mx(p.i)}" cy="${my(p.x)}" r="8"/>`).join("")}</svg>`);
  tour.parentNode!.append(mini);
  const dots = $$("circle", mini);
  // Camera for an entry: straight in (a touch high and to the side, so it reads as 3D), far enough
  // that its panels fit.
  const tan = Math.tan((fov / 2) * Math.PI / 180);
  const fit = (p: Panel): View => {
    const d = Math.max((p.h * 1.12) / 2 / tan, (p.w * 1.08) / 2 / (tan * (W / H)));
    return { pos: [p.x + d * 0.08, -p.h / 2 + d * 0.1, p.z + d], look: [p.x, -p.h / 2, p.z] };
  };
  // An overview: up and in front of everything, backed off until every panel's corners are in
  // frame, lane names included, and above the caption band (y > -0.6).
  const xs = spots.map((p) => p.x), zs = spots.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const corners = spots.flatMap((p): Vec3[] => [[p.x - 740, 0, p.z], [p.x + 740, 0, p.z], [p.x - 740, -p.h, p.z], [p.x + 740, -p.h, p.z]])
    .concat(mods.map((m): Vec3 => [colX(m), FLOOR, ROW * 0.6])); // the lane names too
  const inFrame = ([x, y, z]: Vec3) => { const v = new THREE.Vector3(x, y, z).project(cam); return Math.abs(v.x) < 0.95 && v.y < 0.8 && v.y > -0.6 && v.z < 1; };
  let over: View;
  search: for (let d = 3000; d < 60000; d *= 1.06) {
    for (const aim of [0, 0.1, 0.2, 0.3, 0.4]) { // aiming nearer tilts the camera down, lifting everything in frame
      over = { pos: [cx, FLOOR + d * 0.62, cz + d * 0.78], look: [cx, FLOOR + 200, cz + d * aim] };
      cam.position.set(...over.pos); cam.lookAt(...over.look); cam.updateMatrixWorld();
      if (corners.every(inFrame)) break search;
    }
  }
  const lerp = (a: Vec3, b: Vec3, k: number) => a.map((v, j) => v + (b[j]! - v) * k) as Vec3;
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  // Where the camera wants to be for entry i at time t. Two panels: one wide shot of both, held.
  // Three or more: too small together, so it holds on each for an equal share of the line and
  // snaps between them.
  const view = (i: number, t: number, start: FrameDetail["start"]) => {
    const p = panels[i];
    if (!p) return over;
    if (!p.xs || p.xs.length < 3) return fit(p);
    const t0 = start(s.b0 + i), t1 = Number.isFinite(start(s.b0 + i + 1)) ? start(s.b0 + i + 1) : t0 + 8;
    const n = p.xs.length, share = (t1 - t0) / n;
    const j = Math.min(n - 1, Math.max(0, Math.floor((t - t0) / share)));
    const snap = j ? ease((t - t0 - j * share) / 0.5) : 1; // 0.5 s from the previous panel to this one
    const x = p.xs[j - (j ? 1 : 0)]! + (p.xs[j]! - p.xs[j - (j ? 1 : 0)]!) * snap;
    return fit({ ...p, x, w: 1480 });
  };
  const draw = (t: number, start: FrameDetail["start"]) => {
    let { pos, look } = view(0, t, start);
    for (let i = 1; i < panels.length; i++) {
      const k = ease((t - start(s.b0 + i)) / 1.4);
      if (k <= 0) break;
      const to = view(i, t, start);
      // Mid-move the camera backs off and rises, so it passes over the panels rather than through them.
      const out = Math.sin(Math.PI * k), far = Math.min(1, Math.hypot(to.pos[0] - pos[0], to.pos[2] - pos[2]) / 2000);
      pos = lerp(pos, to.pos, k); pos[1] += out * far * 700; pos[2] += out * far * 1400; look = lerp(look, to.look, k);
    }
    cam.position.set(...pos);
    cam.lookAt(...look);
    // CSS has no near plane: a panel the camera has passed would draw huge and mirrored. Hide it.
    // (isCSS3DObject is set by three at runtime; its types don't declare it.)
    for (const o of world.children) if ((o as typeof o & { isCSS3DObject?: true }).isCSS3DObject && o.rotation.x === 0) o.visible = o.position.z < pos[2] - 400; // lane signs too
    const cur = Math.max(0, panels.findLastIndex((_, i) => t >= start(s.b0 + i) - 0.01));
    // Panels of earlier steps stand between the camera and this one in the lanes beside it: they
    // fade as the camera moves on, and come back for the overview.
    const gone = panels[cur] ? ease((t - start(s.b0 + cur)) / 0.6) : 1 - ease((t - start(s.b0 + cur)) / 1.4);
    for (const p of spots) p.el.style.opacity = p.i < cur ? (1 - gone).toFixed(3) : "1";
    for (const d of dots) d.setAttribute("class", +d.dataset["i"]! === cur || !panels[cur] ? "on" : +d.dataset["i"]! < cur ? "past" : "");
    const here = new Set(dots.filter((d) => +d.dataset["i"]! === cur).map((d) => d.dataset["m"]));
    for (const x of $$("text", mini)) x.setAttribute("class", here.has(x.dataset["m"]) ? "on" : "");
    // Lane names belong to the overview: they fade in as the camera pulls up, and stay off the code.
    const ov = panels.findIndex((p) => !p), k = ov < 0 ? 0 : ease((t - start(s.b0 + ov)) / 1.4);
    labels.domElement.style.opacity = k.toFixed(3);
    renderer.render(world, cam);
    labels.render(world, cam);
  };
  stage.addEventListener("viz-frame", (ev) => draw((ev as CustomEvent<FrameDetail>).detail.t, (ev as CustomEvent<FrameDetail>).detail.start));
  draw(0, () => Infinity); // the renderer only attaches panels on a render — before film rescans for them
}

function sceneHTML(s: Scene) {
  const body = ((R as Record<string, ((s: Scene) => string) | undefined>)[s.kind] ?? (() => `<p>unknown scene kind "${esc(s.kind)}"</p>`))(s);
  return `${s.heading === false ? "" : `<h2 data-b="${s.b0}" data-d="0">${md(s.heading ?? s.title)}${s.subheading ? `<small>${md(s.subheading)}</small>` : ""}</h2>`}${body}`;
}

// Pointers: light each mark's target from the moment its words are spoken (Kokoro word timings,
// in the compiled manifest) until the next mark on that line, or the line's end. Targets, comma-
// separated: "L40-41" whole lines · "L69:inline_link_urls" just that text on line 69 · "-42" a
// removed line (old number) · "@name" an element with data-pt; several @names get ONE outline.
// Boxes use ui-narration's highlight look, so films and recordings point the same way.
/** What a mark points the cursor at: an element or line, or a fragment of a line's text. */
type Target = (HTMLElement & { sub?: undefined }) | { line: HTMLElement; sub: string; classList?: undefined };
type Box = ({ kind: "union"; els: HTMLElement[]; host: HTMLElement } | { kind: "sub"; line: HTMLElement; sub: string }) & { iv: string; div?: HTMLDivElement };
const pending: Box[] = []; // boxes to measure once the stage is laid out: [container, rect fn, interval]
const aims: { iv: string; target: Target }[] = [];    // one per mark: where the cursor goes, and when
// "^" in front of a target means POINT at it (the cursor, aimed at its centre) instead of
// highlighting it. The same thing is never both: highlight a container and point inside it,
// or do one — pointing at what is already lit is just noise.
function targetsOf(spec: string, box: ParentNode | undefined) {
  const lines: HTMLElement[] = [], els: HTMLElement[] = [], subs: [HTMLElement, string][] = [], points: Target[] = [];
  for (let x of spec.split(",").map((v) => v.trim())) {
    const point = x.startsWith("^");
    if (point) x = x.slice(1);
    if (point) { const t = targetsOf(x, box); points.push(...t.lines, ...t.els, ...t.subs.map(([l, sub]) => ({ line: l, sub }))); continue; }
    if (x.startsWith("@")) { els.push(...$$(`[data-pt="${x.slice(1)}"]`, box)); continue; }
    const [range, sub] = x.split(":") as [string, string?];
    const old = range.startsWith("-");
    const [a, b] = range.replace(/^[L-]/, "").split("-").map(Number) as [number, number?];
    const nums = new Set<string | null | undefined>(Array.from({ length: (b || a) - a + 1 }, (_, i) => String(a + i)));
    const hit = $$(".l", box).filter((l) => (old ? nums.has(l.dataset["old"]) : nums.has($("em", l)?.textContent)));
    if (sub) subs.push(...hit.map((l): [HTMLElement, string] => [l, sub.trim()])); else lines.push(...hit);
  }
  return { lines, els, subs, points };
}
async function pointers(stage: HTMLElement) {
  const manifest: Manifest | null = window.__vizTts ?? (await fetch(".tts/manifest.json").then((r) => (r.ok ? r.json() : null), () => null));
  const wordsOf = new Map((manifest?.cues ?? []).filter((c) => c.text && c.words).map((c) => [c.text!, c.words!] as const));
  const words = (x: string) => x.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const add = (el: HTMLElement, iv: string) => (el.dataset["h"] = [el.dataset["h"], iv].filter(Boolean).join(";"));
  for (const s of scenes) s.lines.forEach((line, k) => {
    const marks = [...line.matchAll(MARK)];
    if (!marks.length) return;
    const timed = (wordsOf.get(spoken(line)) ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w[0]));
    if (!timed.length) return; // not compiled yet — the next verify compiles it
    const scene = $(`[data-scene="${s.i}"]`, stage);
    if (!scene) return; // not in this cut
    const box = s.kind === "tour" ? $$(".hunk", scene)[k] : scene;
    const beat = s.b0 + k;
    const starts = marks.map((m) => timed[Math.min(timed.length - 1, words(spoken(line.slice(0, m.index))).length)]?.[1] ?? 0);
    marks.forEach((m, j) => {
      const iv = `${beat}:${Math.max(0, starts[j]! - 0.1).toFixed(2)}:${j + 1 < marks.length ? `${beat}:${(starts[j + 1]! - 0.1).toFixed(2)}` : `${beat + 1}:0`}`;
      // MARK stops at the first ")", so "(L9:f(x))" would leave a stray ")" in the spoken line and captions.
      if (m[2]!.includes("(")) console.error(`pr-viz: pointer target "${m[2]}" can't contain "(" — point at a fragment without parentheses`);
      const t = targetsOf(m[2]!, box);
      if (!t.lines.length && !t.els.length && !t.subs.length && !t.points.length) console.error(`pr-viz: pointer "${m[1]}" → ${m[2]} matches nothing in scene "${s.title}"`);
      // A thing being pointed at must already be on screen. Items appear one per line by default
      // (item i on line i), so a line that talks about items 1–5 at once would light up rows
      // that only arrive on a later line, and the rows would then show up a beat late. Pull each
      // target — and whatever contains it or sits inside it — onto this line, just before its mark.
      for (const el of [...t.els, ...t.points.filter((p) => p instanceof Element)]) {
        const due = Math.max(0, starts[j]! - 0.6);
        const late = (x: HTMLElement) => +x.dataset["b"]! > beat || (+x.dataset["b"]! === beat && +(x.dataset["d"] ?? 0) > due);
        const ups: HTMLElement[] = []; for (let e: HTMLElement | null = el; e && e !== scene; e = e.parentElement) ups.push(e);
        for (const x of [...ups, ...$$("[data-b]", el)]) if (x.dataset["b"] !== undefined && late(x)) { x.dataset["b"] = String(beat); x.dataset["d"] = due.toFixed(2); }
      }
      for (const l of t.lines) add(l, iv);
      if (t.els.length === 1) add(t.els[0]!, iv);
      if (t.els.length > 1) pending.push({ kind: "union", els: t.els, host: scene, iv });
      for (const [l, sub] of t.subs) {
        if (!l.textContent.includes(sub)) console.error(`pr-viz: pointer "${m[1]}" → "${sub}" isn't on line ${$("em", l)?.textContent || l.dataset["old"]}`);
        else pending.push({ kind: "sub", line: l, sub, iv });
      }
      // Only pointing targets get the cursor — see aimCursor.
      if (t.points.length) aims.push({ iv, target: t.points[0]! });
    });
  });
}
// After layout (and autofit): draw each pending box in its container's own coordinates — offsets
// for element outlines (ignore the slide-in transforms), a text Range for a code fragment.
function drawBoxes() {
  const offset = (el: HTMLElement, host: HTMLElement) => { let x = 0, y = 0; for (let e: HTMLElement | null = el; e && e !== host; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; } return { x, y }; };
  for (const b of pending) {
    const div = document.createElement("div");
    b.div = div;
    div.className = "ptbox";
    div.dataset["h"] = b.iv;
    if (b.kind === "union") {
      const ps = b.els.map((e) => ({ ...offset(e, b.host), w: e.offsetWidth, h: e.offsetHeight }));
      const x = Math.min(...ps.map((p) => p.x)), y = Math.min(...ps.map((p) => p.y));
      Object.assign(div.style, { left: x - 8 + "px", top: y - 8 + "px", width: Math.max(...ps.map((p) => p.x + p.w)) - x + 16 + "px", height: Math.max(...ps.map((p) => p.y + p.h)) - y + 16 + "px" });
      b.host.append(div);
    } else {
      const walker = document.createTreeWalker(b.line, NodeFilter.SHOW_TEXT);
      const text: Text[] = [];
      for (let n; (n = walker.nextNode() as Text | null);) text.push(n);
      const full = text.map((n) => n.data).join(""), at = full.indexOf(b.sub);
      let seen = 0; const range = document.createRange();
      for (const n of text) {
        if (at >= seen && at < seen + n.length) range.setStart(n, at - seen);
        if (at + b.sub.length > seen && at + b.sub.length <= seen + n.length) range.setEnd(n, at + b.sub.length - seen);
        seen += n.length;
      }
      const lr = b.line.getBoundingClientRect(), k = lr.width / b.line.offsetWidth || 1, rr = range.getBoundingClientRect();
      Object.assign(div.style, { left: b.line.offsetLeft + (rr.left - lr.left) / k - 4 + "px", top: b.line.offsetTop + (rr.top - lr.top) / k - 2 + "px",
        width: rr.width / k + 8 + "px", height: rr.height / k + 4 + "px", borderRadius: "6px", borderWidth: "2px" });
      b.line.parentNode!.append(div); // the <pre>, positioned
    }
  }
}

// The cursor: for each mark, the point to glide to, measured with the film sought to that
// moment (so slide-ins have finished and autofit zoom is in) — then the film goes back.
function aimCursor(f: Film, stage: HTMLElement) {
  if (!aims.length) return;
  const back = f.timeline.at(), sr = () => stage.getBoundingClientRect();
  const iv = (spec: string) => { const [b, d, xb, xd] = spec.split(":").map(Number) as [number, number, number, number]; const B = f.beats;
    return { t: B[b - 1]!.t0 + d, until: xb - 1 < B.length ? B[xb - 1]!.t0 + xd : f.timeline.total }; };
  // The centre of what's pointed at: an element's box, a line's text, or a fragment's text.
  const centre = (tg: Target) => {
    let r;
    if (tg.sub !== undefined) {
      const walker = document.createTreeWalker(tg.line, NodeFilter.SHOW_TEXT), text: Text[] = [];
      for (let n; (n = walker.nextNode() as Text | null);) text.push(n);
      const at = text.map((n) => n.data).join("").indexOf(tg.sub), rg = document.createRange();
      let seen = 0;
      for (const n of text) {
        if (at >= seen && at < seen + n.length) rg.setStart(n, at - seen);
        if (at + tg.sub.length > seen && at + tg.sub.length <= seen + n.length) rg.setEnd(n, at + tg.sub.length - seen);
        seen += n.length;
      }
      r = rg.getBoundingClientRect();
    } else if (tg.classList?.contains("l")) { const rg = document.createRange(); rg.selectNodeContents(tg); const rs = [...rg.getClientRects()]; r = rs[rs.length - 1] ?? tg.getBoundingClientRect(); }
    else r = tg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  };
  const frames: CursorFrame[] = [];
  for (const a of aims) {
    const when = iv(a.iv);
    f.seek(when.t + 0.7);
    const [x, y] = centre(a.target), s = sr(), k = s.width / 1920;
    frames.push({ ...when, x: (x - s.left) / k, y: (y - s.top) / k });
  }
  f.seek(back);
  f.setCursor(frames);
}

// ================================ film ================================
if (mode === "film") {
  const stage = document.createElement("div");
  stage.id = "stage";
  stage.innerHTML = filmScenes.map((s) => `<section class="scene" data-scene="${s.i}" data-title="${esc(s.title)}" data-beats="${s.b0}-${s.b0 + s.lines.length - 1}"${s.zoom ? ` data-zoom style="--z:${s.zoom}"` : ""}>${sceneHTML(s)}</section>`).join("");
  document.body.append(stage);
  await hydrateCustom(stage);
  await hydrateImages(stage);
  await pointers(stage);
  const f = await film();
  autofit(stage);
  drawBoxes();
  await tour3d(stage);
  f.rescan();
  aimCursor(f, stage); // only marks that point ("^") move the cursor
  const jump = +(loadHash<Hash>().chapter ?? 0);
  if (jump) { f.seek(f.chapters[jump - 1]?.t0 ?? 0); const { chapter, ...rest } = loadHash<Hash>(); saveHash({ ...rest, t: f.timeline.at() }); }
  // Opened from review mode's "▶ watch": play at once, and stop at the end of that section.
  const { autoplay, only } = loadHash<Hash>();
  if (autoplay) f.timeline.play();
  if (only && jump) {
    const end = f.chapters[jump - 1]!.t0 + f.chapters[jump - 1]!.dur - 0.45; // before the scene's fade-out
    (function stop() { if (f.timeline.at() >= end) { f.timeline.pause(); f.seek(end); } else requestAnimationFrame(stop); })();
  }
  drawLinks(stage);
  addEventListener("resize", () => drawLinks(stage));
  // Embedded as review mode's section player, the review page is already behind it.
  if (window.top === window) document.body.insertAdjacentHTML("beforeend", `<a id="to-review" data-viz-chrome href="${hashFor({ mode: "review" })}">Review this ↗</a>`);
  if ($("#to-review")) $("#to-review")!.onclick = (e) => {
    e.preventDefault();
    const ci = f.chapters.findLastIndex((c) => f.timeline.at() >= c.t0 - 0.01);
    go({ mode: "review", scene: Math.max(0, ci) });
  };
}

// =============================== review ===============================
else {
  document.body.classList.add("review-mode", ...(poster ? ["poster-mode"] : []));
  const key = `pr-viz:${plan.pr?.repo ?? ""}#${plan.pr?.number ?? ""}@${plan.pr?.head ?? ""}`;
  const state: { reviewed: Record<string, boolean> } = { reviewed: {}, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
  const save = () => { localStorage.setItem(key, JSON.stringify(state)); tally(); };
  const sections: [Section, string][] = [["why", "Why"], ["what", "What"], ["how", "How"], ["proof", "Proof"], ["risk", "Risk & rollout"], ["verdict", "Verdict"]];
  const watch = (s: Scene) => `<a class="watch" data-go='${JSON.stringify({ mode: "film", chapter: s.i + 1 })}' href="${hashFor({ mode: "film", chapter: s.i + 1 })}">▶ watch</a>`;

  const tourHTML = (s: SceneOf<"tour">) => `<div class="files">${diff.files.map((f) => {
    const entries = new Map((s.entries ?? []).flatMap((e) => (e.hunks ?? [e.hunk]).map((id, k) => [id, k ? "" : e.say] as const)));
    return `<details class="file k-${f.kind}"${f.kind === "prod" ? " open" : ""}><summary><label onclick="event.stopPropagation()"><input type="checkbox" data-reviewed="${esc(f.path)}"${state.reviewed[f.path] ? " checked" : ""}> reviewed</label>
      <span class="fk">${f.kind}</span> <code>${esc(f.path)}</code> <span class="mut">+${f.add} −${f.del}</span></summary>
      ${f.hunks.map((h) => `${entries.get(h.id) ? `<p class="say">${md(entries.get(h.id))}</p>` : ""}<pre>${h.lines.map((l) => lineHTML(h, l)).join("")}</pre>`).join("") || '<p class="mut">binary — not shown</p>'}</details>`;
  }).join("")}</div>`;

  const review = document.createElement("main");
  review.id = "review";
  review.innerHTML = `<header><div class="mut">${esc(plan.pr?.repo ?? "")}${plan.pr?.number ? ` · <a href="${esc(plan.pr.url ?? "#")}">#${plan.pr.number}</a>` : ""}</div>
      <h1>${md(plan.pr?.title ?? "Change review")}</h1>${poster ? "" : `<div class="bar"><a class="watch big" data-go='{"mode":"film"}' href="${hashFor({ mode: "film" })}">▶ Watch the film</a><span id="tally"></span></div>`}</header>
    ${criteria.length && !(poster && scenes.some((s) => s.kind === "trace")) ? `<section class="sec"><h2>Acceptance criteria</h2>${criteria.map((b) => `<div class="beh st-${b.status ?? "tested"}"><b>${esc(b.id)}</b> ${md(b.title)}<span class="proof">${(b.proof ?? []).map((p) => md(p)).join(" · ")}${b.gap ? ` <span class="gap">${md(b.gap)}</span>` : ""}</span></div>`).join("")}</section>` : ""}
    ${sections.map(([id, label]) => {
      // "poster": false keeps a scene off the poster (one that only makes sense moving).
      const mine = scenes.filter((s) => (s.section ?? "what") === id && !(poster && s.poster === false));
      if (!mine.length) return "";
      return `<section class="sec"><h2>${label}</h2>${mine.map((s) => `<article class="rscene" id="scene-${s.i}" data-scene="${s.i}">${poster ? "" : `<h3>${md(s.title)} ${watch(s)}</h3>`}
        <div class="frame"><div class="scene">${s.kind === "tour" && !poster ? `<h2>${md(s.heading ?? s.title)}</h2>${tourHTML(s)}` : sceneHTML(s)}</div></div>
        ${s.kind === "tour" || poster ? "" : `<blockquote>${s.lines.map(md).join(" ")}</blockquote>`}</article>`).join("")}</section>`;
    }).join("")}`;
  document.body.append(review);
  await hydrateCustom(review);
  await hydrateImages(review);

  function tally() {
    if (poster) return;
    const r = Object.values(state.reviewed).filter(Boolean).length;
    $("#tally")!.textContent = `${r} / ${diff.files.length} files reviewed`;
  }
  review.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset["reviewed"]) state.reviewed[t.dataset["reviewed"]] = t.checked;
    save();
  });
  // "▶ watch" plays that section right here, over the page (the click lets the player start with
  // sound: allow="autoplay" hands this page's user gesture to the frame). The big button opens the
  // whole film instead.
  for (const a of $$("a.watch", review)) a.onclick = (e) => {
    e.preventDefault();
    const target: Partial<Hash> = JSON.parse(a.dataset["go"]!);
    if (!target.chapter) return go(target);
    const src = location.pathname + hashFor({ ...target, autoplay: true, only: true });
    document.body.insertAdjacentHTML("beforeend", `<div id="player"><iframe allow="autoplay" src="${src}"></iframe><button title="close (Esc)">✕</button></div>`);
    const close = () => $("#player")?.remove();
    $("#player button")!.onclick = close;
    $("#player")!.onclick = (ev) => { if ((ev.target as HTMLElement).id === "player") close(); };
    addEventListener("keydown", (ev) => ev.key === "Escape" && close(), { once: true });
  };
  // Scenes are drawn for a 1920px stage; the review page scales each one to its column.
  const fit = () => { for (const fr of $$(".frame", review)) fr.style.setProperty("--k", String(fr.clientWidth / 1920)); drawLinks(review); };
  addEventListener("resize", fit);
  fit();
  tally();
  const s = loadHash<Hash>().scene;
  if (s !== undefined) $(`#scene-${s}`)?.scrollIntoView();
}
