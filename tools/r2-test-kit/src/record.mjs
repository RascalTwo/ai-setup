// Istanbul counters, per test. A record is { runner, name, load, files: { <path>: { m, s, f, b } } }:
// only the counters that moved, and `m`, the id of the file's static map (statements, functions,
// branches) stored once under out/coverage/meta/<m>.json.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export const OUT = "out/coverage";
export const META = `${OUT}/meta`;

const sha = (s, n) => createHash("sha1").update(s).digest("hex").slice(0, n);

/** A deep copy of the counters only, so later increments don't change it. */
export function snapshot(cov = {}) {
  const out = {};
  for (const [path, fc] of Object.entries(cov)) {
    const b = {};
    for (const [k, arms] of Object.entries(fc.b)) b[k] = [...arms];
    out[path] = { s: { ...fc.s }, f: { ...fc.f }, b };
  }
  return out;
}

/** The counters that moved between a snapshot and now; files and counters that didn't move are left out. */
export function diff(before, cov = {}) {
  const out = {};
  for (const [path, fc] of Object.entries(cov)) {
    const was = before[path] ?? { s: {}, f: {}, b: {} };
    const d = { s: {}, f: {}, b: {} };
    let moved = false;
    for (const k of ["s", "f"]) for (const [id, n] of Object.entries(fc[k])) if (n > (was[k][id] ?? 0)) (d[k][id] = n - (was[k][id] ?? 0)), (moved = true);
    for (const [id, arms] of Object.entries(fc.b)) {
      const delta = arms.map((n, i) => n - (was.b[id]?.[i] ?? 0));
      if (delta.some((n) => n > 0)) (d.b[id] = delta), (moved = true);
    }
    if (moved) out[path] = d;
  }
  return out;
}

/** Adds one sparse set of counters into another, in place. */
export function add(into, sparse) {
  for (const [path, d] of Object.entries(sparse)) {
    const t = (into[path] ??= { s: {}, f: {}, b: {} });
    for (const k of ["s", "f"]) for (const [id, n] of Object.entries(d[k])) t[k][id] = (t[k][id] ?? 0) + n;
    for (const [id, arms] of Object.entries(d.b)) t.b[id] = arms.map((n, i) => n + (t.b[id]?.[i] ?? 0));
  }
  return into;
}

/** The static half of a file's coverage: everything but the counters. */
const metaOf = ({ s, f, b, ...meta }) => meta;

/**
 * Writes one test's record (and the static map of any file not seen yet) under out/coverage.
 * `cov` is the live __coverage__ object, read for the static maps; `sparse` is what this test moved.
 */
export function writeRecord(dir, { runner, name, load = false }, sparse, cov, cwd) {
  mkdirSync(join(cwd, META), { recursive: true });
  mkdirSync(join(cwd, dir), { recursive: true });
  const files = {};
  for (const [path, counters] of Object.entries(sparse)) {
    const meta = metaOf(cov[path]);
    const rel = relative(cwd, path);
    const m = sha(rel + (meta.hash ?? JSON.stringify(meta.statementMap)), 12);
    const metaFile = join(cwd, META, `${m}.json`);
    if (!existsSync(metaFile)) writeFileSync(metaFile, JSON.stringify({ ...meta, path: rel }));
    files[rel] = { m, ...counters };
  }
  // the name decides the file, so a rerun or retry of a test replaces its record
  writeFileSync(join(cwd, dir, `${name.replace(/\W+/g, "_").slice(0, 80)}_${sha(name, 8)}.json`), JSON.stringify({ runner, name, load, files }));
}

/** Every record in a folder, in file-name order, so everything built from them is deterministic. */
export function readRecords(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

/** Every stored static map, by id. */
export function readMeta(cwd) {
  const dir = join(cwd, META);
  const out = {};
  if (existsSync(dir)) for (const f of readdirSync(dir).sort()) if (f.endsWith(".json")) out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  return out;
}

/** A full Istanbul file coverage from a static map and (possibly sparse) counters. */
export function hydrate(meta, counters = { s: {}, f: {}, b: {} }) {
  const s = {}, f = {}, b = {};
  for (const id of Object.keys(meta.statementMap)) s[id] = counters.s[id] ?? 0;
  for (const id of Object.keys(meta.fnMap)) f[id] = counters.f[id] ?? 0;
  for (const [id, br] of Object.entries(meta.branchMap)) b[id] = br.locations.map((_, i) => counters.b[id]?.[i] ?? 0);
  return { ...meta, s, f, b };
}
