// stack-lens.ts: what the explorer looks AT in the parsed skill. It holds no rule text.
//
// The matrix says "this kind, this layer: these tools, backed by these sections"; the flow says
// "these nodes, taken from these bullets". Every tool name and every node is checked against the
// parsed markdown (`checkLens`), so when the skill changes a tool the page can't go on showing the old
// one: the check returns a Problem, which the page shows as a banner and tests/ fails on.
import {
  enforcement,
  firstSentence,
  plain,
  sectionsOf,
  type Bullet,
  type Enforcement,
  type Flag,
  type Problem,
  type Prose,
  type Ref,
  type Rule,
  type Section,
  type SkillFile,
  type Stack,
} from "./stack-model.js";

// ---------------------------------------------------------------- the matrix

export const KINDS = [
  { id: "shared", label: "Shared TypeScript", tab: "shared" },
  { id: "web", label: "Web app", tab: "web-app" },
  { id: "server", label: "Server", tab: "server" },
  { id: "cli", label: "CLI", tab: "cli" },
  { id: "python", label: "Python", tab: "python" },
] as const;
export type KindId = (typeof KINDS)[number]["id"];

export const LAYERS = [
  { id: "runtime", label: "Language and runtime" },
  { id: "framework", label: "Framework and libraries" },
  { id: "types", label: "Types" },
  { id: "lint", label: "Lint" },
  { id: "format", label: "Format" },
  { id: "tests", label: "Tests and runners" },
  { id: "coverage", label: "Coverage" },
  { id: "shots", label: "Screenshots" },
  { id: "gates", label: "Gates and check" },
  { id: "deploy", label: "Deploy" },
] as const;
export type LayerId = (typeof LAYERS)[number]["id"];

/** A tool chip. `label` is shown; `needle` (default: the label) must occur in the cited sections. */
export interface Tool {
  label: string;
  needle?: string;
  /** Shown beside the chip, e.g. "fallback". */
  note?: string;
}
export interface Cell {
  refs: Ref[];
  tools: Tool[];
}

const SHARED = "reference/shared.md";
const TESTS = "reference/test-stack.md";
const WEB = "reference/kinds/web-app.md";
const SERVER = "reference/kinds/server.md";
const CLI = "reference/kinds/cli.md";
const PY = "reference/kinds/python.md";
const cell = (refs: Ref[], tools: (string | Tool)[]): Cell => ({
  refs,
  tools: tools.map((t) => (typeof t === "string" ? { label: t } : t)),
});

