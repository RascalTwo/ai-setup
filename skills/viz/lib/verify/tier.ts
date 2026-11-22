// lib/verify/tier.ts — does this viz need its own tests? (ADR 0022)
//
// A viz whose screen is COMPUTED from the user's input or from a live system can be silently
// wrong while looking fine; one whose content is fixed when written can't. So verify detects the
// first kind from what the page actually does — an api.ts, live calls while loading, real form
// controls — and requires tests/ for it. Detected, not declared: a tag the author must remember
// is the `viz:kind` axis again (ADR 0011). The author only writes something to disagree:
//
//   <meta name="viz:tests" content="smoke: <why a bug here would be visible anyway>">  — opt out
//   <meta name="viz:tests" content="app">                                              — opt in
//
// Measured against 240 vizzes by hand-classification: 35 of 37 caught, 9 false alarms (timeline
// scrubbers, show/hide checkboxes) — those are what the opt-out's reason is for.

import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Page } from "puppeteer-core";
import v8toIstanbul from "v8-to-istanbul";
import { isCopy } from "../copy.ts";
import { floorFile } from "./state.ts";
import { fullName, videoStem } from "../testing/names.ts";
import { readResults, resultsFile, whyOf } from "../testing/spec.ts";
// oxlint-disable-next-line import/max-dependencies -- one module for what a viz's tests need judged: the tier, the test run, and the coverage it measures from Chrome and Istanbul
import { run } from "../proc.ts";
import { stripTs } from "../server/serve.ts";
import { mergeScriptCovs } from "@bcoe/v8-coverage";

// The kit's own calls, on every viz: the feedback widget. Never evidence of the viz's data.
const KIT_ROUTES = new Set(["/_log/feedback"]);

/** Records the data calls the page makes while loading: its api/ and _log/ routes, and other hosts. */
export function watchLiveCalls(page: Page): Set<string> {
  const live = new Set<string>();
  page.on("request", (r) => {
    if (!["fetch", "xhr", "eventsource", "websocket"].includes(r.resourceType())) return;
    const u = new URL(r.url());
    if (!u.protocol.startsWith("http") && !u.protocol.startsWith("ws")) return; // blob:, data: — the page's own bytes
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      live.add(u.hostname);
      return;
    }
    const route = u.pathname.match(/\/(api|_log)\/.*/u)?.[0];
    if (route && !KIT_ROUTES.has(route)) live.add(route);
  });
  return live;
}

/** Real form controls, hidden ones included (inputs on a later step still count); not code samples. */
export const listControls = async (page: Page): Promise<string[]> => {
  try {
    return await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          "input, textarea, select",
        ),
      ]
        .filter((e) => e.type !== "hidden" && !e.disabled && !e.closest("pre, code, #viz-feedback"))
        .map(
          (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : e.type ? `[type=${e.type}]` : ""),
        ),
    );
  } catch {
    return [];
  }
};

export type Tier = {
  needed: boolean;
  why: string[];
  optOut: string | null;
  files: string[];
  error: string | null;
};

