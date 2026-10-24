// Band 1 of the Guide, "Get Running" (fig-run.ts, and treemap.ts under it): the two-sided "why"
// figure, install, and the refine loop. "Your first ask" is stepped in guide.test.ts.
import { describe, it, expect } from "bun:test";
import { open, guideReady, reducedMotion, reply, ownClipboard, copied } from "./helpers.ts";
import { walk, shown, onPlatform } from "./guide-steps.ts";

const litRows = async (page: Awaited<ReturnType<typeof open>>) => {
  const rows = await page.$$eval("#why-list .why-row.hit .wr-n", (els) =>
    els.map((e) => e.textContent),
  );
  return rows;
};
const litCells = async (page: Awaited<ReturnType<typeof open>>) => {
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll<SVGElement>("#why-tm .tm-cell:not(.dim)")]
      .map((e) => e.dataset.vizId!.replace(/^src-/u, ""))
      .toSorted(),
  );
  return cells;
};

describe("Why bother", () => {
  it.concurrent("should light each question's answer on both sides, and put it back when asked again", async () => {
    const page = await viz.given('the "Why bother" figure, no question picked', async () => {
      const p = await open({ hash: "guide", before: reducedMotion });
      await guideReady(p);
      expect(await p.$eval("#why-answer", (e) => e.textContent)).toStartWith(
        "Pick a question above.",
      );
      expect(await litCells(p)).toHaveLength(24);
      return p;
    });

    await viz.when("the reader asks which single file is the biggest", async () =>
      page.click('#why-qs button[data-q="0"]'),
    );
    await viz.then(
      "lib/publish/ is the only row lit in the list and the only cell lit in the picture",
      async () => {
        expect(await litRows(page)).toEqual(["lib/publish/"]);
        expect(await litCells(page)).toEqual(["lib/publish/"]);
        expect(await page.$eval("#why-answer", (e) => e.textContent)).toBe(
          "lib/publish/ — 137 KB, more than a quarter of everything.",
        );
        expect(await page.$eval("#why-list .why-row.hit .wr-v", (e) => e.textContent)).toBe(
          "137 KB",
        );
      },
    );

    await viz.when("the reader asks how much is the shared kit", async () =>
      page.click('#why-qs button[data-q="2"]'),
    );
    await viz.then(
      "the six kit files the answer counts are lit on both sides, and only that question is picked",
      async () => {
        const kit = [
          "deck.js",
          "exchange.css",
          "exchange.js",
          "viz-kit.css",
          "viz-og.css",
          "viz.js",
        ];
        expect((await litRows(page)).toSorted()).toEqual(kit);
        expect(await litCells(page)).toEqual(kit);
        expect(await page.$eval("#why-answer", (e) => e.textContent)).toStartWith(
          "Six files, ~70 KB",
        );
        expect(
          await page.$$eval("#why-qs button.on", (bs) =>
            bs.map((b) => (b as HTMLElement).dataset.q),
          ),
        ).toEqual(["2"]);
      },
    );

    await viz.when("the reader clicks the same question again", async () =>
      page.click('#why-qs button[data-q="2"]'),
    );
    await viz.then(
      "nothing is picked: every cell is lit, no row is, and the prompt is back",
      async () => {
        expect(await litRows(page)).toEqual([]);
        expect(await litCells(page)).toHaveLength(24);
        expect(await page.$$eval("#why-qs button.on", (bs) => bs.length)).toBe(0);
        expect(await page.$eval("#why-answer", (e) => e.textContent)).toStartWith(
          "Pick a question above.",
        );
      },
    );

    await viz.when("the reader clicks between the question buttons", async () => {
      const qs = (await page.$("#why-qs"))!;
      const box = (await qs.boundingBox())!;
      await page.mouse.click(box.x + box.width - 2, box.y + 1);
    });
    await viz.then("still nothing is picked", async () => {
      expect(await page.$$eval("#why-qs button.on", (bs) => bs.length)).toBe(0);
    });
  });
});