export const MATRIX: Record<LayerId, Partial<Record<KindId, Cell>>> = {
  runtime: {
    shared: cell(
      [
        { file: SHARED, heading: "Language and runtime" },
        { file: SHARED, heading: "Types" },
      ],
      ["TypeScript 7", "Node 24", "ESM", { label: "no Bun", needle: "No Bun" }],
    ),
    server: cell(
      [{ file: SERVER, heading: "Where it runs" }],
      ["AWS Lambda", { label: "Node server for WebSockets", needle: "long-running Node server" }],
    ),
    cli: cell([{ file: CLI }], ["Node 24", "type stripping"]),
    python: cell(
      [{ file: PY, heading: "Runtime and dependencies" }],
      [
        "Python ≥ 3.12",
        { label: "uv", needle: "uv for anything" },
        { label: "standard library first", needle: "standard library only" },
      ],
    ),
  },
  framework: {
    shared: cell(
      [{ file: SHARED, heading: "Language and runtime" }],
      [{ label: "zod at boundaries", needle: "Validate data at every trust boundary with zod" }],
    ),
    web: cell([{ file: WEB }], ["React 19", "Vite 8"]),
    server: cell(
      [{ file: SERVER, heading: "Framework" }],
      [
        "Hono 4",
        "@hono/zod-openapi",
        { label: "Fastify 5", needle: "Fastify 5", note: "fallback" },
      ],
    ),
    python: cell(
      [{ file: PY, heading: "Services" }],
      ["FastAPI", { label: "pydantic settings", needle: "BaseSettings" }],
    ),
  },
  types: {
    shared: cell(
      [{ file: SHARED, heading: "Types" }],
      [
        "TypeScript 7",
        { label: "strict flag set", needle: "The strict flag set" },
        { label: "typecheck per program", needle: "typecheck script runs tsc -p" },
      ],
    ),
    python: cell(
      [{ file: PY, heading: "Types" }],
      ["basedpyright", { label: "every check an error", needle: 'typeCheckingMode = "all"' }],
    ),
  },
  lint: {
    shared: cell(
      [{ file: SHARED, heading: "Lint" }],
      [
        "oxlint",
        { label: "type-aware (tsgolint)", needle: "oxlint-tsgolint" },
        { label: "a reason per disabled rule", needle: "Every rule turned off has a written" },
      ],
    ),
    web: cell([{ file: WEB }], ["jsx-a11y"]),
    cli: cell(
      [{ file: CLI }],
      [
        {
          label: "linted like the app",
          needle: "Scripts are linted, formatted and type-checked like the app",
        },
      ],
    ),
    python: cell(
      [{ file: PY, heading: "Lint and format" }],
      ["ruff", { label: "every rule on", needle: "ruff with every rule on" }],
    ),
  },
  format: {
    shared: cell([{ file: SHARED, heading: "Format" }], [{ label: "oxfmt", note: "no config" }]),
    python: cell([{ file: PY, heading: "Lint and format" }], ["ruff format"]),
  },
  tests: {
    shared: cell(
      [
        { file: TESTS, heading: "Runners" },
        { file: TESTS, heading: "One result list" },
      ],
      ["vitest", "Playwright Test", "Testing Library", { label: "Allure 3", needle: "Allure 3" }],
    ),
    web: cell(
      [{ file: WEB }],
      [
        { label: "the built bundle", needle: "run the built bundle" },
        { label: "page.route fakes", needle: "page.route" },
      ],
    ),
    server: cell(
      [{ file: SERVER, heading: "Other rules" }],
      [
        { label: "app.request() in-process", needle: "app.request" },
        { label: "synthetic Lambda event", needle: "synthetic API Gateway event" },
      ],
    ),
    cli: cell(
      [{ file: CLI }],
      [{ label: "real CLI, fake programs on PATH", needle: "fake programs on PATH" }],
    ),
    python: cell(
      [{ file: PY, heading: "Tests and coverage" }],
      ["pytest", { label: "strict = true", needle: "strict = true" }],
    ),
  },
  coverage: {
    shared: cell(
      [
        { file: TESTS, heading: "Coverage: Istanbul" },
        { file: TESTS, heading: "Per-test coverage" },
        { file: TESTS, heading: "One result list" },
        { file: TESTS, heading: "Mutation testing" },
      ],
      [
        "Istanbul",
        "monocart-coverage-reports",
        "cov-map",
        { label: "floor that only rises", needle: "floor that only rises" },
        "Stryker",
        "fast-check",
      ],
    ),
    web: cell(
      [{ file: WEB }],
      [{ label: "instrumented bundle", needle: "instrumented for coverage (Istanbul plugin)" }],
    ),
    python: cell(
      [{ file: PY, heading: "Tests and coverage" }],
      ["coverage.py", { label: "per-test contexts", needle: "dynamic contexts" }, "mutmut"],
    ),
  },
  shots: {
    shared: cell(
      [{ file: TESTS, heading: "Screenshots and approval" }],
      [
        "toHaveScreenshot",
        { label: "updateSnapshots: none", needle: "updateSnapshots: 'none'" },
        { label: "approve one at a time", needle: "approve or reject one at a time" },
        { label: "baselines made in Docker", needle: "Playwright's Docker image" },
      ],
    ),
  },
  gates: {
    shared: cell(
      [
        { file: SHARED, heading: "The check command" },
        { file: SHARED, heading: "Hooks and CI" },
        { file: TESTS, heading: "One result list" },
      ],
      [
        { label: "one command, cheapest first", needle: "One command runs every check" },
        { label: "fast mode for pre-commit", needle: "A fast mode for the pre-commit hook" },
        { label: "CI runs the same command", needle: "CI runs the same full check command" },
        { label: "gates tested both ways", needle: "Gates are tested both ways" },
        { label: "Allure quality gate", needle: "quality gate" },
      ],
    ),
    python: cell(
      [{ file: PY, heading: "The check command" }],
      [
        "./check",
        { label: "every step, even after a failure", needle: "every step even after a failure" },
      ],
    ),
  },
  deploy: {
    shared: cell(
      [{ file: SHARED, heading: "Hooks and CI" }],
      [
        {
          label: "deploy only after check passes",
          needle: "build and deploy jobs run only after it passes",
        },
      ],
    ),
    web: cell(
      [{ file: WEB }],
      [
        { label: "Docker → ghcr → NAS", needle: "Docker image → ghcr → signed webhook → NAS" },
        { label: "S3 + CloudFront via SAM", needle: "S3 + CloudFront behind AuthGuard via SAM" },
      ],
    ),
    server: cell(
      [{ file: SERVER, heading: "Other rules" }],
      [{ label: "esbuild, one file", needle: "esbuild, minified, one file" }],
    ),
    cli: cell([{ file: CLI }], [{ label: "dry run first", needle: "has a dry run" }]),
  },
};

// ---------------------------------------------------------------- evidence

export type Hit =
  | { kind: "rule"; rule: Rule; section: Section }
  | { kind: "bullet"; bullet: Bullet; section: Section }
  | { kind: "prose"; prose: Prose; section: Section };

