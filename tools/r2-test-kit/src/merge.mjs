// Every per-test record of every runner -> one Istanbul coverage map -> one report (lcov, HTML, text),
// then the floor. A missing or empty input is a failure, never a silently smaller report.
import libCoverage from "istanbul-lib-coverage";
import libInstrument from "istanbul-lib-instrument";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFloor } from "./floor.mjs";
import { hydrate, readMeta, readRecords } from "./record.mjs";

export class KitError extends Error {}

/** Every input's records; throws KitError naming the first missing or empty input. */
export function loadInputs(inputs, cwd) {
  return inputs.map((dir) => {
    if (!existsSync(join(cwd, dir))) throw new KitError(`coverage input missing: ${dir}`);
    const records = readRecords(join(cwd, dir));
    if (!records.some((r) => !r.load && Object.keys(r.files).length)) throw new KitError(`coverage input empty: ${dir} has no test record with coverage`);
    return records;
  }).flat();
}

/** One coverage map of every record, plus every included source file no runner loaded, at 0%. */
export function buildCoverageMap(records, { include }, cwd) {
  const meta = readMeta(cwd);
  const map = libCoverage.createCoverageMap({});
  for (const m of Object.values(meta)) if (include(m.path)) map.addFileCoverage(hydrate(m));
  for (const r of records) for (const [path, c] of Object.entries(r.files)) if (include(path) && meta[c.m]) map.addFileCoverage(hydrate(meta[c.m], c));
  for (const path of sourceFiles(join(cwd, "src"), cwd)) {
    if (!include(path) || map.files().includes(path)) continue;
    // shortcut: only files under src/ are found when nothing loaded them; widen when an app counts code elsewhere
    const inst = libInstrument.createInstrumenter({ esModules: true, parserPlugins: ["typescript", "jsx"] });
    inst.instrumentSync(readFileSync(join(cwd, path), "utf8"), path);
    map.addFileCoverage(inst.lastFileCoverage());
  }
  return map;
}

function sourceFiles(dir, cwd) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(cwd.length + 1))
    .sort();
}

/** Writes the report and checks the floor. Returns { ok, messages, totals }. */
export function merge(config, cwd) {
  const map = buildCoverageMap(loadInputs(config.inputs, cwd), config, cwd);
  const context = libReport.createContext({ dir: join(cwd, config.reportDir), coverageMap: map, defaultSummarizer: "nested", sourceFinder: (p) => readFileSync(join(cwd, p), "utf8") });
  for (const r of ["lcov", "json", "text"]) reports.create(r).execute(context);
  const s = map.getCoverageSummary().toJSON();
  const totals = Object.fromEntries(["lines", "statements", "functions", "branches"].map((k) => [k, s[k].pct]));
  return { totals, ...checkFloor(join(cwd, config.floorFile), totals, config.floorFile) };
}
