// Steps the Library tests share: reaching a row's drawer, reading what it says, and stand-ins for
// the drawer's writes that change the synthetic library the way the viz CLI would.
import type { Page } from "puppeteer-core";
import { HOME, CENTRAL, ATLAS, HARBOR, type Stub } from "./helpers.ts";

// open() (which hides the dev server's feedback pill) and the page-owned clipboard live in helpers.ts.
export { open, ownClipboard, copied } from "./helpers.ts";

declare global {
  interface Window {
    tabs: { location: unknown; closed: boolean; close(): void }[];
  }
}

/** A real new tab is a page open() never intercepted, so pointing it at a viz would reach the real
 *  server. The page gets recording stand-ins instead: `tabs(page)` is [where each went, closed?].
 *  `blockAfter: n` lets n tabs open and answers null after, as a popup blocker does. */
export const ownTabs = async (
  page: Page,
  { blockAfter = Infinity }: { blockAfter?: number } = {},
): Promise<void> => {
  await page.evaluate((limit) => {
    window.tabs = [];
    // defineProperty, not assignment: the stand-in tab is not a Window, so window.open's type would refuse it.
    Object.defineProperty(window, "open", {
      value: () => {
        if (window.tabs.length >= limit) return null;
        const t = {
          location: "",
          closed: false,
          close() {
            this.closed = true;
          },
        };
        window.tabs.push(t);
        return t;
      },
    });
  }, blockAfter);
};
export const tabs = async (page: Page): Promise<[string, boolean][]> => {
  const all = await page.evaluate(() =>
    window.tabs.map((t): [string, boolean] => [String(t.location), t.closed]),
  );
  return all;
};

/** A viz's id (its path under $HOME), as api/slugs names it. */
export const idOf = (container: string, name: string): string =>
  container.slice(HOME.length + 1) + "/" + name;
export const ID = {
  tide: idOf(CENTRAL, "tide-clock"),
  orbit: idOf(CENTRAL, "orbit-deck"),
  river: idOf(CENTRAL, "river-poster"),
  garden: idOf(CENTRAL, "garden-planner"),
  loose: idOf(CENTRAL, "loose-sketch"),
  starter: idOf(CENTRAL, "poster-starter"),
  globe: idOf(CENTRAL, "big-globe"),
  secret: idOf(CENTRAL, "secret-notes"),
  metrics: idOf(ATLAS, "atlas-metrics"),
  exchange: idOf(ATLAS, "atlas-exchange"),
  dive: idOf(ATLAS, "atlas-dive"),
  harborMap: idOf(HARBOR, "harbor-map"),
  timeline: idOf(HARBOR, "harbor-timeline"),
  gardenCopy: idOf(HARBOR, "garden-planner"),
};

export const row = (id: string): string => `.slug[data-id="${id}"]`;
export const drawer = (id: string): string => `.slug-drawer[data-id="${id}"]`;
export const act = (id: string, a: string, extra = ""): string =>
  `${drawer(id)} [data-act="${a}"]${extra}`;

/** Opens a row's management drawer with its ⋯ button. */
export async function openDrawer(page: Page, id: string): Promise<void> {
  await click(page, `${row(id)} [data-act="toggle"]`);
  await page.waitForSelector(drawer(id));
}

/** The drawer's status line: its text and whether it reads ok / err. */
export const status = async (
  page: Page,
  id: string,
): Promise<{ text: string | null; ok: boolean; err: boolean }> => {
  const s = await page.$eval(`${drawer(id)} .drawer-status`, (e) => ({
    text: e.textContent,
    ok: e.classList.contains("ok"),
    err: e.classList.contains("err"),
  }));
  return s;
};

