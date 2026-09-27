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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Page } from "puppeteer-core";
import v8toIstanbul from "v8-to-istanbul";
import { mergeScriptCovs } from "@bcoe/v8-coverage";

// The kit's own calls, on every viz: the feedback widget. Never evidence of the viz's data.
const KIT_ROUTES = ["/_log/feedback"];

/** Records the data calls the page makes while loading: its api/ and _log/ routes, and other hosts. */
export function watchLiveCalls(page: Page): Set<string> {
  const live = new Set<string>();
  page.on("request", (r) => {
    if (!["fetch", "xhr", "eventsource", "websocket"].includes(r.resourceType())) return;
    const u = new URL(r.url());
    if (!u.protocol.startsWith("http") && !u.protocol.startsWith("ws")) return; // blob:, data: — the page's own bytes
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return void live.add(u.hostname);
    const route = u.pathname.match(/\/(api|_log)\/.*/)?.[0];
    if (route && !KIT_ROUTES.includes(route)) live.add(route);
  });
  return live;
}

/** Real form controls, hidden ones included (inputs on a later step still count); not code samples. */
export const listControls = (page: Page): Promise<string[]> => page.evaluate(() =>
  [...document.querySelectorAll("input, textarea, select")]
    .filter((e) => (e as HTMLInputElement).type !== "hidden" && !(e as HTMLInputElement).disabled
      && !e.closest("pre, code, #viz-feedback"))
    .map((e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : (e as HTMLInputElement).type ? `[type=${(e as HTMLInputElement).type}]` : ""))).catch(() => []);

export type Tier = { needed: boolean; why: string[]; optOut: string | null; files: string[]; error: string | null };

export function tierFor(vizDir: string, live: Set<string>, controls: string[]): Tier {
  vizDir = path.resolve(vizDir); // a served URL's folder ends in a slash
  const why: string[] = [];
  if (existsSync(path.join(vizDir, "api.ts"))) why.push("has api.ts");
  if (live.size) why.push(`calls ${[...live].slice(0, 3).join(", ")}${live.size > 3 ? ` (+${live.size - 3})` : ""}`);
  if (controls.length) why.push(`takes input: ${[...new Set(controls)].slice(0, 3).join(", ")}${controls.length > 3 ? ` (+${controls.length - 3})` : ""}`);

  const html = existsSync(path.join(vizDir, "index.html")) ? readFileSync(path.join(vizDir, "index.html"), "utf8") : "";
  const declared = html.match(/<meta\s+name="viz:tests"\s+content="([^"]*)"/)?.[1].trim() ?? null;
  const testsDir = path.join(vizDir, "tests");
  const files = existsSync(testsDir) ? readdirSync(testsDir).filter((f) => /\.test\.(ts|js|mjs|tsx)$/.test(f)).sort() : [];

  let error: string | null = null, optOut: string | null = null, needed = why.length > 0;
  if (declared === "app") { needed = true; why.push('declared viz:tests="app"'); }
  else if (declared?.startsWith("smoke")) {
    optOut = declared.replace(/^smoke:?\s*/, "");
    if (!optOut) error = 'viz:tests="smoke" needs a reason: content="smoke: <why a bug here would be visible anyway>"';
    else needed = false;
  } else if (declared !== null) error = `viz:tests="${declared}" isn't "app" or "smoke: <reason>"`;

  if (!error && needed && !files.length)
    error = `this viz computes what it shows (${why.join("; ")}), so it needs journey tests: add tests/*.test.ts — ` +
      `or, if a bug here would be visible anyway, opt out in index.html: <meta name="viz:tests" content="smoke: <reason>">`;
  return { needed, why, optOut, files, error };
}

const PRELOAD = path.resolve(import.meta.dir, "../testing/preload.ts");
export type TestRun = { ran: number; failed: number; failures: string[]; baselines: string[]; output: string };

