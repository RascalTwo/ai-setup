import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { istanbul } from "../src/vite.mjs";
import { tmp } from "./helpers.mjs";

const TSX = "export const Free = ({ total }: { total: number }) => <p>{total > 50 && <b>free</b>}</p>;\n";

describe("istanbul() vite plugin", () => {
  test("instruments the original TSX before other transforms, a JSX && arm as a branch", async () => {
    const root = tmp();
    const p = istanbul();
    expect(p.enforce).toBe("pre");
    await p.configResolved({ root });
    const out = p.transform(TSX, join(root, "src/Free.tsx"));
    expect(out.code).toMatch("__coverage__");
    expect(out.code).toMatch('type: "binary-expr"');
    expect(out.map.sources[0]).toMatch("Free.tsx");
    expect(p.transform("export const a: number = 1;", join(root, "src/a.ts?v=1")).code).toMatch("__coverage__");
  });

  test("skips tests, the entry file, node_modules, non-scripts, and follows the app's config", async () => {
    const root = tmp();
    const p = istanbul();
    await p.configResolved({ root });
    for (const id of ["src/a.test.ts", "src/main.tsx", "node_modules/x/src/a.ts", "src/a.css", "lib/a.ts"]) expect(p.transform("x", join(root, id))).toBeUndefined();
    writeFileSync(join(root, "r2-test-kit.config.mjs"), "export default { include: (p) => p.startsWith('lib/') };");
    const q = istanbul();
    await q.configResolved({ root });
    expect(q.transform("export const a = 1;", join(root, "lib/a.ts"))).toBeTruthy();
    const own = istanbul({ include: () => false });
    await own.configResolved({ root });
    expect(own.transform("export const a = 1;", join(root, "lib/a.ts"))).toBeUndefined();
  });
});
