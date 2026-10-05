// Kit files that come from packages are GENERATED: each package's entry, bundled into one file.
//
// package.json "kitBundles" maps a kit file to the package it is built from:
//   "kitBundles": { "pairwise.js": "@rascaltwo/pairwise-sorter" }
// The package itself is pinned in devDependencies (a git or npm spec; list it in
// trustedDependencies too if it builds itself on install).
//
// Why bundled copies rather than serving node_modules: end users of this skill have no
// node_modules (it is installed as a symlink; nothing runs `bun install`), and inline.ts can
// only embed a kit file that is flat — a data: module has no base to resolve `./x.js` against.
// tests/kit-bundles.test.ts fails whenever a committed file drifts from its pin.
//
//   add or bump a package → `bun install` → `bun run sync:kit` → commit kit/ with package.json
import path from "node:path";
import { STRICT, TSC_PATH, cdnDeclarations, bareToSkill } from "../lib/verify/types.ts";
import os from "node:os";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const SKILL = path.join(import.meta.dir, "..");
export const KIT_DIR = path.join(SKILL, "kit");

/** kit file → package name, from package.json. */
export async function kitBundles(): Promise<Record<string, string>> {
  const bundles = await packageMap("kitBundles");
  return bundles;
}

/** The string-to-string object under `key` in package.json; absent or any other shape reads as empty. */
async function packageMap(key: string): Promise<Record<string, string>> {
  const pkg: unknown = await Bun.file(path.join(SKILL, "package.json")).json();
  if (typeof pkg !== "object" || pkg === null) return {};
  const map: unknown = Object.entries(pkg).find(([k]) => k === key)?.[1];
  if (typeof map !== "object" || map === null) return {};
  return Object.fromEntries(
    Object.entries(map).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

/** The single-file bundle of `pkg`, exactly as its kit file should read. */
export async function bundle(pkg: string): Promise<string> {
  const entry = Bun.resolveSync(pkg, SKILL);
  // Bun writes each module's path into the bundle relative to the cwd, so the same pin gave
  // different bytes (and a failing kit-bundles test) depending on where it was run from.
  const cwd = process.cwd();
  process.chdir(SKILL);
  const built = await Bun.build({ entrypoints: [entry], format: "esm", target: "browser" }).finally(
    () => process.chdir(cwd),
  );
  if (!built.success) throw new AggregateError(built.logs, `bundling ${pkg} failed`);
  const pin = (await packageMap("devDependencies"))[pkg] ?? "unpinned";
  return `// GENERATED from ${pkg} (${pin}) by maintainer/sync-kit.ts — do not edit.
// Change the package, bump its pin in skills/viz/package.json, then run \`bun run sync:kit\`.
${await built.outputs[0]!.text()}`;
}

// ---- TypeScript sources shipped as JavaScript (ADR 0023) ----------------------------------
//
// Some of the skill is WRITTEN in TypeScript but has to EXIST as plain JS, because something
// reads the .js without a Bun in between:
//   - kit/src/<name>.ts → kit/<name>.js: fallback mode and the gem paste the kit into a page, and
//     every server, export and vendored runtime reads kit/<name>.js.
//   - tape-key.ts → tape-key.js: inline.ts embeds it verbatim in every self-contained export.
//   - template sources (viz-pages/<template>/*.ts) → the .js beside them: fallback mode and the
//     gem read a template's files to adapt it inline. `viz create --from` skips these copies.
// Anything served by Bun (vizzes, the self-portrait, the review pages) is stripped as it is
// served and gets no .js. Each source compiles to its committed .js, held to the same
// strictness a typed viz is (STRICT); tests/kit-sources.test.ts fails on any type error or any
// .js that has drifted. `tsc` rather than Bun's stripper because its output keeps the
// comments — fallback agents read them.
//
// Workers (`*-worker.ts`) run in a worker scope, not a page: they get the WebWorker lib instead
// of the DOM, so each kind is its own program.

export const SRC_DIR = path.join(KIT_DIR, "src");
/** Sources outside kit/src that ship as a .js beside themselves (paths relative to the skill).
 *  `../<skill>/…` is a skill built on viz, in the same checkout; skipped where it isn't installed. */
export const BESIDE = [
  "tape-key.ts",
  "viz-pages/exchange/content.ts",
  "viz-pages/exchange/mount.ts",
  "../grill-me-viz/grill.ts",
];
/** Classic scripts (loaded without type=module): tsc emits `export {};` for them, which must go. */
const CLASSIC = new Set(["../grill-me-viz/grill.ts"]);
/** A generated file's first line — also how `viz create --from` recognises one to skip. */
export const GENERATED_MARK = "// GENERATED from ";
const banner = (src: string) =>
  `${GENERATED_MARK}${src} by \`bun run sync:kit\` — edit that file, not this one.\n`;

/** Every TypeScript source the skill ships as JS, relative to the skill: source → output. */
export function generatedSources(): Map<string, string> {
  const out = new Map<string, string>();
  if (existsSync(SRC_DIR))
    for (const f of readdirSync(SRC_DIR)
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))
      .toSorted()) {
      out.set(`kit/src/${f}`, `kit/${f.replace(/\.ts$/u, ".js")}`);
    }
  for (const f of BESIDE)
    if (existsSync(path.join(SKILL, f))) out.set(f, f.replace(/\.ts$/u, ".js"));
  return out;
}

