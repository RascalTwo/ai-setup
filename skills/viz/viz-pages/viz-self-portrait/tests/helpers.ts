// Shared by the self-portrait's tests. The browser and the page come from `viz.open()` (the viz
// skill's test preload); this adds the one thing every test here needs: a STAND-IN for the page's
// own api/, so no test can ever reach the real library.
//
// THE SAFETY RULE. The page's api/ writes to the user's real viz library (update, move, delete,
// mirror, vendor, render, rollback, create, rotate, preview, POST ranking…). So open() intercepts
// every request before the page loads:
//   - a read route (GET slugs, slugs-git, log, server-info, mirrors, vendors, history, ranking)
//     is answered from a synthetic Library (fixtures/library.ts);
//   - anything else under api/, _log/, _files/ or _status is answered ONLY by a stub the test
//     installs explicitly — `stubs: { "POST update": ok() }` — and every call is recorded;
//   - one with no stand-in is a STRAY: the page gets a 501, and the test run fails loudly. Nothing
//     is ever passed through to the server.
//
//   const page = await open({ hash: "dashboard", lib: (l) => { l.slugs = l.slugs.slice(0, 3); },
//                             stubs: { "POST update": ok("posture → private") } });
//   await dashboardReady(page);
//   calls(page, "POST update")   // → [{ method, route, query, body }]

import type { JSHandle, Page } from "puppeteer-core";
import { library, rankingView, type Library } from "./fixtures/library.ts";
export * from "./fixtures/library.ts";

/** A write's JSON body as the page sends it. The fields the tests read are named; `{}` when the call had no JSON body. */
export interface ApiBody {
  id?: string;
  name?: string;
  list?: string;
  action?: string;
  slug?: string;
  container?: string;
  toContainer?: string;
  sub?: string;
  to?: string;
  access?: string;
  listed?: string;
  title?: string;
  tags?: string;
  log?: [string, number][];
  benched?: string[];
  priority?: string[];
  [field: string]: unknown;
}
const isBody = (v: unknown): v is ApiBody =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isReply = (o: unknown): o is Reply => typeof o === "object" && o !== null && REPLY in o;
export type ApiCall = {
  method: string;
  route: string;
  query: Record<string, string>;
  body: ApiBody;
};
const REPLY = Symbol("reply");
type Reply = { [REPLY]: true; status: number; json?: unknown; text?: string; abort?: boolean };
/** A stub answers a call; return plain JSON (→ 200) or `reply(status, json)`. It may change `lib`. */
export type Stub = (call: ApiCall, lib: Library) => unknown;
export type SPPage = Page & {
  errors: string[];
  api: { lib: Library; calls: ApiCall[]; strays: string[] };
};

export const reply = (status: number, json: unknown): Reply => ({ [REPLY]: true, status, json });
/** A plain-text answer, as api.ts gives on a thrown handler ("api error: …" with a 500). */
export const text = (status: number, body: string): Reply => ({
  [REPLY]: true,
  status,
  text: body,
});
/** No answer at all: the request fails at the network level, as with the server down mid-request. */
export const netError = (): Reply => ({ [REPLY]: true, status: 0, abort: true });
/** The shape every api/ write answers on success: the CLI's stdout. */
export const ok =
  (out = ""): Stub =>
  () => ({ ok: true, out, err: "" });
/** …and on a refusal: the CLI's stderr, with a 400. */
export const fail =
  (err: string, status = 400): Stub =>
  () =>
    reply(status, { ok: false, out: "", err });

// The reads, answered from the library. Keyed "METHOD route" like the stubs.
const READS: Record<string, Stub> = {
  "GET slugs": (_, l) => l.slugs,
  "GET slugs-git": (_, l) => l.git,
  "GET log": (_, l) => l.log,
  "GET server-info": (_, l) => l.server,
  "GET mirrors": (c, l) => l.mirrors[c.query["id"] ?? ""] ?? [],
  "GET vendors": (c, l) => l.vendors[c.query["id"] ?? ""] ?? [],
  "GET history": (c, l) => {
    const commits = l.history[c.query["id"] ?? ""];
    return commits ? { ok: true, commits } : reply(404, { ok: false, err: "unknown viz id" });
  },
  "GET ranking": (_, l) => rankingView(l),
  // The kit's feedback widget (injected by the server) reads this page's own feedback log.
  "GET _log/feedback": () => [],
  // The server's own routes. /_rescan is a deep scan of $HOME: not a library write, but still
  // never the real one — answered here like a read.
  "GET /_rescan": (_, l) => ({ containers: l.server.containers, slugs: l.slugs.length }),
};

