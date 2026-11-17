// stack-model.ts: reads the r2-app-stack skill's own markdown into rules, sections and flags.
//
// ONE module for two readers. The poster's explorer runs it in the browser over fetched files;
// tests/r2-app-stack.test.ts runs the same code over the files on disk. Whatever the test accepts
// is what the page renders, and anything that does not parse comes back as a `Problem`, never as a
// silently thinner page. No DOM, no fs, no rule text lives here.

/** The skill's files, relative to the skill folder. The page reaches them through `skill/` (a symlink). */
export const FILES = [
  "SKILL.md",
  "reference/shared.md",
  "reference/test-stack.md",
  "reference/testable-apps.md",
  "reference/adopt.md",
  "reference/kinds/web-app.md",
  "reference/kinds/server.md",
  "reference/kinds/cli.md",
  "reference/kinds/python.md",
] as const;
export type SkillFile = (typeof FILES)[number];

export const REPO_URL = "https://github.com/RascalTwo/ai-setup/blob/main/skills/r2-app-stack/";

export type Flag = "candidate" | "not-decided" | "to-be-packaged" | "not-enforced" | "to-build";
export type Enforcement = "gate" | "human" | "none" | "unstated";

export interface Problem {
  file: string;
  line: number;
  message: string;
}

export interface Rule {
  file: string;
  /** 1-based line of the table row, or of the paragraph where a block rule starts. */
  line: number;
  form: "table" | "block";
  rule: string;
  why: string;
  sources: string;
  /** Empty only for a block that states its rule without an Enforced line. */
  enforced: string;
  /** Other bold-labelled paragraphs of a block rule: Known friction, Cost, Risk and fallback. */
  extras: { label: string; text: string }[];
  flags: Flag[];
}

export interface Bullet {
  line: number;
  label: string;
  text: string;
  flags: Flag[];
}

export interface Prose {
  line: number;
  text: string;
  flags: Flag[];
}

export interface Section {
  file: string;
  heading: string;
  level: number;
  /** 1-based line of the heading. */
  line: number;
  anchor: string;
  rules: Rule[];
  bullets: Bullet[];
  prose: Prose[];
  code: { lang: string; text: string; line: number }[];
  steps: { n: number; title: string; text: string; sub: string[]; line: number }[];
  /** A section called "Not decided yet": its bullets are parked items, not rules. */
  parked: boolean;
}

export interface Doc {
  file: string;
  title: string;
  sections: Section[];
  /** Rows of SKILL.md's "Building | Read" table. */
  routes: { building: string; read: string; line: number }[];
}

export interface Stack {
  docs: Record<string, Doc>;
  problems: Problem[];
}

// ---------------------------------------------------------------- text helpers

/** GitHub's heading anchor: lower case, punctuation dropped, every space a hyphen. */
export function slug(heading: string): string {
  return plain(heading)
    .toLowerCase()
    .replaceAll(/[^\w\s-]/gu, "")
    .trim()
    .replaceAll(/\s/gu, "-");
}