const norm = (s: string): string => plain(s).toLowerCase();
export const needleOf = (t: Tool): string => t.needle ?? t.label;

export function cellSections(stack: Stack, c: Cell): Section[] {
  return c.refs.flatMap((r) => sectionsOf(stack, r));
}

/** Where the skill says the tool: rules first, then bullets and prose of the cited sections. */
export function hitsFor(stack: Stack, c: Cell, t: Tool): Hit[] {
  const n = norm(needleOf(t));
  const out: Hit[] = [];
  for (const section of cellSections(stack, c)) {
    for (const rule of section.rules) {
      const text = [
        rule.rule,
        rule.why,
        rule.sources,
        rule.enforced,
        ...rule.extras.map((x) => x.text),
      ].join(" ");
      if (norm(text).includes(n)) out.push({ kind: "rule", rule, section });
    }
    for (const bullet of section.bullets)
      if (norm(`${bullet.label} ${bullet.text}`).includes(n))
        out.push({ kind: "bullet", bullet, section });
    for (const prose of section.prose)
      if (norm(prose.text).includes(n)) out.push({ kind: "prose", prose, section });
  }
  return out;
}

export interface ToolState {
  hits: Hit[];
  enforcement: Enforcement | "unknown";
  flags: Flag[];
}

/** What the skill says about a tool: how hard it is held, and whether it is only a candidate. */
export function toolState(hits: Hit[]): ToolState {
  const rules = hits.flatMap((h) => (h.kind === "rule" ? [h.rule] : []));
  const flags = new Set<Flag>();
  for (const f of ["candidate", "to-build", "to-be-packaged"] as const)
    if (rules.length > 0 && rules.every((r) => r.flags.includes(f))) flags.add(f);
  for (const h of hits)
    if (h.kind === "bullet" && h.bullet.flags.includes("to-be-packaged"))
      flags.add("to-be-packaged");
  const levels = new Set(rules.map(enforcement));
  const order = ["none", "unstated", "human", "gate"] as const;
  const worst: Enforcement | "unknown" = order.find((k) => levels.has(k)) ?? "unknown";
  return { hits, enforcement: worst, flags: [...flags] };
}

// ---------------------------------------------------------------- the flow

export type Pick =
  | { row: string } // a table row whose rule contains this
  | { bullet: string } // a bullet whose label starts with this
  | { field: "rule" }; // the section's block rule

export interface FlowNode {
  ref: Ref & { heading: string };
  pick: Pick;
}
export interface Lane {
  id: string;
  title: string;
  caption: { ref: Ref & { heading: string }; field: "rule" | "why" | "prose" };
  stages: FlowNode[][];
}

const T = (heading: string): Ref & { heading: string } => ({ file: TESTS, heading });
const RUN = "Runners";
const IST = "Coverage: Istanbul everywhere";
const PER = "Per-test coverage";
const RES = "One result list";
const SHOT = "Screenshots and approval";

export const FLOW: Lane[] = [
  {
    id: "coverage",
    title: "Coverage, counted once",
    caption: { ref: T(IST), field: "why" },
    stages: [
      [
        { ref: T(RUN), pick: { row: "vitest" } },
        { ref: T(RUN), pick: { row: "Playwright Test" } },
      ],
      [{ ref: T(IST), pick: { field: "rule" } }],
      [{ ref: T(RES), pick: { bullet: "Coverage" } }],
    ],
  },
  {
    id: "results",
    title: "Results, listed once",
    caption: { ref: T(RES), field: "rule" },
    stages: [
      [{ ref: T(RES), pick: { bullet: "Order" } }],
      [{ ref: T(RES), pick: { bullet: "Results" } }],
    ],
  },
  {
    id: "per-test",
    title: "Per-test map, asked both ways",
    caption: { ref: T(PER), field: "why" },
    stages: [
      [
        { ref: T(PER), pick: { bullet: "vitest" } },
        { ref: T(PER), pick: { bullet: "Playwright" } },
      ],
      [{ ref: T(PER), pick: { bullet: "Query" } }],
    ],
  },
  {
    id: "shots",
    title: "Screenshots, approved one by one",
    caption: { ref: T(SHOT), field: "prose" },
    stages: [
      [{ ref: T(SHOT), pick: { bullet: "Compare" } }],
      [{ ref: T(SHOT), pick: { bullet: "Never write baselines" } }],
      [{ ref: T(SHOT), pick: { bullet: "Collect" } }],
      [{ ref: T(SHOT), pick: { bullet: "Review" } }],
      [{ ref: T(SHOT), pick: { bullet: "Make and approve" } }],
    ],
  },
];

export interface NodeView {
  title: string;
  body: string;
  file: string;
  anchor: string;
  line: number;
  flags: Flag[];
}

const BODY_MAX = 170;