type Ranking = Library["ranking"];

const newList = (b: ApiBody, r: Ranking): unknown => {
  const name = (b.name ?? "").trim();
  if (!name) return reply(400, { ok: false, err: "a dimension needs a name" });
  const id =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, "") || "list";
  if (r.lists[id]) return reply(409, { ok: false, err: `"${name}" already exists` });
  r.lists[id] = { name, log: [], benched: [], priority: [] };
  r.current = id;
  return { ok: true, current: id };
};

const renameList = (b: ApiBody, r: Ranking, list: string): unknown => {
  const name = (b.name ?? "").trim();
  if (
    Object.entries(r.lists).some(
      ([id, x]) => id !== list && x.name.toLowerCase() === name.toLowerCase(),
    )
  )
    return reply(409, { ok: false, err: `"${name}" is already taken` });
  r.lists[list]!.name = name;
  return { ok: true, list: b.list, name };
};

const deleteList = (b: ApiBody, r: Ranking, list: string): unknown => {
  if (Object.keys(r.lists).length === 1)
    return reply(409, {
      ok: false,
      err: "that is the only dimension — rename it or add another first",
    });
  const answered = r.lists[list]!.log.length;
  Reflect.deleteProperty(r.lists, list);
  if (r.current === b.list) r.current = Object.keys(r.lists)[0]!;
  return { ok: true, deleted: b.list, answered, current: r.current };
};

/** A working stand-in for POST api/ranking, honouring api.ts's contract against `lib.ranking`.
 *  Opt in like any write: `stubs: { "POST ranking": fakes.ranking }`. */
export const fakes = {
  ranking: ({ body: b }, l) => {
    const r = l.ranking;
    if (b.action === "new") return newList(b, r);
    const list = b.list ?? "";
    if (b.action && !r.lists[list])
      return reply(404, { ok: false, err: `no dimension "${b.list}"` });
    if (b.action === "rename") return renameList(b, r, list);
    if (b.action === "delete") return deleteList(b, r, list);
    if (b.action === "select") {
      r.current = list;
      return { ok: true, current: r.current };
    }
    const id = b.list ?? r.current;
    if (!r.lists[id]) return reply(404, { ok: false, err: `no dimension "${id}"` });
    const log = b.log ?? [];
    r.lists[id] = { ...r.lists[id], log, benched: b.benched ?? [], priority: b.priority ?? [] };
    return { ok: true, list: id, answered: log.length };
  },
} satisfies Record<string, Stub>;

/** Motion off, so scrolls land at once: open({ before: reducedMotion }). */
export const reducedMotion = async (p: Page): Promise<void> => {
  await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
};

/** What a stray does by default: fail the run. A rejection nobody handles fails `bun test` (exit 1),
 *  so it fails verify even when no assertion of the test's own notices the 501. */
export const strayFails = (msg: string): void => {
  // oxlint-disable-next-line no-void -- the rejection is deliberately left unhandled so it fails the running test
  void Promise.reject(new Error(msg));
};

