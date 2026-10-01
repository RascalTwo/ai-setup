// Shared by the anidoodle tour's tests. The page has no backend: it reads its own data.json and media, so
// a test drives it directly. The only thing kept out is the network: anything off this origin is refused.
import type { Page } from "puppeteer-core";

declare global {
  // eslint-disable-next-line no-var
  var viz: {
    open(hash?: string | object, o?: { width?: number; height?: number; before?: (p: Page) => unknown }): Promise<Page & { errors: string[] }>;
  };
}

const BASE = new URL(process.env.VIZ_URL!.replace(/#.*$/, ""));

/** The tour, open on the given chapter (1-based, as the chapter strip numbers them). */
export async function open(chapter = 1): Promise<Page & { errors: string[] }> {
  const page = await viz.open(undefined, {
    before: async (p) => {
      await p.setRequestInterception(true);
      p.on("request", (req) => {
        if (req.isInterceptResolutionHandled()) return;
        return new URL(req.url()).origin === BASE.origin ? req.continue() : req.abort("blockedbyclient");
      });
    },
  });
  await page.waitForFunction(() => document.querySelectorAll(".chap").length > 0 && !!document.querySelector("#pipeDetail b"), { timeout: 15_000 });
  if (chapter > 1) await goTo(page, chapter);
  return page;
}

export async function goTo(page: Page, chapter: number) {
  await page.click(`.chap[data-i="${chapter - 1}"]`);
  await page.waitForFunction((n) => document.querySelector("#pos")!.textContent === `${n} / 9`, { timeout: 10_000 }, chapter);
}

export const text = (page: Page, sel: string) => page.$eval(sel, (e) => (e.textContent ?? "").replace(/\s+/g, " ").trim());

/** The intake builder as the user reads it. */
export const brief = (page: Page) => page.$eval("#intakeOut .cmd", (e) => e.textContent!);
export const said = (page: Page) => text(page, "#intakeOut .say");
export const preview = (page: Page) => text(page, "#shapePreview");
export const commands = (page: Page) => page.$eval("#intakeOut .cmd:last-of-type", (e) => e.textContent!);

/** Set a text field the way typing would: replace its value, then fire `input`. */
export const fill = (page: Page, sel: string, value: string) =>
  page.$eval(sel, (e, v) => { const i = e as HTMLInputElement; i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, value);
