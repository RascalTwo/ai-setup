// tests/testing-tier.test.ts — `viz verify` decides which vizzes need their own tests, and runs them.
//
// WHY: a viz whose screen is computed from the user's input or from a live system can be
// silently wrong while looking fine, so it needs journey tests; a viz whose content is fixed
// when written only needs the smoke run verify already does. The decision is DETECTED from
// what the page does (ADR 0022), because a tag an author has to remember is a tag that rots
// (ADR 0011). These tests drive the real CLI against throwaway vizzes served by the real server.

import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const SKILL = path.dirname(import.meta.dir);
// Verified by file:// URL: serving them would mean registering a viz-pages container in the
// user's real registry on every test run.
const TMP = path.join(SKILL, "tests", ".tmp-vizzes");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A throwaway viz: files by name → contents. Returns its folder. */
function viz(name: string, files: Record<string, string>): string {
  const dir = path.join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), body);
  }
  return dir;
}
const page = (body: string, head = "") => `<!doctype html><html><head><meta charset="utf-8"><title>t</title>${head}</head><body><h1>Fixture</h1><svg width="200" height="100"><rect width="80" height="60"/><circle cx="140" cy="50" r="30"/></svg><p>A fixture viz with enough on it to pass the layout audit.</p>${body}</body></html>`;

type Verdict = { ok: boolean; errors: string[]; tests: { needed: boolean; why: string[]; optOut: string | null; ran: number; failed: number } };
async function verify(dir: string, ...flags: string[]): Promise<{ code: number; v: Verdict }> {
  return verifyWith({}, dir, ...flags);
}
async function verifyWith(env: Record<string, string>, dir: string, ...flags: string[]): Promise<{ code: number; v: Verdict }> {
  const target = `file://${dir}/index.html`;
  const proc = Bun.spawn(["bun", path.join(SKILL, "viz.ts"), "verify", target, "--json", ...flags], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, VIZ_NO_OPEN: "1", ...env },
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, v: JSON.parse(out.slice(out.indexOf("{"))) };
}

