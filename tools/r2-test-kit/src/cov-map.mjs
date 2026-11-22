// test <-> line map from the per-test records. Keys per file: a line "N", a function "N#name", a branch
// arm "N.bBLOCK.ARM" (BLOCK is Istanbul's branch id, ARM its arm index). Only counters a test itself
// moved count; "(load) <file>" records are their own entries, credited to no test.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readMeta } from "./record.mjs";

export const MAP = "out/pertest/map.json";

/** Keys a set of counters touched in one file, given its static map. All keys when `counters` is omitted. */
export function keysOf(meta, counters) {
  const hit = (n) => !counters || n > 0;
  const keys = new Set();
  for (const [id, st] of Object.entries(meta.statementMap)) if (hit(counters?.s[id])) keys.add(`${st.start.line}`);
  for (const [id, fn] of Object.entries(meta.fnMap)) if (hit(counters?.f[id])) keys.add(`${fn.decl.start.line}#${fn.name}`);
  for (const [id, br] of Object.entries(meta.branchMap))
    br.locations.forEach((_, arm) => hit(counters?.b[id]?.[arm]) && keys.add(`${br.loc.start.line}.b${id}.${arm}`));
  return [...keys].sort(byKey);
}

// plain code-unit order, not localeCompare: the map must not depend on the machine's locale
// keys and names are unique, so two never compare equal
const cmp = (a, b) => (a < b ? -1 : 1);
const byKey = (a, b) => parseFloat(a) - parseFloat(b) || cmp(a, b);

/** { byTest: { test: { file: keys } }, byLine: { "file:key": tests }, keys: { file: every key } } */
export function buildMap(records, include, cwd) {
  const meta = readMeta(cwd);
  const byTest = {}, byLine = {}, keys = {};
  for (const m of Object.values(meta)) if (include(m.path)) keys[m.path] = keysOf(m);
  for (const r of records) {
    for (const [file, c] of Object.entries(r.files)) {
      if (!include(file) || !meta[c.m]) continue;
      const ks = keysOf(meta[c.m], c);
      if (!ks.length) continue;
      (byTest[r.name] ??= {})[file] = ks;
      for (const k of ks) (byLine[`${file}:${k}`] ??= []).push(r.name);
    }
  }
  for (const tests of Object.values(byLine)) tests.sort();
  for (const [name, files] of Object.entries(byTest)) byTest[name] = sorted(files);
  return { byTest: sorted(byTest), byLine: sorted(byLine), keys: sorted(keys) };
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b)));

export function writeMap(map, cwd) {
  mkdirSync(dirname(join(cwd, MAP)), { recursive: true });
  writeFileSync(join(cwd, MAP), JSON.stringify(map, null, 1) + "\n");
}

export const readMap = (cwd) => JSON.parse(readFileSync(join(cwd, MAP), "utf8"));

/** Lines of output for --test: each test whose name contains the substring, and what it ran per file. */
export function queryTest(map, substring) {
  const out = [];
  for (const [name, files] of Object.entries(map.byTest)) {
    if (!name.includes(substring)) continue;
    out.push(name);
    for (const [file, ks] of Object.entries(files)) out.push(`  ${file}: ${ks.join(" ")}`);
  }
  return out.length ? out : [`no test matches "${substring}"`];
}

/** Lines of output for --line file:N: every key on that line (the line, its functions, its branch arms) and the tests that ran it. */
export function queryLine(map, spec) {
  const at = spec.lastIndexOf(":");
  const file = spec.slice(0, at), line = spec.slice(at + 1);
  const ks = (map.keys[file] ?? []).filter((k) => k === line || k.startsWith(`${line}#`) || k.startsWith(`${line}.b`));
  if (!ks.length) return [`${spec}: nothing counted on that line`];
  return ks.map((k) => `${file}:${k} <- ${map.byLine[`${file}:${k}`]?.join(", ") ?? "(no test ran it)"}`);
}
