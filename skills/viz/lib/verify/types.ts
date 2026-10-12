// lib/verify/types.ts — the type check (ADR 0023).
//
// The protection TypeScript promises comes from the CHECKER, not from writing `.ts`: the
// server strips types as it serves a file and the export bundles them away, and neither
// checks anything. So verify runs the real checker, strict, over what the viz opted into:
// its `.ts` files, and any `.js` whose first line is `// @ts-check` (JSDoc types — the way
// a fallback-mode viz, one HTML file and no Bun, gets the same protection later).
//
// `/_kit/*` resolves to the kit's TypeScript sources (kit/src), so a wrong call into it — or a
// wrong use of what it returns — is an error here. Bundled kit files with no source are plain
// JS, read (`allowJs`) but not checked (`checkJs: false`).
// `https://…` imports are CDN modules. Where the skill has the package or its @types installed
// (devDependencies), the URL is typed as that package — `https://esm.sh/d3@7` checks as `d3`;
// anything else types as `any`.
// Tests (`tests/`) are checked too — `bun test` only strips types, so nothing else would — as a third
// program against the `viz` global's type (lib/testing/global.d.ts). `*.interactions.ts` is a verify
// script driving headless Chrome and is not checked.
// TWO PROGRAMS, because a viz can carry a whole Bun backend beside its page (api.ts, kb.ts,
// lib/*, pipeline.ts …) and browser settings make every `Bun.file`, `process` and `./x.ts`
// import in it an error that buries the real ones. The PAGE program is rooted at what the
// browser loads — the scripts its HTML names, plus `// @ts-check` .js — and tsc follows their
// imports. Every other .ts is BACKEND: checked against Bun's types (`@types/bun`), with `.ts`
// import paths allowed. A page with no script tag in its HTML (nothing to root at) is all page, except api.ts.

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCopy } from "../copy.ts";

const SKILL = path.resolve(import.meta.dir, "../..");

/** The compiler options every typed thing in /viz is held to — a viz by verify, the kit by
 *  `bun run sync:kit` (ADR 0023). EVERY CORRECTNESS FLAG, not just `strict`: an index can be
 *  undefined, an optional property can't be set to undefined by accident, every path returns,
 *  nothing is left unused. `isolatedModules` + `verbatimModuleSyntax` are the ones this setup
 *  NEEDS: files are stripped one at a time, so code that only compiles with the whole program
 *  in view (a type imported as a value) is an error here, not a broken page there. */
export const STRICT = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noPropertyAccessFromIndexSignature: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  allowUnreachableCode: false,
  allowUnusedLabels: false,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  skipLibCheck: true,
  moduleDetection: "force", // every file is a module: no shared top-level names between files
  target: "ES2022",
  module: "ESNext",
  moduleResolution: "Bundler",
  lib: ["ES2024", "DOM", "DOM.Iterable"], // what current Chrome runs (Object.groupBy, Promise.withResolvers)
} as const;
export const TSC_PATH = path.join(SKILL, "node_modules/typescript/lib/tsc.js");
const TSC = TSC_PATH;