async function shots(dir: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", path.join(SKILL, "viz.ts"), "shots", `file://${dir}/index.html`, ...args], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, VIZ_NO_OPEN: "1" },
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe("which vizzes need their own tests", () => {
  test.concurrent("Given a viz with a text input and no tests, when verify runs, then it fails naming the input and how to opt out", async () => {
    // GIVEN a page the user types into, with no tests/ folder
    const dir = viz("input-no-tests", { "index.html": page(`<input id="name" type="text">`) });

    // WHEN verify runs
    const { code, v } = await verify(dir);

    // THEN it fails, and exits non-zero so a script or hook can stop on it
    expect(v.ok).toBe(false);
    expect(code).toBe(1);
    // THEN it says why: the input it found
    expect(v.tests.needed).toBe(true);
    expect(v.tests.why.join(" ")).toContain("input#name");
    // THEN the error tells the author the two ways forward
    const msg = v.errors.join("\n");
    expect(msg).toContain("tests/");
    expect(msg).toContain('viz:tests');
  }, 60000);

  test.concurrent("Given a viz with an input that opts out with a reason, when verify runs, then it passes and records the reason", async () => {
    // GIVEN a timeline scrubber, opted out with a reason
    const dir = viz("opt-out", { "index.html": page(`<input id="scrub" type="range">`, `<meta name="viz:tests" content="smoke: the slider only scrubs a fixed timeline">`) });

    // WHEN verify runs
    const { code, v } = await verify(dir);

    // THEN it passes, exiting 0
    expect(v.errors).toEqual([]);
    expect(code).toBe(0);
    // THEN the reason is on the record
    expect(v.tests.needed).toBe(false);
    expect(v.tests.optOut).toBe("the slider only scrubs a fixed timeline");
  }, 60000);

  test.concurrent("Given an opt-out with no reason, when verify runs, then it fails asking for one", async () => {
    // GIVEN viz:tests="smoke" and nothing after it
    const dir = viz("opt-out-bare", { "index.html": page(`<input id="q">`, `<meta name="viz:tests" content="smoke">`) });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it fails, saying a reason is required
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("needs a reason");
  }, 60000);

  test.concurrent("Given a viz whose content is fixed, when verify runs, then the smoke run is enough", async () => {
    // GIVEN a page with no input, no live calls, no api.ts, and an <input> only inside a code sample
    const dir = viz("static", { "index.html": page(`<pre><code><input type="text"></code></pre>`) });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it passes without asking for tests
    expect(v.errors).toEqual([]);
    expect(v.tests.needed).toBe(false);
  }, 60000);

  test.concurrent("Given a viz with a backend and no inputs, when verify runs, then it needs tests because of the backend", async () => {
    // GIVEN a page with an api.ts beside it
    const dir = viz("backend", { "index.html": page(""), "api.ts": "export default {};" });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it needs tests, and says the backend is why
    expect(v.ok).toBe(false);
    expect(v.tests.why).toContain("has api.ts");
  }, 60000);

  test.concurrent("Given a viz that declares itself an app, when verify runs, then it needs tests though nothing was detected", async () => {
    // GIVEN a page driven only by buttons, declared an app
    const dir = viz("declared-app", { "index.html": page(`<button>Next branch</button>`, `<meta name="viz:tests" content="app">`) });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it needs tests
    expect(v.ok).toBe(false);
    expect(v.tests.needed).toBe(true);
  }, 60000);
});

describe("running a viz's own tests", () => {
  // A tiny app: type a name, it greets you.
  const app = page(`<input id="name"><p id="out"></p><script>
    document.querySelector("#name").addEventListener("input", (e) => {
      document.querySelector("#out").textContent = "Hello, " + e.target.value + "!"; });</script>`);

  test.concurrent("Given an app viz with a passing journey test, when verify runs, then it passes and counts the test", async () => {
    // GIVEN the greeting app and a test that types a name through the real page
    const dir = viz("app-passing", { "index.html": app, "tests/greet.test.ts": `
      import { test, expect } from "bun:test";
      test("greets by name", async () => {
        const page = await viz.open();
        await page.type("#name", "Ada");
        expect(await page.$eval("#out", (e) => e.textContent)).toBe("Hello, Ada!");
      });` });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it passes
    expect(v.errors).toEqual([]);
    // THEN it ran the one test
    expect(v.tests.ran).toBe(1);
    expect(v.tests.failed).toBe(0);
  }, 90000);

  test.concurrent("Given an app viz whose journey test fails, when verify runs, then it fails naming the test", async () => {
    // GIVEN the greeting app and a test expecting the wrong greeting
    const dir = viz("app-failing", { "index.html": app, "tests/greet.test.ts": `
      import { test, expect } from "bun:test";
      test("greets formally", async () => {
        const page = await viz.open();
        await page.type("#name", "Ada");
        expect(await page.$eval("#out", (e) => e.textContent)).toBe("Good day, Ada.");
      });` });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it fails, naming the failing test
    expect(v.ok).toBe(false);
    expect(v.tests.failed).toBe(1);
    expect(v.errors.join("\n")).toContain("greets formally");
  }, 90000);

  test.concurrent("Given a shell that forces colour output, when verify runs a failing journey test, then it still names the test", async () => {
    // GIVEN the greeting app and a test expecting the wrong greeting
    const dir = viz("app-failing-colour", { "index.html": app, "tests/greet.test.ts": `
      import { test, expect } from "bun:test";
      test("greets formally", async () => {
        const page = await viz.open();
        await page.type("#name", "Ada");
        expect(await page.$eval("#out", (e) => e.textContent)).toBe("Good day, Ada.");
      });` });

    // WHEN verify runs with FORCE_COLOR set, as some terminals and hooks do
    const { v } = await verifyWith({ FORCE_COLOR: "3" }, dir);

    // THEN it fails, naming the failing test rather than "tests did not run"
    expect(v.tests.failed).toBe(1);
    expect(v.errors.join("\n")).toContain("greets formally");
  }, 90000);
});

describe("failure videos", () => {
  const app = page(`<input id="name"><p id="out"></p><script>
    document.querySelector("#name").addEventListener("input", (e) => {
      document.querySelector("#out").textContent = "Hello, " + e.target.value + "!"; });</script>`);
  const tests = { "tests/greet.test.ts": `
    import { test, expect } from "bun:test";
    test("greets by name", async () => {
      const page = await viz.open();
      await page.type("#name", "Ada");
      expect(await page.$eval("#out", (e) => e.textContent)).toBe("Hello, Ada!");
    });
    test("greets formally", async () => {
      const page = await viz.open();
      await page.type("#name", "Ada");
      expect(await page.$eval("#out", (e) => e.textContent)).toBe("Good day, Ada.");
    });` };

  test.concurrent("Given one failing and one passing journey test, when verify runs, then only the failure's video is kept, and named", async () => {
    // GIVEN two tests of the greeting app, the second expecting the wrong greeting
    const dir = viz("video", { "index.html": app, ...tests });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN the failing test's error names a video of it
    const failed = v.errors.find((e) => e.includes("greets formally"))!;
    const video = failed.match(/video: (\S+\.webm)/)?.[1];
    expect(video).toBeDefined();
    expect((await Bun.file(video!).stat()).size).toBeGreaterThan(0);
    // THEN no video is left for the test that passed
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(path.dirname(video!)).filter((f) => f.endsWith(".webm"))).toEqual([path.basename(video!)]);
  }, 120000);
});