/** Runs the viz's tests/*.test.* under `bun test` with the `viz` global. */
export async function runTests(vizDir: string, url: string, files: string[], { update = false, out, target }: { update?: boolean; out: string; target?: string }): Promise<TestRun> {
  for (const f of readdirSync(out)) if (f.startsWith("browser-coverage-")) rmSync(path.join(out, f));
  rmSync(path.join(out, "videos"), { recursive: true, force: true });
  rmSync(path.join(out, "bun-coverage"), { recursive: true, force: true });
  // it.concurrent tests mostly WAIT on the page (a film, a debounce, a worker), so one page per core:
  // on the QR generator's style suite 16 at once beat 8 (44 s vs 60 s) with the CPU far from full.
  // Not bun's default 20, which is too many Chromes for a small machine.
  const concurrency = Math.max(2, os.availableParallelism());
  // Plain output: the parsing below reads bun's markers, which FORCE_COLOR (set by some shells and hooks) wraps in ANSI codes.
  const { FORCE_COLOR: _, ...env } = process.env;
  const proc = Bun.spawn(["bun", "test", "--preload", PRELOAD, "--timeout", "120000", `--max-concurrency=${concurrency}`,
    "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${path.join(out, "bun-coverage")}`, ...files.map((f) => "./tests/" + f)], {
    cwd: vizDir, stdout: "pipe", stderr: "pipe", env: { ...env, NO_COLOR: "1", VIZ_URL: url, VIZ_DIR: vizDir, VIZ_OUT: out, VIZ_TARGET: target ?? url, ...(update ? { VIZ_UPDATE_SNAPSHOTS: "1" } : {}) },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const output = stdout + stderr;
  await proc.exited;
  const count = (w: string) => Number(output.match(new RegExp(`^\\s*(\\d+) ${w}$`, "m"))?.[1] ?? 0);
  // All on stderr, in order: a test's "VIZ-VIDEO <file>"s, then "VIZ-TEST-END", then — only if it
  // failed — its "error: …" and "(fail) <name>". A failure keeps its videos; a pass's are deleted.
  const failures: string[] = [];
  let why = "", pending: string[] = [], last: string[] = [];
  const drop = (files: string[]) => files.forEach((f) => rmSync(f, { force: true }));
  for (const line of stderr.split("\n")) {
    if (line.startsWith("VIZ-VIDEO ")) { pending.push(line.slice(10).trim()); continue; }
    if (line === "VIZ-TEST-END") { drop(last); last = pending; pending = []; continue; }
    const err = line.match(/^(?:error|\w*Error)(?: \[\w+\])?:\s*(.+)$/); // also node's "AssertionError [ERR_ASSERTION]: …"
    if (err) why = err[1].trim();
    const fail = line.match(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/);
    if (fail) {
      const video = last.length ? `  (video: ${last.join(", ")})` : "";
      failures.push((why ? `${fail[1]} — ${why}` : fail[1]) + video);
      why = ""; last = [];
    }
  }
  drop(last); drop(pending);
  // A file that fails to load reports no "(fail)" line, only an error and a non-zero exit.
  if (proc.exitCode && !failures.length) failures.push(`tests did not run (bun test exited ${proc.exitCode})`);
  const baselines = [...output.matchAll(/^VIZ-BASELINE-SAVED (.+)$/gm)].map((m) => m[1]);
  return { ran: count("pass") + count("fail"), failed: Math.max(count("fail"), failures.length), failures, baselines, output };
}

// ---- coverage: the page's scripts (Chrome) + whatever the tests import (bun) ----------------------
//
// Lines AND branches, of the viz's own scripts only (not tests/, vendor/, node_modules/). Excluding
// code is allowed, but only with a reason, like an eslint-disable that must say why:
//   /* c8 ignore next -- <why> */   /* c8 ignore next 3 -- <why> */   /* c8 ignore start -- <why> */ … /* c8 ignore stop */
// A bare one fails verify. (c8's syntax, which v8-to-istanbul already honours; v8 and node:coverage too.)

const own = (vizDir: string, file: string) => file.startsWith(vizDir + path.sep)
  && !/[\\/](tests|vendor|node_modules)[\\/]/.test(file.slice(vizDir.length)) && /\.(m?js|ts)$/.test(file);

export type FileCov = {
  covered: number; total: number; bCovered: number; bTotal: number;
  missed: number[]; missedBranches: number[]; ignores: { line: number; reason: string }[];
  by: Record<number, string[]>; // line → the tests that ran it
  untaken: { line: number; from: number; to: number; code: string }[]; // exactly which code a branch never ran
};

// A test's name from its call sites ("/…/tests/x.test.ts:42|/…/tests/x.test.ts:88", innermost first): the
// first site that sits inside an it()/test() — one less indented than the calling line — under the nearest
// describe() above that. A helper in the test file isn't inside one, so the test that called it is used.
// A name built in a template keeps its ${…}.
const UNIT = "the unit tests (bun, not per test)";
const names = new Map<string, string>();
function testName(sites: string): string {
  if (names.has(sites)) return names.get(sites)!;
  let name = "";
  for (const site of sites.split("|")) {
    const [, file, at] = site.match(/^(.*):(\d+)$/)!;
    const src = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
    const call = (re: RegExp, from: number, maxIndent: number) => {
      for (let i = from; i >= 0; i--) {
        const m = src[i]?.match(re), indent = src[i]?.search(/\S/) ?? -1;
        if (m && indent < maxIndent) return { title: m[2], indent, line: i };
      }
    };
    const here = Number(at) - 1, indent = src[here]?.search(/\S/) ?? 0;
    const t = call(/\b(?:it|test)(?:\.concurrent|\.only|\.skip)?\(\s*(["'`])((?:\\.|(?!\1).)*)\1/, here, indent);
    if (!t) {
      // Not in a test, but in a describe's set-up (a beforeAll opening one page for all its tests).
      const block = /\b(?:before|beforeAll|beforeEach)\(/.test(src[here] ?? "") && call(/\bdescribe\(\s*(["'`])((?:\\.|(?!\1).)*)\1/, here - 1, indent);
      if (block) { name = `${block.title} › (set-up shared by its tests)`; break; }
      continue;
    }
    const d = call(/\bdescribe\(\s*(["'`])((?:\\.|(?!\1).)*)\1/, t.line - 1, t.indent);
    name = d ? `${d.title} › ${t.title}` : t.title;
    break;
  }
  name ||= sites.split("|")[0].replace(/^.*\//, "");
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
    const m = text.match(/\/\*\s*(?:[cv]8|node:coverage)\s+ignore\s+(next(?:\s+(\d+))?|start|stop)\b(.*?)\*\//);
    if (!m) return;
    const reason = m[3].match(/^\s*--\s*(.*\S)/)?.[1] ?? "";
    if (m[1] === "stop") { open = null; return; }
    const ig: Ignore = { line, reason, lines: new Set([line]) };
    if (m[1] === "start") open = ig;
    else {
      const own = /^\W*\/\*/.test(text); // on its own line → the next N lines; after code → this line
      for (let k = 1; own && k <= Number(m[2] ?? 1); k++) ig.lines.add(line + k);
    }
    out.push(ig);
  });
  return out;
}

/** Coverage of the viz's own scripts, from the coverage files a test run left in `out`. */
export async function measureCoverage(vizDir: string, out: string): Promise<Record<string, FileCov>> {
  vizDir = path.resolve(vizDir); // a served URL's folder ends in a slash, and own() compares prefixes
  const lines = new Map<string, Map<number, number>>();   // file → line → hits
  const by = new Map<string, Map<number, Set<string>>>();   // file → line → tests that ran it
  const credit = (file: string, line: number, test: string) => {
    const m = by.get(file) ?? by.set(file, new Map()).get(file)!;
    (m.get(line) ?? m.set(line, new Set()).get(line)!).add(test);
  };
  type Arm = { line: number; col: number; endLine: number; endCol: number; n: number };
  const branches = new Map<string, Map<string, Arm>>(); // file → "line:col" → hits, with where the arm ends
  const mark = (file: string, line: number, n: number) => {
    const m = lines.get(file) ?? lines.set(file, new Map()).get(file)!;
    m.set(line, Math.max(m.get(line) ?? 0, n));
  };
  // bun: lcov, for code the tests imported directly (lines only — bun doesn't measure branches).
  const lcov = path.join(out, "bun-coverage", "lcov.info");
  let file = "";
  if (existsSync(lcov)) for (const l of readFileSync(lcov, "utf8").split("\n")) {
    if (l.startsWith("SF:")) file = path.resolve(vizDir, l.slice(3));
    else if (l.startsWith("DA:") && own(vizDir, file)) { const [line, n] = l.slice(3).split(",").map(Number); mark(file, line, n); if (n) credit(file, line, UNIT); }
  }
  // Chrome: raw V8 block coverage per script → lines and branches. V8 only reports the blocks of
  // functions that ran, so a branch inside a function that never ran isn't counted (its lines are).
  // Inline <script>s are skipped — their offsets are into the script, not the HTML file.
  //
  // Lines are credited per page (each page's counts are exact within that page). Branches come from
  // every page MERGED first: V8 leaves out a block whose count equals its parent's, so the rest of a
  // function after an early return is reported only in a page where it did NOT run — taking the max
  // over what was reported would call it never run. @bcoe/v8-coverage merges treating absence right.
  const convert = async (local: string, text: string, functions: never[]) => {
    const conv = v8toIstanbul(local, 0, { source: text });
    await conv.load();
    conv.applyCoverage(functions);
    return Object.values(conv.toIstanbul())[0] as {
      statementMap: Record<string, { start: { line: number } }>; s: Record<string, number>;
      branchMap: Record<string, { locations: { start: { line: number; column: number }; end: { line: number; column: number } }[] }>; b: Record<string, number[]>;
    };
  };
  const pages = new Map<string, { text: string; covs: { scriptId: string; url: string; functions: never[] }[] }>();
  for (const f of readdirSync(out).filter((f) => f.startsWith("browser-coverage-"))) {
    const saved = JSON.parse(readFileSync(path.join(out, f), "utf8")) as { test: string | null; scripts: { url: string; text: string; functions: never[] }[] };
    const test = saved.test ? testName(saved.test) : null;
    for (const s of saved.scripts) {
      const u = new URL(s.url);
      const local = u.protocol === "file:" ? fileURLToPath(u) : ["localhost", "127.0.0.1"].includes(u.hostname) ? path.join(os.homedir(), decodeURIComponent(u.pathname)) : "";
      if (!own(vizDir, local)) continue;
      const data = await convert(local, s.text, structuredClone(s.functions));
      for (const [id, loc] of Object.entries(data.statementMap)) {
        mark(local, loc.start.line, data.s[id]);
        if (test && data.s[id] > 0) credit(local, loc.start.line, test);
      }
      const e = pages.get(local) ?? pages.set(local, { text: s.text, covs: [] }).get(local)!;
      e.covs.push({ scriptId: "0", url: s.url, functions: s.functions });
    }
  }
  for (const [local, { text, covs }] of pages) {
    const merged = mergeScriptCovs(covs);
    if (!merged) continue;
    const data = await convert(local, text, merged.functions as never[]);
    const bm = branches.get(local) ?? branches.set(local, new Map()).get(local)!;
    for (const [id, br] of Object.entries(data.branchMap)) br.locations.forEach((loc, k) => {
      bm.set(`${loc.start.line}:${loc.start.column}`, { line: loc.start.line, col: loc.start.column, endLine: loc.end.line, endCol: loc.end.column, n: data.b[id][k] });
    });
  }
  const result: Record<string, FileCov> = {};
  for (const [f, m] of lines) {
    const src = readFileSync(f, "utf8").split("\n");
    const ignores = readIgnores(src);
    // Only lines with code count: v8-to-istanbul makes every line inside a function that ran a
    // "statement", blank lines and comments included, which would inflate the percentage.
    const notCode = (l: number) => /^\s*($|\/\/|\/\*|\*)/.test(src[l - 1] ?? "");
    const skip = new Set([...ignores.flatMap((i) => [...i.lines]), ...[...m.keys()].filter(notCode)]);
    const ln = [...m].filter(([l]) => !skip.has(l));
    const br = [...(branches.get(f)?.values() ?? [])].filter((b) => !skip.has(b.line));
    result[path.relative(vizDir, f)] = {
      covered: ln.filter(([, n]) => n > 0).length, total: ln.length,
      bCovered: br.filter((b) => b.n > 0).length, bTotal: br.length,
      missed: ln.filter(([, n]) => !n).map(([l]) => l).sort((a, b) => a - b),
      missedBranches: [], // filled from `untaken` below: every line holding code a branch never ran
      ignores: ignores.map(({ line, reason }) => ({ line, reason })),
      by: Object.fromEntries([...(by.get(f) ?? [])].filter(([l]) => !skip.has(l)).map(([l, t]) => [l, [...t].sort()])),
      // An arm that never ran, per line it spans: its start line from its column, middle lines whole,
      // its last line up to its end. The code itself goes along, so a report can quote it.
      untaken: br.filter((b) => !b.n).flatMap((b) => {
        const out = [];
        for (let l = b.line; l <= Math.min(b.endLine, b.line + 40); l++) {
          const text = src[l - 1] ?? "", from = l === b.line ? Math.max(0, b.col) : text.search(/\S|$/), to = l === b.endLine ? b.endCol : text.length;
          if (to > from && text.slice(from, to).trim()) out.push({ line: l, from, to, code: text.slice(from, to) });
        }
        return out;
      }),
    };
    const fc = result[path.relative(vizDir, f)];
    fc.missedBranches = [...new Set(fc.untaken.map((u) => u.line))].sort((a, b) => a - b);
  }
  return result;
}

/** Every exclusion without a reason, as "file:line …" errors. */
export const bareIgnores = (measured: Record<string, FileCov>): string[] => Object.entries(measured).flatMap(([f, c]) =>
  c.ignores.filter((i) => !i.reason).map((i) => `${f}:${i.line} excludes code from coverage but needs a reason: /* c8 ignore next -- <why this can't or needn't be tested> */`));

/** The uncovered report: per file, the lines and branches no test reached (with their code), and every exclusion's reason. */
export function writeReport(vizDir: string, measured: Record<string, FileCov>, file: string): void {
  const out: string[] = [];
  for (const [f, c] of Object.entries(measured)) {
    const src = readFileSync(path.join(path.resolve(vizDir), f), "utf8").split("\n");
    const code = (l: number) => src[l - 1]?.trim().slice(0, 140) ?? "";
    out.push(`${f} — lines ${pct(c.covered, c.total)}% (${c.covered}/${c.total}), branches ${c.bTotal ? pct(c.bCovered, c.bTotal) + "%" : "n/a"} (${c.bCovered}/${c.bTotal})`);
    const runs: number[][] = [];
    for (const l of c.missed) (runs.length && l === runs.at(-1)!.at(-1)! + 1 ? runs.at(-1)! : (runs.push([]), runs.at(-1)!)).push(l);
    for (const r of runs) {
      out.push(`  not run  ${r[0]}${r.length > 1 ? "-" + r.at(-1) : ""}:`);
      for (const l of r.slice(0, 6)) out.push(`             ${String(l).padStart(4)} | ${code(l)}`);
      if (r.length > 6) out.push(`             … ${r.length - 6} more`);
    }
    const arms = new Map<number, string[]>();
    for (const u of c.untaken) if (!c.missed.includes(u.line)) (arms.get(u.line) ?? arms.set(u.line, []).get(u.line)!).push(u.code.trim().slice(0, 90));
    for (const [l, codes] of [...arms].sort((a, b) => a[0] - b[0])) out.push(`  branch   ${l}: never ran: ${codes.map((c) => "\`" + c + "\`").join(", ")}   in: ${code(l)}`);
    for (const i of c.ignores) out.push(`  excluded ${i.line}: ${i.reason || "(NO REASON — verify fails until one is given)"}`);
    out.push("");
  }
  writeFileSync(file, out.join("\n") || "(no own scripts measured)\n");
}

/** coverage.json (the data) and coverage.html (the page you click through), beside coverage.txt. */
export function writeAttribution(vizDir: string, measured: Record<string, FileCov>, txt: string): void {
  const tests: Record<string, { lines: Record<string, number[]>; unique: number }> = {};
  const files: Record<string, unknown> = {};
  for (const [f, c] of Object.entries(measured)) {
    for (const [line, ts] of Object.entries(c.by)) for (const t of ts) {
      const e = (tests[t] ??= { lines: {}, unique: 0 });
      (e.lines[f] ??= []).push(Number(line));
      if (ts.length === 1) e.unique++;
    }
    files[f] = { ...c, source: readFileSync(path.join(path.resolve(vizDir), f), "utf8").split("\n") };
  }
  const data = { viz: path.basename(path.resolve(vizDir)), at: new Date().toISOString(), files, tests };
  writeFileSync(txt.replace(/\.txt$/, ".json"), JSON.stringify(data));
  const page = readFileSync(path.join(import.meta.dir, "../testing/coverage.html"), "utf8");
  const prism = readFileSync(path.join(import.meta.dir, "../testing/vendor/prism.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  writeFileSync(txt.replace(/\.txt$/, ".html"), page.replace("/*PRISM*/", () => prism)
    .replace("/*COVERAGE-DATA*/null", () => JSON.stringify(data).replace(/</g, "\\u003c")));
}

export type Coverage = {
  lines: number; branches: number; files: Record<string, { lines: number; branches: number }>;
  floor: { lines: number; branches: number }; raised: boolean; error: string | null; report: string;
};
const pct = (covered: number, total: number) => (total ? Math.floor(1000 * covered / total) / 10 : 0); // down, so a floor is never above the truth

/** The floor only goes up, for lines and branches each: below it fails; above it, it rises to meet the new level. */
export function ratchet(vizDir: string, measured: Record<string, FileCov>, report = ""): Coverage {
  vizDir = path.resolve(vizDir);
  const all = Object.values(measured), sum = (k: keyof FileCov) => all.reduce((a, f) => a + (f[k] as number), 0);
  // Lines over lines, not an average of per-file percentages: a 3-line file mustn't weigh as much as a 400-line one.
  const lines = pct(sum("covered"), sum("total"));
  const bTotal = sum("bTotal"), branches = bTotal ? pct(sum("bCovered"), bTotal) : 100;
  const files = Object.fromEntries(Object.entries(measured).map(([f, c]) => [f, { lines: pct(c.covered, c.total), branches: c.bTotal ? pct(c.bCovered, c.bTotal) : 100 }]));
  const fp = path.join(vizDir, "tests", "coverage-floor.json");
  const saved = existsSync(fp) ? JSON.parse(readFileSync(fp, "utf8")) : {};
  const floor = { lines: Number(saved.lines ?? -1), branches: Number(saved.branches ?? -1) };
  const below = [lines < floor.lines && `line coverage ${lines}% is below its floor of ${floor.lines}%`,
    branches < floor.branches && `branch coverage ${branches}% is below its floor of ${floor.branches}%`].filter(Boolean);
  if (below.length) return { lines, branches, files, floor, raised: false, report,
    error: `${below.join("; ")} (tests/coverage-floor.json) — test what lost coverage; the report lists it: ${report}` };
  const next = { lines: Math.max(lines, floor.lines), branches: Math.max(branches, floor.branches) };
  const raised = all.length > 0 && (next.lines !== floor.lines || next.branches !== floor.branches); // never set a floor from nothing measured
  if (raised) writeFileSync(fp, JSON.stringify(next, null, 2) + "\n");
  return { lines, branches, files, floor: raised ? next : floor, raised, error: null, report };
}
