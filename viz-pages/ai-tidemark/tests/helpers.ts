// Shared by the tidemark's tests. The page and browser come from `viz.open()`; this adds the one thing every
// test needs: a FAKE for the page's only backend route, /data, so no test ever reads the recorder's real files.
//
//   const page = await open(twoSources());            // a good answer
//   const page = await open("error");                 // the backend is broken → the page falls back to demo data
//   page.api.calls                                    // how many times the page asked
//
// The data is typed from contract.ts, so a change to the contract breaks the fixtures at compile time.
//
// The page's one outside dependency is d3, imported from esm.sh. A test must not touch the network, so that request
// is answered with the REAL d3 (bundled from the viz skill's own copy) and every other cross-origin request is refused.
import type { Page } from "puppeteer-core";
import type { Data, Routes, Sample, Source } from "../contract.ts";

declare global {
  var viz: {
    open(
      hash?: string | object,
      o?: { width?: number; height?: number; before?: (p: Page) => unknown },
    ): Promise<Page & { errors: string[] }>;
  };
}

const BASE = new URL(process.env.VIZ_URL!.replace(/#.*$/u, ""));
const SKILL = "/Users/jmilliken/Desktop/Desktop/Code/ai-setup/skills/viz";
let d3Bundle: Promise<string> | undefined;
const bundleD3 = async (): Promise<string> => {
  const built = await Bun.build({
    entrypoints: [Bun.resolveSync("d3", SKILL)],
    format: "esm",
    target: "browser",
  });
  const text = await built.outputs[0]!.text();
  return text;
};
const realD3 = async (): Promise<string> => {
  const js = await (d3Bundle ??= bundleD3());
  return js;
};

export const H = 3600e3;
/** "Now" in every fixture: the page reads the clock from the data (`now`), never from the browser. */
export const NOW = 1_790_000_400_000;

/** What /data can do: answer with data, refuse with a status, never answer, or drop the connection. */
export type Answer = Routes["/data"]["reply"] | { status: number; body: string } | "hang" | "abort";
export type TidePage = Page & { errors: string[]; api: { calls: string[]; strays: string[] } };

/** One reading, in hours relative to NOW. */
const sample = (t: number, w: number, v: number, r: number, q: Sample["q"] = "exact"): Sample => ({
  t: NOW + t * H,
  w,
  v,
  r: NOW + r * H,
  q,
});
const WK = 10080,
  FIVE = 300;

/**
 * Claude Code, worked out by hand (the tests' expected values come from this, not from the page):
 *  - last week closed at 60% (r = -84h); this week is half gone (resets +84h) and stands at 30%.
 *  - this week climbed 0 → 10 → 20 → 24 → 30, so 30 points in the last 7 days, and at that rate
 *    projects to 30 + 30 × ½ = 45%. (Last week's 40 → 60 happened more than 7 days ago: not counted.)
 *  - two 5-hour windows: A peaked at 50% (a lagged statusline reading of 50 beats the exact 40) and the week
 *    rose 10 during it; B peaked at 20% and the week rose 4. Slope = (50·10 + 20·4) / (50² + 20²) = 0.2.
 *  - a third window C (peak 10%) began before any weekly reading of its own, so it has no weekly burn and is left out of the slope.
 *  - tier Max 20x, so window A (50 > 25) would have hit the Max 5x limit; B (20) and C (10) would not.
 */
export const claude = (over: { now?: number } = {}): Source => ({
  id: "claude",
  label: "Claude Code",
  tier: { name: "Max 20x", down: "Max 5x", line: 25 },
  samples: [
    sample(-200, WK, 40, -84),
    sample(-180, WK, 60, -84),
    sample(-80, WK, 0, 84),
    sample(-64, FIVE, 25, -60),
    sample(-62, FIVE, 50, -60, "lagged"),
    sample(-61, FIVE, 40, -60),
    sample(-60, WK, 10, 84),
    sample(-30, WK, 20, 84),
    sample(-42, FIVE, 10, -40),
    sample(-24, FIVE, 10, -20),
    sample(-22, WK, 24, 84),
    sample(-21, FIVE, 20, -20),
    sample(0, WK, over.now ?? 30, 84),
  ],
});

/** Codex: this week at 8% (0 → 5 → 8), one real 5-hour window peaking at 5%, and one that only ever read 0%. */
export const codex = (): Source => ({
  id: "codex",
  label: "Codex",
  plan: "plus",
  tier: null,
  samples: [
    sample(-80, WK, 0, 84),
    sample(-44, FIVE, 0, -40),
    sample(-41, FIVE, 0, -40),
    sample(-12, FIVE, 3, -8),
    sample(-10, WK, 5, 84),
    sample(-9, FIVE, 5, -8),
    sample(0, WK, 8, 84),
  ],
});

export const twoSources = (o: { errors?: string; claudeNow?: number } = {}): Data => ({
  now: NOW,
  demo: false,
  sources: [claude(o.claudeNow === undefined ? {} : { now: o.claudeNow }), codex()],
  errors: o.errors ?? "",
});

/** Opens the page with the fake in front of /data. `answer` may be a function of the call number (1st, 2nd…). */
export async function open(
  answer: Answer | ((call: number) => Answer),
  o: { hash?: string | object } = {},
): Promise<TidePage> {
  const api = { calls: [] as string[], strays: [] as string[] };
  const js = await realD3();
  const page = await viz.open(o.hash, {
    before: async (p) => {
      await p.setRequestInterception(true);
      p.on("request", (req) => {
        if (req.isInterceptResolutionHandled()) return;
        const settle = (done: Promise<void>) => {
          done.catch((e: unknown) => {
            console.error(e);
          });
        };
        const u = new URL(req.url());
        if (u.hostname === "esm.sh" && u.pathname.startsWith("/d3@7")) {
          settle(
            req.respond({
              status: 200,
              contentType: "text/javascript",
              headers: { "access-control-allow-origin": "*" },
              body: js,
            }),
          );
          return;
        }
        if (u.origin !== BASE.origin) {
          settle(req.abort("blockedbyclient"));
          return;
        }
        const path = u.pathname;
        const route = path.match(/\/api\/(.*)$/u)?.[1];
        if (route === undefined) {
          settle(req.continue());
          return;
        }
        if (route !== "data") {
          api.strays.push(route);
          // oxlint-disable-next-line no-void -- deliberately unhandled: the rejection is what fails the run on a stray API call
          void Promise.reject(new Error(`STRAY API CALL: ${route} has no stand-in`));
          settle(req.respond({ status: 501, contentType: "text/plain", body: "no stand-in" }));
          return;
        }
        api.calls.push(route);
        const a = typeof answer === "function" ? answer(api.calls.length) : answer;
        if (a === "hang") return;
        if (a === "abort") {
          settle(req.abort("failed"));
          return;
        }
        if ("status" in a) {
          settle(req.respond({ status: a.status, contentType: "text/plain", body: a.body }));
          return;
        }
        settle(
          req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(a) }),
        );
      });
    },
  });
  return Object.assign(page, { api });
}

/** The page has drawn something: KPI tiles, or the empty-state message. */
export const ready = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => document.querySelector("#kpis")!.children.length > 0, {
    timeout: 15_000,
  });
};

/** The text of one KPI tile's number and detail line. */
export const tile = async (
  page: Page,
  source: string,
  label: string,
): Promise<{ n: string | null; d: string | null; cls: string }> => {
  const out = await page.$eval(`[data-viz-id="kpi-${source}-${label}"]`, (e) => ({
    n: e.querySelector(".n")!.textContent,
    d: e.querySelector(".d")!.textContent,
    cls: e.querySelector(".n")!.className,
  }));
  return out;
};

export const texts = async (page: Page, sel: string): Promise<string[]> => {
  const out = await page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
  return out;
};

export interface Hash {
  heat?: unknown;
  zoom?: unknown;
  sel?: unknown;
  hide?: unknown;
}
/** The page's own state, as the URL hash keeps it: only the fields the tests read, each checked where it is read. */
export const hash = async (page: Page): Promise<Hash> => {
  const raw = await page.evaluate(() => decodeURIComponent(location.hash.slice(1)) || "{}");
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
};