const CDN =
  /^https:\/\/(?:esm\.sh|cdn\.jsdelivr\.net\/npm|unpkg\.com|cdn\.skypack\.dev)\/((?:@[^/@?]+\/)?[^/@?]+)(?:@[^/?]*)?(\/[^?#]*)?/u;

/** An ambient declaration for each CDN import in `files` whose package the skill has types for,
 *  re-exporting it by its bare name (resolved in the skill's node_modules by `bareToSkill`). */
export function cdnDeclarations(files: string[]): string {
  const urls = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(
      /(?:from\s*|import\s*\(\s*)["'](https:\/\/[^"']+)["']/gu,
    ))
      urls.add(m[1]!);
  }
  let out = "";
  for (const url of [...urls].toSorted()) {
    const m = url.match(CDN);
    if (!m) continue;
    const name = m[1]!;
    const typed =
      existsSync(path.join(SKILL, "node_modules", name)) ||
      existsSync(path.join(SKILL, "node_modules/@types", name.replace(/^@([^/]+)\//u, "$1__")));
    if (!typed) continue;
    const spec = JSON.stringify(name + (m[2] ?? "")),
      at = JSON.stringify(url);
    out += `declare module ${at} { export * from ${spec}; import d from ${spec}; export default d; }\n`;
  }
  return out;
}
/** Bare specifiers resolve in the skill's node_modules: CDN re-exports above, and import-mapped names like "three". */
/** tsconfig `paths` for the kit: the alias a viz writes (`@viz/kit`, `@viz/kit/<file>.js`) and the older `/_kit/*`. */
export const kitPaths = {
  "/_kit/*": [path.join(SKILL, "kit/src/*"), path.join(SKILL, "kit/*")],
  "@viz/kit": [path.join(SKILL, "kit/src/viz"), path.join(SKILL, "kit/viz")],
  "@viz/kit/*": [path.join(SKILL, "kit/src/*"), path.join(SKILL, "kit/*")],
};

export const bareToSkill = {
  // three's own import-map convention (three/addons/ → examples/jsm/), which @types/three mirrors.
  "three/addons/*": [path.join(SKILL, "node_modules/@types/three/examples/jsm/*")],
  "*": [path.join(SKILL, "node_modules/@types/*"), path.join(SKILL, "node_modules/*")],
};

/** Files the checker should see: `.ts` (not `.d.ts` or tests), and `.js` that opted in. */
export function typedFiles(vizDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules" || name === "tests" || name === "vendor")
        continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      // *.interactions.ts drives verify's headless Chrome from Bun: not page code, not checked.
      if (name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".interactions.ts"))
        out.push(abs);
      else if (
        name.endsWith(".js") &&
        /^\s*\/\/\s*@ts-check\b/u.test(readFileSync(abs, "utf8").slice(0, 200))
      )
        out.push(abs);
    }
  };
  walk(vizDir);
  return out.toSorted();
}

/** The viz's own tests: every `.ts` under tests/ (not `.d.ts`, not a vendored library's directory). */
export function testFiles(vizDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (
        name.startsWith(".") ||
        name === "node_modules" ||
        name === "vendor" ||
        name === "__screenshots__"
      )
        continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(abs);
    }
  };
  if (existsSync(path.join(vizDir, "tests"))) walk(path.join(vizDir, "tests"));
  return out.toSorted();
}

/** The kit sources the viz's HTML loads with `<script src="/_kit/x.js">`. A page that only loads a
 *  kit file (no `import`) still gets its global declarations — `deck:slide` on WindowEventMap, say
 *  — because these join the program. They are held to STRICT by sync:kit already, so they add
 *  no errors of their own. */
