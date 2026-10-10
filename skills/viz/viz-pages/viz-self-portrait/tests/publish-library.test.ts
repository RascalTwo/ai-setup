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
    // GIVEN the Library with every container in scope, and api/preview building slowly
    let built!: () => void;
    const building = new Promise<void>((r) => {
      built = r;
    });
    const page = await open({
      hash: "dashboard",
      stubs: {
        "POST preview": async (c, l) => {
          await building;
          return preview(c, l);
        },
      },
    });
    await dashboardReady(page);
    await ownClipboard(page);

    // WHEN the page has loaded

    // THEN preview and deployed url can't be pressed
    expect(
      await page.$$eval("button#preview-btn, button#baseurl-btn", (els) =>
        els.map((e) => e.disabled),
      ),
    ).toEqual([true, true]);

    // WHEN the user scopes to harbor, a sealed container, and presses preview
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");

    // THEN it says it is building, and can't be pressed again meanwhile
    expect(await text(page, "#preview-result")).toBe(
      "building the publishable tree — this can take a bit…",
    );
    expect(
      await page.$eval("button#preview-btn", (e) => [e.disabled, e.textContent.trim()]),
    ).toEqual([true, "building…"]);
    expect((await nthCall(page, "POST preview")).body).toEqual({ container: HARBOR });

    // WHEN the build is served
    built();

    // THEN the served URL shows, with a stop button, and the lobby key: passphrase, hash and a shim link per page
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

    // THEN each value's copy button sits beside it, where a click reaches that button and no other
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

    // WHEN they copy the passphrase
    await click(page, '#lobby-key button.copy[data-copy="tide-anchor-42"]');

    // THEN it is on the clipboard, the button says so, and a moment later reads copy again
    await textIs(page, '#lobby-key button.copy[data-copy="tide-anchor-42"]', "copied");
    expect(await copied(page)).toEqual(["tide-anchor-42"]);
    await textIs(page, '#lobby-key button.copy[data-copy="tide-anchor-42"]', "copy", 3000);

    // WHEN the clipboard refuses and they copy the hash
    await ownClipboard(page, true);
    await click(page, '#lobby-key button.copy[data-copy="a1b2c3"]');

    // THEN the button says the copy failed
    await textIs(page, '#lobby-key button.copy[data-copy="a1b2c3"]', "copy failed");

    // WHEN they click the key's heading, which is no button
    await click(page, "#lobby-key h4", { offset: { x: 4, y: 4 } });

    // THEN nothing happens: nothing more is copied, nothing rotated, nothing breaks
    expect(await copied(page)).toEqual(["tide-anchor-42"]);
    expect(calls(page, "POST rotate")).toEqual([]);
    expect(page.errors).toEqual([]);
  });

  it.concurrent("should show no key for an open container, and say when a sealed build has no shim links", async () => {
    // GIVEN api/preview: atlas has no lobby; harbor's build this time printed no shims
    const page = await open({
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
    await dashboardReady(page);

    // WHEN the user previews harbor
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");

    // THEN the key says the hash works against any origin
    await textIs(
      page,
      "#lobby-key .note",
      "No shim links in this build. The hash above is host-independent, so it works against any origin.",
    );

    // WHEN they preview atlas instead
    await page.select("#f-scope", ATLAS);
    await click(page, "#preview-btn");

    // THEN there is no key
    await nthCall(page, "POST preview", 2);
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#lobby-key")!.hidden);
    expect(await page.$eval("#lobby-key", (e) => e.innerHTML)).toBe("");
  });

  it.concurrent("should say why a preview failed, and stop a running one", async () => {
    // GIVEN api/preview serves harbor, refuses atlas with a reason, and refuses central with none
    const page = await open({
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
    await dashboardReady(page);
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");
    await textIs(page, "#preview-result", "serving → http://127.0.0.1:61234/");

    // WHEN the user previews atlas, which the publish gate refuses
    await page.select("#f-scope", ATLAS);
    await click(page, "#preview-btn");

    // THEN the refusal shows as an error, the stop button and the old lobby key are gone
    await textIs(
      page,
      "#preview-result",
      "preview failed: publish gate: atlas-metrics is untagged",
    );
    expect(await page.$eval("#preview-result", (e) => e.className)).toBe("preview-result err");
    expect(
      await page.$$eval("button#preview-stop, div#lobby-key", (els) => els.map((e) => e.hidden)),
    ).toEqual([true, true]);

    // WHEN one fails without a reason, THEN it says so
    await page.select("#f-scope", CENTRAL);
    await click(page, "#preview-btn");
    await textIs(page, "#preview-result", "preview failed: unknown error");

    // WHEN harbor is previewed again and the user stops it
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");
    await textIs(page, "#preview-result", "serving → http://127.0.0.1:61234/");
    await click(page, "#preview-stop");

    // THEN the preview is taken down; the lobby key stays, to be pasted
    expect((await nthCall(page, "POST preview-stop")).body).toEqual({});
    await textIs(page, "#preview-result", "preview stopped");
    expect(
      await page.$$eval("button#preview-stop, div#lobby-key", (els) => els.map((e) => e.hidden)),
    ).toEqual([true, false]);
  });
});

describe("where a container deploys", () => {
  it.concurrent("should show the deployed URL and share links, and the lobby's deployed shim links, until the scope changes", async () => {
    // GIVEN harbor previewed, and api/base-url answering its deployed origin and one share page
    const page = await open({
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
    await dashboardReady(page);
    await ownClipboard(page);
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");
    await textIs(page, "#preview-result", "serving → http://127.0.0.1:61234/");

    // WHEN the user asks where it deploys
    await click(page, "#baseurl-btn");

    // THEN base-url.sh's answer shows with the share page, copyable
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

    // THEN the lobby key adds the shim links on the deployed origin, which are the shareable ones
    expect((await lobbyRows(page)).slice(4)).toEqual([
      ["deployed", "https://harbor.example/a1b2c3/"],
      ["", "https://harbor.example/a1b2c3/harbor-map/"],
    ]);
    expect(await text(page, "#lobby-key .note")).toBe(
      "Deployed links are the shareable ones — a sealed page can't unfurl, so the shim carries the card. They 404 until you actually deploy.",
    );

    // WHEN they scope to atlas and back, and preview harbor again
    await page.select("#f-scope", ATLAS);
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");
    await nthCall(page, "POST preview", 2);

    // THEN the deployed links are gone: the base URL belonged to the scope they left
    await page.waitForFunction(() => document.querySelectorAll("#lobby-key dt").length === 4);
    expect((await lobbyRows(page)).map(([label]) => label)).toEqual([
      "passphrase",
      "hash",
      "shim link",
      "",
    ]);

    // WHEN they ask for atlas's, with no preview showing a key
    await page.select("#f-scope", ATLAS);
    await click(page, "#baseurl-btn");

    // THEN it shows with no share pages
    await textIs(page, "#preview-result", "deploys to → https://harbor.example");
  });

  it.concurrent("should say why base-url.sh gave no answer", async () => {
    // GIVEN api/base-url fails for harbor with a reason, and for atlas without one
    const page = await open({
      hash: "dashboard",
      stubs: {
        "POST base-url": (c, l) =>
          fail(c.body.container === HARBOR ? "harbor has no base-url.sh" : "")(c, l),
      },
    });
    await dashboardReady(page);

    // WHEN the user asks for each
    await page.select("#f-scope", HARBOR);
    await click(page, "#baseurl-btn");
    await textIs(page, "#preview-result", "harbor has no base-url.sh");
    await page.select("#f-scope", ATLAS);
    await click(page, "#baseurl-btn");

    // THEN each shows as an error, the second in the page's own words
    await textIs(page, "#preview-result", "base-url.sh failed");
    expect(await page.$eval("#preview-result", (e) => e.className)).toBe("preview-result err");
  });
});

describe("rotating a lobby key", () => {
  it.concurrent("should rotate only on a confirming second click, then rebuild to show the new key", async () => {
    // GIVEN harbor previewed with its lobby key, and api/rotate
    const page = await open({
      hash: "dashboard",
      realDisarm: true,
      stubs: { "POST preview": preview, "POST rotate": ok("rotated the lobby key of harbor") },
    });
    await dashboardReady(page);
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");
    await page.waitForSelector("#lobby-key button.rot");

    // WHEN the user clicks rotate key once
    await click(page, "#lobby-key button.rot");

    // THEN it warns what a rotation kills, and waits; left alone it disarms
    expect(await text(page, "#lobby-key button.rot")).toBe("confirm? kills every lobby link");
    await textIs(page, "#lobby-key button.rot", "rotate key", 4000);
    expect(calls(page, "POST rotate")).toEqual([]);

    // WHEN they click it twice
    await click(page, "#lobby-key button.rot");
    await click(page, "#lobby-key button.rot");

    // THEN harbor's key is rotated, and the preview rebuilt to show the new one
    expect((await nthCall(page, "POST rotate")).body).toEqual({ container: HARBOR });
    expect((await nthCall(page, "POST preview", 2)).body).toEqual({ container: HARBOR });
    await textIs(page, "#preview-result", "serving → http://127.0.0.1:61234/");
    expect(await page.$eval("div#lobby-key", (e) => e.hidden)).toBe(false);
  });

  it.concurrent("should ask for a fresh preview when the scope moved on, and show a refused rotation", async () => {
    // GIVEN harbor previewed; api/rotate refuses once without a reason, once with one, then rotates
    let n = 0;
    const page = await open({
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
    await dashboardReady(page);
    await page.select("#f-scope", HARBOR);
    await click(page, "#preview-btn");
    await page.waitForSelector("#lobby-key button.rot");
    const rotate = async () => {
      await click(page, "#lobby-key button.rot");
      await click(page, "#lobby-key button.rot");
    };

    // WHEN the user rotates and it is refused, twice
    await rotate();
    await textIs(page, "#preview-result", "rotate failed: unknown error");
    await rotate();
    await textIs(page, "#preview-result", "rotate failed: not a lobby container");

    // THEN the key and its button are as they were
    expect(
      await page.$eval("#lobby-key button.rot", (e) => [
        e.textContent,
        e.disabled,
        e.classList.contains("armed"),
      ]),
    ).toEqual(["rotate key", false, false]);

    // WHEN they scope to atlas, then rotate harbor's key
    await page.select("#f-scope", ATLAS);
    await rotate();

    // THEN the key is gone, nothing is rebuilt, and the page says to preview harbor again
    await textIs(
      page,
      "#preview-result",
      "rotated the lobby key of harborpreview this container again to see the new key.",
    );
    expect(await page.$eval("div#lobby-key", (e) => e.hidden)).toBe(true);
    expect(calls(page, "POST preview").length).toBe(1);
  });
});
