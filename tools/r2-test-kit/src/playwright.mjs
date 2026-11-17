// Playwright: `test` with an auto fixture that collects the page's Istanbul counters into one record per
// test. A full navigation throws the page's window away, so on pagehide each page stashes its counters
// in sessionStorage (synchronous, and it survives same-origin navigation); when the test ends the last
// page returns its own counters plus every stash. Measured: a binding call made on pagehide never
// arrives, and evaluating while a navigation request is held hangs.
import { test as base } from "@playwright/test";
import { relative } from "node:path";
import { add, OUT, writeRecord } from "./record.mjs";

const dir = `${OUT}/e2e`;
const KEY = "__r2cov:";

function stash() {
  addEventListener("pagehide", () => {
    if (!globalThis.__coverage__) return;
    try {
      sessionStorage.setItem(`${KEY}${sessionStorage.length}`, JSON.stringify(globalThis.__coverage__));
    } catch {
      sessionStorage.setItem(`${KEY}overflow`, "1");
    }
  });
}

function collect() {
  const parts = [globalThis.__coverage__ ?? {}];
  let overflow = false;
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k === `${KEY}overflow`) overflow = true;
    else if (k?.startsWith(KEY)) parts.push(JSON.parse(sessionStorage.getItem(k)));
  }
  return { parts, overflow };
}

export const test = base.extend({
  r2Coverage: [
    async ({ page }, use, info) => {
      // shortcut: only the `page` fixture is read, and a page left for another origin keeps its stash there; widen when a test needs it
      await page.addInitScript(`const KEY = ${JSON.stringify(KEY)}; (${stash})()`);
      await use();
      const { parts, overflow } = await page.evaluate(`const KEY = ${JSON.stringify(KEY)}; (${collect})()`).catch(() => ({ parts: [], overflow: false }));
      if (overflow) throw new Error("r2-test-kit: a page's coverage did not fit in sessionStorage, so this test's coverage is incomplete");
      const full = {}, sum = {};
      for (const c of parts) Object.assign(full, c), add(sum, c);
      const name = `${relative(process.cwd(), info.file)} > ${info.titlePath.slice(1).join(" > ")}`;
      writeRecord(dir, { runner: "playwright", name }, sum, full, process.cwd());
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";