describe("failure videos with concurrent tests", () => {
  test.concurrent("Given a passing test then two concurrent tests that fail, when verify runs, then no failure is given another test's video", async () => {
    // GIVEN a filmed passing test, followed by two failing tests that run at the same time
    const dir = viz("video-concurrent", {
      "index.html": page(`<input id="name">`),
      "tests/a.test.ts": `
        import { test, expect } from "bun:test";
        test("alone and passing", async () => { await viz.open(); });
        test.concurrent("together one", async () => { await viz.open(); expect(1).toBe(2); });
        test.concurrent("together two", async () => { await viz.open(); expect(1).toBe(3); });`,
    });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN both concurrent failures are reported
    const failures = v.errors.filter((e) => e.includes("TEST FAILED"));
    expect(failures.length).toBe(2);
    // THEN neither carries a video — the only one filmed belonged to the passing test
    expect(failures.some((e) => e.includes("video:"))).toBe(false);
  }, 120000);
});

describe("screenshot baselines", () => {
  const box = (colour: string) => page(`<input id="x"><div id="box" style="width:120px;height:80px;background:${colour}"></div>`);
  const shotTest = { "tests/look.test.ts": `
    import { test } from "bun:test";
    test("the box looks right", async () => {
      const page = await viz.open();
      await viz.screenshot(page, "box", { selector: "#box" });
    });` };

  test.concurrent("Given a screenshot with no baseline yet, when verify runs, then it fails until a person approves the picture", async () => {
    // GIVEN a viz whose test screenshots a box, and no baseline on disk
    const dir = viz("shot-new", { "index.html": box("red"), ...shotTest });

    // WHEN verify runs
    const first = await verify(dir);

    // THEN it fails, saying the new picture awaits approval
    expect(first.v.ok).toBe(false);
    expect(first.v.errors.join("\n")).toContain("awaiting approval");
    // THEN the picture waits in .pending, not as the baseline
    expect(await Bun.file(path.join(dir, "tests/__screenshots__/.pending/box.png")).exists()).toBe(true);
    expect(await Bun.file(path.join(dir, "tests/__screenshots__/box.png")).exists()).toBe(false);

    // WHEN a person approves it and verify runs again
    await shots(dir, "--approve", "box");
    const { v } = await verify(dir);

    // THEN it passes, with the approved picture as the baseline
    expect(v.errors).toEqual([]);
    expect(await Bun.file(path.join(dir, "tests/__screenshots__/box.png")).exists()).toBe(true);
  }, 120000);

  test.concurrent("Given a changed picture, when a person rejects it, then the baseline is untouched and verify still fails", async () => {
    // GIVEN an approved red box that has turned blue
    const dir = viz("shot-reject", { "index.html": box("red"), ...shotTest });
    await verify(dir, "--update-snapshots");
    const before = await Bun.file(path.join(dir, "tests/__screenshots__/box.png")).bytes();
    writeFileSync(path.join(dir, "index.html"), box("blue"));
    await verify(dir);

    // WHEN a person rejects the change
    const listed = await shots(dir, "--json");
    await shots(dir, "--reject", "box");

    // THEN the change was listed for review
    expect(JSON.parse(listed)).toEqual([{ name: "box", kind: "changed" }]);
    // THEN the baseline is exactly what it was
    expect(await Bun.file(path.join(dir, "tests/__screenshots__/box.png")).bytes()).toEqual(before);
    // THEN nothing is pending, and verify still fails — the page is still wrong
    expect(await Bun.file(path.join(dir, "tests/__screenshots__/.pending/box.png")).exists()).toBe(false);
    expect((await verify(dir)).v.ok).toBe(false);
  }, 150000);

  test.concurrent("Given a baseline of a different picture, when verify runs, then it fails naming the screenshot", async () => {
    // GIVEN an approved baseline of a red box
    const dir = viz("shot-changed", { "index.html": box("red"), ...shotTest });
    await verify(dir, "--update-snapshots");

    // WHEN the box turns blue and verify runs again
    writeFileSync(path.join(dir, "index.html"), box("blue"));
    const { v } = await verify(dir);

    // THEN it fails, naming the screenshot that changed
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain('screenshot "box"');
  }, 120000);

  test.concurrent("Given a screenshot that masks a clock, when the clock changes between runs, then it still matches", async () => {
    // GIVEN a box with the current time inside it, screenshotted with the time masked
    const clock = (t: string) => page(`<input id="x"><div id="box" style="width:160px;height:80px;background:#eee"><span id="now">${t}</span></div>`);
    const test_ = { "tests/look.test.ts": `
      import { test } from "bun:test";
      test("the box looks right", async () => {
        const page = await viz.open();
        await viz.screenshot(page, "box", { selector: "#box", mask: ["#now"] });
      });` };
    const dir = viz("shot-mask", { "index.html": clock("10:41:07"), ...test_ });
    await verify(dir, "--update-snapshots");

    // WHEN the time is different on the next run
    writeFileSync(path.join(dir, "index.html"), clock("23:59:59"));
    const { v } = await verify(dir);

    // THEN it still matches
    expect(v.errors).toEqual([]);
  }, 120000);

  test.concurrent("Given a changed picture, when verify runs with --update-snapshots, then the baseline is replaced and it passes", async () => {
    // GIVEN a baseline of a red box, and the box now blue
    const dir = viz("shot-update", { "index.html": box("red"), ...shotTest });
    await verify(dir, "--update-snapshots");
    writeFileSync(path.join(dir, "index.html"), box("blue"));

    // WHEN verify runs with --update-snapshots, then again without it
    await verify(dir, "--update-snapshots");
    const { v } = await verify(dir);

    // THEN the new picture is the baseline, and it passes
    expect(v.errors).toEqual([]);
  }, 150000);
});

