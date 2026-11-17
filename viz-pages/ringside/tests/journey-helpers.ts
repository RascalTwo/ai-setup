// Shared fixtures and page helpers for the journey tests: fake calls, the stubbed backend, and DOM pokes.
import type { HTTPRequest, Page } from "puppeteer-core";

export const ID = "11111111-2222-3333-4444-555555555555";
export const ID2 = "99999999-2222-3333-4444-555555555555";
export const SEC = 1000;

export const call = (
  id: string,
  lane: string,
  label: string,
  start: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  tool: lane === "run" ? "Bash" : "Read",
  lane,
  label,
  detail: `detail of ${label}`,
  start,
  end: null,
  error: false,
  file: null,
  plus: 0,
  minus: 0,
  agent: "main",
  needsLabel: false,
  summary: "",
  pos: 0,
  ...extra,
});
export const result = (id: string, end: number, error = false, preview = "ok"): object => ({
  id,
  end,
  error,
  preview,
});
export const chunk = (parts: Record<string, unknown>, offset = 10): object => ({
  calls: [],
  results: [],
  prompts: [],
  says: [],
  subs: {},
  agents: [],
  more: false,
  ...parts,
  offset,
});
export const session = (id: string, now: number, title = "fix the pins"): object => ({
  id,
  project: "~/repo",
  mtime: now,
  size: 10,
  title,
});

export interface Spec {
  sessions?: object[];
  /** What /api/events answers for a given `from` offset and `subs` cursor. */
  events?: (from: number, subs: string) => object;
  /** What later polls (the cursor is past the first reply) answer, by poll number from 1. Default: nothing new. */
  later?: (poll: number) => object;
  /** While true, /api/events answers 500. Tests may flip it. */
  down?: boolean;
  /** What /api/label answers for a call id. */
  label?: (id: string) => { status?: number; label: string | null };
  /** How long the two model routes take to answer, in ms (default 250). */
  delay?: number;
  /** What /api/outcome answers for a call id. */
  outcome?: (id: string) => { status?: number; outcome: string | null };
  /** What /api/story answers. Default: no story. */
  story?: () => { status?: number; story: string | null };
  /** What /api/lane answers for a call id. Default: no lane. */
  lane?: (id: string) => { lane: string | null };
  /** What /api/beat answers for a strip's raw request body. Default: no line. */
  beat?: (posted: string) => { status?: number; beat: string | null };
}

export interface Seen {
  /** The `subs` cursor of every /api/events request. */
  subs: string[];
  /** The call id of every /api/label request. */
  labelled: string[];
  /** The most /api/label requests that were ever in flight at once. */
  peak: number;
  /** The call id of every /api/outcome request, and the most in flight at once. */
  outcomes: string[];
  outcomePeak: number;
  /** The raw body of every /api/outcome request. */
  outcomeBodies: string[];
  /** The raw body of every /api/beat request. */
  beats: string[];
  /** The raw body of every /api/story request. */
  stories: string[];
}

