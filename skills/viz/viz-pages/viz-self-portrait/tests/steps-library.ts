// Steps the Library tests share: reaching a row's drawer, reading what it says, and stand-ins for
// the drawer's writes that change the synthetic library the way the viz CLI would.
import type { Page } from "puppeteer-core";
import { HOME, CENTRAL, ATLAS, HARBOR, type Stub } from "./helpers.ts";

// open() (which hides the dev server's feedback pill) and the page-owned clipboard live in helpers.ts.
export { open, ownClipboard, copied } from "./helpers.ts";


/** A real new tab is a page open() never intercepted, so pointing it at a viz would reach the real
 *  server. The page gets recording stand-ins instead: `tabs(page)` is [where each went, closed?].
 *  `blockAfter: n` lets n tabs open and answers null after, as a popup blocker does. */
export const ownTabs = (page: Page, { blockAfter = Infinity } = {}) => page.evaluate((blockAfter) => {
  (window as any).tabs = [];
  window.open = () => {
    if ((window as any).tabs.length >= blockAfter) return null;
    const t = { location: "", closed: false, close() { this.closed = true; } };
    (window as any).tabs.push(t);
    return t as unknown as Window;
  };
}, blockAfter);
export const tabs = (page: Page) => page.evaluate(() => (window as any).tabs.map((t: { location: unknown; closed: boolean }) => [String(t.location), t.closed]) as [string, boolean][]);

/** A viz's id (its path under $HOME), as api/slugs names it. */
export const idOf = (container: string, name: string) => container.slice(HOME.length + 1) + "/" + name;
export const ID = {
  tide: idOf(CENTRAL, "tide-clock"), orbit: idOf(CENTRAL, "orbit-deck"), river: idOf(CENTRAL, "river-poster"),
  garden: idOf(CENTRAL, "garden-planner"), loose: idOf(CENTRAL, "loose-sketch"), starter: idOf(CENTRAL, "poster-starter"),
  globe: idOf(CENTRAL, "big-globe"), secret: idOf(CENTRAL, "secret-notes"),
  metrics: idOf(ATLAS, "atlas-metrics"), exchange: idOf(ATLAS, "atlas-exchange"), dive: idOf(ATLAS, "atlas-dive"),
  harborMap: idOf(HARBOR, "harbor-map"), timeline: idOf(HARBOR, "harbor-timeline"), gardenCopy: idOf(HARBOR, "garden-planner"),
};

export const row = (id: string) => `.slug[data-id="${id}"]`;
export const drawer = (id: string) => `.slug-drawer[data-id="${id}"]`;
export const act = (id: string, a: string, extra = "") => `${drawer(id)} [data-act="${a}"]${extra}`;

/** Opens a row's management drawer with its ⋯ button. */
export async function openDrawer(page: Page, id: string) {
  await click(page, `${row(id)} [data-act="toggle"]`);
  await page.waitForSelector(drawer(id));
}

/** The drawer's status line: its text and whether it reads ok / err. */
export const status = (page: Page, id: string) =>
  page.$eval(`${drawer(id)} .drawer-status`, (e) => ({ text: e.textContent, ok: e.classList.contains("ok"), err: e.classList.contains("err") }));

/** Waits until the drawer's status line reads `text`. */
export const statusIs = (page: Page, id: string, text: string, timeout = 5000) =>
  page.waitForFunction((sel, t) => document.querySelector(sel)?.textContent === t, { timeout }, `${drawer(id)} .drawer-status`, text)
    .catch(async (e) => { throw new Error(`status never read "${text}"; it reads ${JSON.stringify(await page.$eval(`${drawer(id)} .drawer-status`, (x) => x.textContent).catch(() => "(no drawer)"))}: ${e.message}`); });

/** Sets an input's value as a user would: select what is there, type over it. */
export async function typeInto(page: Page, sel: string, text: string) {
  await page.click(sel, { count: 3 });
  await page.keyboard.press("Backspace");
  if (text) await page.type(sel, text);
}

/** api/update as the CLI does it: applies each axis in the body to the viz, answers its stdout. */
export const update: Stub = ({ body }, lib) => {
  const s = lib.slugs.find((x) => x.id === body.id)!;
  const said: string[] = [];
  for (const [k, v] of Object.entries(body as Record<string, string>)) {
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
export const drop = (lib: { slugs: { id: string }[] }, id: string) => { lib.slugs = lib.slugs.filter((s) => s.id !== id) as never; };

/** The ids of the visible rows, top to bottom. */
export const rowIds = (page: Page) => page.$$eval("#slugs .slug", (els) => els.map((e) => (e as HTMLElement).dataset.id!));

export const text = (page: Page, sel: string) => page.$eval(sel, (e) => e.textContent!.replace(/\s+/g, " ").trim());

/** A real click, retried once if the 5s refresh rebuilt the element between finding and clicking it
 *  (the click never landed then, so a retry can't click twice). */
export const click = (page: Page, sel: string, o?: Parameters<Page["click"]>[1]) =>
  page.click(sel, o).catch((e: Error) => /detached|does not belong|not clickable|context was destroyed/i.test(e.message) ? page.click(sel, o) : Promise.reject(e));

/** api/move as the CLI does it: a rename (name) or a move (toContainer) gives the viz a new id. */
export const move: Stub = ({ body }, lib) => {
  const s = lib.slugs.find((x) => x.id === body.id)!;
  if (body.name) s.name = body.name;
  if (body.toContainer) Object.assign(s, { container: body.toContainer, isCentral: body.toContainer === CENTRAL, host: body.toContainer.slice(HOME.length + 1).replace(/\/viz-pages$/, "") });
  s.id = idOf(s.container, s.name);
  return { ok: true, out: `moved → ${s.id}`, err: "" };
};

/** Waits until a selector's text (whitespace collapsed) reads `want`. */
export const textIs = (page: Page, sel: string, want: string, timeout = 5000) =>
  page.waitForFunction((s, w) => document.querySelector(s)?.textContent?.replace(/\s+/g, " ").trim() === w, { timeout }, sel, want)
    .catch(async () => { throw new Error(`${sel} never read "${want}"; it reads "${await text(page, sel).catch(() => "(absent)")}"`); });