describe("coverage floor", () => {
  // app.js: greet() runs when the user types; shout() never runs from the page.
  const files = (floor?: number) => ({
    "index.html": page(`<input id="name"><p id="out"></p><script src="app.js"></script>`),
    "app.js": `function greet(n) {\n  return "Hello, " + n + "!";\n}\nfunction shout(n) {\n  const loud = n.toUpperCase();\n  return loud + "!!!";\n}\ndocument.querySelector("#name").addEventListener("input", (e) => {\n  document.querySelector("#out").textContent = greet(e.target.value);\n});\n`,
    "tests/greet.test.ts": `
      import { test, expect } from "bun:test";
      test("greets by name", async () => {
        const page = await viz.open();
        await page.type("#name", "Ada");
        expect(await page.$eval("#out", (e) => e.textContent)).toBe("Hello, Ada!");
      });`,
    ...(floor === undefined ? {} : { "tests/coverage-floor.json": JSON.stringify({ lines: floor }) }),
  });
  type Cov = { lines: number; floor: { lines: number }; files: Record<string, { lines: number }> };
  const cov = (v: unknown) => (v as { coverage: Cov }).coverage;

  test.concurrent("Given an app viz with no floor yet, when verify runs, then it measures the page's code and sets the floor", async () => {
    // GIVEN a tested app viz with code the tests never reach, and no floor file
    const dir = viz("cov-new", files());

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it passes
    expect(v.errors).toEqual([]);
    // THEN app.js is measured: some lines ran, the ones in shout() didn't
    expect(cov(v).files["app.js"].lines).toBeGreaterThan(0);
    expect(cov(v).files["app.js"].lines).toBeLessThan(100);
    // THEN the floor is set to what was measured
    const floor = JSON.parse(await Bun.file(path.join(dir, "tests/coverage-floor.json")).text());
    expect(floor.lines).toBe(cov(v).floor.lines);
  }, 90000);

  test.concurrent("Given a floor above what the tests now reach, when verify runs, then it fails saying coverage dropped", async () => {
    // GIVEN a floor of 100% on code the tests only partly run
    const dir = viz("cov-drop", files(100));

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it fails, naming the drop
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("below its floor");
  }, 90000);

  test.concurrent("Given a floor below what the tests now reach, when verify runs, then it passes and raises the floor", async () => {
    // GIVEN a floor of 10%
    const dir = viz("cov-raise", files(10));

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it passes
    expect(v.errors).toEqual([]);
    // THEN the floor went up to the new level, never down
    const floor = JSON.parse(await Bun.file(path.join(dir, "tests/coverage-floor.json")).text());
    expect(floor.lines).toBeGreaterThan(10);
  }, 90000);
});