export function tierFor(dir: string, live: Set<string>, controls: string[]): Tier {
  const vizDir = path.resolve(dir); // a served URL's folder ends in a slash
  const why: string[] = [];
  if (existsSync(path.join(vizDir, "api.ts"))) why.push("has api.ts");
  if (live.size > 0)
    why.push(
      `calls ${[...live].slice(0, 3).join(", ")}${live.size > 3 ? ` (+${live.size - 3})` : ""}`,
    );
  if (controls.length > 0)
    why.push(
      `takes input: ${[...new Set(controls)].slice(0, 3).join(", ")}${controls.length > 3 ? ` (+${controls.length - 3})` : ""}`,
    );

  // A copy is a projection of its origin (ADR 0006): a mirror's built page keeps its inputs and API calls but can
  // never hold tests, so demanding them fails every mirror of a viz that has any. The origin is what is tested.
  if (isCopy(vizDir))
    return {
      needed: false,
      why,
      optOut: "a mirror or vendored copy — its tests run at the origin",
      files: [],
      error: null,
    };

  const html = existsSync(path.join(vizDir, "index.html"))
    ? readFileSync(path.join(vizDir, "index.html"), "utf8")
    : "";
  const declared = html.match(/<meta\s+name="viz:tests"\s+content="([^"]*)"/u)?.[1]?.trim() ?? null;
  const testsDir = path.join(vizDir, "tests");
  const files = existsSync(testsDir)
    ? readdirSync(testsDir)
        .filter((f) => /\.test\.(ts|js|mjs|tsx)$/u.test(f))
        .toSorted()
    : [];

  let error: string | null = null,
    optOut: string | null = null,
    needed = why.length > 0;
  if (declared === "app") {
    needed = true;
    why.push('declared viz:tests="app"');
  } else if (declared?.startsWith("smoke")) {
    optOut = declared.replace(/^smoke:?\s*/u, "");
    if (!optOut)
      error =
        'viz:tests="smoke" needs a reason: content="smoke: <why a bug here would be visible anyway>"';
    else needed = false;
  } else if (declared !== null) error = `viz:tests="${declared}" isn't "app" or "smoke: <reason>"`;

  if (!error && needed && files.length === 0)
    error =
      `this viz computes what it shows (${why.join("; ")}), so it needs journey tests: add tests/*.test.ts — ` +
      `or, if a bug here would be visible anyway, opt out in index.html: <meta name="viz:tests" content="smoke: <reason>">`;
  return { needed, why, optOut, files, error };
}

const SKILL = path.resolve(import.meta.dirname, "../..");
const VITEST = path.join(SKILL, "node_modules/vitest/vitest.mjs");
const CONFIG = path.join(SKILL, "lib/testing/vitest.config.ts");
export type TestRun = {
  ran: number;
  failed: number;
  failures: string[];
  baselines: string[];
  output: string;
};

/** Runs the viz's tests/*.test.* under vitest (lib/testing/vitest.config.ts) with the `viz` global. */
export async function runTests(
  vizDir: string,
  url: string,
  files: string[],
  { update = false, out, target }: { update?: boolean; out: string; target?: string },
): Promise<TestRun> {
  for (const f of readdirSync(out))
    if (/^(?:browser-coverage-|unit-coverage-|steps-)/u.test(f)) rmSync(path.join(out, f));
  rmSync(path.join(out, "videos"), { recursive: true, force: true });
  rmSync(resultsFile(out), { force: true });
  // Plain output: FORCE_COLOR (set by some shells and hooks) would wrap what is read below in ANSI codes.
  const { FORCE_COLOR: _, ...env } = process.env;
  const { stdout, stderr, code } = await run(
    [
      process.execPath,
      VITEST,
      "run",
      "--config",
      CONFIG,
      "--root",
      realpathSync(vizDir),
      ...files.map((f) => "tests/" + f),
    ],
    {
      cwd: vizDir,
      env: {
        ...env,
        NO_COLOR: "1",
        VIZ_URL: url,
        VIZ_DIR: vizDir,
        VIZ_OUT: out,
        VIZ_TARGET: target ?? url,
        ...(update ? { VIZ_UPDATE_SNAPSHOTS: "1" } : {}),
      },
    },
  );
  const output = stdout + stderr;
  const results = readResults(out);
  const failures = (results?.testResults ?? []).flatMap((file) => {
    const failed = file.assertionResults.filter((a) => a.status === "failed");
    // A file that fails to load has no failed test, only a message.
    if (failed.length === 0 && file.status === "failed")
      return [`tests did not run: ${whyOf(file.message)}`];
    return failed.map((a) => {
      const name = fullName(a.ancestorTitles, a.title);
      const stem = videoStem(name);
      const videos = existsSync(path.join(out, "videos"))
        ? readdirSync(path.join(out, "videos")).filter((v) => v.startsWith(stem + "--"))
        : [];
      return `${name} — ${whyOf(a.failureMessages[0])}${videos.length > 0 ? `  (video: ${videos.map((v) => path.join(out, "videos", v)).join(", ")})` : ""}`;
    });
  });
  // An unhandled rejection fails the run with every test green (a stray: see the self-portrait's guard test).
  const stray = output
    .match(/Unhandled (?:Rejection|Error)s?[^\n]*\n(?:[^\n]*\n)*?\s*(?:\w*Error[^\n]*)/u)?.[0]
    ?.split("\n")
    .at(-1)
    ?.trim();
  if (code && failures.length === 0)
    failures.push(
      stray ? `unhandled error: ${stray}` : `tests did not run (vitest exited ${code})`,
    );
  const baselines = [...output.matchAll(/^VIZ-BASELINE-SAVED (.+)$/gmu)].map(
    ([, name = ""]) => name,
  );
  const ran = (results?.numTotalTests ?? 0) - (results?.numPendingTests ?? 0);
  return { ran, failed: failures.length, failures, baselines, output };
}