/** Every source compiled: output path (relative to the skill) → its JavaScript, and any type errors. */
export function compileSources(): { files: Map<string, string>; errors: string[] } {
  const files = new Map<string, string>(),
    errors: string[] = [];
  const all = [...generatedSources()];
  for (const [kind, lib] of [
    ["page", STRICT.lib],
    ["worker", ["ES2023", "WebWorker"]],
  ] as const) {
    const group = all.filter(([src]) => src.endsWith("-worker.ts") === (kind === "worker"));
    if (group.length === 0) continue;
    const tmp = mkdtempSync(path.join(os.tmpdir(), "viz-kit-"));
    const root = realpathSync(path.dirname(SKILL)); // skills/: BESIDE may reach a sibling skill
    try {
      writeFileSync(
        path.join(tmp, "ambient.d.ts"),
        `declare module "https://*";\n${cdnDeclarations(group.map(([src]) => path.join(SKILL, src)))}`,
      );
      writeFileSync(
        path.join(tmp, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            ...STRICT,
            lib,
            outDir: path.join(tmp, "out"),
            rootDir: root,
            removeComments: false,
            newLine: "lf",
            paths: {
              "/_kit/*": [path.join(SRC_DIR, "*")],
              "@viz/kit": [path.join(SRC_DIR, "viz")],
              "@viz/kit/*": [path.join(SRC_DIR, "*")],
              ...bareToSkill,
            },
          },
          files: [
            ...group.map(([src]) => path.join(realpathSync(SKILL), src)),
            path.join(tmp, "ambient.d.ts"),
          ],
        }),
      );
      const r = Bun.spawnSync({
        cmd: [
          process.execPath,
          TSC_PATH,
          "-p",
          path.join(tmp, "tsconfig.json"),
          "--pretty",
          "false",
        ],
        cwd: realpathSync(SKILL),
        env: { ...process.env, PWD: realpathSync(SKILL) },
      });
      errors.push(
        ...(r.stdout.toString() + r.stderr.toString())
          .split("\n")
          .filter((l) => /error TS\d+/u.test(l))
          .map((l) => l.trim()),
      );
      for (const [src, dest] of group) {
        const out = path.join(
          tmp,
          "out",
          path.relative(root, path.join(realpathSync(SKILL), src)).replace(/\.ts$/u, ".js"),
        );
        if (!existsSync(out)) continue;
        const js = readFileSync(out, "utf8");
        files.set(
          dest,
          banner(src) + (CLASSIC.has(src) ? js.replace(/^export \{\};\n?/mu, "") : js),
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { files, errors };
}

if (import.meta.main) {
  for (const [file, pkg] of Object.entries(await kitBundles())) {
    // oxlint-disable-next-line no-await-in-loop -- bundles are built one at a time (bundle() chdirs the process)
    await Bun.write(path.join(KIT_DIR, file), await bundle(pkg));
    console.log(`kit/${file} ← ${pkg}`);
  }
  const { files, errors } = compileSources();
  for (const e of errors) console.error(`✗ ${e}`);
  // oxlint-disable-next-line no-process-exit -- CLI entry point: the exit code is the result
  if (errors.length > 0) process.exit(1);
  const from = new Map([...generatedSources()].map(([src, dest]) => [dest, src]));
  for (const [file, js] of files) {
    // oxlint-disable-next-line no-await-in-loop -- writes stay in order so the log lines read in order
    await Bun.write(path.join(SKILL, file), js);
    console.log(`${file} ← ${from.get(file)}`);
  }
}