describe("measuring coverage", () => {
  test.concurrent("Given a viz folder written with a trailing slash, when its coverage is measured, then its own scripts still count", async () => {
    // GIVEN a viz folder and a raw browser coverage file for its app.js, as a served viz produces
    const dir = viz("cov-slash", { "app.js": "function a() {\n  return 1;\n}\na();\n" });
    const out = path.join(dir, "out");
    mkdirSync(out);
    writeFileSync(path.join(out, "browser-coverage-1-0.json"), JSON.stringify({ test: null, scripts: [{
      url: `file://${dir}/app.js`, text: "function a() {\n  return 1;\n}\na();\n",
      functions: [{ functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 35, count: 1 }] }],
    }] }));

    // WHEN coverage is measured with the folder given as a served URL gives it: trailing slash
    const { measureCoverage } = await import("../lib/verify/tier.ts");
    const files = await measureCoverage(dir + "/", out);

    // THEN app.js is measured
    expect(files["app.js"]).toMatchObject({ covered: 4, total: 4 });
  });

  test.concurrent("Given a big file half covered and a tiny file fully covered, when the floor is applied, then the total weighs lines, not files", async () => {
    // GIVEN 50 of 100 lines in one file, and 2 of 2 in another
    const dir = viz("cov-weight", { "index.html": page("") });
    mkdirSync(path.join(dir, "tests"));

    // WHEN the floor is applied
    const { ratchet } = await import("../lib/verify/tier.ts");
    const f = (covered: number, total: number) => ({ covered, total, bCovered: 0, bTotal: 0, missed: [], missedBranches: [], ignores: [] });
    const c = ratchet(dir, { "big.js": f(50, 100), "tiny.js": f(2, 2) });

    // THEN the total is 52 of 102 lines, not the average of 50% and 100%
    expect(c.lines).toBe(50.9);
  });

  test.concurrent("Given a run that measured none of the viz's own scripts, when the floor is applied, then no floor is set", async () => {
    // GIVEN a viz with no floor yet, and nothing measured
    const dir = viz("cov-none", { "index.html": page("") });
    mkdirSync(path.join(dir, "tests"));

    // WHEN the floor is applied to an empty measurement
    const { ratchet } = await import("../lib/verify/tier.ts");
    ratchet(dir, {});

    // THEN no floor file was written — 0% would be a floor that guards nothing
    expect(await Bun.file(path.join(dir, "tests/coverage-floor.json")).exists()).toBe(false);
  });
});

