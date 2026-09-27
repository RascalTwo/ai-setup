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

const SKILL = path.join(import.meta.dir, "..");
export const KIT_DIR = path.join(SKILL, "kit");

/** kit file → package name, from package.json. */
export async function kitBundles(): Promise<Record<string, string>> {
  return (await Bun.file(path.join(SKILL, "package.json")).json()).kitBundles ?? {};
}

/** The single-file bundle of `pkg`, exactly as its kit file should read. */
export async function bundle(pkg: string): Promise<string> {
  const entry = Bun.resolveSync(pkg, SKILL);
  // Bun writes each module's path into the bundle relative to the cwd, so the same pin gave
  // different bytes (and a failing kit-bundles test) depending on where it was run from.
  const cwd = process.cwd();
  process.chdir(SKILL);
  const built = await Bun.build({ entrypoints: [entry], format: "esm", target: "browser" }).finally(() => process.chdir(cwd));
  if (!built.success) throw new AggregateError(built.logs, `bundling ${pkg} failed`);
  const pin = (await Bun.file(path.join(SKILL, "package.json")).json()).devDependencies?.[pkg] ?? "unpinned";
  return `// GENERATED from ${pkg} (${pin}) by maintainer/sync-kit.ts — do not edit.
// Change the package, bump its pin in skills/viz/package.json, then run \`bun run sync:kit\`.
${await built.outputs[0]!.text()}`;
}

if (import.meta.main) {
  for (const [file, pkg] of Object.entries(await kitBundles())) {
    await Bun.write(path.join(KIT_DIR, file), await bundle(pkg));
    console.log(`kit/${file} ← ${pkg}`);
  }
}
