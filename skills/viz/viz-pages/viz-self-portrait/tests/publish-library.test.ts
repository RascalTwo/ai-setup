// The Library's publish tools (dashboard.ts): preview a container exactly as it would publish,
// ask where it deploys, and the lobby key of a sealed container — shown, copied and rotated.
import { describe, it, expect } from "bun:test";
import {
  dashboardReady,
  nthCall,
  calls,
  ok,
  fail,
  CENTRAL,
  ATLAS,
  HARBOR,
  type Stub,
} from "./helpers.ts";
import { open, click, text, textIs, ownClipboard, copied } from "./steps-library.ts";

type P = Awaited<ReturnType<typeof open>>;
const LOBBY = {
  passphrase: "tide-anchor-42",
  hash: "a1b2c3",
  shims: ["http://127.0.0.1:61234/a1b2c3/", "http://127.0.0.1:61234/a1b2c3/harbor-map/"],
};
/** api/preview: serves the container, with harbor's lobby key when it is harbor. */
const preview: Stub = ({ body }) => ({
  ok: true,
  out: "",
  url: "http://127.0.0.1:61234/",
  container: body.container,
  lobby: body.container === HARBOR ? LOBBY : null,
});
/** The lobby key as rows of [label, value]. */
const lobbyRows = async (page: P): Promise<(string | null)[][]> => {
  const rows = await page.$$eval("#lobby-key dt", (dts) =>
    dts.map((dt) => [dt.textContent, dt.nextElementSibling!.firstChild!.textContent]),
  );
  return rows;
};