describe("branch coverage, reasoned exclusions, and the uncovered report", () => {
  // sign() is called with a positive number only: every line runs, one branch never does.
  const files = (appJs: string) => ({
    "index.html": page(`<input id="n"><p id="out"></p><script src="app.js"></script>`),
    "app.js": appJs,
    "tests/sign.test.ts": `
      import { test, expect } from "bun:test";
      test("names the sign", async () => {
        const page = await viz.open();
        await page.type("#n", "5");
        expect(await page.$eval("#out", (e) => e.textContent)).toBe("positive");
      });`,
  });
  const sign = `function sign(n) {\n  return n > 0 ? "positive" : "not positive";\n}\ndocument.querySelector("#n").addEventListener("input", (e) => {\n  document.querySelector("#out").textContent = sign(Number(e.target.value));\n});\n`;
  type Cov = { lines: number; branches: number; report: string };
  const cov = (v: unknown) => (v as { coverage: Cov }).coverage;

  test.concurrent("Given a condition only ever taken one way, when verify runs, then lines are complete but branches are not", async () => {
    // GIVEN every line runs, and the ternary only ever takes its first arm
    const dir = viz("branch", files(sign));

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN all lines count as covered, and the branch coverage shows the missing arm
    expect(cov(v).lines).toBe(100);
    expect(cov(v).branches).toBeLessThan(100);
    // THEN the floor holds branches too
    const floor = JSON.parse(await Bun.file(path.join(dir, "tests/coverage-floor.json")).text());
    expect(floor.branches).toBe(cov(v).branches);
    // THEN the data says exactly which code never ran: the ternary's other arm
    const data = JSON.parse(await Bun.file(cov(v).report.replace(/\.txt$/, ".json")).text());
    expect(data.files["app.js"].untaken.some((u: { code: string }) => u.code.includes('"not positive"'))).toBe(true);
  }, 90000);

  test.concurrent("Given a test that reloads the page, when verify runs, then what ran before the reload still counts", async () => {
    // GIVEN a test that types (running the handler), then reloads the page
    const dir = viz("reload", { ...files(sign), "tests/sign.test.ts": `
      import { test, expect } from "bun:test";
      test("names the sign, then comes back", async () => {
        const page = await viz.open();
        await page.type("#n", "5");
        expect(await page.$eval("#out", (e) => e.textContent)).toBe("positive");
        await page.reload();
      });` });

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN the handler that ran before the reload is covered
    expect(cov(v).lines).toBe(100);
  }, 90000);

  test.concurrent("Given code the tests never reach, when verify runs, then the report names the lines", async () => {
    // GIVEN a function nothing calls
    const dir = viz("report", files(sign + `function unused() {\n  return "never";\n}\n`));

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN the coverage report lists the unreached lines with their code
    const report = await Bun.file(cov(v).report).text();
    expect(report).toContain("app.js");
    expect(report).toContain('return "never";');
  }, 90000);

  test.concurrent("Given an exclusion comment with no reason, when verify runs, then it fails naming where", async () => {
    // GIVEN code excluded from coverage without saying why
    const dir = viz("ignore-bare", files(sign + `/* c8 ignore next */\nfunction unused() { return "never"; }\n`));

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it fails, pointing at the file and line and asking for the reason
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toMatch(/app\.js:7 .*needs a reason/);
  }, 90000);

  test.concurrent("Given an exclusion with a reason, when verify runs, then the excluded code doesn't count against coverage", async () => {
    // GIVEN the unreached function excluded, with a reason
    const dir = viz("ignore-reason", files(sign + `/* c8 ignore next -- kept for the console, never called by the page */\nfunction unused() { return "never"; }\n`));

    // WHEN verify runs
    const { v } = await verify(dir);

    // THEN it passes with every line covered
    expect(v.errors).toEqual([]);
    expect(cov(v).lines).toBe(100);
    // THEN the report records the exclusion and its reason, so a reviewer sees it
    expect(await Bun.file(cov(v).report).text()).toContain("kept for the console, never called by the page");
  }, 90000);
});

