// lib/testing/runner.ts — vitest's runner, with each test run in its own scope (lib/testing/scope.ts).
//
// A page lives as long as the test that opened it: left open, every page of the self-portrait's 143 tests lived to the
// end of the run (289 Chrome renderers, ~32 GB summed RSS). Tests overlap (it.concurrent), and vitest's own
// "current test" is one global, so the scope rides on AsyncLocalStorage instead. When the test has ended its pages
// close, a passing test's films are deleted and a failing test's are kept under a name verify can find.
import { TestRunner } from "vitest";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fullName, testKey, videoStem } from "./names.ts";
import { shared, type Scope } from "./scope.ts";

type Named = { name: string; suite?: Named | undefined; type?: string };
const ancestorsOf = (test: { suite?: Named | undefined }): string[] => {
  const names: string[] = [];
  for (let s = test.suite; s?.type === "suite"; s = s.suite) names.unshift(s.name);
  return names;
};
const scopes = new WeakMap<object, Scope>();

// Teardown runs after the test, outside every vitest timeout, so a close or a film stop that never settles (a hung
// renderer, an ffmpeg already gone) used to hang the whole run for hours. Each gets 15 s, then the run moves on.
const SETTLE_MS = 15_000;
async function settle(p: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    p.catch(() => null),
    new Promise((resolve) => {
      timer = setTimeout(resolve, SETTLE_MS);
    }),
  ]);
  clearTimeout(timer);
}

export default class VizRunner extends TestRunner {
  // oxlint-disable-next-line eslint/class-methods-use-this -- vitest calls it as a method of its runner; it needs none of the runner's state
  public async runTask(test: Parameters<TestRunner["onAfterTryTask"]>[0]): Promise<void> {
    const id = testKey(test.file.filepath, ancestorsOf(test), test.name, test.location?.line);
    const scope: Scope = { id, pages: new Set(), films: [], ended: false };
    scopes.set(test, scope);
    shared.running++;
    try {
      await shared.als.run(scope, () => TestRunner.getTestFn(test)?.());
    } finally {
      shared.running--;
    }
  }

  public override async onAfterRetryTask(
    ...args: Parameters<TestRunner["onAfterRetryTask"]>
  ): Promise<void> {
    await super.onAfterRetryTask(...args);
    const [test] = args;
    const scope = scopes.get(test);
    if (!scope) return;
    scope.ended = true;
    for (const page of scope.pages) {
      // oxlint-disable-next-line no-await-in-loop -- one at a time: closing writes the page's coverage file
      await settle(page.close()); // a page already gone with the browser rejects: that is fine
    }
    const stem = videoStem(fullName(ancestorsOf(test), test.name));
    const out = process.env.VIZ_OUT ?? "";
    let n = 0;
    for (const film of scope.films.splice(0)) {
      // oxlint-disable-next-line no-await-in-loop -- one film at a time: stopping one flushes its file
      await settle(film.stop());
      if (test.result?.state === "fail") {
        const kept = path.join(out, "videos", `${stem}--${n++}.webm`);
        mkdirSync(path.dirname(kept), { recursive: true });
        renameSync(film.path, kept);
      } else rmSync(film.path, { force: true });
    }
  }
}