describe("previewing a container", () => {
  it.concurrent("should preview only a chosen container, and show a sealed one's lobby key, copyable", async () => {
    const { page, built } = await viz.given(
      "the Library with every container in scope, and api/preview building slowly",
      async () => {
        let release!: () => void;
        const building = new Promise<void>((r) => {
          release = r;
        });
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST preview": async (c, l) => {
              await building;
              return preview(c, l);
            },
          },
        });
        await dashboardReady(p);
        await ownClipboard(p);
        return { page: p, built: release };
      },
    );

    await viz.when("the page has loaded");
    await viz.then("preview and deployed url can't be pressed", async () => {
      expect(
        await page.$$eval("button#preview-btn, button#baseurl-btn", (els) =>
          els.map((e) => e.disabled),
        ),
      ).toEqual([true, true]);
    });

    await viz.when(
      "the user scopes to harbor, a sealed container, and presses preview",
      async () => {
        await page.select("#f-scope", HARBOR);
        await click(page, "#preview-btn");
      },
    );
    await viz.then("it says it is building, and can't be pressed again meanwhile", async () => {
      expect(await text(page, "#preview-result")).toBe(
        "building the publishable tree — this can take a bit…",
      );
      expect(
        await page.$eval("button#preview-btn", (e) => [e.disabled, e.textContent.trim()]),
      ).toEqual([true, "building…"]);
      expect((await nthCall(page, "POST preview")).body).toEqual({ container: HARBOR });
    });

    await viz.when("the build is served", () => {
      built();
    });
    await viz.then(
      "the served URL shows, with a stop button, and the lobby key: passphrase, hash and a shim link per page",
      async () => {
        await textIs(page, "#preview-result", "serving → http://127.0.0.1:61234/");
        expect(await page.$eval("button#preview-stop", (e) => e.hidden)).toBe(false);
        expect(await page.$eval("div#lobby-key", (e) => e.hidden)).toBe(false);
        expect(await lobbyRows(page)).toEqual([
          ["passphrase", "tide-anchor-42"],
          ["hash", "a1b2c3"],
          ["shim link", "http://127.0.0.1:61234/a1b2c3/"],
          ["", "http://127.0.0.1:61234/a1b2c3/harbor-map/"],
        ]);
        expect(await text(page, "#lobby-key .note")).toBe(
          "Shim links open the site already unlocked, with no # fragment. Hit deployed url for the shareable form.",
        );
      },
    );
    await viz.then(
      "each value's copy button sits beside it, where a click reaches that button and no other",
      async () => {
        expect(
          await page.$$eval("#lobby-key button.copy", (bs) =>
            bs.map((b) => {
              const r = b.getBoundingClientRect(),
                dd = b.parentElement!.getBoundingClientRect();
              return (
                document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b &&
                r.top >= dd.top &&
                r.bottom <= dd.bottom
              );
            }),
          ),
        ).toEqual([true, true, true, true]);
      },
    );

    await viz.when("they copy the passphrase", async () =>
      click(page, '#lobby-key button.copy[data-copy="tide-anchor-42"]'),
    );
    await viz.then(
      "it is on the clipboard, the button says so, and a moment later reads copy again",
      async () => {
        await textIs(page, '#lobby-key button.copy[data-copy="tide-anchor-42"]', "copied");
        expect(await copied(page)).toEqual(["tide-anchor-42"]);
        await textIs(page, '#lobby-key button.copy[data-copy="tide-anchor-42"]', "copy", 3000);
      },
    );

    await viz.when("the clipboard refuses and they copy the hash", async () => {
      await ownClipboard(page, true);
      await click(page, '#lobby-key button.copy[data-copy="a1b2c3"]');
    });
    await viz.then("the button says the copy failed", async () => {
      await textIs(page, '#lobby-key button.copy[data-copy="a1b2c3"]', "copy failed");
    });

    await viz.when("they click the key's heading, which is no button", async () =>
      click(page, "#lobby-key h4", { offset: { x: 4, y: 4 } }),
    );
    await viz.then(
      "nothing happens: nothing more is copied, nothing rotated, nothing breaks",
      async () => {
        expect(await copied(page)).toEqual(["tide-anchor-42"]);
        expect(calls(page, "POST rotate")).toEqual([]);
        expect(page.errors).toEqual([]);
      },
    );
  });

  it.concurrent("should show no key for an open container, and say when a sealed build has no shim links", async () => {
    const page = await viz.given(
      "api/preview: atlas has no lobby; harbor's build this time printed no shims",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST preview": ({ body }) => ({
              ok: true,
              out: "",
              url: "http://127.0.0.1:61234/",
              lobby: body.container === HARBOR ? { ...LOBBY, shims: [] } : null,
            }),
          },
        });
        await dashboardReady(p);
        return p;
      },
    );

    await viz.when("the user previews harbor", async () => {
      await page.select("#f-scope", HARBOR);
      await click(page, "#preview-btn");
    });
    await viz.then("the key says the hash works against any origin", async () => {
      await textIs(
        page,
        "#lobby-key .note",
        "No shim links in this build. The hash above is host-independent, so it works against any origin.",
      );
    });

    await viz.when("they preview atlas instead", async () => {
      await page.select("#f-scope", ATLAS);
      await click(page, "#preview-btn");
    });
    await viz.then("there is no key", async () => {
      await nthCall(page, "POST preview", 2);
      await page.waitForFunction(() => document.querySelector<HTMLElement>("#lobby-key")!.hidden);
      expect(await page.$eval("#lobby-key", (e) => e.innerHTML)).toBe("");
    });
  });

  it.concurrent("should say why a preview failed, and stop a running one", async () => {
    const page = await viz.given(
      "api/preview serves harbor, refuses atlas with a reason, and refuses central with none",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST preview": (c, l) =>
              c.body.container === HARBOR
                ? preview(c, l)
                : c.body.container === ATLAS
                  ? fail("publish gate: atlas-metrics is untagged")(c, l)
                  : fail("")(c, l),
            "POST preview-stop": () => ({ ok: true, stopped: "http://127.0.0.1:61234/" }),
          },
        });
        await dashboardReady(p);
        await p.select("#f-scope", HARBOR);
        await click(p, "#preview-btn");
        await textIs(p, "#preview-result", "serving → http://127.0.0.1:61234/");
        return p;
      },
    );

    await viz.when("the user previews atlas, which the publish gate refuses", async () => {
      await page.select("#f-scope", ATLAS);
      await click(page, "#preview-btn");
    });
    await viz.then(
      "the refusal shows as an error, the stop button and the old lobby key are gone",
      async () => {
        await textIs(
          page,
          "#preview-result",
          "preview failed: publish gate: atlas-metrics is untagged",
        );
        expect(await page.$eval("#preview-result", (e) => e.className)).toBe("preview-result err");
        expect(
          await page.$$eval("button#preview-stop, div#lobby-key", (els) =>
            els.map((e) => e.hidden),
          ),
        ).toEqual([true, true]);
      },
    );

    await viz.when("one fails without a reason", async () => {
      await page.select("#f-scope", CENTRAL);
      await click(page, "#preview-btn");
    });
    await viz.then("it says so", async () => {
      await textIs(page, "#preview-result", "preview failed: unknown error");
    });

    await viz.when("harbor is previewed again and the user stops it", async () => {
      await page.select("#f-scope", HARBOR);
      await click(page, "#preview-btn");
      await textIs(page, "#preview-result", "serving → http://127.0.0.1:61234/");
      await click(page, "#preview-stop");
    });
    await viz.then("the preview is taken down; the lobby key stays, to be pasted", async () => {
      expect((await nthCall(page, "POST preview-stop")).body).toEqual({});
      await textIs(page, "#preview-result", "preview stopped");
      expect(
        await page.$$eval("button#preview-stop, div#lobby-key", (els) => els.map((e) => e.hidden)),
      ).toEqual([true, false]);
    });
  });
});

