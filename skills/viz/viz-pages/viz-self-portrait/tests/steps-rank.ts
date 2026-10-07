// Rank's own test steps (rank.test.ts): the corpora it ranks, the browser dialogs its dimension
// buttons raise, and a stand-in GET ranking that can be held open to race against.
import type { Page } from "puppeteer-core";
import { rankingView, type Library, type SPPage, type Stub } from "./helpers.ts";

/** Three vizzes, so a whole sort is two or three answers. */
export const three = (l: Library): void => {
  l.ranking.items = l.ranking.items.filter((i) =>
    ["Tide clock", "Orbit deck", "River poster"].includes(i.title),
  );
};

/** …ranked on two dimensions: "Best" (current) and a second, empty one. */
export const twoDims = (l: Library): void => {
  three(l);
  l.ranking.lists["demo"] = { name: "Best for a client demo", log: [], benched: [], priority: [] };
};

/** An event handler can't be async, but a failed accept/dismiss must still surface as it would there: rethrow. */
const surface = (p: Promise<unknown>): void => {
  p.catch((e: unknown) => {
    throw e;
  });
};

/** The prompt/confirm/alert dialogs the page raises, in order. Each prompt or confirm takes the next
 *  of `answers`: a string is typed into a prompt, true accepts a confirm, null cancels either. */
export function dialogs(
  page: Page,
  answers: (string | boolean | null)[] = [],
): { type: string; message: string; value: string }[] {
  const seen: { type: string; message: string; value: string }[] = [];
  page.on("dialog", (d) => {
    seen.push({ type: d.type(), message: d.message(), value: d.defaultValue() });
    if (d.type() === "alert") {
      surface(d.accept());
      return;
    }
    const a = answers.shift();
    if (a === null || a === undefined || a === false) surface(d.dismiss());
    else surface(d.accept(typeof a === "string" ? a : undefined));
  });
  return seen;
}

/** Waits until `n` dialogs have been raised. */
export async function nthDialog(seen: unknown[], n: number, timeout = 10_000): Promise<void> {
  const t0 = Date.now();
  while (seen.length < n) {
    if (Date.now() - t0 > timeout) throw new Error(`expected ${n} dialog(s), saw ${seen.length}`);
    // oxlint-disable-next-line no-await-in-loop -- polling: each check must wait for the page to raise more dialogs
    await new Promise<void>((r) => {
      setTimeout(r, 25);
    });
  }
}

/** A GET ranking whose `nth` call reads the library when it arrives, then answers only once
 *  `release()` is called — a slow server, so a user can act while that read is in flight. */
export function heldRead(nth: number): { stub: Stub; release: () => void; reads: () => number } {
  let n = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const stub: Stub = async (_, l) => {
    const view = structuredClone(rankingView(l));
    if (++n === nth) await gate;
    return view;
  };
  return { stub, release, reads: () => n };
}

/** What the Rank tab is showing, as the user reads it. */
export const rankView = async (
  page: SPPage,
): Promise<{
  question: string;
  dimension: string | undefined;
  dimensions: string[];
  hint: string;
  answered: string;
  saved: string;
}> => {
  const view = await page.evaluate(() => {
    const list = document.querySelector("#rk-list");
    if (!(list instanceof HTMLSelectElement)) throw new Error("#rk-list is not a select");
    return {
      question: document.querySelector("#rk-question")!.textContent,
      dimension: list.selectedOptions[0]?.textContent,
      dimensions: [...document.querySelectorAll("#rk-list option")].map((o) => o.textContent),
      hint: document.querySelector("#rk-dimhint")!.textContent,
      answered: document.querySelector("#rk-answered")!.textContent,
      saved: document.querySelector("#rk-saved")!.textContent,
    };
  });
  return view;
};

/** The finished order, best first. */
export const rankOrder = async (page: Page): Promise<string[]> => {
  const order = await page.$$eval("#rk-order li", (els) => els.map((e) => e.textContent));
  return order;
};

/** The sort has finished. */
export const rankDone = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const done = document.querySelector("#rank-done");
      if (!(done instanceof HTMLElement)) throw new Error("#rank-done is missing");
      return !done.hidden;
    },
    { timeout: 10_000 },
  );
};

/** The saved-state line reads `text`. */
export const savedReads = async (page: Page, text: string): Promise<void> => {
  await page.waitForFunction(
    (t) => document.querySelector("#rk-saved")!.textContent === t,
    { timeout: 10_000 },
    text,
  );
};

/** Waits until Rank asks about [left, right]: after an answer, the next pair is drawn a beat later. */
export const pairShown = async (page: Page, pair: string[]): Promise<void> => {
  const [left, right] = pair;
  if (left === undefined || right === undefined) throw new Error("pairShown needs [left, right]");
  await page.waitForFunction(
    (l, r) =>
      document.querySelector("#rk-a .rk-t")?.textContent === l &&
      document.querySelector("#rk-b .rk-t")?.textContent === r,
    { timeout: 10_000 },
    left,
    right,
  );
};
