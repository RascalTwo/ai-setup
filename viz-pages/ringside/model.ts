// model.ts — turns Claude Code transcript lines (.jsonl) into the few things the page draws:
// tool calls (with lane, plain-English label, start/end), user prompts, and what Claude said.
// Pure functions only, so the backend and the tests share one parser.

export type Lane = "plan" | "look" | "run" | "verify" | "change" | "delegate" | "outside";

export const LANES: readonly { id: Lane; name: string; hint: string; color: string }[] = [
  { id: "plan", name: "Plan", hint: "skills, todo lists, plan mode", color: "var(--c4)" },
  { id: "look", name: "Look", hint: "reading files, searching code", color: "var(--c1)" },
  {
    id: "run",
    name: "Run",
    hint: "other shell commands: installs, servers, scripts",
    color: "var(--c5)",
  },
  {
    id: "verify",
    name: "Verify",
    hint: "tests, lint, type checks, builds, viz verify",
    color: "var(--c7)",
  },
  { id: "change", name: "Change", hint: "editing or writing files", color: "var(--c3)" },
  { id: "delegate", name: "Delegate", hint: "subagents and workflows", color: "var(--c8)" },
  {
    id: "outside",
    name: "Outside",
    hint: "web, GitHub, Jira, other MCP tools",
    color: "var(--c2)",
  },
];

export interface Call {
  id: string;
  tool: string;
  lane: Lane;
  label: string;
  detail: string;
  start: number;
  end: number | null;
  error: boolean;
  file: string | null;
  plus: number;
  minus: number;
  /** "main", or "<agentId> <description>" for a call made inside a subagent. */
  agent: string;
  /** True when no rule or Claude-written description gave this call a good label. */
  needsLabel: boolean;
  /** True when the rules cannot see what a script does, so the local model picks the lane. */
  needsLane: boolean;
  /** Redacted, clipped input for a local model to read; empty unless `needsLabel` or `needsLane`. */
  summary: string;
  /** Byte offset of this call's line in its own transcript, so its result can be re-read later. */
  pos: number;
}
export interface Result {
  id: string;
  end: number;
  error: boolean;
  preview: string;
}
export interface Prompt {
  at: number;
  text: string;
}
export interface Say {
  at: number;
  text: string;
}
export interface Chunk {
  calls: Call[];
  results: Result[];
  prompts: Prompt[];
  says: Say[];
}

