// The injected guide in a real browser (product-tour's step 3): the first bubble shows on its target,
// doing each step's action moves the tour on by itself, the app still takes clicks outside the target,
// and every step reaches the page around it by postMessage, as the walkthrough page listens for it.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// puppeteer comes with the viz skill (installed beside this one); a checkout without it skips.
const PUPPETEER = [path.join(import.meta.dir, "../viz"), path.join(process.env["HOME"] ?? "", ".claude/skills/viz")]
  .map((d) => path.join(d, "node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"))
  .find((f) => existsSync(f));
type Frame = { url(): string; click(s: string): Promise<void>; select(s: string, v: string): Promise<string[]>; $eval<R>(s: string, fn: (e: Element) => R): Promise<R> };
type Page = { goto(u: string): Promise<unknown>; frames(): Frame[]; evaluate<R>(fn: () => R): Promise<R>; waitForFunction(fn: () => boolean, o: { timeout: number }): Promise<unknown> };
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

const CHROME = process.env["PUPPETEER_EXECUTABLE_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const steps = [
  { id: "S1", say: "Switch <b>View</b> to Calendar.", target: "#view", done: { sel: "#view", value: "calendar" }, reset: { sel: "#view", value: "timeline" } },
  { id: "S2", say: "Step forward with ›.", target: "#next", done: { sel: "#title", text: "November" } },
  { id: "S3", say: "Look at the title.", target: "#title" },
];

let browser: Browser, page: Page, server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "walk-guide-"));
  cpSync(path.join(import.meta.dir, "fixtures/tiny-app"), dist, { recursive: true });
  const walk = path.join(dist, "walk.json");
  writeFileSync(walk, JSON.stringify({ steps }));
  const inj = Bun.spawnSync(["bun", path.join(import.meta.dir, "guide/inject.ts"), dist, walk], { stderr: "pipe" });
  if (inj.exitCode !== 0) throw new Error(inj.stderr.toString());
  // The walkthrough page's stand-in: the app in a frame, every message it posts kept in order.
  writeFileSync(path.join(dist, "page.html"), `<iframe id="now" src="index.html?tour" style="width:900px;height:600px"></iframe>
<script>window.got=[];addEventListener("message",e=>{if(e.source===now.contentWindow&&e.data.tour)got.push(e.data.tour)})</script>`);
  server = Bun.serve({ port: 0, fetch: (r) => {
    const f = path.join(dist, new URL(r.url).pathname.slice(1) || "index.html");
    return existsSync(f) ? new Response(Bun.file(f)) : new Response("", { status: 404 });
  } });
  if (!PUPPETEER || !existsSync(CHROME)) return;
  const { default: puppeteer } = (await import(PUPPETEER)) as { default: { launch(o: object): Promise<Browser> } };
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await browser.newPage();
});
afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

const app = () => {
  const f = page.frames().find((x) => x.url().includes("index.html"));
  if (!f) throw new Error("no app frame");
  return f;
};
const got = () => page.evaluate(() => (window as unknown as { got: { id?: string; done?: boolean }[] }).got);
const bubble = (f: Frame) => f.$eval(".driver-popover-title", (e) => e.textContent);

describe.skipIf(!PUPPETEER || !existsSync(CHROME))("the injected guide", () => {
  it("should move on by itself as each step's action is done, never by Next, and tell the page", async () => {
    await page.goto(`http://localhost:${server.port}/page.html`);
    await page.waitForFunction(() => (window as unknown as { got: unknown[] }).got.length > 0, { timeout: 10_000 });
    const f = app();
    expect(await bubble(f)).toBe("Step 1 of 3");
    expect(await f.$eval(".driver-active-element", (e) => e.id)).toBe("view");

    // A click on the app outside the target still lands.
    await f.click("#other");
    expect(await f.$eval("#clicks", (e) => e.textContent)).toBe("1");

    await f.select("#view", "calendar");
    await page.waitForFunction(() => (window as unknown as { got: unknown[] }).got.length === 2, { timeout: 5000 });
    await f.click("#next");
    await page.waitForFunction(() => (window as unknown as { got: unknown[] }).got.length === 3, { timeout: 5000 });
    expect(await bubble(f)).toBe("Step 3 of 3");
    expect((await got()).map((m) => m.id)).toEqual(["S1", "S2", "S3"]);

    await f.click(".driver-popover-next-btn"); // the read-only last step ends on its button
    await page.waitForFunction(() => (window as unknown as { got: { done?: boolean }[] }).got.at(-1)?.done === true, { timeout: 5000 });
  }, 30_000);
});