/** Resolve a flow node to the text the skill says there, or undefined when it is gone. */
export function resolveNode(stack: Stack, node: FlowNode): NodeView | undefined {
  const sec = sectionsOf(stack, node.ref)[0];
  if (!sec) return undefined;
  const at = { file: sec.file, anchor: sec.anchor };
  const p = node.pick;
  if ("row" in p) {
    const r = sec.rules.find((x) => norm(x.rule).includes(norm(p.row)));
    if (!r) return undefined;
    const title = /\*\*(.+?)\*\*/u.exec(r.rule)?.[1] ?? firstSentence(r.rule, 40);
    return {
      ...at,
      title,
      body: firstSentence(plain(r.rule).slice(title.length), BODY_MAX, 40),
      line: r.line,
      flags: r.flags,
    };
  }
  if ("bullet" in p) {
    const b = sec.bullets.find((x) => x.label.toLowerCase().startsWith(p.bullet.toLowerCase()));
    if (!b) return undefined;
    const body = plain(b.text);
    const rest = body.toLowerCase().startsWith(b.label.toLowerCase())
      ? body.slice(b.label.length).replace(/^[\s:.]+/u, "")
      : body;
    return {
      ...at,
      title: b.label,
      body: firstSentence(rest, BODY_MAX, 60),
      line: b.line,
      flags: b.flags,
    };
  }
  const r = sec.rules[0];
  if (!r) return undefined;
  return {
    ...at,
    title: sec.heading,
    body: firstSentence(r.rule, BODY_MAX),
    line: r.line,
    flags: r.flags,
  };
}

export function resolveCaption(stack: Stack, lane: Lane): string | undefined {
  const sec = sectionsOf(stack, lane.caption.ref)[0];
  if (!sec) return undefined;
  const { field } = lane.caption;
  const text = field === "prose" ? sec.prose[0]?.text : sec.rules[0]?.[field];
  return text === undefined ? undefined : firstSentence(text, 230);
}

// ---------------------------------------------------------------- tabs

export const TABS: { id: string; label: string; file: SkillFile; hint?: string }[] = [
  { id: "shared", label: "Shared TS", file: SHARED },
  { id: "tests", label: "Test stack", file: TESTS },
  { id: "ui", label: "UI apps", file: "reference/testable-apps.md" },
  { id: "web-app", label: "Web app", file: WEB },
  { id: "server", label: "Server", file: SERVER },
  { id: "cli", label: "CLI", file: CLI },
  { id: "python", label: "Python", file: PY },
  {
    id: "adopt",
    label: "Adopt",
    file: "reference/adopt.md",
    hint: "get this in line with my stack",
  },
];

/** The kind a matrix column opens in the per-kind view. */
export const tabOfKind = (k: KindId): string => KINDS.find((x) => x.id === k)?.tab ?? "shared";

// ---------------------------------------------------------------- the check

/** Everything the lens expects of the parsed skill. An empty list means the explorer can draw it all. */
export function checkLens(stack: Stack): Problem[] {
  const out: Problem[] = [];
  const bad = (message: string) => out.push({ file: "explorer", line: 0, message });
  for (const layer of LAYERS) {
    for (const kind of KINDS) {
      const c = MATRIX[layer.id][kind.id];
      if (!c) continue;
      const where = `matrix ${kind.label} × ${layer.label}`;
      for (const r of c.refs)
        if (sectionsOf(stack, r).length === 0)
          bad(`${where}: no section "${r.heading ?? "*"}" in ${r.file}`);
      for (const t of c.tools)
        if (hitsFor(stack, c, t).length === 0)
          bad(`${where}: the skill no longer says "${needleOf(t)}" in the sections it cites`);
    }
  }
  for (const lane of FLOW) {
    if (resolveCaption(stack, lane) === undefined)
      bad(
        `flow "${lane.title}": caption not found in ${lane.caption.ref.file} › ${lane.caption.ref.heading}`,
      );
    for (const node of lane.stages.flat()) {
      if (!resolveNode(stack, node))
        bad(
          `flow "${lane.title}": ${JSON.stringify(node.pick)} not found under "${node.ref.heading}"`,
        );
    }
  }
  const routed = new Set(
    stack.docs["SKILL.md"]?.routes.flatMap((r) => /\]\(([^)]+)\)/u.exec(r.read)?.[1] ?? []),
  );
  for (const tab of TABS) {
    if (!stack.docs[tab.file]) bad(`tab ${tab.label}: ${tab.file} did not load`);
    if (tab.file !== "reference/adopt.md" && !routed.has(tab.file))
      bad(`tab ${tab.label}: SKILL.md's routing table no longer links ${tab.file}`);
  }
  for (const link of routed)
    if (!TABS.some((t) => t.file === link))
      bad(`SKILL.md routes to ${link}, which the explorer has no tab for`);
  return out;
}
