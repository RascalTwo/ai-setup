// lib/testing/spec-render.ts — spec.md (the behaviour index agents read before changing code) and spec.html (the page).

import type { Scenario, Spec, Step } from "./spec.ts";

const MARK = { pass: "✓", fail: "✗", skip: "–", "not run": "○" } as const;
const STEP_MARK = { passed: "✓", failed: "✗", "not reached": "·" } as const;

const passed = (spec: Spec) => spec.scenarios.filter((s) => s.status === "pass").length;
const ran = (spec: Spec) =>
  spec.scenarios.some((s) => s.status !== "not run" && s.status !== "skip");
const headline = (spec: Spec) =>
  ran(spec)
    ? `${passed(spec)} of ${spec.scenarios.length} scenarios pass · last run ${spec.ranAt}`
    : `${spec.scenarios.length} scenarios · not run (no test results yet: run \`viz verify\`)`;

/** Features with a failure first, a feature's failures first; otherwise the order the tests are written in. */
function byFeature(spec: Spec): [string, Scenario[]][] {
  const groups = new Map<string, Scenario[]>();
  for (const s of spec.scenarios)
    (groups.get(s.feature) ?? groups.set(s.feature, []).get(s.feature)!).push(s);
  const failing = (l: Scenario[]) => l.filter((s) => s.status === "fail").length;
  return [...groups]
    .map(([f, l]): [string, Scenario[]] => [
      f,
      l.toSorted((a, b) => +(b.status === "fail") - +(a.status === "fail")),
    ])
    .toSorted((a, b) => failing(b[1]) - failing(a[1]));
}

const stepText = (s: Step) => `${s.kind} ${s.text}`;
const coverText = (s: Scenario) =>
  s.covers
    ? "ran " + s.covers.map((c) => `${c.file} (${c.lines} lines)`).join(", ")
    : s.unitTogether
      ? `unit tests together: ${s.unitTogether.lines} lines in ${s.unitTogether.files} file${s.unitTogether.files === 1 ? "" : "s"}, shared (bun measures them once, not per test)`
      : "";

export function renderSpecMd(spec: Spec): string {
  const out = [
    `# Spec: ${spec.viz}`,
    "",
    `${headline(spec)}. Generated from tests/ by \`viz verify\`; do not edit.`,
    "",
  ];
  for (const [feature, list] of byFeature(spec)) {
    out.push(`## ${feature}`, "");
    for (const s of list) {
      out.push(`- ${MARK[s.status]} **${s.title}** (${s.file}:${s.line})`);
      if (s.error) out.push(`  - error: ${s.error}`);
      if (s.steps.length === 0) out.push("  - no steps written");
      for (const st of s.steps)
        out.push(`  - ${st.state ? STEP_MARK[st.state] + " " : ""}${stepText(st)}`);
      const c = coverText(s);
      if (c) out.push(`  - ${c}`);
    }
    out.push("");
  }
  return out.join("\n");
}

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const CSS = `
:root{color-scheme:light dark;--ok:#1a7f37;--bad:#cf222e;--idle:#8b949e;--line:#d0d7de;--mut:#656d76}
@media(prefers-color-scheme:dark){:root{--ok:#3fb950;--bad:#f85149;--line:#30363d;--mut:#8b949e}}
body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}
h1{margin:0}.sub{color:var(--mut);margin:.2rem 0 1.5rem}
h2{font-size:1.1rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.2rem}
.sc{margin:.6rem 0;padding:.5rem .8rem;border:1px solid var(--line);border-radius:6px}
.sc.fail{border-color:var(--bad)}
.dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:.5em;background:var(--idle)}
.pass .dot{background:var(--ok)}.fail .dot{background:var(--bad)}
.t{font-weight:600}.at{color:var(--mut);font-size:.8rem;margin-left:.5rem}
ol{margin:.4rem 0 .2rem;padding-left:1.4rem}li{margin:.1rem 0}
li.passed::marker{color:var(--ok);content:"✓ "}li.failed{color:var(--bad)}li.failed::marker{content:"✗ "}
li.nr{color:var(--mut)}li.nr::marker{content:"· "}
li b{font-size:.75rem;letter-spacing:.03em}
.err{margin:.4rem 0;padding:.4rem .6rem;background:color-mix(in srgb,var(--bad) 12%,transparent);border-radius:4px;font-family:ui-monospace,monospace;font-size:.85rem;white-space:pre-wrap}
.none{color:var(--mut);font-style:italic}.cov{margin-top:.3rem;font-size:.85rem;color:var(--mut)}
.chip{display:inline-block;padding:0 .5em;border:1px solid var(--line);border-radius:1em;margin-right:.3em}
a{color:inherit}`;

function scenarioHtml(s: Scenario): string {
  const cls = s.status === "not run" || s.status === "skip" ? "" : s.status;
  const steps =
    s.steps.length > 0
      ? `<ol>${s.steps
          .map(
            (st) =>
              `<li class="${st.state === "passed" ? "passed" : st.state === "failed" ? "failed" : st.state ? "nr" : ""}"><b>${st.kind}</b> ${esc(st.text)}${st.state === "not reached" ? " <small>(not reached)</small>" : ""}</li>`,
          )
          .join("")}</ol>`
      : `<div class="none">no steps written</div>`;
  const key = encodeURIComponent(s.coverageKey);
  const cov = s.covers
    ? "ran " +
      s.covers
        .map(
          (c) =>
            `<a class="chip" href="coverage.html#test=${key}">${esc(c.file)} · ${c.lines} lines</a>`,
        )
        .join("")
    : s.unitTogether
      ? `<span class="chip" title="bun measures coverage once per run, so it cannot be traced per unit test">unit tests together · ${s.unitTogether.lines} lines in ${s.unitTogether.files} file${s.unitTogether.files === 1 ? "" : "s"} (shared)</span>`
      : "";
  return `<div class="sc ${cls}"><span class="dot" title="${s.status}"></span><span class="t">${esc(s.title)}</span><span class="at">${s.status === "not run" ? "not run · " : s.status === "skip" ? "skipped · " : ""}${esc(s.file)}:${s.line}</span>${
    s.error ? `<div class="err">${esc(s.error)}</div>` : ""
  }${steps}${cov ? `<div class="cov">${cov}</div>` : ""}</div>`;
}

export function renderSpecHtml(spec: Spec): string {
  const body = byFeature(spec)
    .map(([f, l]) => `<h2>${esc(f)}</h2>${l.map(scenarioHtml).join("")}`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Spec: ${esc(spec.viz)}</title><style>${CSS}</style>
<h1>${esc(spec.viz)}</h1><p class="sub">${esc(headline(spec))} · generated from tests/, not edited</p>${body}`;
}