describe("where a container deploys", () => {
  it.concurrent("should show the deployed URL and share links, and the lobby's deployed shim links, until the scope changes", async () => {
    const page = await viz.given(
      "harbor previewed, and api/base-url answering its deployed origin and one share page",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST preview": preview,
            "POST base-url": ({ body }) => ({
              ok: true,
              out: "",
              url: "https://harbor.example",
              shares:
                body.container === HARBOR ? ["https://harbor.example/share/harbor-timeline/"] : [],
            }),
          },
        });
        await dashboardReady(p);
        await ownClipboard(p);
        await p.select("#f-scope", HARBOR);
        await click(p, "#preview-btn");
        await textIs(p, "#preview-result", "serving → http://127.0.0.1:61234/");
        return p;
      },
    );

    await viz.when("the user asks where it deploys", async () => click(page, "#baseurl-btn"));
    await viz.then("base-url.sh's answer shows with the share page, copyable", async () => {
      expect((await nthCall(page, "POST base-url")).body).toEqual({ container: HARBOR });
      await textIs(
        page,
        "#preview-result",
        "deploys to → https://harbor.example🪪 share → https://harbor.example/share/harbor-timeline/ copy",
      );
      expect(await text(page, "#baseurl-btn")).toBe("deployed url");
      await click(page, "#preview-result button.copy");
      await textIs(page, "#preview-result button.copy", "copied");
      expect(await copied(page)).toEqual(["https://harbor.example/share/harbor-timeline/"]);
    });
    await viz.then(
      "the lobby key adds the shim links on the deployed origin, which are the shareable ones",
      async () => {
        expect((await lobbyRows(page)).slice(4)).toEqual([
          ["deployed", "https://harbor.example/a1b2c3/"],
          ["", "https://harbor.example/a1b2c3/harbor-map/"],
        ]);
        expect(await text(page, "#lobby-key .note")).toBe(
          "Deployed links are the shareable ones — a sealed page can't unfurl, so the shim carries the card. They 404 until you actually deploy.",
        );
      },
    );

    await viz.when("they scope to atlas and back, and preview harbor again", async () => {
      await page.select("#f-scope", ATLAS);
      await page.select("#f-scope", HARBOR);
      await click(page, "#preview-btn");
      await nthCall(page, "POST preview", 2);
    });
    await viz.then(
      "the deployed links are gone: the base URL belonged to the scope they left",
      async () => {
        await page.waitForFunction(() => document.querySelectorAll("#lobby-key dt").length === 4);
        expect((await lobbyRows(page)).map(([label]) => label)).toEqual([
          "passphrase",
          "hash",
          "shim link",
          "",
        ]);
      },
    );

    await viz.when("they ask for atlas's, with no preview showing a key", async () => {
      await page.select("#f-scope", ATLAS);
      await click(page, "#baseurl-btn");
    });
    await viz.then("it shows with no share pages", async () => {
      await textIs(page, "#preview-result", "deploys to → https://harbor.example");
    });
  });

  it.concurrent("should say why base-url.sh gave no answer", async () => {
    const page = await viz.given(
      "api/base-url fails for harbor with a reason, and for atlas without one",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST base-url": (c, l) =>
              fail(c.body.container === HARBOR ? "harbor has no base-url.sh" : "")(c, l),
          },
        });
        await dashboardReady(p);
        return p;
      },
    );

    await viz.when("the user asks for each", async () => {
      await page.select("#f-scope", HARBOR);
      await click(page, "#baseurl-btn");
      await textIs(page, "#preview-result", "harbor has no base-url.sh");
      await page.select("#f-scope", ATLAS);
      await click(page, "#baseurl-btn");
    });
    await viz.then("each shows as an error, the second in the page's own words", async () => {
      await textIs(page, "#preview-result", "base-url.sh failed");
      expect(await page.$eval("#preview-result", (e) => e.className)).toBe("preview-result err");
    });
  });
});