/** Markdown with its markup removed: code ticks, bold, link targets. */
export function plain(text: string): string {
  return text
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replaceAll(/\*\*([^*]+)\*\*/gu, "$1")
    .replaceAll("`", "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** The first sentence of `text` as plain words; a very short one takes the next sentence too. */
export function firstSentence(text: string, max = 160, min = 0): string {
  const parts = plain(text).match(/.*?\.(?=\s|$)|.+$/gu) ?? [""];
  let s = (parts[0] ?? "").replace(/\.$/u, "");
  for (let i = 1; s.length < min && parts[i] !== undefined; i++)
    s += `. ${(parts[i] ?? "").replace(/\.$/u, "").trim()}`;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export const esc = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Where a link written in `file` points: a sibling skill file becomes its place on GitHub. */
export function linkTo(href: string, file: string): string {
  if (/^https?:/u.test(href)) return href;
  try {
    return new URL(href, REPO_URL + file).href;
  } catch {
    return "#";
  }
}

/** A link to a file in the skill, to a heading in it, or to a line of its source. */
export function sourceUrl(file: string, at?: { anchor?: string; line?: number }): string {
  if (at?.line !== undefined) return `${REPO_URL}${file}?plain=1#L${at.line}`;
  return `${REPO_URL}${file}${at?.anchor ? `#${at.anchor}` : ""}`;
}

const TOKEN = /\[((?:[^\]`]|`[^`]*`)+)\]\(([^)\s]+)\)|`([^`]+)`/gu;
const bold = (s: string): string => esc(s).replaceAll(/\*\*(.+?)\*\*/gu, "<b>$1</b>");

/** The little markdown the skill uses (code, bold, links) as safe HTML. */
export function md(text: string, file: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += bold(text.slice(last, m.index));
    const [whole, linkText, href, code] = m;
    if (code !== undefined) out += `<code>${esc(code)}</code>`;
    else if (linkText !== undefined && href !== undefined)
      out += `<a href="${esc(linkTo(href, file))}">${md(linkText, file)}</a>`;
    last = m.index + whole.length;
  }
  return out + bold(text.slice(last));
}

// ---------------------------------------------------------------- flags

const CORE = ["rule", "why", "sources", "enforced"] as const;
const LABEL = /\*\*([A-Za-z][^*:]*?):\*\*/gu;

export function flagsOf(
  text: string,
  parts: {
    why?: string | undefined;
    enforced?: string | undefined;
    rule?: string | undefined;
  } = {},
): Flag[] {
  const out: Flag[] = [];
  // "candidate placement" / "candidate wiring" qualify a rule that stands; only a bare candidate is one.
  if (
    /^candidate\b(?! placement)/iu.test(parts.enforced ?? "") ||
    /^candidate\b/iu.test(parts.why ?? "") ||
    /^candidate\b/iu.test(parts.rule ?? text)
  )
    out.push("candidate");
  if (/to be packaged/iu.test(text)) out.push("to-be-packaged");
  if (/not enforced yet/iu.test(parts.enforced ?? "")) out.push("not-enforced");
  if (/\bto build\b|not yet built/iu.test(`${parts.enforced ?? ""} ${parts.why ?? ""} ${text}`))
    out.push("to-build");
  return out;
}

/** How hard a rule is held: a machine gate, a person reviewing, or nothing yet. */
export function enforcement(r: Pick<Rule, "enforced" | "flags">): Enforcement {
  const e = r.enforced.trim();
  if (e === "") return "unstated";
  if (
    e === "—" ||
    /not enforced yet|^candidate\b(?! placement)/iu.test(e) ||
    r.flags.includes("to-build")
  )
    return "none";
  if (/^review\b|\breview$/iu.test(e)) return "human";
  return "gate";
}

// ---------------------------------------------------------------- parsing

const HEADING = /^(#{1,6})\s+(.+?)\s*$/u;
const SEP = /^\|[\s:|-]+\|$/u;
const BLOCK_START = /^(?:```|\||[-*]\s|\d+\.\s)/u;
type CoreKey = (typeof CORE)[number];
const isCore = (k: string): k is CoreKey => (CORE as readonly string[]).includes(k);