describe("coverage attribution", () => {
  // Two handlers, each driven by its own test.
  const files = {
    "index.html": page(`<input id="a"><input id="b"><p id="out"></p><script src="app.js"></script>`),
    "app.js": `document.querySelector("#a").addEventListener("input", () => {\n  document.querySelector("#out").textContent = "typed in a";\n});\ndocument.querySelector("#b").addEventListener("input", () => {\n  document.querySelector("#out").textContent = "typed in b";\n});\n`,
    "tests/ab.test.ts": `
      import { describe, it, expect } from "bun:test";
      describe("the two boxes", () => {
        it.concurrent("should answer box a", async () => {
          const page = await viz.open();
          await page.type("#a", "x");
          expect(await page.$eval("#out", (e) => e.textContent)).toBe("typed in a");
        });
        it.concurrent("should answer box b", async () => {
          const page = await viz.open();
          await page.type("#b", "x");
          expect(await page.$eval("#out", (e) => e.textContent)).toBe("typed in b");
        });
      });`,
  };

  test.concurrent("Given two tests that each drive one handler, when verify runs, then each handler's lines name only its own test", async () => {
    // GIVEN the two-box viz and its two concurrent tests
    const dir = viz("attribution", files);

    // WHEN verify runs
    const { v } = await verify(dir);
    const data = JSON.parse(await Bun.file((v as unknown as { coverage: { report: string } }).coverage.report.replace(/\.txt$/, ".json")).text());
    const by = data.files["app.js"].by as Record<string, string[]>;

    // THEN box a's handler line is covered by box a's test alone
    expect(by["2"]).toEqual(["the two boxes › should answer box a"]);
    // THEN box b's handler line by box b's test alone
    expect(by["5"]).toEqual(["the two boxes › should answer box b"]);
    // THEN the other way round: each test lists the lines it covered
    expect(data.tests["the two boxes › should answer box a"].lines["app.js"]).toContain(2);
    expect(data.tests["the two boxes › should answer box a"].lines["app.js"]).not.toContain(5);
    // THEN the interactive page exists beside it
    expect(await Bun.file((v as unknown as { coverage: { report: string } }).coverage.report.replace(/\.txt$/, ".html")).exists()).toBe(true);
  }, 90000);
});

describe("merging coverage across pages", () => {
  test.concurrent("Given one test takes an early return and another runs past it, when verify runs, then nothing after the return reads as never run", async () => {
    // GIVEN f() returns early for an empty value and carries on otherwise, and two tests, one each way,
    // each in its own page — so Chrome reports the rest of f() only in the page where it DIDN'T run
    const dir = viz("merge-early-return", {
      "index.html": page(`<input id="a"><input id="b"><p id="out"></p><script src="app.js"></script>`),
      "app.js": `function f(s) {\n  if (!s) return "none";\n  const n = s.length;\n  return "len " + n;\n}\nfor (const id of ["a", "b"]) document.querySelector("#" + id).addEventListener("input", (e) => {\n  document.querySelector("#out").textContent = f(id === "a" ? e.target.value : "");\n});\n`,
      "tests/f.test.ts": `
        import { it, expect } from "bun:test";
        it.concurrent("should measure a value", async () => {
          const page = await viz.open();
          await page.type("#a", "xy");
          expect(await page.$eval("#out", (e) => e.textContent)).toBe("len 2");
        });
        it.concurrent("should say none for nothing", async () => {
          const page = await viz.open();
          await page.type("#b", "z");
          expect(await page.$eval("#out", (e) => e.textContent)).toBe("none");
        });`,
    });

    // WHEN verify runs
    const { v } = await verify(dir);
    const data = JSON.parse(await Bun.file((v as unknown as { coverage: { report: string } }).coverage.report.replace(/\.txt$/, ".json")).text());

    // THEN the lines after the early return aren't reported as code no test ran
    expect(data.files["app.js"].untaken.filter((u: { line: number }) => u.line === 3 || u.line === 4)).toEqual([]);
    // THEN both ways through the if were taken
    expect(data.files["app.js"].untaken.filter((u: { line: number }) => u.line === 2)).toEqual([]);
  }, 90000);
});
