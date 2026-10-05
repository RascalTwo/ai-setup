// Shared by the anidoodle tour's tests. The page has no backend: it reads its own data.json and media, so
// a test drives it directly. The only thing kept out is the network: anything off this origin is refused.
import type { Page } from "puppeteer-core";

declare global {
  var viz: {
    open(
      hash?: string | object,
      o?: { width?: number; height?: number; before?: (p: Page) => unknown },
    ): Promise<Page & { errors: string[] }>;
  };
}

const BASE = new URL(process.env.VIZ_URL!.replace(/#.*$/u, ""));

/** The tour, open on the given chapter (1-based, as the chapter strip numbers them). */
export async function open(chapter = 1): Promise<Page & { errors: string[] }> {
  const page = await viz.open(undefined, {
    before: async (p) => {
      await p.setRequestInterception(true);
      p.on("request", (req) => {
        if (req.isInterceptResolutionHandled()) return;
        const sameOrigin = new URL(req.url()).origin === BASE.origin;
        (sameOrigin ? req.continue() : req.abort("blockedbyclient")).catch((e: unknown) => {
          console.error(e);
        });
      });
    },
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".chap").length > 0 && !!document.querySelector("#pipeDetail b"),
    { timeout: 15_000 },
  );
  if (chapter > 1) await goTo(page, chapter);
  return page;
}

export async function goTo(page: Page, chapter: number): Promise<void> {
  await page.click(`.chap[data-i="${chapter - 1}"]`);
  await page.waitForFunction(
    (n) => document.querySelector("#pos")!.textContent === `${n} / 9`,
    { timeout: 10_000 },
    chapter,
  );
}

export const text = async (page: Page, sel: string): Promise<string> => {
  const out = await page.$eval(sel, (e) => (e.textContent ?? "").replaceAll(/\s+/gu, " ").trim());
  return out;
};

/** The intake builder as the user reads it. */
export const brief = async (page: Page): Promise<string | null> => {
  const out = await page.$eval("#intakeOut .cmd", (e) => e.textContent);
  return out;
};
export const said = async (page: Page): Promise<string> => {
  const out = await text(page, "#intakeOut .say");
  return out;
};
export const preview = async (page: Page): Promise<string> => {
  const out = await text(page, "#shapePreview");
  return out;
};
export const commands = async (page: Page): Promise<string | null> => {
  const out = await page.$eval("#intakeOut .cmd:last-of-type", (e) => e.textContent);
  return out;
};

/** Set a text field the way typing would: replace its value, then fire `input`. */
export const fill = async (page: Page, sel: string, value: string): Promise<void> => {
  await page.$eval(
    sel,
    (e, v) => {
      if (e instanceof HTMLInputElement) {
        e.value = v;
        e.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    value,
  );
};