export function kitScriptSources(vizDir: string): string[] {
  const out = new Set<string>();
  for (const name of readdirSync(vizDir)) {
    if (!name.endsWith(".html")) continue;
    for (const m of readFileSync(path.join(vizDir, name), "utf8").matchAll(
      /<script\b[^>]*\bsrc=["']\/_kit\/([\w-]+)\.js["']/gu,
    )) {
      const src = path.join(SKILL, "kit/src", `${m[1]}.ts`);
      if (existsSync(src)) out.add(src);
    }
  }
  return [...out].toSorted();
}

/** Local scripts the viz's HTML loads — `<script src="./app.js">` → `app.ts` — the roots of the page
 *  program. `/_kit/…` and `https://…` sources are not the viz's own files. */
export function pageRoots(vizDir: string, files: string[]): string[] {
  const roots = new Set<string>();
  const htmls = readdirSync(vizDir).filter((n) => n.endsWith(".html"));
  for (const name of htmls) {
    for (const m of readFileSync(path.join(vizDir, name), "utf8").matchAll(
      /<script\b[^>]*\bsrc=["']([^"']+)["']/gu,
    )) {
      const src = m[1]!;
      if (/^(?:[a-z]+:)?\/\//u.test(src) || src.startsWith("/")) continue;
      const abs = path.resolve(vizDir, src.split(/[?#]/u)[0]!);
      const ts = abs.replace(/\.m?js$/u, ".ts");
      if (files.includes(ts)) roots.add(ts);
      else if (files.includes(abs)) roots.add(abs); // a // @ts-check .js
    }
  }
  // Any opted-in .js is page code by definition (it has no backend reading).
  for (const f of files) if (f.endsWith(".js")) roots.add(f);
  return [...roots].toSorted();
}

/** Null when the viz has nothing typed; otherwise what was checked and what failed. */
export function typecheck(dir: string): { files: string[]; errors: string[] } | null {
  const vizDir = realpathSync(dir); // tsc names files relative to its cwd; a symlinked path (/tmp) would not match
  if (isCopy(vizDir)) return null; // checked at its origin (lib/copy.ts)
  const files = typedFiles(vizDir);
  const tests = testFiles(vizDir);
  if (files.length === 0 && tests.length === 0) return null;
  if (!existsSync(TSC))
    return {
      files,
      errors: [`typescript is not installed in the viz skill — run \`bun install\` in ${SKILL}`],
    };
  const tmp = mkdtempSync(path.join(os.tmpdir(), "viz-types-"));
  try {
    const kit = kitScriptSources(vizDir);
    const rooted = pageRoots(vizDir, files);
    // Nothing to root at (an inline <script> in index.html, no src) means every .ts is page — except
    // the root api.ts, the documented backend entry, which is never page code.
    const backendEntry = path.join(vizDir, "api.ts");
    const page = rooted.length > 0 ? rooted : files.filter((f) => f !== backendEntry);
    const paths = { ...kitPaths, ...bareToSkill };
    const program = (
      name: string,
      options: Record<string, unknown>,
      roots: string[],
      ambient: string[],
    ) => {
      writeFileSync(
        path.join(tmp, `${name}.d.ts`),
        `declare module "https://*";\n${cdnDeclarations(ambient)}`,
      );
      writeFileSync(
        path.join(tmp, `${name}.json`),
        JSON.stringify({
          compilerOptions: {
            ...STRICT,
            noEmit: true,
            allowJs: true,
            checkJs: false,
            paths,
            ...options,
          },
          files: [...roots, path.join(tmp, `${name}.d.ts`)],
        }),
      );
      const r = Bun.spawnSync({
        cmd: [
          process.execPath,
          TSC,
          "-p",
          path.join(tmp, `${name}.json`),
          "--pretty",
          "false",
          "--listFiles",
        ],
        cwd: vizDir,
      });
      const out = r.stdout.toString() + r.stderr.toString();
      const errors = out
        .split("\n")
        .filter((l) => /error TS\d+/u.test(l))
        // tsc names files relative to its cwd, which is the viz: already the path an author wants.
        .map((l) => l.trim());
      if (r.exitCode !== 0 && errors.length === 0)
        errors.push(`tsc exited ${r.exitCode}: ${out.trim().slice(0, 400)}`);
      return {
        errors,
        listed: new Set(
          out
            .split("\n")
            .filter((l) => path.isAbsolute(l.trim()))
            .map((l) => l.trim()),
        ),
      };
    };
    const pageRun =
      page.length > 0
        ? program("page", {}, [...page, ...kit], [...page, ...kit])
        : { errors: [] as string[], listed: new Set<string>() };
    const errors = pageRun.errors;
    // Whatever the browser never loads is backend: Bun's types, and `./x.ts` imports allowed.
    const backend = files.filter((f) => !pageRun.listed.has(f));
    if (backend.length > 0) {
      // Only errors in the viz's own files: a backend that imports the skill's code (`../../lib/…`)
      // follows the import, and those files' errors are the skill's to fix, not this viz's.
      errors.push(
        ...program(
          "backend",
          {
            lib: ["ES2024"],
            types: ["bun"],
            typeRoots: [path.join(SKILL, "node_modules/@types")],
            allowImportingTsExtensions: true,
            // `process.env.PORT` is a property of an index signature in @types/node; the flag would make
            // every env read an error and say nothing about correctness.
            noPropertyAccessFromIndexSignature: false,
          },
          backend,
          backend,
        ).errors.filter((e) => !e.startsWith("..")),
      );
    }
    if (tests.length > 0) {
      // Tests drive the page from Bun (`viz`, puppeteer, bun:test) AND write callbacks that run in the page
      // (`page.$eval(sel, (e) => e.textContent)`), so this program has both Bun's types and the DOM's. They
      // also import the viz's own modules; those are checked by their own program above, so only what is
      // reported against tests/ counts here.
      errors.push(
        ...program(
          "tests",
          {
            types: ["bun"],
            typeRoots: [path.join(SKILL, "node_modules/@types")],
            allowImportingTsExtensions: true,
            noPropertyAccessFromIndexSignature: false,
          },
          [...tests, path.join(SKILL, "lib/testing/global.d.ts")],
          [...tests, ...files],
        ).errors.filter((e) => e.startsWith("tests/")),
      );
    }
    return { files: [...files, ...tests].map((f) => path.relative(vizDir, f)), errors };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
