// lib/testing/coverage.ts — the coverage page's script. tier.ts (writeAttribution) strips its types and inlines
// it into coverage.html. A classic script, not a module: no import or export, so it can run from file://.

// What writeAttribution (tier.ts) puts in the page: its FileCov per file, plus the file's source.
type FileCov = {
  covered: number; total: number; bCovered: number; bTotal: number;
  missed: number[]; missedBranches: number[]; ignores: { line: number; reason: string }[];
  by: Record<number, string[]>; untaken: { line: number; from: number; to: number; code: string }[];
  source: string[];
};
declare const DATA: { viz: string; at: string; files: Record<string, FileCov>; tests: Record<string, { lines: Record<string, number[]>; unique: number }> };
// The vendored Prism, as far as this page uses it.
type PrismToken = { type: string; content: PrismStream; alias?: string | string[] };
type PrismStream = string | PrismToken | PrismStream[];
declare const Prism: { languages: { typescript: object; javascript: object }; tokenize(text: string, grammar: object): PrismStream };
type Seg = { text: string; cls: string };
type State = { cls: "skip"; why: string; by?: undefined } | { cls: "miss"; why?: undefined; by?: undefined } | { cls: "part" | "run"; why?: undefined; by: string[] } | null;

const $ = <E extends Element = HTMLElement>(s: string) => document.querySelector<E>(s)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]!);
const pct = (a: number, b: number) => (b ? Math.floor((1000 * a) / b) / 10 : 100);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const files = Object.keys(DATA.files), tests = Object.keys(DATA.tests).sort();
let tab = "files", test: string | null = null, line: number | null = null, hl = "", at = -1;
let file = files.slice().sort((a, b) => pct(DATA.files[a]!.covered, DATA.files[a]!.total) - pct(DATA.files[b]!.covered, DATA.files[b]!.total))[0]!;

// ---- source: highlight the whole file, then cut it into lines ---------------------------------------
// Tokenising line by line would break a comment or a template string that spans lines, so Prism
// tokenises the file once and each token's text is split at newlines, keeping its classes on every piece.
const lines: Record<string, Seg[][]> = {}; // file → [[{ text, cls }]] per line
function tokenLines(f: string): Seg[][] {
  if (lines[f]) return lines[f];
  const src = DATA.files[f]!.source.join("\n"), grammar = /\.ts$/.test(f) ? Prism.languages.typescript : Prism.languages.javascript;
  const out: Seg[][] = [[]];
  const walk = (tok: PrismStream, cls: string): void => {
    if (typeof tok === "string") tok.split("\n").forEach((t, i) => { if (i) out.push([]); if (t) out.at(-1)!.push({ text: t, cls }); });
    else if (Array.isArray(tok)) tok.forEach((t) => walk(t, cls));
    else walk(tok.content, `${cls} token ${tok.type} ${([] as string[]).concat(tok.alias ?? []).join(" ")}`.trim());
  };
  walk(Prism.tokenize(src, grammar), "");
  return (lines[f] = out);
}
// One line as HTML, with the characters no test ran through underlined.
function lineHtml(f: string, n: number) {
  const marks = DATA.files[f]!.untaken.filter((u) => u.line === n);
  let col = 0, html = "";
  for (const seg of tokenLines(f)[n - 1] ?? []) {
    const start = col, end = col + seg.text.length;
    let cuts = [start, end, ...marks.flatMap((m) => [m.from, m.to]).filter((c) => c > start && c < end)].sort((a, b) => a - b);
    cuts = [...new Set(cuts)];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i]!, b = cuts[i + 1]!, text = seg.text.slice(a - start, b - start);
      const miss = marks.some((m) => a >= m.from && b <= m.to);
      html += `<span class="${seg.cls}${miss ? " untaken" : ""}">${esc(text)}</span>`;
    }
    col = end;
  }
  return html || " ";
}

// ---- a line's state --------------------------------------------------------------------------------
function state(f: string, n: number): State {
  const c = DATA.files[f]!, ig = c.ignores.find((i) => i.line === n);
  if (ig) return { cls: "skip", why: ig.reason };
  if (c.missed.includes(n)) return { cls: "miss" };
  const by = c.by[n];
  if (!by) return null; // not code the coverage counts (blank, a comment, a brace), or excluded from above
  return { cls: c.missedBranches.includes(n) ? "part" : "run", by };
}
const matches = (f: string, n: number) => {
  const s = state(f, n);
  return hl === "miss" ? s?.cls === "miss" : hl === "part" ? s?.cls === "part" : hl === "one" ? s?.by?.length === 1 : false;
};

