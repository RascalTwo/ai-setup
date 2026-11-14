import { stepper, need } from "@viz/kit";
import { startExplorer } from "./explorer.js";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "ONE COMMAND, BOTH RUNNERS",
    rows: [
      ["format, lint, types", "run first", "ok"],
      ["vitest (node + component projects)", "logic and component tests", "ok"],
      ["Playwright Test", "journeys against the built bundle", "ok"],
      ["run-s --continue-on-error", "one failure hides nothing", "ok"],
    ],
    lede: "<b>Two runners must never mean two answers.</b> The check command runs both, then the coverage merge and the results merge, and ends in one exit code.",
  },
  {
    t: "INSTRUMENT ONCE, WITH ISTANBUL",
    rows: [
      ["istanbul-lib-instrument Vite plugin", "14 lines, enforce: pre", "ok"],
      ["vitest", "instrumented source", "ok"],
      ["browser-test build", "fills window.__coverage__", "ok"],
      ["instrument after the TS transform", "drops a JSX && branch", "bad"],
    ],
    lede: "The plugin instruments the original <code>.ts</code> and <code>.tsx</code> before any transform, so unit, component and browser coverage share one format and merge exactly, branches included.",
  },
  {
    t: "RECORD COVERAGE PER TEST",
    rows: [
      ["vitest setup file", "copy before, subtract after", "ok"],
      ["imports before any test", "go to a (load) entry", "ok"],
      ["Playwright auto fixture", "reads window.__coverage__", "ok"],
      ["at the end of each test", "pages left by navigation too", "ok"],
    ],
    lede: "Every run records which lines, functions and branches each test reached. The <code>(load)</code> entry keeps imports from crediting every test.",
  },
  {
    t: "MERGE COVERAGE, CHECK THE FLOOR",
    rows: [
      ["monocart-coverage-reports", "one merged report", "ok"],
      ["floor", "checked on the merged result", "ok"],
      ["every expected input exists", "checked by the merge script", "ok"],
      ["a missing or empty input", "fails the check", "bad"],
    ],
    lede: "The merge tool only logs a missing folder, so the script checks every input has data. Its path filters are functions, not globs: globs fail silently under a dot-folder.",
  },
  {
    t: "ONE RESULT LIST",
    rows: [
      ["vitest", "JUnit XML", "ok"],
      ["Playwright", "JUnit XML", "ok"],
      ["Allure 3 (allure)", "one list, one HTML report", "ok"],
      ["quality gate", "fails the run", "bad"],
    ],
    lede: "Each runner writes JUnit XML and Allure 3 reads both, so no adapters are needed. The gate in Allure decides the exit code.",
  },
  {
    t: "ASK THE MAP BOTH WAYS",
    rows: [
      ['cov-map --test "<name>"', "its lines, functions, branches", "ok"],
      ["cov-map --line src/file.ts:12", "the tests that reach it", "ok"],
      ["branch arm", "12.b0.1", "ok"],
      ["a line only one test reaches", "fragile", "bad"],
    ],
    lede: "When a line breaks you know which tests to run; a test that reaches nothing unique may be redundant. The map was identical with tests in parallel or one at a time.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const render = (i: number): void => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:12px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};text-align:right">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "stack" });
need("#next").addEventListener("click", () => st.next());
need("#prev").addEventListener("click", () => st.prev());
const play = need("#play");
let on = false;
play.addEventListener("click", () => {
  on = !on;
  if (on) st.play();
  else st.pause();
  play.textContent = on ? "❚❚ pause" : "▶ play";
});
const stopPlay = (): void => {
  on = false;
  play.textContent = "▶ play";
};
for (const el of [need("#next"), need("#prev")]) el.addEventListener("click", stopPlay);

// The explorer sections further down the page: drawn from the skill's own markdown (explorer.ts).
try {
  await startExplorer();
} catch (e) {
  console.error("r2-app-stack explorer failed", e);
  for (const el of document.querySelectorAll(".x"))
    el.innerHTML = `<div class="x-problems" role="alert"><b>The explorer failed to start.</b> ${e instanceof Error ? e.message : String(e)}</div>`;
}
