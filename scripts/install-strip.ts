#!/usr/bin/env bun
// The Install strip on every poster: generated from the manifests, written between
// `<!-- install:start -->` and `<!-- install:end -->`, just before the "why it exists" cue.
//
//   bun scripts/install-strip.ts          rewrite every poster's strip
//   bun scripts/install-strip.ts --check  list posters whose strip is stale (exit 1); writes nothing
//
// check-posters.ts runs the same comparison, so the pre-commit hook fails on a stale strip.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, HOME_REPO, SUBAGENTS, owned, closure, type Owned } from "./manifest.ts";

const START = "<!-- install:start -->", END = "<!-- install:end -->";
const CUE = '<div class="scroll-cue">';
const MANUAL_URL = "../rascal-ai-setup-tour/#manualTitle";
const REPO_URL = `https://github.com/${HOME_REPO}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One shell line, highlighted: the command, its flags, and the source repo. */
const line = (l: string) =>
  `<span class="l">${esc(l)
    .replace(/^(\S+)/, '<span class="c">$1</span>')
    .replace(/ (-\S+)/g, ' <span class="f">$1</span>')
    .replace(/(add )(\S+)/, '$1<span class="r">$2</span>')}</span>`;

export function strip(o: Owned, all: Owned[]): string {
  const c = closure(o, all);
  const add = ([repo, skills]: [string, string[]]) => `npx skills add ${repo} -g ${skills.map((s) => `-s ${s}`).join(" ")}`;
  const needsFull = [...c.tools.map((t) => `the ${t} tool`), ...(c.manual.includes(SUBAGENTS) ? ["its subagents"] : [])];
  const full = o.kind === "tool" || needsFull.length > 0;
  const lines = full
    ? ["bun install.ts", ...Object.entries(c.repos).filter(([r]) => r !== HOME_REPO).map(add)]
    : Object.entries(c.repos).map(add);
  const why = full
    ? `<p class="why">the full setup, run in a clone of <a href="${REPO_URL}">${HOME_REPO}</a>${o.kind === "skill" ? `: it needs ${needsFull.join(" and ")}` : ""}</p>`
    : "";
  const manual = c.manual.filter((m) => !(full && m === SUBAGENTS));
  const needs = c.commands.length + manual.length
    ? `<p class="needs">needs ${[
        ...c.commands.map((x) => `<code>${esc(x)}</code>`),
        ...manual.map((x) => `<a class="man" href="${MANUAL_URL}">${esc(x)}</a>`),
      ].join(" ")}</p>`
    : "";
  return `${START}
<section class="install" data-viz-id="install-strip" data-label="how to install ${esc(o.name)}">
<style>
.install { max-width:820px; margin:26px auto 0; padding:12px 16px; border:1px solid #263040; border-left:3px solid var(--accent); border-radius:8px; background:#0f141b; font-family:var(--mono); }
.install header { display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600; letter-spacing:0.16em; color:var(--accent); }
.install button { font:12px var(--mono); color:#9aa4b2; background:none; border:1px solid #2f3846; border-radius:5px; padding:1px 8px; cursor:pointer; }
.install pre { margin:8px 0 0; font:13px/1.6 var(--mono); color:#d7dde6; white-space:pre-wrap; word-break:break-word; }
.install .l::before { content:"$ "; color:#5b6573; }
.install .c { color:#7ee787; }
.install .f { color:#d2a8ff; }
.install .r { color:#79c0ff; }
.install p { margin:8px 0 0; font-size:12.5px; color:#9aa4b2; }
.install .why { color:var(--warn); }
.install .needs code, .install .needs a { display:inline-block; padding:0 7px; border:1px solid #2f3846; border-radius:5px; color:#cfd6df; text-decoration:none; }
.install .needs a.man { border-style:dashed; color:var(--warn); }
</style>
<header>INSTALL<button type="button" onclick="navigator.clipboard.writeText(this.closest('.install').querySelector('pre').innerText)">copy</button></header>
${why}<pre>${lines.map(line).join("\n")}</pre>
${needs}
</section>
${END}
`;
}

export function posterPath(o: Owned): string | null {
  for (const slug of [`${o.kind}-${o.name}`, `skill-${o.name}`, `tool-${o.name}`]) {
    const p = join(REPO, "viz-pages", slug, "index.html");
    if (existsSync(p)) return p;
  }
  return null;
}

/** The poster with its strip set to `want`: replaced in place, or inserted before the cue. */
export function withStrip(html: string, want: string): string {
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a >= 0 && b > a) return html.slice(0, a) + want + html.slice(b + END.length).replace(/^\n/, "");
  const i = html.indexOf(CUE);
  if (i < 0) throw new Error("no scroll-cue to put the strip before");
  const indent = /[ \t]*$/.exec(html.slice(0, i))![0];
  return html.slice(0, i - indent.length) + want + html.slice(i - indent.length);
}

/** Formatting-insensitive: the poster formatter may rewrap the region, which is not staleness. */
const squash = (s: string) => s.replace(/\s+/g, "");
export function isStale(html: string, want: string): boolean {
  const a = html.indexOf(START), b = html.indexOf(END);
  return a < 0 || b < a || squash(html.slice(a, b + END.length)) !== squash(want.trim());
}

if (import.meta.main) {
  const all = owned();
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const o of all) {
    const p = posterPath(o);
    if (!p || o.noManifest) continue;
    const html = readFileSync(p, "utf8"), want = strip(o, all);
    if (!isStale(html, want)) continue;
    stale.push(o.name);
    if (!check) writeFileSync(p, withStrip(html, want));
  }
  console.log(stale.length ? `${check ? "stale" : "rewrote"}: ${stale.join(", ")}` : "every strip is current");
  process.exit(check && stale.length ? 1 : 0);
}