// ---- header, file list, test tree ------------------------------------------------------------------
function header() {
  let lc = 0, lt = 0, bc = 0, bt = 0;
  for (const c of Object.values(DATA.files)) { lc += c.covered; lt += c.total; bc += c.bCovered; bt += c.bTotal; }
  $("#title").textContent = `${DATA.viz} — coverage`;
  $("#totals").innerHTML = `lines <b>${pct(lc, lt)}%</b> · branches <b>${pct(bc, bt)}%</b> · ${tests.length} tests`;
  $("#when").textContent = new Date(DATA.at).toLocaleString();
}
function testItem(t: string, labelHtml: string) {
  const e = DATA.tests[t]!, n = Object.values(e.lines).reduce((a, l) => a + l.length, 0);
  return `<button class="item" data-test="${esc(t)}" aria-current="${t === test}">${labelHtml}${e.unique ? `<span class="tag only">${e.unique} only it runs</span>` : '<span class="tag" title="Every line it runs, another test runs too">no unique lines</span>'}<small>${plural(n, "line")} run</small></button>`;
}
function drawList() {
  for (const b of document.querySelectorAll<HTMLElement>(".tabs button")) b.setAttribute("aria-pressed", String(b.dataset["tab"] === tab));
  if (tab === "files") {
    $("#list").innerHTML = files.map((f) => { const c = DATA.files[f]!, p = pct(c.covered, c.total), notRun = c.total - c.covered;
      return `<button class="item" data-file="${esc(f)}" aria-current="${f === file}">${esc(f)}<small>lines ${p}% · branches ${pct(c.bCovered, c.bTotal)}% · ${notRun ? plural(notRun, "line") + " no test runs" : "every line run"}</small><div class="bar"><i style="width:${p}%"></i></div></button>`; }).join("");
    return;
  }
  // Tests as their describe() blocks: "Downloads › should …" goes under "Downloads".
  const groups = new Map<string, string[]>();
  for (const t of tests) { const i = t.lastIndexOf(" › "), g = i < 0 ? "" : t.slice(0, i); (groups.get(g) ?? groups.set(g, []).get(g)!).push(t); }
  $("#list").innerHTML = [...groups].map(([g, ts]) => {
    const items = ts.map((t) => testItem(t, esc(g ? t.slice(g.length + 3) : t))).join("");
    // A group of one is just that test, with its describe() as a quiet prefix: no fold to open.
    if (g && ts.length === 1) return testItem(ts[0]!, `<span class="muted">${esc(g)} ›</span> ${esc(ts[0]!.slice(g.length + 3))}`);
    return g ? `<details class="group" ${(test !== null && ts.includes(test)) || groups.size < 6 ? "open" : ""}><summary>${esc(g)} <span>(${ts.length})</span></summary>${items}</details>` : items;
  }).join("");
}

// ---- the source view -------------------------------------------------------------------------------
function drawCode() {
  const c = DATA.files[file]!, mine = test ? new Set(DATA.tests[test]!.lines[file] ?? []) : null;
  $("#code").innerHTML = c.source.map((_, i) => {
    const n = i + 1, s = state(file, n), by = s?.by ?? [];
    const only = mine?.has(n) && by.length === 1;
    const cls = ["ln", s?.cls ?? "", mine && !mine.has(n) ? "dim" : "", mine?.has(n) ? "mine" : "", only ? "only" : "", hl && matches(file, n) ? "match" : "", n === line ? "sel" : ""].join(" ");
    const g = s?.cls === "miss" ? "✕" : s?.cls === "skip" ? "–" : only ? "only" : by.length || "";
    return `<div class="${cls}" id="L${n}" data-n="${n}" title="${s?.why ? "excluded: " + esc(s.why) : ""}"><span class="n">${n}</span><span class="g">${g}</span><code>${lineHtml(file, n)}</code></div>`;
  }).join("");
  drawNav();
}
// ▲▼ walk the highlighted lines (or the picked test's own lines) without hiding anything around them.
function targets() {
  const c = DATA.files[file]!;
  if (hl) return c.source.map((_, i) => i + 1).filter((n) => matches(file, n));
  if (test) return (DATA.tests[test]!.lines[file] ?? []).filter((n) => c.by[n]?.length === 1).sort((a, b) => a - b);
  return [];
}
function drawNav() {
  const t = targets(), nav = $("#nav");
  nav.hidden = !t.length;
  $("#navpos").textContent = t.length ? `${at >= 0 ? at + 1 : "–"} of ${t.length} ${hl ? "" : "only-this-test lines"}` : "";
}
function go(step: number) {
  const t = targets(); if (!t.length) return;
  at = (at + step + t.length) % t.length;
  line = t[at]!;
  drawCode(); drawSide();
  document.getElementById("L" + line)?.scrollIntoView({ block: "center" });
}