const BASE = new URL(process.env.VIZ_URL!.replace(/#.*$/u, ""));
const basePath = BASE.pathname.endsWith("/") ? BASE.pathname : BASE.pathname + "/";

/** How a request is handled: the viz's own files and the kit pass through; nothing else does. */
function classify(
  u: URL,
): { kind: "pass" } | { kind: "api"; key: string; route: string } | { kind: "absent" } {
  if (u.origin !== BASE.origin) return { kind: "pass" };
  const p = decodeURIComponent(u.pathname);
  if (p === "/_rescan" || p === "/_refresh" || p === "/_health")
    return { kind: "api", key: p, route: p };
  if (p.startsWith("/_kit/")) return { kind: "pass" };
  if (p.startsWith(basePath)) {
    const rest = p.slice(basePath.length);
    const m = rest.match(/^api(?:\/(.*))?$/u);
    if (m) return { kind: "api", key: m[1] ?? "", route: m[1] ?? "" };
    if (/^(_log|_files|_status)(\/|$)/u.test(rest)) return { kind: "api", key: rest, route: rest };
    return { kind: "pass" };
  }
  // Another viz's api (e.g. a page the test world only pretends exists) is still the real server.
  if (/\/(api|_log|_files|_status)(\/|$)/u.test(p)) return { kind: "api", key: p, route: p };
  // A fixture viz's own files (a thumbnail, a hero): they don't exist anywhere — say so locally.
  return { kind: "absent" };
}

export interface OpenOptions {
  hash?: string;
  /** Change the default library before the page loads. */
  lib?: (l: Library) => void;
  /** Answers for writes (and overrides for reads), keyed "POST update", "GET slugs", "POST _log/feedback"… */
  stubs?: Record<string, Stub>;
  /** false: /_health answers 503, as when the server is down. */
  live?: boolean;
  /** Called with each stray's description instead of failing the run — only the guard's own test uses it. */
  onStray?: (msg: string) => void;
  // Explicit `undefined` is allowed, as on the skill's own OpenOptions (a test may pass `before: maybeFn`).
  width?: number | undefined;
  height?: number | undefined;
  /**
   * true: the two-step confirm disarms after its real 2.5 s, for the tests of that disarm. Otherwise
   * the window is stretched, so a slow machine between a test's two clicks cannot disarm the first.
   */
  realDisarm?: boolean;
  /** Runs before the page loads, after the stand-in is installed (e.g. emulate reduced motion). */
  before?: ((p: Page) => unknown) | undefined;
}

/** The self-portrait, with the stand-in api/ in front of it. */
export async function open({
  hash,
  lib: edit,
  stubs = {},
  live = true,
  onStray = strayFails,
  width,
  height,
  realDisarm = false,
  before,
}: OpenOptions = {}): Promise<SPPage> {
  const lib = library();
  edit?.(lib);
  const api = { lib, calls: [] as ApiCall[], strays: [] as string[] };
  const opener =
    new Error().stack
      ?.split("\n")
      .find((l) => l.includes(".test.ts"))
      ?.trim() ?? "?";

  const page = await viz.open(hash, {
    width,
    height,
    before: async (p) => {
      // The dev server's feedback pill sits fixed over the bottom-right corner: a real click on a button
      // scrolled under it lands on the pill's Send (an unstubbed _log write). It's the server's overlay.
      await p.evaluateOnNewDocument(() =>
        addEventListener("DOMContentLoaded", () =>
          document.head.append(
            Object.assign(document.createElement("style"), {
              textContent: "#viz-feedback { display: none !important; }",
            }),
          ),
        ),
      );
      if (!realDisarm)
        await p.evaluateOnNewDocument(() => {
          // The page's only 2500 ms timers are the confirm buttons' disarm windows.
          const real = window.setTimeout.bind(window);
          Reflect.set(window, "setTimeout", (fn: TimerHandler, ms?: number, ...args: unknown[]) =>
            real(fn, ms === 2500 ? 600_000 : ms, ...args),
          );
        });
      await p.setRequestInterception(true);
      // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return -- puppeteer drops the handler's promise; a rejection inside must still surface as unhandled and fail the run
      p.on("request", async (req) => {
        if (req.isInterceptResolutionHandled()) return;
        const u = new URL(req.url());
        const c = classify(u);
        if (c.kind === "pass") return req.continue();
        if (c.kind === "absent")
          return req.respond({
            status: 404,
            contentType: "text/plain",
            body: "not in the test library",
          });
        if (c.key === "/_health")
          return req.respond({
            status: live ? 200 : 503,
            contentType: "text/plain",
            body: live ? "OK" : "down",
          });

        // oxlint-disable-next-line typescript/no-deprecated -- fetchPostData() asks Chrome again and swallows its errors (an unreadable body would pass as empty); the interceptor reads the body it was handed
        const raw = req.postData();
        let sent: unknown = raw ?? null;
        try {
          if (raw) sent = JSON.parse(raw);
        } catch {
          /* not JSON: the stray message shows the raw text */
        }
        const body = isBody(sent) ? sent : {};
        const call: ApiCall = {
          method: req.method(),
          route: c.route,
          query: Object.fromEntries(u.searchParams),
          body,
        };
        const key = `${call.method} ${c.key}`;
        api.calls.push(call);
        const stub = stubs[key] ?? READS[key];
        if (!stub) {
          const msg =
            `STRAY API CALL: ${key}${sent ? " " + JSON.stringify(sent) : ""} has no stand-in — ` +
            `install one with open({ stubs: { "${key}": … } }). Page opened at ${opener}`;
          api.strays.push(key);
          await req.respond({ status: 501, contentType: "text/plain", body: msg });
          return onStray(msg);
        }
        const out = await stub(call, lib);
        const r: Reply = isReply(out) ? out : { [REPLY]: true, status: 200, json: out };
        if (r.abort) return req.abort("failed");
        return r.text !== undefined
          ? req.respond({ status: r.status, contentType: "text/plain", body: r.text })
          : req.respond({
              status: r.status,
              contentType: "application/json",
              body: JSON.stringify(r.json ?? null),
            });
      });
      await before?.(p);
    },
  });
  return Object.assign(page, { api });
}

// ---- reading what happened ----------------------------------------------------------------------

/** Every recorded call to one route, e.g. calls(page, "POST update"). */
export const calls = (page: SPPage, key: string): ApiCall[] =>
  page.api.calls.filter((c) => `${c.method} ${c.route}` === key);

/** Waits for the n-th call to a route and returns it. */
export async function nthCall(
  page: SPPage,
  key: string,
  n = 1,
  timeout = 10_000,
): Promise<ApiCall> {
  const t0 = Date.now();
  while (calls(page, key).length < n) {
    if (Date.now() - t0 > timeout)
      throw new Error(
        `expected ${n} call(s) to ${key}, saw ${calls(page, key).length}; all calls: ${page.api.calls.map((c) => c.method + " " + c.route).join(", ")}`,
      );
    // oxlint-disable-next-line no-await-in-loop -- polling: each check must wait for the one before it
    await Bun.sleep(25);
  }
  return calls(page, key)[n - 1]!;
}

// ---- waiting on the page ------------------------------------------------------------------------

/** The tab whose panel is showing. */
export const activeTab = async (page: Page): Promise<string> => {
  const id = await page.$eval(".tab-panel.active", (e) => e.id.replace(/^tab-/u, ""));
  return id;
};

/** The Library dashboard has drawn its rows, its stat band, its commits AND the slow git feed. */
export const dashboardReady = async (page: Page): Promise<JSHandle<boolean>> => {
  const ready = await page.waitForFunction(
    () =>
      !!document.querySelector("#slug-totals .stat-band") &&
      document.querySelector("#slugs")!.textContent !== "loading…" &&
      document.querySelector("#commits")!.textContent !== "loading…" &&
      document.querySelector("#git-status")!.textContent === "",
    { timeout: 15_000 },
  );
  return ready;
};

/** The visible rows' titles, top to bottom. */
export const rowTitles = async (page: Page): Promise<string[]> => {
  const titles = await page.$$eval("#slugs .slug .slug-name", (els) =>
    els.map((e) => e.textContent.replace(/^central/u, "").trim()),
  );
  return titles;
};

/** The Rank tab has its corpus and is asking about a pair. */
export const rankReady = async (page: Page): Promise<JSHandle<boolean>> => {
  const ready = await page.waitForFunction(
    () =>
      !document.querySelector<HTMLElement>("#rank-main")!.hidden &&
      !!document.querySelector("#rk-a .rk-t") &&
      !!document.querySelector("#rk-b .rk-t"),
    { timeout: 15_000 },
  );
  return ready;
};

/** The two cards Rank is asking about: [left, right] titles. */
export const rankPair = async (page: Page): Promise<(string | null)[]> => {
  const pair = await page.evaluate(() => [
    document.querySelector("#rk-a .rk-t")!.textContent,
    document.querySelector("#rk-b .rk-t")!.textContent,
  ]);
  return pair;
};

/** The guide has built its bands, its rail and every figure. */
export const guideReady = async (page: Page): Promise<JSHandle<boolean>> => {
  const ready = await page.waitForFunction(
    () =>
      document.querySelectorAll("#guide-bands .stop").length > 0 &&
      document.querySelectorAll("#guide-rail .rail-stop").length ===
        document.querySelectorAll("#guide-bands .stop").length,
    { timeout: 15_000 },
  );
  return ready;
};

declare global {
  interface Window {
    copied?: string[];
  }
}

/** The OS clipboard is one per machine, shared by every test page running at once, so a page gets
 *  its own: what it copied is `copied(page)`. `refuse` makes every copy fail, as a denied permission does. */
export const ownClipboard = async (page: Page, refuse = false): Promise<void> => {
  await page.evaluate((deny) => {
    const list = (window.copied ??= []);
    // oxlint-disable-next-line require-await -- writeText must return a promise (promise-function-async) yet has nothing to await
    navigator.clipboard.writeText = async (t: string): Promise<void> => {
      if (deny) throw new DOMException("denied", "NotAllowedError");
      list.push(t);
    };
  }, refuse);
};
export const copied = async (page: Page): Promise<string[]> => {
  const list = await page.evaluate(() => window.copied ?? []);
  return list;
};