describe("Install", () => {
  const PLATFORMS = [
    {
      os: "macOS",
      nav: { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel" },
      yours: ["macOS"],
    },
    {
      os: "Windows, as Chromium's userAgentData reports it",
      nav: {
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        uaData: "Windows",
      },
      yours: ["Windows"],
    },
    {
      os: "Linux, known only from the user agent",
      nav: { ua: "Mozilla/5.0 (X11; Linux x86_64)", platform: "" },
      yours: ["Linux"],
    },
    {
      os: "an OS with no bundle",
      nav: { ua: "Mozilla/5.0 (X11; FreeBSD amd64)", platform: "FreeBSD amd64" },
      yours: [],
    },
  ];
  for (const { os, nav, yours } of PLATFORMS) {
    it.concurrent(`should mark the download for the reader's own platform: ${os}`, async () => {
      const page = await viz.given("a browser on that platform", async () => {
        const p = await open({
          hash: "guide",
          before: async (q) => {
            await reducedMotion(q);
            await onPlatform(nav)(q);
          },
        });
        await guideReady(p);
        return p;
      });

      await viz.when("the reader picks the Claude Desktop way in", async () =>
        page.click('.inst-tab[data-way="chat"]'),
      );

      await viz.then(`"your platform" shows on that bundle's card and no other`, async () => {
        const marked = await page.$$eval(".inst-pane.on .dl-card", (cs) =>
          cs
            .filter((c) => getComputedStyle(c.querySelector(".dl-yours")!).display !== "none")
            .map((c) => c.querySelector("b")!.textContent),
        );
        expect(marked).toEqual(yours);
      });
    });
  }

  it.concurrent("should copy a command, say so, then go back to offering it", async () => {
    const { page, copy } = await viz.given(
      "the install stop, in a browser that lets the page write the clipboard",
      async () => {
        const p = await open({
          hash: "guide&stop=install",
          before: reducedMotion,
        });
        await guideReady(p);
        await ownClipboard(p); // the OS clipboard is shared by every test page running at once
        return {
          page: p,
          copy: '.inst-pane.on .copy[data-copy="npx skills add RascalTwo/ai-setup -s viz"]',
        };
      },
    );

    await viz.when("the reader copies the install command", async () => page.click(copy));

    await viz.then("the button says it copied, and the clipboard holds the command", async () => {
      expect(await page.$eval(copy, (b) => b.textContent)).toBe("copied ✓");
      expect(await copied(page)).toEqual(["npx skills add RascalTwo/ai-setup -s viz"]);
    });
    await viz.then(`it goes back to "copy" a moment later`, async () => {
      await page.waitForFunction(
        (s) => document.querySelector(s)!.textContent === "copy",
        { timeout: 5_000 },
        copy,
      );
    });

    await viz.when("the reader clicks the pane somewhere that isn't a button", async () =>
      page.click(".inst-pane.on .inst-mode"),
    );
    await viz.then("nothing is copied again", async () => {
      expect(await page.$$eval(".inst-pane.on .copy.ok", (bs) => bs.length)).toBe(0);
    });
  });

  const SILENT = [
    {
      when: "the server doesn't say which release it runs",
      stub: (_: unknown, l: { server: object }) => ({ ...l.server, vizVersion: undefined }),
    },
    { when: "there is no server behind the page", stub: () => reply(404, null) },
  ];
  for (const { when, stub } of SILENT) {
    it.concurrent(`should name no release when ${when}`, async () => {
      const options = await viz.given("the Guide over that server", () => ({
        hash: "guide",
        stubs: { "GET server-info": stub },
      }));

      const page = await viz.when("someone opens it", async () => {
        const p = await open(options);
        await guideReady(p);
        return p;
      });

      await viz.then(
        "the download pane's note names no version, rather than a placeholder",
        async () => {
          await page.waitForFunction(() => document.querySelector(".dl-ver")!.textContent !== "…");
          expect(await page.$eval(".dl-ver", (e) => e.textContent)).toBe("");
        },
      );
    });
  }
});

describe("The refine loop", () => {
  it.concurrent("should change the same treemap with each plain-English ask, then show the self-check", async () => {
    const { page, state, kinds } = await viz.given("the refine stop", async () => {
      const p = await open({ hash: "guide", before: reducedMotion });
      await guideReady(p);
      const refineState = async () => {
        const view = await p.evaluate(() => ({
          now: document.querySelector("#refine-asks .ask-line.now b")!.textContent,
          done: document.querySelectorAll("#refine-asks .ask-line.done").length,
          legend: [...document.querySelectorAll("#refine-legend .legend-item:not(.off)")].map((e) =>
            e.textContent.trim(),
          ),
          dim: document.querySelectorAll("#refine-tm .tm-cell.dim").length,
          first: document.querySelector<SVGElement>("#refine-tm .tm-cell")!.dataset.vizId,
          verify: document.querySelector("#refine-verify")!.classList.contains("on"),
        }));
        return view;
      };
      return {
        page: p,
        state: refineState,
        kinds: ["authoring", "serving", "verifying", "publishing", "shared kit", "docs"],
      };
    });

    const steps = await viz.when("the reader walks it step by step", async () => {
      const taken: { i: number; s: Awaited<ReturnType<typeof state>> }[] = [];
      await walk(page, "refine", async (i) => {
        taken.push({ i, s: await state() });
      });
      return taken;
    });

    await viz.then("each step answers the ask it shows", async () => {
      for (const { i, s } of steps) {
        if (i === 0)
          expect(s).toMatchObject({
            now: "the first render",
            done: 0,
            legend: [],
            dim: 0,
            verify: false,
          });
        if (i === 1)
          expect(s).toMatchObject({
            now: "“colour it by which subsystem the file belongs to”",
            legend: kinds,
            dim: 0,
          });
        // the four publishing entries stay lit; the other 20 dim, and the legend says which
        if (i === 2) expect(s).toMatchObject({ legend: ["publishing"], dim: 20, verify: false });
        if (i === 3)
          expect(s).toMatchObject({
            now: "“sort it biggest-first so the ordering means something”",
            legend: kinds,
            dim: 0,
            first: "src-lib/publish/",
          });
        if (i === 4) expect(s).toMatchObject({ done: 4, verify: true });
      }
      expect(await shown(page, "#refine-verify .rv-out")).toBe(true);
    });
  });
});

describe("the treemap layout", () => {
  it.concurrent("should fill its box with areas in proportion to value, and write sizes a reader can read", async () => {
    const treemap = await viz.given("the treemap module the guide draws with", async () => {
      const p = await open({ hash: "guide" });
      await guideReady(p);
      const mod = await p.evaluateHandle(async () => {
        const url = "./treemap.js"; // the page's own module (served from treemap.ts): a variable keeps the type-checker from resolving it against this test file
        const loaded: unknown = await import(url);
        const isTreemap = (m: unknown): m is typeof import("../treemap.ts") =>
          typeof m === "object" &&
          m !== null &&
          "squarify" in m &&
          typeof m.squarify === "function" &&
          "fmtKB" in m &&
          typeof m.fmtKB === "function";
        if (!isTreemap(loaded)) throw new Error("treemap.js does not export squarify and fmtKB");
        return loaded;
      });
      return mod;
    });

    const laid = await viz.when(
      "it lays out nothing, only zeros, a wide box, a tall one and four equal values in a square",
      async () => {
        const out = await treemap.evaluate(({ squarify }) => {
          const box = (rs: { x: number; y: number; w: number; h: number }[]) =>
            rs.map((r) => [r.x, r.y, r.w, r.h].map(Math.round));
          return {
            none: squarify([], 0, 0, 100, 100).length,
            zeros: squarify([{ value: 0 }, { value: -3 }], 0, 0, 100, 100).length,
            wide: box(squarify([{ value: 1 }, { value: 3 }], 0, 0, 200, 100)),
            tall: box(squarify([{ value: 6 }, { value: 2 }, { value: 2 }], 0, 0, 100, 200)),
            square: box(
              squarify([{ value: 1 }, { value: 1 }, { value: 1 }, { value: 1 }], 0, 0, 100, 100),
            ),
          };
        });
        return out;
      },
    );

    await viz.then("nothing to lay out draws nothing", () => {
      expect(laid.none).toBe(0);
      expect(laid.zeros).toBe(0);
    });
    await viz.then(
      "every box is filled, biggest first, in proportion, each row laid along the shorter side",
      () => {
        // 3:1 of a wide 200×100 is two full-height columns, 150 and 50 wide
        expect(laid.wide).toEqual([
          [0, 0, 150, 100],
          [150, 0, 50, 100],
        ]);
        // 6:2:2 of a tall 100×200 is a full-width band 120 high, then two 50×80 side by side under it
        expect(laid.tall).toEqual([
          [0, 0, 100, 120],
          [0, 120, 50, 80],
          [50, 120, 50, 80],
        ]);
        // four equal values in a square are four squares, not four slivers
        expect(laid.square).toEqual([
          [0, 0, 50, 50],
          [0, 50, 50, 50],
          [50, 0, 50, 50],
          [50, 50, 50, 50],
        ]);
      },
    );

    const sizes = await viz.when("it writes sizes either side of 1 KB and 10 KB", async () => {
      const written = await treemap.evaluate(({ fmtKB }) =>
        [0, 1023, 1024, 1536, 10239, 10240, 140088].map(fmtKB),
      );
      return written;
    });
    await viz.then(
      "bytes stay bytes under 1 KB, get one decimal under 10 KB, and none above",
      () => {
        expect(sizes).toEqual(["0 B", "1023 B", "1.0 KB", "1.5 KB", "10.0 KB", "10 KB", "137 KB"]);
      },
    );
  });
});
