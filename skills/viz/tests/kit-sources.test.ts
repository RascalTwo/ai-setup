// tests/kit-sources.test.ts — parts of the skill are written in TypeScript and shipped as JavaScript (ADR 0023).
//
// WHY: fallback mode and the gem build copy kit/<name>.js and template files verbatim, inline.ts
// embeds tape-key.js, and every server, export and vendored runtime reads the kit's .js — so the
// committed .js is what actually runs. It must be exactly what its source compiles to, and that
// source must pass the strictness a typed viz does.
import { expect, test } from "bun:test";
import path from "node:path";
import { compileSources, generatedSources } from "../maintainer/sync-kit.ts";

const SKILL = path.dirname(import.meta.dir);
const { files, errors } = compileSources();

test("Given the TypeScript sources shipped as JS, when compiled at verify's strictness, then there are no type errors", () => {
  expect(errors).toEqual([]);
});

test("Given every such source, when compiled, then each produced its .js", () => {
  expect([...files.keys()].sort()).toEqual([...generatedSources().values()].sort());
});

for (const [src, dest] of generatedSources()) {
  test(`Given ${src}, when compiled, then committed ${dest} is exactly its output (else: bun run sync:kit)`, async () => {
    expect(await Bun.file(path.join(SKILL, dest)).text()).toBe(files.get(dest)!);
  });
}