const SECRET =
  /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|(?:Bearer|token|password|secret|api[_-]?key)(?:\s*[:=]\s*|\s+)["']?[^\s"']{8,})/giu;

/** Masks anything that looks like a credential: this page is meant for a shared screen. */
export const redact = (s: string): string => s.replace(SECRET, "•••");

/** Trims and shortens, keeping line breaks (unlike `clip`, which flattens them for one-liners). */
export const cut = (s: string, n: number): string => {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
/** Longest user or Claude message kept for the conversation. */
const TURN_MAX = 4000;
const bytes = new TextEncoder();

export const clip = (s: string, n: number): string => {
  const one = s.replaceAll(/\s+/gu, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};
const base = (p: string): string => p.split("/").findLast(Boolean) ?? p;
const lines = (s: unknown): number =>
  typeof s === "string" && s.length > 0 ? s.split("\n").length : 0;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const LOOK_CMD =
  /^(cat|ls|grep|rg|head|tail|less|find|\/usr\/bin\/find|wc|jq|tree|stat|file|which|pwd|echo|diff|git (status|log|show|diff|branch|blame))\b/u;
const CHANGE_CMD =
  /^(sed -i|mv|cp|rm|mkdir|touch|tee|ln|chmod|git (add|commit|checkout|switch|restore|reset|stash|merge|rebase|apply|push|tag))\b/u;
const VERIFY_CMD =
  /^(pytest|tox|nox|jest|vitest|playwright|tsc|eslint|oxlint|ruff|mypy|pyright|shellcheck|hadolint|make|gradle|mvn|go (test|vet|build)|cargo (test|check|clippy|build)|docker (compose )?build|(uv|poetry) run (pytest|ruff|mypy|pyright|tox)|python3? -m (pytest|unittest|mypy|ruff)|(npm|pnpm|yarn|bun) (test|run (test|lint|typecheck|type-check|check|build|verify))|terraform (validate|plan))\b/u;
const VERIFY_ANY = /\bviz(\.ts)? (verify|audit|lint)\b/u;
/** Runs code the rules cannot read: a heredoc, `-c`/`-e`, or a script file. */
const INTERPRETER = /^(python3?|node|bun|deno|ruby|perl|bash|sh|zsh|uv run python3?)\b/u;
/** Steps that do nothing on their own: moving about, loop syntax, setting variables. */
const NEUTRAL = /^(cd|export|set|source|\.|true|:|sleep|for|done|if|fi|while|wait|\(|\))(\s|$)/u;
/** Writing to a file with `>`, but not to /dev/null and not `2>&1`. */
const WRITES = /(^|[^2&])>>?\s*(?![&\s]|\/dev\/)/u;
/** A chain is as consequential as its strongest step. */
const WEIGHT: Lane[] = ["look", "run", "verify", "change"];

/** The steps of a shell command: heredoc bodies and quoted text are blanked so they cannot split it. */
export function shellSteps(cmd: string): string[] {
  const flat = cmd
    .replaceAll(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1(?=\s|$)/gu, "<<HEREDOC")
    .replaceAll(/'[^']*'|"(?:[^"\\]|\\.)*"/gu, "''");
  return flat
    .split(/&&|\|\||[;|\n]/u)
    .map((s) =>
      s
        .trim()
        .replace(/^(do|then|else)\s+/u, "")
        .replace(/^(\w+=\S*\s+)+/u, "")
        .replace(/^(sudo|time|exec|nohup|command)\s+/u, ""),
    )
    .filter((s) => s && !NEUTRAL.test(s));
}

/** What one shell step does; "ask" when only reading the script it runs would tell. */
export function stepLane(s: string): Lane | "ask" {
  if (VERIFY_ANY.test(s) || VERIFY_CMD.test(s)) return "verify";
  if (CHANGE_CMD.test(s)) return "change";
  if (LOOK_CMD.test(s)) return WRITES.test(s) ? "change" : "look";
  return INTERPRETER.test(s) ? "ask" : "run";
}

/** A shell command's lane, and whether the local model should look at a script in it. */
function shellLane(cmd: string): { lane: Lane; ask: boolean } {
  const kinds = shellSteps(cmd).map(stepLane);
  const known = kinds.filter((k): k is Lane => k !== "ask");
  const ask = kinds.includes("ask");
  // A script runs something, so it is at least Run until the model says otherwise.
  const floor = ask ? 1 : 0;
  const w = Math.max(floor, ...known.map((k) => WEIGHT.indexOf(k)));
  /* c8 ignore next -- w is always an index of WEIGHT (0 when no step counts) */
  const lane = WEIGHT[w] ?? "look";
  return { lane, ask: ask && lane !== "change" };
}

/** True when a shell call runs a script the rules cannot read, so the local model should pick its lane. */
export const asksLane = (tool: string, input: Record<string, unknown>): boolean =>
  tool === "Bash" && shellLane(str(input["command"])).ask;

/** The lane a tool call belongs in. A shell command takes the strongest lane among its steps. */
export function laneOf(tool: string, input: Record<string, unknown>): Lane {
  if (/^(Read|Grep|Glob|LS|LSP|NotebookRead)$/u.test(tool)) return "look";
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/u.test(tool)) return "change";
  if (/^(Agent|Task|Workflow|SendMessage)$/u.test(tool)) return "delegate";
  if (/^(WebFetch|WebSearch)$/u.test(tool) || tool.startsWith("mcp__")) return "outside";
  if (tool === "Bash") return shellLane(str(input["command"])).lane;
  if (/^(BashOutput|Monitor|KillShell|TaskStop)$/u.test(tool)) return "run";
  return "plan";
}

function describeOther(
  tool: string,
  input: Record<string, unknown>,
): { label: string; detail: string; file: null } {
  const detail = redact(clip(JSON.stringify(input), 300));
  if (!tool.startsWith("mcp__")) return { label: tool, detail, file: null };
  const [, server = "", name = ""] = tool.split("__");
  return { label: `${server} → ${name.replaceAll("_", " ")}`, detail, file: null };
}

const FILE_VERB: Record<string, string> = {
  Read: "Reading",
  Edit: "Editing",
  MultiEdit: "Editing",
  Write: "Writing",
  NotebookEdit: "Editing notebook",
};

/** A short, plain-English sentence for what the call is doing, plus the raw detail. */
export function describe(
  tool: string,
  input: Record<string, unknown>,
): { label: string; detail: string; file: string | null } {
  const path = str(input["file_path"]) || str(input["notebook_path"]) || str(input["path"]);
  const verb = FILE_VERB[tool];
  if (verb) return { label: `${verb} ${base(path)}`, detail: path, file: path || null };
  switch (tool) {
    case "Grep":
      return {
        label: `Searching code for “${clip(str(input["pattern"]), 40)}”`,
        detail: `${str(input["pattern"])}  in ${path || "."}`,
        file: null,
      };
    case "Glob":
      return {
        label: `Finding files ${clip(str(input["pattern"]), 40)}`,
        detail: str(input["pattern"]),
        file: null,
      };
    case "Bash": {
      const cmd = redact(str(input["command"]));
      const d = str(input["description"]);
      return { label: d ? clip(d, 70) : `Running ${clip(cmd, 60)}`, detail: cmd, file: null };
    }
    case "Agent":
    case "Task":
      return {
        label: `Sending a helper: ${clip(str(input["description"]), 50)}`,
        detail: redact(clip(str(input["prompt"]), 400)),
        file: null,
      };
    case "WebSearch":
      return {
        label: `Searching the web: ${clip(str(input["query"]), 50)}`,
        detail: str(input["query"]),
        file: null,
      };
    case "WebFetch": {
      const url = str(input["url"]);
      return {
        label: `Fetching ${url.replace(/^https?:\/\//u, "").split("/")[0] ?? url}`,
        detail: url,
        file: null,
      };
    }
    case "Skill":
      return {
        label: `Loading the ${str(input["skill"])} skill`,
        detail: str(input["args"]),
        file: null,
      };
    case "TodoWrite":
      return { label: "Updating its to-do list", detail: "", file: null };
    case "ToolSearch":
      return { label: "Loading more tools", detail: str(input["query"]), file: null };
    default:
      return describeOther(tool, input);
  }
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const recs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRec) : []);

function editSize(tool: string, input: Record<string, unknown>): { plus: number; minus: number } {
  if (tool === "Write") return { plus: lines(input["content"]), minus: 0 };
  if (tool === "Edit")
    return { plus: lines(input["new_string"]), minus: lines(input["old_string"]) };
  if (tool === "MultiEdit") {
    let plus = 0;
    let minus = 0;
    for (const e of recs(input["edits"])) {
      plus += lines(e["new_string"]);
      minus += lines(e["old_string"]);
    }
    return { plus, minus };
  }
  return { plus: 0, minus: 0 };
}

function resultText(c: Record<string, unknown>): string {
  const v = c["content"];
  if (typeof v === "string") return v;
  return Array.isArray(v)
    ? recs(v)
        .map((p) => str(p["text"]))
        .join(" ")
    : "";
}

/** True for a prompt the user typed (not a slash-command wrapper, reminder, or interrupt). */
const PASTED = /<\/?pasted_content[^>]*>/gu;
/** A typed prompt's text with paste wrappers removed, or null if it was not typed. */
export const typed = (t: string): string | null => {
  const text = t.replaceAll(PASTED, "").trim();
  return isTyped(text) ? redact(cut(text, TURN_MAX)) : null;
};
const isTyped = (t: string): boolean =>
  t.trim().length > 0 && !t.trimStart().startsWith("<") && !t.startsWith("[Request interrupted");

function userRow(content: unknown, at: number, out: Chunk): void {
  if (typeof content === "string") {
    const text = typed(content);
    if (text) out.prompts.push({ at, text });
    return;
  }
  for (const c of recs(content)) {
    if (c["type"] === "tool_result") {
      out.results.push({
        id: str(c["tool_use_id"]),
        end: at,
        error: c["is_error"] === true,
        preview: redact(clip(resultText(c), 160)),
      });
    } else if (c["type"] === "text") {
      const text = typed(str(c["text"]));
      if (text) out.prompts.push({ at, text });
    }
  }
}

export const MAIN = "main";
/** The id half of a call's `agent` tag. */
export const agentId = (agent: string): string => agent.split(" ", 1).join("");
/** The description half of a call's `agent` tag. */
export const agentName = (agent: string): string => agent.slice(agentId(agent).length + 1);

export interface HelperNode {
  id: string;
  name: string;
  start: number;
  /** The helper whose transcript holds the Agent call that launched this one; null for the main session. */
  parent: string | null;
  /** 1 for a helper launched by the main session, 2 for one launched by a helper, and so on. */
  depth: number;
}

/**
 * The helpers that have made a call, as a depth-first list: each helper is followed by the helpers
 * it launched, siblings in the order they started. A helper's parent is the owner of the call its
 * `toolUseId` points at, so any nesting depth works; one whose launcher is unknown counts as main's.
 */
export function helperTree(
  agents: readonly { id: string; toolUseId: string }[],
  calls: readonly { id: string; agent: string; start: number }[],
): HelperNode[] {
  const byId = new Map<string, HelperNode>();
  for (const c of calls) {
    if (c.agent === MAIN) continue;
    const id = agentId(c.agent);
    const node = byId.get(id) ?? {
      id,
      name: agentName(c.agent),
      start: c.start,
      parent: null,
      depth: 1,
    };
    node.start = Math.min(node.start, c.start);
    byId.set(id, node);
  }
  const owner = new Map(calls.map((c) => [c.id, c.agent === MAIN ? "" : agentId(c.agent)]));
  for (const a of agents) {
    const node = byId.get(a.id);
    const launcher = owner.get(a.toolUseId);
    if (node && launcher && launcher !== a.id && byId.has(launcher)) node.parent = launcher;
  }
  const out: HelperNode[] = [];
  const walk = (parent: string | null, depth: number): void => {
    const kids = [...byId.values()].filter((n) => n.parent === parent);
    for (const n of kids.toSorted((x, y) => x.start - y.start)) {
      out.push({ ...n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 1);
  return out;
}

/** Tools whose label comes from a clear rule or from Claude's own `description`. */
const RULE_LABELLED = new Set([
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Grep",
  "Glob",
  "Bash",
  "Agent",
  "Task",
  "WebSearch",
  "WebFetch",
  "Skill",
  "TodoWrite",
  "ToolSearch",
]);

/** True when the label is only a fallback (MCP and unknown tools, Bash with no description). */
export const needsLabel = (tool: string, input: Record<string, unknown>): boolean =>
  !RULE_LABELLED.has(tool) || (tool === "Bash" && !str(input["description"]));

/** Tidies a local model's multi-line reply: blank lines and bold dropped, "*" bullets made "-", or null. */
export function cleanLines(raw: string): string | null {
  const kept = raw
    .split("\n")
    .map((l) =>
      l
        .replaceAll("**", "")
        .trim()
        .replace(/^[*•]\s+/u, "- "),
    )
    .filter(Boolean);
  return kept.length > 0 ? redact(kept.join("\n")) : null;
}

/** Tidies a local model's reply onto one line, whole: quotes and the full stop off, or null if it said nothing. */
export function cleanLabel(raw: string): string | null {
  const one = redact(raw.replaceAll(/\s+/gu, " ").trim()).replaceAll(/^["'`“]+|["'`”.]+$/gu, "");
  return one.trim() || null;
}

function assistantRow(content: unknown, at: number, out: Chunk, agent: string, pos: number): void {
  for (const c of recs(content)) {
    if (c["type"] === "text" && str(c["text"]).trim()) {
      out.says.push({ at, text: redact(cut(str(c["text"]), TURN_MAX)) });
    } else if (c["type"] === "tool_use") {
      const tool = str(c["name"]);
      const input = isRec(c["input"]) ? c["input"] : {};
      const lazy = needsLabel(tool, input);
      const script = asksLane(tool, input);
      out.calls.push({
        id: str(c["id"]),
        tool,
        lane: laneOf(tool, input),
        ...describe(tool, input),
        start: at,
        end: null,
        error: false,
        ...editSize(tool, input),
        agent,
        needsLabel: lazy,
        needsLane: script,
        // A script's body is what tells the model where it belongs, so it gets more room.
        summary: lazy || script ? redact(clip(JSON.stringify(input), script ? 4000 : 1500)) : "",
        pos,
      });
    }
  }
}

/** A message the user sent while Claude was working: a user turn, though not a `user` line. */
function queuedRow(attachment: unknown, at: number, out: Chunk): void {
  if (!isRec(attachment) || attachment["type"] !== "queued_command") return;
  const text = typed(str(attachment["prompt"]));
  if (text) out.prompts.push({ at, text });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Parses complete transcript lines. Lines that fail to parse are skipped. A main transcript skips
 * its subagent (sidechain) lines; a subagent's own file (`agent` is not "main") keeps its calls and
 * results but not its prompts or replies, which belong to the helper, not the room.
 */
export function parseLines(text: string, agent = MAIN, origin = 0): Chunk {
  const sub = agent !== MAIN;
  const out: Chunk = { calls: [], results: [], prompts: [], says: [] };
  let pos = origin;
  for (const raw of text.split("\n")) {
    const start = pos;
    pos += bytes.encode(raw).length + 1;
    const row = raw.trim() ? parseJson(raw) : undefined;
    if (!isRec(row) || (!sub && row["isSidechain"] === true) || row["isMeta"] === true) continue;
    const at = Date.parse(str(row["timestamp"]));
    if (Number.isNaN(at)) continue;
    const msg = row["message"];
    if (row["type"] === "attachment") queuedRow(row["attachment"], at, out);
    else if (!isRec(msg)) continue;
    else if (row["type"] === "user") userRow(msg["content"], at, out);
    else if (row["type"] === "assistant") assistantRow(msg["content"], at, out, agent, start);
  }
  return sub ? { ...out, prompts: [], says: [] } : out;
}

/** Splits a buffer at its last newline: the head is complete lines, the tail waits for more bytes. */
export function completeLines(buf: string): { done: string; rest: number } {
  const i = buf.lastIndexOf("\n");
  return i < 0
    ? { done: "", rest: buf.length }
    : { done: buf.slice(0, i + 1), rest: buf.length - i - 1 };
}

export interface RoundSummary {
  /** From the round's first prompt to its last event. */
  totalMs: number;
  /** Share of the round's action time per lane, biggest first; lanes with no time are left out. */
  lanes: { lane: Lane; ms: number; pct: number }[];
  /** The single longest action, or null if the round had none. */
  slowest: { label: string; ms: number } | null;
}

/** How a finished round's time split across lanes, and which action took longest. */
export function summariseRound(
  calls: readonly { lane: Lane; label: string; start: number; end: number | null }[],
  from: number,
  to: number,
): RoundSummary {
  const spans = calls
    .filter((c) => c.start >= from)
    /* c8 ignore next -- the page only summarises a finished round, where nothing is still running */
    .map((c) => ({ lane: c.lane, label: c.label, ms: Math.max(0, (c.end ?? to) - c.start) }));
  const sum = spans.reduce((s, c) => s + c.ms, 0);
  const lanes = LANES.map((l) => {
    const ms = spans.filter((c) => c.lane === l.id).reduce((s, c) => s + c.ms, 0);
    return { lane: l.id, ms, pct: sum > 0 ? Math.round((ms / sum) * 100) : 0 };
  })
    .filter((l) => l.ms > 0)
    .toSorted((a, b) => b.ms - a.ms);
  const top = spans.toSorted((a, b) => b.ms - a.ms)[0];
  return {
    totalMs: Math.max(0, to - from),
    lanes,
    slowest: top && top.ms > 0 ? { label: top.label, ms: top.ms } : null,
  };
}

/** "42m" or "2h 05m": a gap's length, short enough for a narrow break. */
export function idleSpan(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export interface TimeScale {
  /** Pixels from the left edge for a time; times inside a folded gap land inside its break. */
  x: (t: number) => number;
  /** Each folded gap: its time range, and the pixel box that stands in for it. */
  breaks: { from: number; to: number; x0: number; x1: number }[];
  /** The time at a pixel offset: the inverse of `x`; a pixel inside a break lands inside its gap. */
  t: (px: number) => number;
  /** Time that is left once the folded gaps are taken out. */
  activeMs: number;
}

/**
 * Maps time to pixels with every quiet gap longer than `minGap` folded into a break of `breakPx`
 * pixels, so the busy parts get the width. `busy` are [start, end] spans (a prompt is [t, t]).
 * Pass `minGap` = Infinity for a plain linear scale.
 */
export function timeScale(
  t0: number,
  t1: number,
  width: number,
  busy: readonly (readonly [number, number])[],
  minGap: number,
  breakPx: number,
): TimeScale {
  const gaps: { from: number; to: number }[] = [];
  let cursor = t0;
  // Only what falls inside [t0, t1] counts: a span outside the view cannot open a gap in it.
  const inside = busy
    .filter(([s, e]) => e >= t0 && s <= t1)
    .map(([s, e]): [number, number] => [Math.max(s, t0), Math.min(e, t1)]);
  for (const [s, e] of inside.toSorted((a, b) => a[0] - b[0])) {
    if (s - cursor > minGap) gaps.push({ from: cursor, to: s });
    cursor = Math.max(cursor, e);
  }
  if (t1 - cursor > minGap) gaps.push({ from: cursor, to: t1 });
  const folded = gaps.reduce((s, g) => s + g.to - g.from, 0);
  const activeMs = Math.max(1, t1 - t0 - folded);
  const perMs = Math.max(1, width - gaps.length * breakPx) / activeMs;
  let removed = 0;
  const breaks = gaps.map((g, i) => {
    const x0 = (g.from - t0 - removed) * perMs + i * breakPx;
    removed += g.to - g.from;
    return { from: g.from, to: g.to, x0, x1: x0 + breakPx };
  });
  const x = (t: number): number => {
    let gone = 0;
    for (const [i, b] of breaks.entries()) {
      if (t >= b.to) gone += b.to - b.from;
      /* c8 ignore next -- the page only plots busy times, so just the unit tests land inside a break */
      else if (t > b.from) return b.x0 + ((t - b.from) / (b.to - b.from)) * breakPx;
      else return (t - t0 - gone) * perMs + i * breakPx;
    }
    return (t - t0 - gone) * perMs + breaks.length * breakPx;
  };
  const t = (px: number): number => {
    let gone = 0;
    for (const [i, b] of breaks.entries()) {
      if (px < b.x0) return t0 + gone + (px - i * breakPx) / perMs;
      if (px < b.x1) return b.from + ((px - b.x0) / breakPx) * (b.to - b.from);
      gone += b.to - b.from;
    }
    return t0 + gone + (px - breaks.length * breakPx) / perMs;
  };
  return { x, t, breaks, activeMs };
}

/** What a call did, re-read from its transcript: the call's tool and input, and its result if it has one. */
export function callExcerpt(
  text: string,
  id: string,
): { tool: string; input: string; result: string | null; error: boolean } | null {
  let found: { tool: string; input: string } | null = null;
  for (const raw of text.split("\n")) {
    const row = raw.trim() ? parseJson(raw) : undefined;
    const content = isRec(row) && isRec(row["message"]) ? row["message"]["content"] : undefined;
    for (const c of recs(content)) {
      if (c["type"] === "tool_use" && c["id"] === id) {
        found = { tool: str(c["name"]), input: redact(clip(JSON.stringify(c["input"]), 1500)) };
      } else if (found && c["type"] === "tool_result" && c["tool_use_id"] === id) {
        return {
          ...found,
          result: redact(cut(resultText(c), 2000)),
          error: c["is_error"] === true,
        };
      }
    }
  }
  return found && { ...found, result: null, error: false };
}

export const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Bold, italic, code and links, with code allowed inside bold and italic; everything else stays escaped text. */
function inlineMarkdown(s: string): string {
  const codes: string[] = [];
  // Code spans are set aside first so their contents are never read as formatting, then put back.
  const masked = s.replaceAll(/`([^`]+)`/gu, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  return escapeHtml(masked)
    .replaceAll(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>")
    .replaceAll(/(?<![*\w])\*(?![\s*])([^*]+?)\*(?![*\w])/gu, "<em>$1</em>")
    .replaceAll(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    )
    .replaceAll(/\uE000(\d+)\uE000/gu, (_, n: string) => String(codes[Number(n)]));
}

/**
 * Claude's last words before each prompt (and the latest overall) are its replies; whatever it said
 * on the way there are notes, which the conversation folds away with the actions.
 */
export function splitReplies(prompts: Prompt[], says: Say[]): { replies: Say[]; notes: Say[] } {
  const sorted = says.toSorted((x, y) => x.at - y.at);
  const replies: Say[] = [];
  const notes: Say[] = [];
  for (const [i, s] of sorted.entries()) {
    const next = sorted[i + 1];
    const last = !next || prompts.some((p) => p.at > s.at && p.at <= next.at);
    (last ? replies : notes).push(s);
  }
  return { replies, notes };
}

/**
 * When Claude was waiting on a person: from each final reply to the next prompt, while nothing ran.
 * A message typed while Claude was still working is not waiting. `openEnd` closes the last span
 * (the turn is finished and nobody has answered yet); null leaves it out.
 */
export function waitingSpans(
  prompts: Prompt[],
  says: Say[],
  calls: { start: number; end: number | null }[],
  openEnd: number | null,
): [number, number][] {
  const out: [number, number][] = [];
  for (const r of splitReplies(prompts, says).replies) {
    const next = prompts.find((p) => p.at > r.at)?.at ?? openEnd;
    if (next === null || next <= r.at) continue;
    const busy = calls.some((c) => c.start < next && (c.end ?? Infinity) > r.at);
    if (!busy) out.push([r.at, next]);
  }
  return out;
}

/** Markdown reduced to plain words for a one-line quote: no markers, links as their text, tables as runs. */
export const stripMarkdown = (s: string): string =>
  s
    .replaceAll(/```[^\n]*\n?/gu, "")
    .replaceAll(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/gu, "$1")
    .replaceAll(/^\s*\|?[\s:|-]+\|?\s*$/gmu, "")
    .replaceAll(/^(?:#{1,6}\s+|>\s?|\s*(?:[-*]|\d+\.)\s+)/gmu, "")
    .replaceAll(/[`*]/gu, "")
    .replaceAll(/\s*\|\s*/gu, " · ");

const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u;

/** The cells of a table row, without its outer pipes; `\|` stays a literal pipe. */
const cellsOf = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((c) => c.trim().replaceAll("\\|", "|"));

function tableHtml(head: string[], body: string[][]): string {
  const row = (tag: "th" | "td", cells: string[]): string =>
    `<tr>${cells.map((c) => `<${tag}>${inlineMarkdown(c)}</${tag}>`).join("")}</tr>`;
  return `<table><thead>${row("th", head)}</thead><tbody>${body.map((r) => row("td", r)).join("")}</tbody></table>`;
}

type Block = { kind: "p" | "q" | "ul" | "ol"; items: string[]; start: number };
const blockHtml = (b: Block): string => {
  if (b.kind === "p") return `<p>${b.items.join("<br>")}</p>`;
  if (b.kind === "q") return `<blockquote>${b.items.join("<br>")}</blockquote>`;
  const start = b.kind === "ol" && b.start !== 1 ? ` start="${b.start}"` : "";
  return `<${b.kind}${start}>${b.items.map((i) => `<li>${i}</li>`).join("")}</${b.kind}>`;
};

/**
 * Simple Markdown for Claude's replies: paragraphs, headings, blockquotes, bullet and numbered
 * lists, tables, fenced code, and inline bold, code and http(s) links. Everything is escaped
 * first, so nothing else gets through.
 */
export function renderMarkdown(src: string): string {
  const out: string[] = [];
  const rows = src.split("\n");
  let open: Block | null = null;
  let code: string[] | null = null;
  const flush = (): void => {
    if (open) out.push(blockHtml(open));
    open = null;
  };
  const add = (kind: Block["kind"], html: string, start = 1): void => {
    if (open && open.kind !== kind) flush();
    open = open ?? { kind, items: [], start };
    open.items.push(html);
  };
  let i = 0;
  while (i < rows.length) {
    const line = String(rows[i]);
    i++;
    const heading = /^#{1,6}\s+/u.exec(line);
    const marker = /^\s*(?:([-*])|(\d+)\.)\s+/u.exec(line);
    if (line.startsWith("```")) {
      if (code) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      else flush();
      code = code ? null : [];
    } else if (code) code.push(line);
    else if (line.includes("|") && TABLE_SEP.test(String(rows[i]))) {
      flush();
      const body: string[][] = [];
      i++;
      while (i < rows.length && String(rows[i]).includes("|")) {
        body.push(cellsOf(String(rows[i])));
        i++;
      }
      out.push(tableHtml(cellsOf(line), body));
    } else if (heading) {
      flush();
      const level = heading[0].trim().length;
      out.push(`<h${level}>${inlineMarkdown(line.slice(heading[0].length))}</h${level}>`);
    } else if (line.startsWith(">")) add("q", inlineMarkdown(line.replace(/^>\s?/u, "")));
    else if (marker)
      add(marker[1] ? "ul" : "ol", inlineMarkdown(line.slice(marker[0].length)), Number(marker[2]));
    else if (line.trim()) add("p", inlineMarkdown(line));
    else flush();
  }
  if (code) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flush();
  return out.join("");
}

export interface Range {
  t0: number;
  t1: number;
}

/** The shortest view the timeline will zoom to. */
export const MIN_SPAN = 5000;

/** Zooms by `factor` (below 1 zooms in) keeping `anchor` at the same place on screen. */
export function zoomAround(r: Range, anchor: number, factor: number): Range {
  const span = (r.t1 - r.t0) * factor;
  const t0 = anchor - ((anchor - r.t0) / (r.t1 - r.t0)) * span;
  return { t0, t1: t0 + span };
}

/** The range moved by `dt`. */
export const panBy = (r: Range, dt: number): Range => ({ t0: r.t0 + dt, t1: r.t1 + dt });

/** The two times of a brush, in either order, as a range at least `MIN_SPAN` long. */
export function brushRange(a: number, b: number): Range {
  const t0 = Math.min(a, b);
  return { t0, t1: Math.max(Math.max(a, b), t0 + MIN_SPAN) };
}

/** Keeps a range inside the session's bounds and no shorter than `MIN_SPAN` or longer than the bounds. */
export function clampRange(r: Range, bounds: Range): Range {
  const span = Math.min(Math.max(r.t1 - r.t0, MIN_SPAN), Math.max(bounds.t1 - bounds.t0, MIN_SPAN));
  const t0 = Math.min(Math.max(r.t0, bounds.t0), Math.max(bounds.t0, bounds.t1 - span));
  return { t0, t1: t0 + span };
}

/** True when a helper's transcript ends on a final reply: assistant text, with no tool call after it. */
export function endsFinal(tail: string): boolean {
  const row = parseJson(completeLines(tail).done.trimEnd().split("\n").at(-1) ?? "");
  const content = isRec(row) && isRec(row["message"]) ? row["message"]["content"] : undefined;
  const parts = isRec(row) && row["type"] === "assistant" ? recs(content) : [];
  return parts.some((c) => c["type"] === "text") && !parts.some((c) => c["type"] === "tool_use");
}