function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const out: string[] = [];
  let cur = "";
  let tick = false;
  for (const ch of body) {
    if (ch === "`") tick = !tick;
    if (ch === "|" && !tick) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function bulletOf(text: string, line: number): Bullet {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/u.exec(text);
  if (!m) return { line, label: "", text, flags: flagsOf(text) };
  const [, raw = "", rest = ""] = m;
  // "**Styling.** Today…" and "**vitest:** a setup…" carry their label apart; "**Compare** with…" reads on.
  return {
    line,
    label: raw.replace(/[.:]$/u, "").trim(),
    text: /[.:]$/u.test(raw) ? rest : text,
    flags: flagsOf(text),
  };
}

interface Para {
  line: number;
  text: string;
}

/** Split a paragraph at its `**Label:**` markers. */
function segments(text: string): { lead: string; parts: { label: string; text: string }[] } {
  const marks = [...text.matchAll(LABEL)];
  const first = marks[0];
  if (!first) return { lead: text.trim(), parts: [] };
  const parts = marks.map((m, i) => ({
    label: m[1]?.trim() ?? "",
    text: text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim(),
  }));
  return { lead: text.slice(0, first.index).trim(), parts };
}

interface Fields {
  core: Partial<Record<CoreKey, string>>;
  extras: { label: string; text: string }[];
  consumed: Set<Para>;
  /** A paragraph that opens with bold text and no label: the rule itself, when a Why follows. */
  leadRule: Para | undefined;
  firstLine: number;
}

function collectFields(paras: Para[]): Fields {
  const f: Fields = {
    core: {},
    extras: [],
    consumed: new Set(),
    leadRule: undefined,
    firstLine: 0,
  };
  for (const p of paras) {
    const { lead, parts } = segments(p.text);
    const labelled = parts.filter((x) => isCore(x.label.toLowerCase()));
    if (labelled.length === 0) {
      if (parts.length === 0 && !f.leadRule && /^\*\*[^*]+\*\*/u.test(lead)) f.leadRule = p;
      continue;
    }
    f.consumed.add(p);
    f.firstLine ||= p.line;
    for (const part of parts) {
      const k = part.label.toLowerCase();
      if (isCore(k)) f.core[k] ??= part.text;
      else f.extras.push(part);
    }
    if (lead && !f.core.rule && !/^\*\*[^*]+:\*\*/u.test(lead)) f.core.rule = lead;
  }
  return f;
}

/** Pull one block rule (Rule/Why/Sources/Enforced paragraphs) out of a section's paragraphs; return the rest. */
function blockRule(sec: Section, paras: Para[], problems: Problem[]): Para[] {
  const f = collectFields(paras);
  const { why, sources, enforced } = f.core;
  if (why === undefined) return paras;
  let { rule } = f.core;
  if (rule === undefined && f.leadRule) {
    rule = f.leadRule.text.split(LABEL)[0]?.trim() ?? "";
    f.consumed.add(f.leadRule);
    f.firstLine = Math.min(f.firstLine, f.leadRule.line);
  }
  const at = (message: string) =>
    problems.push({ file: sec.file, line: f.firstLine, message: `${sec.heading}: ${message}` });
  if (!rule) at("a block with a Why has no Rule");
  if (!sources) at("a block with a Why has no Sources");
  if (paras.some((p) => /^\*\*Rule:\*\*/iu.test(p.text)) && !enforced)
    at("a block with **Rule:** has no Enforced");
  const all = [rule, why, sources, enforced, ...f.extras.map((x) => x.text)].join(" ");
  sec.rules.push({
    file: sec.file,
    line: f.firstLine,
    form: "block",
    rule: rule ?? "",
    why,
    sources: sources ?? "",
    enforced: enforced ?? "",
    extras: f.extras,
    flags: flagsOf(all, { why, enforced, rule }),
  });
  return paras.filter((p) => !f.consumed.has(p));
}

/** The state one file's parse carries from line to line. */
interface Ctx {
  file: string;
  lines: string[];
  i: number;
  doc: Doc;
  problems: Problem[];
  sec: Section | undefined;
  paras: Para[];
}

const line = (c: Ctx): string => c.lines[c.i] ?? "";
const problem = (c: Ctx, at: number, message: string) =>
  c.problems.push({ file: c.file, line: at, message });

function closeSection(c: Ctx): void {
  const { sec } = c;
  if (!sec) return;
  const rest = sec.heading === "Contents" ? [] : blockRule(sec, c.paras, c.problems);
  for (const p of rest)
    sec.prose.push({ line: p.line, text: p.text, flags: flagsOf(p.text, { rule: p.text }) });
  c.paras = [];
}

function openSection(c: Ctx, heading: string, level: number): void {
  closeSection(c);
  c.sec = {
    file: c.file,
    heading,
    level,
    line: c.i + 1,
    anchor: slug(heading),
    rules: [],
    bullets: [],
    prose: [],
    code: [],
    steps: [],
    parked: /^not decided yet\b/iu.test(heading),
  };
  c.doc.sections.push(c.sec);
}

function readFence(c: Ctx): void {
  const start = c.i + 1;
  const lang = line(c).slice(3).trim();
  const body: string[] = [];
  for (c.i++; c.i < c.lines.length && !line(c).startsWith("```"); c.i++) body.push(line(c));
  if (c.i >= c.lines.length) problem(c, start, "code fence is never closed");
  c.sec?.code.push({ lang, text: body.join("\n"), line: start });
  c.i++;
}

function readHeading(c: Ctx, hashes: string, title: string): void {
  if (hashes.length === 1) c.doc.title = title;
  openSection(c, hashes.length === 1 ? title : plain(title), hashes.length);
  c.i++;
}

function readRow(
  c: Ctx,
  names: string[],
  isRule: boolean,
  r: { line: number; text: string },
): void {
  const cs = cells(r.text);
  if (cs.length !== names.length || cs.some((x) => x === "")) {
    problem(
      c,
      r.line,
      `table row has ${cs.length} cells (${cs.filter((x) => x === "").length} empty), the header has ${names.length}`,
    );
    return;
  }
  const [a = "", b = "", d = "", e = ""] = cs;
  if (!isRule) c.doc.routes.push({ building: a, read: b, line: r.line });
  else
    c.sec?.rules.push({
      file: c.file,
      line: r.line,
      form: "table",
      rule: a,
      why: b,
      sources: d,
      enforced: e,
      extras: [],
      flags: flagsOf(cs.join(" "), { why: b, enforced: e, rule: a }),
    });
}

function readTable(c: Ctx): void {
  const start = c.i + 1;
  const rows: { line: number; text: string }[] = [];
  for (; c.i < c.lines.length && line(c).startsWith("|"); c.i++)
    rows.push({ line: c.i + 1, text: line(c) });
  const [head, sep] = rows;
  if (!head || !sep || !SEP.test(sep.text.trim())) {
    problem(
      c,
      start,
      "table row outside a table (a paragraph broke the table, or its header and --- rows are missing)",
    );
    return;
  }
  const names = cells(head.text).map((x) => x.toLowerCase());
  const isRule = names.join("|") === CORE.join("|");
  if (!c.sec || (!isRule && names.join("|") !== "building|read")) {
    problem(c, start, `table header "${names.join(" | ")}" is not Rule | Why | Sources | Enforced`);
    return;
  }
  for (const r of rows.slice(2)) readRow(c, names, isRule, r);
}

function readBullet(c: Ctx): void {
  const start = c.i + 1;
  let t = line(c).replace(/^[-*]\s+/u, "");
  for (c.i++; c.i < c.lines.length && /^\s{2,}\S/u.test(line(c)); c.i++) t += ` ${line(c).trim()}`;
  c.sec?.bullets.push(bulletOf(t, start));
}

function readStep(c: Ctx): void {
  const m = /^(\d+)\.\s+(?:\*\*(.+?)\*\*\s*)?(.*)$/u.exec(line(c));
  const step = {
    n: Number(m?.[1] ?? 0),
    title: m?.[2] ?? "",
    text: m?.[3] ?? "",
    sub: [] as string[],
    line: c.i + 1,
  };
  const nextIndented = () => /^\s+\d+\./u.test(c.lines[c.i + 1] ?? "");
  for (
    c.i++;
    c.i < c.lines.length && (/^\s+\S/u.test(line(c)) || (line(c) === "" && nextIndented()));
    c.i++
  ) {
    const sub = /^\s+\d+\.\s+(.*)$/u.exec(line(c));
    if (sub?.[1]) step.sub.push(sub[1]);
    else if (line(c).trim()) step.text += ` ${line(c).trim()}`;
  }
  c.sec?.steps.push(step);
}

function readParagraph(c: Ctx): void {
  const start = c.i + 1;
  let t = line(c).trim();
  for (
    c.i++;
    c.i < c.lines.length &&
    line(c).trim() !== "" &&
    !HEADING.test(line(c)) &&
    !BLOCK_START.test(line(c));
    c.i++
  )
    t += ` ${line(c).trim()}`;
  c.paras.push({ line: start, text: t });
}

export function parseDoc(file: string, text: string): { doc: Doc; problems: Problem[] } {
  const c: Ctx = {
    file,
    lines: text.split("\n"),
    i: 0,
    doc: { file, title: "", sections: [], routes: [] },
    problems: [],
    sec: undefined,
    paras: [],
  };
  if (c.lines[0]?.trim() === "---") {
    c.i = c.lines.indexOf("---", 1) + 1;
    if (c.i === 0) problem(c, 1, "front matter is never closed");
  }
  while (c.i < c.lines.length) {
    const ln = line(c);
    const h = HEADING.exec(ln);
    if (ln.startsWith("```")) readFence(c);
    else if (h) readHeading(c, h[1] ?? "", h[2] ?? "");
    else if (ln.startsWith("|")) readTable(c);
    else if (/^[-*]\s/u.test(ln)) readBullet(c);
    else if (/^\d+\.\s/u.test(ln)) readStep(c);
    else if (ln.trim() === "") c.i++;
    else readParagraph(c);
  }
  closeSection(c);
  if (!c.doc.title) problem(c, 1, "no # title");
  for (const s of c.doc.sections)
    if (s.parked) for (const b of s.bullets) b.flags.push("not-decided");
  return { doc: c.doc, problems: c.problems };
}

/** Parse every file the explorer needs. `read` throws or rejects when a file can't be had. */
export async function loadStack(read: (file: string) => Promise<string>): Promise<Stack> {
  const stack: Stack = { docs: {}, problems: [] };
  await Promise.all(
    FILES.map(async (file) => {
      let text: string;
      try {
        text = await read(file);
      } catch (e) {
        stack.problems.push({
          file,
          line: 0,
          message: `could not be loaded: ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }
      const { doc, problems } = parseDoc(file, text);
      stack.docs[file] = doc;
      stack.problems.push(...problems);
      const ruleCount = doc.sections.reduce((n, s) => n + s.rules.length, 0);
      if (file.startsWith("reference/kinds/") && ruleCount === 0)
        stack.problems.push({ file, line: 1, message: "a kind page yielded no rules" });
    }),
  );
  stack.problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return stack;
}

// ---------------------------------------------------------------- lookups

export interface Ref {
  file: SkillFile;
  /** Part of a heading, any case. Omitted: every section of the file. */
  heading?: string;
}

export function sectionsOf(stack: Stack, ref: Ref): Section[] {
  const doc = stack.docs[ref.file];
  if (!doc) return [];
  const h = ref.heading?.toLowerCase();
  return doc.sections.filter((s) => h === undefined || s.heading.toLowerCase().includes(h));
}

/** Everything a section says, as plain text for matching. */
export function sectionText(s: Section): string {
  return plain(
    [
      ...s.rules.flatMap((r) => [
        r.rule,
        r.why,
        r.sources,
        r.enforced,
        ...r.extras.map((x) => x.text),
      ]),
      ...s.bullets.map((b) => `${b.label} ${b.text}`),
      ...s.prose.map((p) => p.text),
      ...s.code.map((c) => c.text),
    ].join(" "),
  );
}
