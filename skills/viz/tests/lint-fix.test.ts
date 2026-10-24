// tests/lint-fix.test.ts — `viz lint --fix` moves inline code scripts into .ts files and leaves data blocks alone.

import { expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extractInlineScripts } from "../lib/lint/fix.ts";

test("inline code becomes <page>.<n>.ts; import maps, data and src scripts stay", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "viz-fix-"));
  try {
    const page = `<script type="importmap">{"imports":{}}</script>\n<script type="module">\nconst a = 1;\n</script>\n<script src="./x.js"></script>\n<script>var b = 2;</script>`;
    writeFileSync(path.join(dir, "index.html"), page);
    expect(extractInlineScripts(dir)).toEqual(["index.1.ts", "index.2.ts"]);
    expect(readFileSync(path.join(dir, "index.1.ts"), "utf8")).toBe("const a = 1;\n");
    expect(readFileSync(path.join(dir, "index.2.ts"), "utf8")).toBe("var b = 2;\n");
    const html = readFileSync(path.join(dir, "index.html"), "utf8");
    expect(html).toContain(`<script type="module" src="./index.1.js"></script>`);
    expect(html).toContain(`<script src="./index.2.js"></script>`);
    expect(html).toContain(`<script type="importmap">`);
    expect(extractInlineScripts(dir)).toEqual([]); // idempotent
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