/** Waits until the drawer's status line reads `text`. */
export async function statusIs(
  page: Page,
  id: string,
  text: string,
  timeout = 5000,
): Promise<void> {
  try {
    await page.waitForFunction(
      (sel, t) => document.querySelector(sel)?.textContent === t,
      { timeout },
      `${drawer(id)} .drawer-status`,
      text,
    );
  } catch (e: unknown) {
    const reads = JSON.stringify(
      await page
        .$eval(`${drawer(id)} .drawer-status`, (x) => x.textContent)
        .catch(() => "(no drawer)"),
    );
    throw new Error(
      `status never read "${text}"; it reads ${reads}: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}

/** Sets an input's value as a user would: select what is there, type over it. */
export async function typeInto(page: Page, sel: string, text: string): Promise<void> {
  await page.click(sel, { count: 3 });
  await page.keyboard.press("Backspace");
  if (text) await page.type(sel, text);
}

/** A call's body as the CLI receives it: every value a string. */
const asStrings = (body: unknown): Record<string, string> =>
  typeof body === "object" && body !== null
    ? Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]))
    : {};

/** api/update as the CLI does it: applies each axis in the body to the viz, answers its stdout. */
export const update: Stub = ({ body }, lib) => {
  const fields = asStrings(body);
  const s = lib.slugs.find((x) => x.id === fields.id);
  if (!s) throw new Error(`update: no viz ${fields.id}`);
  const said: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id") continue;
    if (k === "posture") s.posture = v;
    else if (k === "listed") s.listed = v === "listed";
    else if (k === "approved") s.approval = v === "true" ? "approved" : "never";
    else if (k === "card-public") s.cardPublic = v === "true" ? "public" : "not-public";
    else if (k === "title") s.title = v;
    else if (k === "description") s.description = v;
    else if (k === "tags") s.tags = v ? v.split(", ") : [];
    else if (k === "linked-from") s.linkedFrom = [...s.linkedFrom, v];
    else if (k === "unlinked-from") s.linkedFrom = s.linkedFrom.filter((l) => l !== v);
    said.push(`${s.name}: ${k} → ${v}`);
  }
  return { ok: true, out: said.join("\n"), err: "" };
};

/** Removes a viz from the library, as `viz delete` / `viz move` would take it from its old id. */
export const drop = (lib: { slugs: { id: string }[] }, id: string): void => {
  lib.slugs = lib.slugs.filter((s) => s.id !== id);
};

/** The ids of the visible rows, top to bottom. */
export const rowIds = async (page: Page): Promise<string[]> => {
  const ids = await page.$$eval("#slugs .slug", (els) =>
    els.map((e) => (e instanceof HTMLElement ? (e.dataset["id"] ?? "") : "")),
  );
  return ids;
};

export const text = async (page: Page, sel: string): Promise<string> => {
  const t = await page.$eval(sel, (e) => e.textContent.replaceAll(/\s+/gu, " ").trim());
  return t;
};

/** A real click, retried once if the 5s refresh rebuilt the element between finding and clicking it
 *  (the click never landed then, so a retry can't click twice). */
export async function click(
  page: Page,
  sel: string,
  o?: Parameters<Page["click"]>[1],
): Promise<void> {
  try {
    await page.click(sel, o);
  } catch (e: unknown) {
    if (
      !(
        e instanceof Error &&
        /detached|does not belong|not clickable|context was destroyed/iu.test(e.message)
      )
    )
      throw e;
    await page.click(sel, o);
  }
}

/** api/move as the CLI does it: a rename (name) or a move (toContainer) gives the viz a new id. */
export const move: Stub = ({ body }, lib) => {
  const fields = asStrings(body);
  const s = lib.slugs.find((x) => x.id === fields.id);
  if (!s) throw new Error(`move: no viz ${fields.id}`);
  if (fields.name) s.name = fields.name;
  if (fields.toContainer)
    Object.assign(s, {
      container: fields.toContainer,
      isCentral: fields.toContainer === CENTRAL,
      host: fields.toContainer.slice(HOME.length + 1).replace(/\/viz-pages$/u, ""),
    });
  s.id = idOf(s.container, s.name);
  return { ok: true, out: `moved → ${s.id}`, err: "" };
};

/** Waits until a selector's text (whitespace collapsed) reads `want`. */
export async function textIs(page: Page, sel: string, want: string, timeout = 5000): Promise<void> {
  try {
    await page.waitForFunction(
      (s, w) => document.querySelector(s)?.textContent?.replaceAll(/\s+/gu, " ").trim() === w,
      { timeout },
      sel,
      want,
    );
  } catch (e: unknown) {
    throw new Error(
      `${sel} never read "${want}"; it reads "${await text(page, sel).catch(() => "(absent)")}"`,
      { cause: e },
    );
  }
}