// ---- the side panel --------------------------------------------------------------------------------
const quote = (f: string, n: number) => `<code>${esc((DATA.files[f]!.source[n - 1] ?? "").trim().slice(0, 60))}</code>`;
function drawSide() {
  const side = $("#side");
  if (test) {
    const e = DATA.tests[test]!;
    const uniq = Object.entries(e.lines).flatMap(([f, ls]) => ls.filter((n) => DATA.files[f]!.by[n]?.length === 1).map((n): [string, number] => [f, n]));
    side.innerHTML = `<h2>${esc(test)}</h2><p>${plural(Object.values(e.lines).reduce((a, l) => a + l.length, 0), "line")} run · ${plural(e.unique, "line")} no other test runs.</p>`
      + (uniq.length ? `<h2>Only this test runs</h2><ul>${uniq.map(([f, n]) => `<li><a data-jump="${esc(f)}:${n}">${esc(f)}:${n}</a> ${quote(f, n)}</li>`).join("")}</ul>`
        : `<div class="note">Every line this test runs, another test runs too. It may still check something the others don't — coverage can't see assertions.</div>`)
      + `<h2>Files</h2><ul>${Object.entries(e.lines).map(([f, ls]) => `<li><a data-file="${esc(f)}">${esc(f)}</a> — ${plural(ls.length, "line")}</li>`).join("")}</ul><a data-clear>Stop showing this test</a>`;
  } else if (line) {
    const s = state(file, line), arms = DATA.files[file]!.untaken.filter((u) => u.line === line);
    side.innerHTML = `<h2>${esc(file)}:${line}</h2>` + (!s ? `<p>Not code the coverage counts (blank, a comment, a brace), or excluded by a comment above it.</p>`
      : s.cls === "skip" ? `<p>Excluded from coverage:</p><div class="note">${esc(s.why || "NO REASON — verify fails until one is given")}</div>`
      : s.cls === "miss" ? `<p>No test runs this line.</p>`
      : (arms.length ? `<p>Run, but no test ever took:</p><ul>${arms.map((a) => `<li><code>${esc(a.code.trim().slice(0, 80))}</code></li>`).join("")}</ul>` : "")
        + `<p>Run by ${plural(s.by.length, "test")}:</p><ul>${s.by.map((t) => `<li><a data-test="${esc(t)}">${esc(t)}</a></li>`).join("")}</ul>`);
  } else {
    const c = DATA.files[file]!;
    side.innerHTML = `<h2>${esc(file)}</h2><p>Click a line to see which tests run it and, where a branch was never taken, exactly what. Pick a test to see its lines — and the ones only it runs, marked <b style="color:var(--only)">only</b>.</p>`
      + `<ul><li>${c.covered}/${c.total} lines run</li><li>${c.bCovered}/${c.bTotal} ways through branches taken</li><li>${plural(c.ignores.length, "exclusion")}</li></ul>`
      + (c.ignores.length ? `<h2>Exclusions</h2><ul>${c.ignores.map((i) => `<li>line ${i.line}: ${esc(i.reason || "NO REASON")}</li>`).join("")}</ul>` : "");
  }
}

// ---- wiring ----------------------------------------------------------------------------------------
const draw = () => { drawList(); drawCode(); drawSide(); };
document.addEventListener("click", (e) => {
  const t = (e.target as Element).closest<HTMLElement>("[data-tab],[data-file],[data-test],[data-n],[data-clear],[data-hl],[data-go],[data-jump]"); if (!t) return;
  const d = t.dataset;
  if (d["go"]) return go(Number(d["go"]));
  if (d["tab"]) tab = d["tab"];
  else if (d["hl"] !== undefined) { hl = d["hl"]; at = -1; for (const b of document.querySelectorAll("#hl button")) b.setAttribute("aria-pressed", String(b === t)); }
  else if (d["jump"]) { const [f, n] = [d["jump"].replace(/:\d+$/, ""), Number(d["jump"].match(/\d+$/)![0])]; file = f; line = n; drawCode(); drawList();
    return document.getElementById("L" + n)?.scrollIntoView({ block: "center" }); }
  else if (d["file"]) { file = d["file"]; line = null; at = -1; }
  else if (d["test"]) { test = d["test"]; line = null; at = -1; if (!DATA.tests[test]!.lines[file]) file = Object.keys(DATA.tests[test]!.lines)[0]!; tab = "tests"; draw(); return go(1); }
  else if ("clear" in d) { test = null; at = -1; }
  else if (d["n"]) { line = Number(d["n"]); test = null; }
  draw();
});
window.addEventListener("keydown", (e) => { if (e.key === "j") go(1); if (e.key === "k") go(-1); });
header(); draw();
