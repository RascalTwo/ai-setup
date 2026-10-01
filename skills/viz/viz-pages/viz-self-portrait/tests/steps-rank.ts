// Rank's own test steps (rank.test.ts): the corpora it ranks, the browser dialogs its dimension
// buttons raise, and a stand-in GET ranking that can be held open to race against.
import type { Page } from "puppeteer-core";
import { rankingView, type Library, type SPPage, type Stub } from "./helpers.ts";

/** Three vizzes, so a whole sort is two or three answers. */
export const three = (l: Library) => {
  l.ranking.items = l.ranking.items.filter((i) => ["Tide clock", "Orbit deck", "River poster"].includes(i.title));
};

/** …ranked on two dimensions: "Best" (current) and a second, empty one. */
export const twoDims = (l: Library) => {
  three(l);
  l.ranking.lists["demo"] = { name: "Best for a client demo", log: [], benched: [], priority: [] };
};

/** The prompt/confirm/alert dialogs the page raises, in order. Each prompt or confirm takes the next
 *  of `answers`: a string is typed into a prompt, true accepts a confirm, null cancels either. */
export function dialogs(page: Page, answers: (string | boolean | null)[] = []) {
  const seen: { type: string; message: string; value: string }[] = [];
  page.on("dialog", async (d) => {
    seen.push({ type: d.type(), message: d.message(), value: d.defaultValue() });
    if (d.type() === "alert") return d.accept();
    const a = answers.shift();
    if (a === null || a === undefined || a === false) return d.dismiss();
    return d.accept(typeof a === "string" ? a : undefined);
  });
  return seen;
}

/** Waits until `n` dialogs have been raised. */
export async function nthDialog(seen: unknown[], n: number, timeout = 10_000) {
  const t0 = Date.now();
  while (seen.length < n) {
    if (Date.now() - t0 > timeout) throw new Error(`expected ${n} dialog(s), saw ${seen.length}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A GET ranking whose `nth` call reads the library when it arrives, then answers only once
 *  `release()` is called — a slow server, so a user can act while that read is in flight. */
export function heldRead(nth: number) {
  let n = 0, release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const stub: Stub = async (_, l) => {
    const view = structuredClone(rankingView(l));
    if (++n === nth) await gate;
    return view;
  };
  return { stub, release, reads: () => n };
}

/** What the Rank tab is showing, as the user reads it. */
export const rankView = (page: SPPage) => page.evaluate(() => ({
  question: document.getElementById("rk-question")!.textContent,
  dimension: (document.getElementById("rk-list") as HTMLSelectElement).selectedOptions[0]?.textContent,
  dimensions: [...document.querySelectorAll("#rk-list option")].map((o) => o.textContent),
  hint: document.getElementById("rk-dimhint")!.textContent,
  answered: document.getElementById("rk-answered")!.textContent,
  saved: document.getElementById("rk-saved")!.textContent,
}));

/** The finished order, best first. */
export const rankOrder = (page: Page) => page.$$eval("#rk-order li", (els) => els.map((e) => e.textContent));

/** The sort has finished. */
export const rankDone = (page: Page) =>
  page.waitForFunction(() => !(document.getElementById("rank-done") as HTMLElement).hidden, { timeout: 10_000 });

/** The saved-state line reads `text`. */
export const savedReads = (page: Page, text: string) =>
  page.waitForFunction((t) => document.getElementById("rk-saved")!.textContent === t, { timeout: 10_000 }, text);

/** Waits until Rank asks about [left, right]: after an answer, the next pair is drawn a beat later. */
export const pairShown = (page: Page, [a, b]: string[]) => page.waitForFunction((a, b) =>
  document.querySelector("#rk-a .rk-t")?.textContent === a && document.querySelector("#rk-b .rk-t")?.textContent === b,
  { timeout: 10_000 }, a!, b!);