describe("rotating a lobby key", () => {
  it.concurrent("should rotate only on a confirming second click, then rebuild to show the new key", async () => {
    const page = await viz.given(
      "harbor previewed with its lobby key, and api/rotate",
      async () => {
        const p = await open({
          hash: "dashboard",
          realDisarm: true,
          stubs: { "POST preview": preview, "POST rotate": ok("rotated the lobby key of harbor") },
        });
        await dashboardReady(p);
        await p.select("#f-scope", HARBOR);
        await click(p, "#preview-btn");
        await p.waitForSelector("#lobby-key button.rot");
        return p;
      },
    );

    await viz.when("the user clicks rotate key once", async () =>
      click(page, "#lobby-key button.rot"),
    );
    await viz.then("it warns what a rotation kills, and waits; left alone it disarms", async () => {
      expect(await text(page, "#lobby-key button.rot")).toBe("confirm? kills every lobby link");
      await textIs(page, "#lobby-key button.rot", "rotate key", 4000);
      expect(calls(page, "POST rotate")).toEqual([]);
    });

    await viz.when("they click it twice", async () => {
      await click(page, "#lobby-key button.rot");
      await click(page, "#lobby-key button.rot");
    });
    await viz.then(
      "harbor's key is rotated, and the preview rebuilt to show the new one",
      async () => {
        expect((await nthCall(page, "POST rotate")).body).toEqual({ container: HARBOR });
        expect((await nthCall(page, "POST preview", 2)).body).toEqual({ container: HARBOR });
        await textIs(page, "#preview-result", "serving → http://127.0.0.1:61234/");
        expect(await page.$eval("div#lobby-key", (e) => e.hidden)).toBe(false);
      },
    );
  });

  it.concurrent("should ask for a fresh preview when the scope moved on, and show a refused rotation", async () => {
    const { page, rotate } = await viz.given(
      "harbor previewed; api/rotate refuses once without a reason, once with one, then rotates",
      async () => {
        let n = 0;
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST preview": preview,
            "POST rotate": (c, l) =>
              ++n === 1
                ? fail("")(c, l)
                : n === 2
                  ? fail("not a lobby container")(c, l)
                  : ok("rotated the lobby key of harbor")(c, l),
          },
        });
        await dashboardReady(p);
        await p.select("#f-scope", HARBOR);
        await click(p, "#preview-btn");
        await p.waitForSelector("#lobby-key button.rot");
        const rotateKey = async () => {
          await click(p, "#lobby-key button.rot");
          await click(p, "#lobby-key button.rot");
        };
        return { page: p, rotate: rotateKey };
      },
    );

    await viz.when("the user rotates and it is refused, twice", async () => {
      await rotate();
      await textIs(page, "#preview-result", "rotate failed: unknown error");
      await rotate();
      await textIs(page, "#preview-result", "rotate failed: not a lobby container");
    });
    await viz.then("the key and its button are as they were", async () => {
      expect(
        await page.$eval("#lobby-key button.rot", (e) => [
          e.textContent,
          e.disabled,
          e.classList.contains("armed"),
        ]),
      ).toEqual(["rotate key", false, false]);
    });

    await viz.when("they scope to atlas, then rotate harbor's key", async () => {
      await page.select("#f-scope", ATLAS);
      await rotate();
    });
    await viz.then(
      "the key is gone, nothing is rebuilt, and the page says to preview harbor again",
      async () => {
        await textIs(
          page,
          "#preview-result",
          "rotated the lobby key of harborpreview this container again to see the new key.",
        );
        expect(await page.$eval("div#lobby-key", (e) => e.hidden)).toBe(true);
        expect(calls(page, "POST preview").length).toBe(1);
      },
    );
  });
});