// ---- coverage: the page's scripts (Chrome) + whatever the tests import (Istanbul) ----------------------
//
// Lines AND branches, of the viz's own scripts only (not tests/, vendor/, node_modules/). Excluding
// code is allowed, but only with a reason, like a lint disable that must say why:
//   /* c8 ignore next -- <why> */   /* c8 ignore next 3 -- <why> */   /* c8 ignore start -- <why> */ … /* c8 ignore stop */
// A bare one fails verify. (c8's syntax, which v8-to-istanbul already honours; v8 and node:coverage too.)

const own = (vizDir: string, file: string) =>
  file.startsWith(vizDir + path.sep) &&
  !/[\\/](tests|vendor|node_modules)[\\/]/u.test(file.slice(vizDir.length)) &&
  /\.(m?js|ts)$/u.test(file);

export type FileCov = {
  covered: number;
  total: number;
  bCovered: number;
  bTotal: number;
  missed: number[];
  missedBranches: number[];
  ignores: { line: number; reason: string }[];
  by: Record<number, string[]>; // line → the tests that ran it
  untaken: { line: number; from: number; to: number; code: string }[]; // exactly which code a branch never ran
};

// A test's name from its call sites ("/…/tests/x.test.ts:42|/…/tests/x.test.ts:88", innermost first): the
// first site that sits inside an it()/test() — one less indented than the calling line — under the nearest
// describe() above that. A helper in the test file isn't inside one, so the test that called it is used.
// A name built in a template keeps its ${…}.
const UNIT = "the unit tests (together, not per test)";
const names = new Map<string, string>();
function testName(sites: string): string {
  const known = names.get(sites);
  if (known !== undefined) return known;
  let name = "";
  for (const site of sites.split("|")) {
    const parsed = site.match(/^(.*):(\d+)$/u);
    if (!parsed) continue;
    const [, file = "", at] = parsed;
    const src = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
    const call = (re: RegExp, from: number, maxIndent: number) => {
      for (let i = from; i >= 0; i--) {
        const m = src[i]?.match(re),
          indent = src[i]?.search(/\S/u) ?? -1;
        if (m && indent < maxIndent) {
          const [, , title = ""] = m; // group 2 always participates
          return { title, indent, line: i };
        }
      }
      return null;
    };
    const here = Number(at) - 1,
      indent = src[here]?.search(/\S/u) ?? 0;
    const t = call(
      /\b(?:it|test)(?:\.concurrent|\.only|\.skip)?\(\s*(["'`])((?:\\.|(?!\1).)*)\1/u,
      here,
      indent,
    );
    if (!t) {
      // Not in a test, but in a describe's set-up (a beforeAll opening one page for all its tests).
      const block =
        /\b(?:before|beforeAll|beforeEach)\(/u.test(src[here] ?? "") &&
        call(/\bdescribe\(\s*(["'`])((?:\\.|(?!\1).)*)\1/u, here - 1, indent);
      if (block) {
        name = `${block.title} › (set-up shared by its tests)`;
        break;
      }
      continue;
    }
    const d = call(/\bdescribe\(\s*(["'`])((?:\\.|(?!\1).)*)\1/u, t.line - 1, t.indent);
    name = d ? `${d.title} › ${t.title}` : t.title;
    break;
  }
  name ||= sites.replace(/\|[^]*$/u, "").replace(/^.*\//u, "");
  names.set(sites, name);
  return name;
}

type Ignore = { line: number; reason: string; lines: Set<number> };

/** The exclusion comments in one file: which lines each covers, and its reason ("" = none given). */
function readIgnores(src: string[]): Ignore[] {
  const out: Ignore[] = [];
  let open: Ignore | null = null;
  src.forEach((text, i) => {
    const line = i + 1;
    if (open) open.lines.add(line);
    const m = text.match(
      /\/\*\s*(?:[cv]8|node:coverage)\s+ignore\s+(next(?:\s+(\d+))?|start|stop)\b(.*?)\*\//u,
    );
    if (!m) return;
    const [, , , tail = ""] = m; // group 3 always participates
    const reason = tail.match(/^\s*--\s*(.*\S)/u)?.[1] ?? "";
    if (m[1] === "stop") {
      open = null;
      return;
    }
    const ig: Ignore = { line, reason, lines: new Set([line]) };
    if (m[1] === "start") open = ig;
    else {
      const alone = /^\W*\/\*/u.test(text); // on its own line → the next N lines; after code → this line
      if (alone) for (let k = 1; k <= Number(m[2] ?? 1); k++) ig.lines.add(line + k);
    }
    out.push(ig);
  });
  return out;
}

type Istanbul = {
  statementMap: Record<string, { start: { line: number } }>;
  s: Record<string, number>;
  branchMap: Record<
    string,
    {
      locations: {
        start: { line?: number; column?: number };
        end: { line?: number; column?: number };
      }[];
    }
  >;
  b: Record<string, number[]>;
};

/** Istanbul's counters for what the tests imported, summed over the test files (preload.ts wrote one each). */
function readUnitCoverage(vizDir: string, out: string): Map<string, Istanbul> {
  const unit = new Map<string, Istanbul>();
  const real = realpathSync(vizDir); // vitest names files by their real path; a symlinked viz dir (/tmp) would not match
  for (const f of readdirSync(out).filter((n) => n.startsWith("unit-coverage-"))) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the file preload.ts wrote: Istanbul's coverage map, by file
    const saved = JSON.parse(readFileSync(path.join(out, f), "utf8")) as Record<string, Istanbul>;
    for (const [abs, cov] of Object.entries(saved)) {
      const file = abs.startsWith(real) ? vizDir + abs.slice(real.length) : abs;
      const sum = unit.get(file);
      if (!sum) {
        unit.set(file, cov);
        continue;
      }
      for (const [id, n] of Object.entries(cov.s)) sum.s[id] = (sum.s[id] ?? 0) + n;
      for (const [id, arms] of Object.entries(cov.b))
        sum.b[id] = arms.map((n, i) => n + (sum.b[id]?.[i] ?? 0));
    }
  }
  return unit;
}

/** Coverage of the viz's own scripts, from the coverage files a test run left in `out`. A script that
 *  ran but cannot be mapped to its source is left out of the result and named in `unmeasured`. */
// oxlint-disable-next-line complexity -- one pass over Istanbul's unit files and Chrome's V8 files into shared maps; splitting it would pass those maps around
export async function measureCoverage(
  dir: string,
  out: string,
  unmeasured: string[] = [],
): Promise<Record<string, FileCov>> {
  const vizDir = path.resolve(dir); // a served URL's folder ends in a slash, and own() compares prefixes
  const lines = new Map<string, Map<number, number>>(); // file → line → hits
  const by = new Map<string, Map<number, Set<string>>>(); // file → line → tests that ran it
  const credit = (file: string, line: number, test: string) => {
    let m = by.get(file);
    if (!m) by.set(file, (m = new Map<number, Set<string>>()));
    let tests = m.get(line);
    if (!tests) m.set(line, (tests = new Set<string>()));
    tests.add(test);
  };
  type Arm = { line: number; col: number; endLine: number; endCol: number; n: number };
  const branches = new Map<string, Map<string, Arm>>(); // file → "line:col" → hits, with where the arm ends
  const mark = (file: string, line: number, n: number) => {
    let m = lines.get(file);
    if (!m) lines.set(file, (m = new Map<number, number>()));
    m.set(line, Math.max(m.get(line) ?? 0, n));
  };
  // Istanbul: code the tests imported directly (vitest.config.ts instruments it), one file of counters per test file.
  // Not per test: the tests of a file share the counters, so the credit goes to "the unit tests" together.
  const unit = readUnitCoverage(vizDir, out);
  const unitBranches = new Map<string, Map<string, Arm>>();
  for (const [file, cov] of unit) {
    if (!own(vizDir, file) || !existsSync(file)) continue;
    for (const [id, loc] of Object.entries(cov.statementMap)) {
      const n = cov.s[id] ?? 0;
      mark(file, loc.start.line, n);
      if (n) credit(file, loc.start.line, UNIT);
    }
    const arms = new Map<string, Arm>();
    for (const [id, br] of Object.entries(cov.branchMap))
      for (const [k, { start, end }] of br.locations.entries())
        // an `if` with no `else` has an arm with no place in the source
        if (
          start.line !== undefined &&
          start.column !== undefined &&
          end.line !== undefined &&
          end.column !== undefined
        )
          arms.set(`${start.line}:${start.column}`, {
            line: start.line,
            col: start.column,
            endLine: end.line,
            endCol: end.column,
            n: cov.b[id]?.[k] ?? 0,
          });
    unitBranches.set(file, arms);
  }
  // Chrome: raw V8 block coverage per script → lines and branches. V8 only reports the blocks of
  // functions that ran, so a branch inside a function that never ran isn't counted (its lines are).
  // Inline <script>s are skipped — their offsets are into the script, not the HTML file.
  //
  // Lines are credited per page (each page's counts are exact within that page). Branches come from
  // every page MERGED first: V8 leaves out a block whose count equals its parent's, so the rest of a
  // function after an early return is reported only in a page where it did NOT run — taking the max
  // over what was reported would call it never run. @bcoe/v8-coverage merges treating absence right.
  // A script served from TypeScript carries an inline source map to its .ts (lib/server/static.ts):
  // v8-to-istanbul follows it, and the lines it reports — and the file they belong to — are the .ts's.
  const convert = async (local: string, text: string, functions: never[]) => {
    const conv = v8toIstanbul(local, 0, { source: text });
    await conv.load();
    conv.applyCoverage(functions);
    const entry = Object.entries(conv.toIstanbul())[0];
    if (!entry) throw new Error(`v8-to-istanbul reported no file for ${local}`);
    const [name, data] = entry;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v8-to-istanbul types its istanbul data as `any`; this is the one place it gets a shape
    return Object.assign(data as object, { file: name }) as { file: string } & {
      statementMap: Record<string, { start: { line: number } }>;
      s: Record<string, number>;
      branchMap: Record<
        string,
        {
          locations: {
            start: { line: number; column: number };
            end: { line: number; column: number };
          }[];
        }
      >;
      b: Record<string, number[]>;
    };
  };
  const pages = new Map<
    string,
    { text: string; covs: { scriptId: string; url: string; functions: never[] }[] }
  >();
  const unmapped = new Set<string>();
  for (const f of readdirSync(out).filter((n) => n.startsWith("browser-coverage-"))) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the file preload.ts (writeCoverage) wrote; this is the one place it gets its shape
    const saved = JSON.parse(readFileSync(path.join(out, f), "utf8")) as {
      test: string | null;
      scripts: { url: string; text: string; functions: never[] }[];
    };
    const test = saved.test ? testName(saved.test) : null;
    for (const s of saved.scripts) {
      const u = new URL(s.url);
      const local =
        u.protocol === "file:"
          ? fileURLToPath(u)
          : ["localhost", "127.0.0.1"].includes(u.hostname)
            ? path.join(os.homedir(), decodeURIComponent(u.pathname))
            : "";
      if (!own(vizDir, local)) continue;
      // oxlint-disable-next-line no-await-in-loop -- one script at a time: each folds its counts into the shared maps below, in file order
      const data = await convert(local, s.text, structuredClone(s.functions));
      // No file on disk for what ran: a classic script stripped from .ts has no map to its source.
      if (!existsSync(data.file)) {
        unmapped.add(path.relative(vizDir, local));
        continue;
      }
      for (const [id, loc] of Object.entries(data.statementMap)) {
        const hits = data.s[id];
        if (hits === undefined) continue;
        mark(data.file, loc.start.line, hits);
        if (test && hits > 0) credit(data.file, loc.start.line, test);
      }
      let e = pages.get(local);
      if (!e) pages.set(local, (e = { text: s.text, covs: [] }));
      e.covs.push({ scriptId: "0", url: s.url, functions: s.functions });
    }
  }
  for (const [local, { text, covs }] of pages) {
    const merged = mergeScriptCovs(covs);
    if (!merged) continue;
    // oxlint-disable-next-line no-await-in-loop, typescript/no-unsafe-type-assertion -- one script at a time, into the shared branch map; @bcoe/v8-coverage's function type and v8-to-istanbul's do not line up, and never[] is the bridge `convert` takes
    const data = await convert(local, text, merged.functions as never[]);
    let bm = branches.get(data.file);
    if (!bm) branches.set(data.file, (bm = new Map<string, Arm>()));
    for (const [id, br] of Object.entries(data.branchMap))
      for (const [k, loc] of br.locations.entries()) {
        const n = data.b[id]?.[k];
        if (n === undefined) continue;
        bm.set(`${loc.start.line}:${loc.start.column}`, {
          line: loc.start.line,
          col: loc.start.column,
          endLine: loc.end.line,
          endCol: loc.end.column,
          n,
        });
      }
  }
  // A file the browser never loaded has its branches from Istanbul; one it did load keeps Chrome's (the two do not share arms).
  for (const [f, arms] of unitBranches) if (!branches.has(f)) branches.set(f, arms);
  const result: Record<string, FileCov> = {};
  for (const [f, m] of lines) {
    const src = readFileSync(f, "utf8").split("\n");
    const ignores = readIgnores(src);
    // Only lines with code count: v8-to-istanbul makes every line inside a function that ran a
    // "statement", blank lines and comments included, which would inflate the percentage.
    // A line of only closing brackets (`});`) that nothing ran is not a miss either: V8 maps a callback's end there,
    // and when the callback never ran (its one line is excluded with a reason) the line has no code of its own to test.
    const notCode = (l: number) => /^\s*($|\/\/|\/\*|\*)/u.test(src[l - 1] ?? "");
    const loneCloser = ([l, n]: [number, number]) =>
      !n && /^\s*[)\]}.,;]+$/u.test(src[l - 1] ?? "");
    const skip = new Set([
      ...ignores.flatMap((i) => [...i.lines]),
      ...[...m.keys()].filter(notCode),
      ...[...m].filter(loneCloser).map(([l]) => l),
    ]);
    const ln = [...m].filter(([l]) => !skip.has(l));
    const br = [...(branches.get(f)?.values() ?? [])].filter((b) => !skip.has(b.line));
    const fc: FileCov = {
      covered: ln.filter(([, n]) => n > 0).length,
      total: ln.length,
      bCovered: br.filter((b) => b.n > 0).length,
      bTotal: br.length,
      missed: ln
        .filter(([, n]) => !n)
        .map(([l]) => l)
        .toSorted((a, b) => a - b),
      missedBranches: [], // filled from `untaken` below: every line holding code a branch never ran
      ignores: ignores.map(({ line, reason }) => ({ line, reason })),
      by: Object.fromEntries(
        [...(by.get(f) ?? [])]
          .filter(([l]) => !skip.has(l))
          .map(([l, t]) => [l, [...t].toSorted()]),
      ),
      // An arm that never ran, per line it spans: its start line from its column, middle lines whole,
      // its last line up to its end. The code itself goes along, so a report can quote it.
      untaken: br
        .filter((b) => !b.n)
        .flatMap((b) => {
          const parts = [];
          for (let l = b.line; l <= Math.min(b.endLine, b.line + 40); l++) {
            const text = src[l - 1] ?? "",
              from = l === b.line ? Math.max(0, b.col) : text.search(/\S|$/u),
              to = l === b.endLine ? b.endCol : text.length;
            if (to > from && text.slice(from, to).trim())
              parts.push({ line: l, from, to, code: text.slice(from, to) });
          }
          return parts;
        }),
    };
    result[path.relative(vizDir, f)] = fc;
    fc.missedBranches = [...new Set(fc.untaken.map((u) => u.line))].toSorted((a, b) => a - b);
  }
  unmeasured.push(...unmapped);
  return result;
}

/** Every exclusion without a reason, as "file:line …" errors. */
export const bareIgnores = (measured: Record<string, FileCov>): string[] =>
  Object.entries(measured).flatMap(([f, c]) =>
    c.ignores
      .filter((i) => !i.reason)
      .map(
        (i) =>
          `${f}:${i.line} excludes code from coverage but needs a reason: /* c8 ignore next -- <why this can't or needn't be tested> */`,
      ),
  );

/** The uncovered report: per file, the lines and branches no test reached (with their code), and every exclusion's reason. */
export function writeReport(vizDir: string, measured: Record<string, FileCov>, file: string): void {
  const out: string[] = [];
  for (const [f, c] of Object.entries(measured)) {
    const src = readFileSync(path.join(path.resolve(vizDir), f), "utf8").split("\n");
    const code = (l: number) => src[l - 1]?.trim().slice(0, 140) ?? "";
    out.push(
      `${f} — lines ${pct(c.covered, c.total)}% (${c.covered}/${c.total}), branches ${c.bTotal ? pct(c.bCovered, c.bTotal) + "%" : "n/a"} (${c.bCovered}/${c.bTotal})`,
    );
    const runs: number[][] = [];
    let prev = -2; // no line is -1, so the first missed line never joins a run
    for (const l of c.missed) {
      const last = runs.at(-1);
      if (last && l === prev + 1) last.push(l);
      else runs.push([l]);
      prev = l;
    }
    for (const r of runs) {
      out.push(`  not run  ${r[0]}${r.length > 1 ? "-" + r.at(-1) : ""}:`);
      for (const l of r.slice(0, 6)) out.push(`             ${String(l).padStart(4)} | ${code(l)}`);
      if (r.length > 6) out.push(`             … ${r.length - 6} more`);
    }
    const arms = new Map<number, string[]>();
    for (const u of c.untaken)
      if (!c.missed.includes(u.line)) {
        const arm = u.code.trim().slice(0, 90);
        const codes = arms.get(u.line);
        if (codes) codes.push(arm);
        else arms.set(u.line, [arm]);
      }
    for (const [l, codes] of [...arms].toSorted((a, b) => a[0] - b[0]))
      out.push(
        `  branch   ${l}: never ran: ${codes.map((t) => "`" + t + "`").join(", ")}   in: ${code(l)}`,
      );
    for (const i of c.ignores)
      out.push(
        `  excluded ${i.line}: ${i.reason || "(NO REASON — verify fails until one is given)"}`,
      );
    out.push("");
  }
  writeFileSync(file, out.join("\n") || "(no own scripts measured)\n");
}

/** coverage.json (the data) and coverage.html (the page you click through), beside coverage.txt. */
export function writeAttribution(
  vizDir: string,
  measured: Record<string, FileCov>,
  txt: string,
): void {
  const tests: Record<string, { lines: Record<string, number[]>; unique: number }> = {};
  const files: Record<string, unknown> = {};
  for (const [f, c] of Object.entries(measured)) {
    for (const [line, ts] of Object.entries(c.by))
      for (const t of ts) {
        const e = (tests[t] ??= { lines: {}, unique: 0 });
        (e.lines[f] ??= []).push(Number(line));
        if (ts.length === 1) e.unique++;
      }
    files[f] = {
      ...c,
      source: readFileSync(path.join(path.resolve(vizDir), f), "utf8").split("\n"),
    };
  }
  const data = {
    viz: path.basename(path.resolve(vizDir)),
    at: new Date().toISOString(),
    files,
    tests,
  };
  writeFileSync(txt.replace(/\.txt$/u, ".json"), JSON.stringify(data));
  const page = readFileSync(path.join(import.meta.dirname, "../testing/coverage.html"), "utf8");
  const script = (js: string) => js.replaceAll(/<\/script/giu, "<\\/script");
  const prism = script(
    readFileSync(path.join(import.meta.dirname, "../testing/vendor/prism.js"), "utf8"),
  );
  const js = script(
    stripTs(readFileSync(path.join(import.meta.dirname, "../testing/coverage.ts"), "utf8")),
  );
  writeFileSync(
    txt.replace(/\.txt$/u, ".html"),
    page
      .replace("/*PRISM*/", () => prism)
      .replace("/*COVERAGE-JS*/", () => js)
      .replace("/*COVERAGE-DATA*/null", () => JSON.stringify(data).replaceAll("<", "\\u003c")),
  );
}

export type Coverage = {
  lines: number;
  branches: number;
  files: Record<string, { lines: number; branches: number }>;
  floor: { lines: number; branches: number };
  raised: boolean;
  error: string | null;
  report: string;
};
const pct = (covered: number, total: number) =>
  total ? Math.floor((1000 * covered) / total) / 10 : 0; // down, so a floor is never above the truth

/** How far, in tenths of a point, a total may sit under its floor and still pass: browser-measured coverage wobbles on
 *  unchanged code (85.1, 85.3, 85.1 measured on one viz), so an exact floor failed every other run. */
const SLACK_TENTHS = 3;
const under = (total: number, floor: number) =>
  Math.round(total * 10) < Math.round(floor * 10) - SLACK_TENTHS;

/** The floor only goes up, for lines and branches each: more than SLACK under it fails; above it, it rises to meet the new level. */
export function ratchet(dir: string, measured: Record<string, FileCov>, report = ""): Coverage {
  const vizDir = path.resolve(dir);
  const all = Object.values(measured),
    sum = (k: "covered" | "total" | "bCovered" | "bTotal") => all.reduce((a, f) => a + f[k], 0);
  // Lines over lines, not an average of per-file percentages: a 3-line file mustn't weigh as much as a 400-line one.
  const lines = pct(sum("covered"), sum("total"));
  const bTotal = sum("bTotal"),
    branches = bTotal ? pct(sum("bCovered"), bTotal) : 100;
  const files = Object.fromEntries(
    Object.entries(measured).map(([f, c]) => [
      f,
      { lines: pct(c.covered, c.total), branches: c.bTotal ? pct(c.bCovered, c.bTotal) : 100 },
    ]),
  );
  const fp = floorFile(vizDir);
  const saved: unknown = existsSync(fp) ? JSON.parse(readFileSync(fp, "utf8")) : {};
  const field = (k: string): unknown =>
    typeof saved === "object" && saved !== null ? Reflect.get(saved, k) : undefined;
  const floor = { lines: Number(field("lines") ?? -1), branches: Number(field("branches") ?? -1) };
  const below = [
    under(lines, floor.lines) && `line coverage ${lines}% is below its floor of ${floor.lines}%`,
    under(branches, floor.branches) &&
      `branch coverage ${branches}% is below its floor of ${floor.branches}%`,
  ].filter(Boolean);
  if (below.length > 0)
    return {
      lines,
      branches,
      files,
      floor,
      raised: false,
      report,
      error: `${below.join("; ")} (.verify/floor.json) — test what lost coverage; the report lists it: ${report}`,
    };
  const next = {
    lines: Math.max(lines, floor.lines),
    branches: Math.max(branches, floor.branches),
  };
  const raised = all.length > 0 && (next.lines !== floor.lines || next.branches !== floor.branches); // never set a floor from nothing measured
  if (raised) writeFileSync(fp, JSON.stringify(next, null, 2) + "\n");
  return { lines, branches, files, floor: raised ? next : floor, raised, error: null, report };
}