/** Fakes the backend: sessions, events, and the two model routes (each answered after 250ms). */
export function stage(spec: Spec): { before: (page: Page) => Promise<void>; seen: Seen } {
  const seen: Seen = {
    subs: [],
    labelled: [],
    peak: 0,
    outcomes: [],
    outcomePeak: 0,
    outcomeBodies: [],
    beats: [],
    stories: [],
  };
  const flight = { label: 0, outcome: 0 };
  const respond = (req: HTTPRequest, body: unknown, status = 200): void => {
    req
      .respond({ status, contentType: "application/json", body: JSON.stringify(body) })
      .catch(console.error);
  };
  let polls = 0;
  // A real backend never repeats itself, so once the cursor is past the first reply, answer "nothing new".
  const eventsFor = (from: number, subs: string): object => {
    if (from < 10) return spec.events ? spec.events(from, subs) : chunk({});
    polls++;
    return spec.later ? spec.later(polls) : chunk({}, from);
  };
  const modelRoute = (req: HTTPRequest, kind: "label" | "outcome"): void => {
    req
      .fetchPostData()
      .then((posted) => {
        const id = /"id":"(\w+)"/u.exec(posted ?? "")?.[1] ?? "";
        (kind === "label" ? seen.labelled : seen.outcomes).push(id);
        if (kind === "outcome") seen.outcomeBodies.push(posted ?? "");
        flight[kind]++;
        if (kind === "label") seen.peak = Math.max(seen.peak, flight.label);
        else seen.outcomePeak = Math.max(seen.outcomePeak, flight.outcome);
        setTimeout(() => {
          flight[kind]--;
          if (kind === "label") {
            const a = spec.label?.(id) ?? { label: null };
            respond(req, { label: a.label }, a.status ?? 200);
          } else {
            const a = spec.outcome?.(id) ?? { outcome: null };
            respond(req, { outcome: a.outcome }, a.status ?? 200);
          }
        }, spec.delay ?? 250);
      })
      .catch(console.error);
  };
  const before = async (page: Page): Promise<void> => {
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
      const url = req.url();
      if (url.includes("/api/sessions")) respond(req, { sessions: spec.sessions ?? [] });
      else if (url.includes("/api/label")) modelRoute(req, "label");
      else if (url.includes("/api/outcome")) modelRoute(req, "outcome");
      else if (url.includes("/api/story"))
        req
          .fetchPostData()
          .then((posted = "") => {
            seen.stories.push(posted);
            const a = spec.story?.() ?? { story: null };
            setTimeout(() => {
              respond(req, { story: a.story }, a.status ?? 200);
            }, spec.delay ?? 250);
          })
          .catch(console.error);
      else if (url.includes("/api/lane"))
        req
          .fetchPostData()
          .then((posted = "") => {
            const id = /"id":"(\w+)"/u.exec(posted)?.[1] ?? "";
            setTimeout(() => {
              respond(req, spec.lane?.(id) ?? { lane: null });
            }, spec.delay ?? 250);
          })
          .catch(console.error);
      else if (url.includes("/api/beat"))
        req
          .fetchPostData()
          .then((posted = "") => {
            seen.beats.push(posted);
            const a = spec.beat?.(posted) ?? { beat: null };
            setTimeout(() => {
              respond(req, { beat: a.beat }, a.status ?? 200);
            }, spec.delay ?? 250);
          })
          .catch(console.error);
      else if (url.includes("/api/events")) {
        const q = new URL(url).searchParams;
        const subs = q.get("subs") ?? "";
        seen.subs.push(subs);
        if (spec.down) respond(req, { error: "down" }, 500);
        else respond(req, eventsFor(Number(q.get("from") ?? 0), subs));
      } else req.continue().catch(console.error);
    });
  };
  return { before, seen };
}

export const text = async (page: Page, sel: string): Promise<string> =>
  page.$eval(sel, (e) => e.textContent ?? "");
/** Clicks an SVG element in one step: the timeline redraws every half second, so a handle can go stale. */
/** Fires a mouse event on an element in one in-page step, so a redraw cannot detach it in between. */
export const fire = async (page: Page, sel: string, type: string): Promise<void> => {
  await page.evaluate(
    (s, ty) => {
      document.querySelector(s)?.dispatchEvent(new MouseEvent(ty, { bubbles: true }));
    },
    sel,
    type,
  );
};
export const tap = async (page: Page, sel: string): Promise<void> => {
  await fire(page, sel, "click");
};
export const pause = async (ms: number): Promise<void> => {
  await new Promise((done) => {
    setTimeout(done, ms);
  });
};

/** An element's computed justify-content, read in one in-page step (the conversation redraws on every poll). */
export const justify = async (page: Page, sel: string): Promise<string> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return e ? getComputedStyle(e).justifyContent : "missing";
  }, sel);
