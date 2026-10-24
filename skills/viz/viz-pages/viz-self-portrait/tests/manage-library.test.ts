// The Library's management drawer (dashboard.ts, ADR 0009): every change a user can make to one
// viz from its row (axes, words, name, place), what the page asks api/ for, and what it shows afterwards.
// Its copies elsewhere are manage-copies.test.ts; video, history, templates and sparse rows are
// manage-render-history.test.ts.
import { describe, it, expect } from "bun:test";
import {
  dashboardReady,
  nthCall,
  calls,
  ok,
  fail,
  netError,
  text as textReply,
  rowTitles,
  ATLAS,
  HARBOR,
  viz as makeViz,
} from "./helpers.ts";
import {
  open,
  click,
  ID,
  act,
  row,
  drawer,
  openDrawer,
  status,
  statusIs,
  update,
  move,
  ownClipboard,
  copied,
  rowIds,
  text,
  typeInto,
  textIs,
} from "./steps-library.ts";

type P = Awaited<ReturnType<typeof open>>;
const lit = async (page: P, id: string, axis: string): Promise<(string | null)[]> => {
  const labels = await page.$$eval(`${drawer(id)} .dg-b.on[data-axis="${axis}"]`, (els) =>
    els.map((e) => e.textContent),
  );
  return labels;
};
const axisLabel = async (page: P, id: string, axis: string): Promise<string | null> => {
  const label = await page.$eval(
    `${drawer(id)} [data-axis="${axis}"]`,
    (e) => e.parentElement!.querySelector(".dg-l")!.textContent,
  );
  return label;
};

describe("the management drawer", () => {
  it.concurrent("should keep saying what a posture change did after the list refreshes under it", async () => {
    const page = await viz.given(
      "River poster's drawer open, api/update standing in for the CLI",
      async () => {
        const p = await open({ hash: "dashboard", stubs: { "POST update": update } });
        await dashboardReady(p);
        await openDrawer(p, ID.river);
        return p;
      },
    );

    await viz.when("the user makes it public", async () => {
      await page.$eval(drawer(ID.river), (d) => {
        Object.assign(d, { __old: true });
      });
      await click(page, act(ID.river, "axis", '[data-axis="posture"][data-val="public"]'));
      // (the write is followed by a refetch of the slugs and the git feed, which rebuilds the drawer)
      await nthCall(page, "GET slugs-git", 2);
      await page.waitForFunction(
        (sel) => !("__old" in document.querySelector(sel)!),
        {},
        drawer(ID.river),
      );
    });

    await viz.then("the page asked for exactly that change", async () => {
      expect((await nthCall(page, "POST update")).body).toEqual({
        id: ID.river,
        posture: "public",
      });
    });
    await viz.then(
      "the row reads public, the drawer is still open on public, and it still says what the CLI did, as a success",
      async () => {
        expect(await text(page, `${row(ID.river)} .axis`)).toBe("public");
        expect(await lit(page, ID.river, "posture")).toEqual(["public"]);
        expect(await status(page, ID.river)).toEqual({
          text: "river-poster: posture → public",
          ok: true,
          err: false,
        });
      },
    );
  });

  it.concurrent("should set listed, approval and the card from the drawer, each labelled with its state", async () => {
    const page = await viz.given(
      "the drawers of River poster (unlisted), Orbit deck (changed since approval) and Atlas weekly metrics (card changed since it was reviewed)",
      async () => {
        const p = await open({ hash: "dashboard", stubs: { "POST update": update } });
        await dashboardReady(p);
        await openDrawer(p, ID.river);
        expect(await lit(p, ID.river, "listed")).toEqual(["unlisted"]);
        expect(await axisLabel(p, ID.river, "approved")).toBe("not approved");
        expect(await axisLabel(p, ID.river, "card-public")).toBe("🪪 card not public");
        expect(await lit(p, ID.river, "card-public")).toEqual(["card is not public"]);
        return p;
      },
    );

    await viz.when("the user lists River poster", async () => {
      await click(page, act(ID.river, "axis", '[data-axis="listed"][data-val="listed"]'));
    });

    await viz.then("api/update is asked to list it, and the drawer shows it listed", async () => {
      expect((await nthCall(page, "POST update")).body).toEqual({ id: ID.river, listed: "listed" });
      await statusIs(page, ID.river, "river-poster: listed → listed");
      await textIs(page, `${drawer(ID.river)} .dg-b.on[data-axis="listed"]`, "listed");
    });

    await viz.when(
      "they open Orbit deck, which changed since it was approved, and re-approve it",
      async () => {
        await openDrawer(page, ID.orbit);
        expect(await page.$(drawer(ID.river))).toBeNull(); // one drawer at a time
        expect(await axisLabel(page, ID.orbit, "approved")).toBe("⚠ changed since approval");
        expect(
          await text(page, act(ID.orbit, "axis", '[data-val="true"][data-axis="approved"]')),
        ).toBe("re-approve this version");
        await click(page, act(ID.orbit, "axis", '[data-axis="approved"][data-val="true"]'));
      },
    );

    await viz.then("it reads approved", async () => {
      expect((await nthCall(page, "POST update", 2)).body).toEqual({
        id: ID.orbit,
        approved: "true",
      });
      await statusIs(page, ID.orbit, "orbit-deck: approved → true");
      await page.waitForFunction(
        (sel) =>
          document.querySelector(sel)?.parentElement!.querySelector(".dg-l")!.textContent ===
          "approved",
        {},
        `${drawer(ID.orbit)} [data-axis="approved"]`,
      );
      expect(await lit(page, ID.orbit, "approved")).toEqual(["approve this version"]);
    });

    await viz.when(
      "they open Atlas weekly metrics, whose card changed since review, and make the card public",
      async () => {
        await openDrawer(page, ID.metrics);
        expect(await axisLabel(page, ID.metrics, "card-public")).toBe(
          "⚠ card changed since reviewed (was not public)",
        );
        expect(await lit(page, ID.metrics, "card-public")).toEqual([]);
        await click(page, act(ID.metrics, "axis", '[data-axis="card-public"][data-val="true"]'));
      },
    );

    await viz.then(
      "the card is public, and as a public viz outside a lobby it gets a share page (no note says otherwise)",
      async () => {
        expect((await nthCall(page, "POST update", 3)).body).toEqual({
          id: ID.metrics,
          "card-public": "true",
        });
        await statusIs(page, ID.metrics, "atlas-metrics: card-public → true");
        await page.waitForFunction(
          (sel) =>
            document.querySelector(sel)?.parentElement!.querySelector(".dg-l")!.textContent ===
            "🪪 card public",
          {},
          `${drawer(ID.metrics)} [data-axis="card-public"]`,
        );
        expect(await text(page, drawer(ID.metrics))).not.toContain("no share page");
      },
    );
  });

  it.concurrent("should say when a public card gets no share page, and why", async () => {
    const page = await viz.given(
      "Big globe's card made public while the viz itself is local, and Harbor timeline's in a lobby",
      async () => {
        const p = await open({
          hash: "dashboard",
          lib: (l) => {
            Object.assign(
              l.slugs.find((s) => s.name === "big-globe")!,
              { cardPublic: "public", posture: "local" },
            );
          },
        });
        await dashboardReady(p);
        return p;
      },
    );

    const { globe, timeline } = await viz.when("the user opens each drawer", async () => {
      await openDrawer(page, ID.globe);
      const globeTexts = await page.$$eval(`${drawer(ID.globe)} .mz`, (els) =>
        els.map((e) => e.textContent),
      );
      await openDrawer(page, ID.timeline);
      const timelineTexts = await page.$$eval(`${drawer(ID.timeline)} .mz`, (els) =>
        els.map((e) => e.textContent),
      );
      return { globe: globeTexts, timeline: timelineTexts };
    });

    await viz.then("each says why there is no share page", () => {
      expect(globe).toContain("no share page: posture is local — only public vizzes get one");
      expect(timeline).toContain(
        "no share page: this container has a private lobby — its lobby shim carries the card instead",
      );
    });
  });

  it.concurrent("should show a write the CLI refused as an error, and not refresh", async () => {
    const page = await viz.given(
      "api/update refuses: Atlas weekly metrics is linked from elsewhere",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: { "POST update": fail("refused: linked from a team wiki page (ADR 0016)") },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.metrics);
        return p;
      },
    );

    const gitBefore = await viz.when("the user makes it private", async () => {
      const before = calls(page, "GET slugs-git").length; // (slugs are refetched every 5s anyway; the git feed only after a write)
      await click(page, act(ID.metrics, "axis", '[data-axis="posture"][data-val="private"]'));
      return before;
    });

    await viz.then(
      "the drawer shows the refusal as an error, the posture is unchanged, and nothing was refetched",
      async () => {
        await statusIs(page, ID.metrics, "refused: linked from a team wiki page (ADR 0016)");
        expect(await status(page, ID.metrics)).toMatchObject({ ok: false, err: true });
        expect(await lit(page, ID.metrics, "posture")).toEqual(["public"]);
        await page.waitForNetworkIdle({ idleTime: 150 });
        expect(calls(page, "GET slugs-git").length).toBe(gitBefore);
      },
    );
  });

  for (const [how, shown] of [
    ["api error: git exited 128", "api error: git exited 128"],
    ["", "HTTP 500"],
    ["net", "TypeError: Failed to fetch"],
  ] satisfies [string, string][]) {
    it.concurrent(`should show why a write failed when the server answers ${how === "net" ? "nothing" : how ? "its error page" : "an empty 500"}`, async () => {
      const page = await viz.given("api/update fails that way", async () => {
        const p = await open({
          hash: "dashboard",
          stubs: { "POST update": () => (how === "net" ? netError() : textReply(500, how)) },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.river);
        return p;
      });

      await viz.when("the user lists River poster", async () => {
        await click(page, act(ID.river, "axis", '[data-axis="listed"][data-val="listed"]'));
      });

      await viz.then("the drawer shows the reason, as an error", async () => {
        await statusIs(page, ID.river, shown);
        expect(await status(page, ID.river)).toMatchObject({ err: true });
      });
    });
  }

  it.concurrent("should fall back to a plain word when the CLI succeeds silently, or fails without a reason", async () => {
    const page = await viz.given(
      "api/update succeeds with no output, and api/move fails with no message",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: { "POST update": ok(""), "POST move": fail("") },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.river);
        return p;
      },
    );

    await viz.when("the user approves River poster", async () => {
      await click(page, act(ID.river, "axis", '[data-axis="approved"][data-val="true"]'));
    });

    await viz.then('the drawer says "updated"', async () => {
      await statusIs(page, ID.river, "updated");
    });

    await viz.when("they save its title", async () => {
      await click(page, act(ID.river, "meta-save"));
    });

    await viz.then('"saved"', async () => {
      await statusIs(page, ID.river, "saved");
    });

    await viz.when("they rename it and the CLI fails without saying why", async () => {
      await click(page, act(ID.river, "rename"));
    });

    await viz.then('"failed", as an error', async () => {
      await statusIs(page, ID.river, "failed");
      expect(await status(page, ID.river)).toMatchObject({ err: true });
    });
  });

  it.concurrent("should not show a slow write's answer in the drawer the user moved on to", async () => {
    const { page, answer } = await viz.given(
      "api/update slow to answer for River poster",
      async () => {
        let release!: () => void;
        const answered = new Promise<void>((r) => {
          release = r;
        });
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST update": async (c, l) => {
              await answered;
              return update(c, l);
            },
          },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.river);
        return { page: p, answer: release };
      },
    );

    await viz.when(
      "the user lists River poster, and opens Big globe's drawer before the answer comes",
      async () => {
        await click(page, act(ID.river, "axis", '[data-axis="listed"][data-val="listed"]'));
        await nthCall(page, "POST update");
        await openDrawer(page, ID.globe);
        answer();
      },
    );

    await viz.then(
      "once the list has refreshed, Big globe's drawer says nothing of River poster's change",
      async () => {
        await nthCall(page, "GET slugs-git", 2);
        await textIs(page, `${row(ID.river)} .slug-axes`, "private🪪 card not publicposter");
        expect(await status(page, ID.globe)).toEqual({ text: "", ok: false, err: false });
      },
    );
  });

  it.concurrent("should leave the drawer's typed text alone on the 5s refresh, and show the refreshed viz once closed", async () => {
    const page = await viz.given("Big globe's drawer open with a title half typed", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      await openDrawer(p, ID.globe);
      await typeInto(p, `${drawer(ID.globe)} [data-fld="title"]`, "Big glo");
      return p;
    });

    await viz.when("the viz is retitled elsewhere and a refresh passes", async () => {
      page.api.lib.slugs.find((s) => s.id === ID.globe)!.title = "Globe (edited elsewhere)";
      // The band is written in the same breath as the page keeping the new list, so it is the
      // signal that the refresh landed (a recorded request, even an idle network, is not: a loaded
      // browser can still be parsing the answer).
      const containers = ++page.api.lib.server.containers;
      await textIs(page, "#server-containers b", String(containers), 10_000);
    });

    await viz.then("the typed text is still there, and the row not yet redrawn", async () => {
      expect(
        await page.$eval(`${drawer(ID.globe)} [data-fld="title"]`, (e) =>
          e instanceof HTMLInputElement ? e.value : null,
        ),
      ).toBe("Big glo");
      expect(await text(page, `${row(ID.globe)} .slug-name`)).toBe("centralBig globe");
    });

    await viz.when("the user closes the drawer", async () => {
      await click(page, `${row(ID.globe)} [data-act="toggle"]`);
    });

    await viz.then("the row shows the new title, and the drawer is gone", async () => {
      expect(await text(page, `${row(ID.globe)} .slug-name`)).toBe(
        "centralGlobe (edited elsewhere)",
      );
      expect(await page.$(drawer(ID.globe))).toBeNull();
    });
  });
});

describe("editing a viz's words", () => {
  it.concurrent("should save title, description and tags, the tags edited as chips", async () => {
    const { page, chips, tag } = await viz.given(
      "Big globe's drawer: tags maps and 3d",
      async () => {
        const p = await open({ hash: "dashboard", stubs: { "POST update": update } });
        await dashboardReady(p);
        await openDrawer(p, ID.globe);
        const chipsOf = async (): Promise<(string | undefined)[]> => {
          const tags = await p.$$eval(`${drawer(ID.globe)} .chip`, (els) =>
            els.map((e) => (e instanceof HTMLElement ? e.dataset.tag : undefined)),
          );
          return tags;
        };
        expect(await chipsOf()).toEqual(["maps", "3d"]);
        return { page: p, chips: chipsOf, tag: `${drawer(ID.globe)} .tag-input` };
      },
    );

    await viz.when("the user retitles and describes it", async () => {
      await typeInto(page, `${drawer(ID.globe)} [data-fld="title"]`, "Big globe 2");
      await typeInto(page, `${drawer(ID.globe)} [data-fld="description"]`, "Every port, spinning.");
    });
    await viz.when(
      'they add "ports" with Enter, "sea" with a comma, "MAPS" again, an empty Enter, then remove "3d" with its ✕',
      async () => {
        await page.type(tag, "ports");
        await page.keyboard.press("Enter");
        await page.type(tag, "sea,");
        await page.type(tag, "MAPS");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await click(page, `${drawer(ID.globe)} .chip[data-tag="3d"] [data-act="chip-rm"]`);
      },
    );

    await viz.then(
      'each new tag is a chip, once, and the duplicate "MAPS" was not added',
      async () => {
        expect(await chips()).toEqual(["maps", "ports", "sea"]);
        expect(await page.$eval(tag, (e) => (e instanceof HTMLInputElement ? e.value : null))).toBe(
          "",
        );
      },
    );

    await viz.when(
      'they Backspace in the empty tag box, which removes the last chip, then type "globe" without Enter and save',
      async () => {
        await click(page, tag);
        await page.keyboard.press("Backspace");
        expect(await chips()).toEqual(["maps", "ports"]);
        await page.type(tag, "globe");
        await page.keyboard.press("ArrowLeft"); // any other key leaves the chips alone
        expect(await chips()).toEqual(["maps", "ports"]);
        await click(page, act(ID.globe, "meta-save"));
      },
    );

    await viz.then("api/update gets the new words, the typed tag included", async () => {
      expect((await nthCall(page, "POST update")).body).toEqual({
        id: ID.globe,
        title: "Big globe 2",
        description: "Every port, spinning.",
        tags: "maps, ports, globe",
      });
    });
    await viz.then("the row shows them", async () => {
      await statusIs(page, ID.globe, "big-globe: title → Big globe 2");
      await textIs(page, `${row(ID.globe)} .slug-name`, "centralBig globe 2");
      expect(
        await page.$$eval(`${row(ID.globe)} .tag-chip`, (els) => els.map((e) => e.textContent)),
      ).toEqual(["maps", "ports", "globe"]);
    });
  });

  it.concurrent("should not add a typed tag twice when it is already a chip", async () => {
    const page = await viz.given(
      'Big globe\'s drawer, "Maps" typed in the tag box without Enter',
      async () => {
        const p = await open({ hash: "dashboard", stubs: { "POST update": update } });
        await dashboardReady(p);
        await openDrawer(p, ID.globe);
        await p.type(`${drawer(ID.globe)} .tag-input`, "Maps");
        return p;
      },
    );

    await viz.when("the user saves", async () => {
      await click(page, act(ID.globe, "meta-save"));
    });

    await viz.then("the tags are unchanged", async () => {
      expect((await nthCall(page, "POST update")).body.tags).toBe("maps, 3d");
    });
  });

  it.concurrent("should add and remove where a viz is linked from", async () => {
    const { page, links } = await viz.given(
      'Atlas weekly metrics, linked from "a team wiki page"',
      async () => {
        const p = await open({ hash: "dashboard", stubs: { "POST update": update } });
        await dashboardReady(p);
        await openDrawer(p, ID.metrics);
        const linksOf = async (): Promise<(string | null)[]> => {
          const chipTexts = await p.$$eval(`${drawer(ID.metrics)} .link-list .mchip`, (els) =>
            els.map((e) => e.firstChild!.textContent),
          );
          return chipTexts;
        };
        expect(await linksOf()).toEqual(["a team wiki page"]);
        return { page: p, links: linksOf };
      },
    );

    await viz.when("the user presses add with nothing typed", async () => {
      await click(page, act(ID.metrics, "link"));
    });

    await viz.then("the drawer asks for an entry, and nothing is sent", async () => {
      await statusIs(page, ID.metrics, "entry required");
      expect(calls(page, "POST update")).toEqual([]);
    });

    await viz.when('they add "the quarterly deck"', async () => {
      await page.type(`${drawer(ID.metrics)} [data-fld="linkedFrom"]`, "the quarterly deck");
      await click(page, act(ID.metrics, "link"));
    });

    await viz.then("it is sent and listed", async () => {
      expect((await nthCall(page, "POST update")).body).toEqual({
        id: ID.metrics,
        "linked-from": "the quarterly deck",
      });
      await statusIs(page, ID.metrics, "atlas-metrics: linked-from → the quarterly deck");
      expect(await links()).toEqual(["a team wiki page", "the quarterly deck"]);
    });

    await viz.when("they remove both", async () => {
      await click(page, act(ID.metrics, "unlink", '[data-link="a team wiki page"]'));
      await nthCall(page, "POST update", 2);
      await statusIs(page, ID.metrics, "atlas-metrics: unlinked-from → a team wiki page");
      await click(page, act(ID.metrics, "unlink", '[data-link="the quarterly deck"]'));
    });

    await viz.then(
      "the page says it is not linked, and the row's linked badge is gone",
      async () => {
        expect((await nthCall(page, "POST update", 3)).body).toEqual({
          id: ID.metrics,
          "unlinked-from": "the quarterly deck",
        });
        await textIs(page, `${drawer(ID.metrics)} .link-list`, "not linked");
        expect(await text(page, `${row(ID.metrics)} .slug-axes`)).not.toContain("linked");
      },
    );
  });

  it.concurrent("should copy a viz's uid, or say it has none yet", async () => {
    const { page, uid } = await viz.given(
      "the dashboard, with a clipboard of its own",
      async () => {
        const p = await open({ hash: "dashboard" });
        await dashboardReady(p);
        await ownClipboard(p);
        await openDrawer(p, ID.river);
        return { page: p, uid: p.api.lib.slugs.find((s) => s.id === ID.river)!.uid };
      },
    );

    await viz.when("the user clicks River poster's uid", async () => {
      await click(page, act(ID.river, "copy-uid"));
    });

    await viz.then("it is on the clipboard, and the drawer says so", async () => {
      await statusIs(page, ID.river, "uid copied");
      expect(await copied(page)).toEqual([uid]);
    });

    await viz.when("the clipboard refuses", async () => {
      await ownClipboard(page, true);
      await click(page, act(ID.river, "copy-uid"));
    });

    await viz.then("the drawer says the copy failed", async () => {
      await statusIs(page, ID.river, "copy failed");
      expect(await status(page, ID.river)).toMatchObject({ err: true });
    });

    await viz.when("they open loose-sketch, which has no uid yet", async () => {
      await openDrawer(page, ID.loose);
    });

    await viz.then("there is nothing to copy, and the drawer says how one is made", async () => {
      expect(await page.$(act(ID.loose, "copy-uid"))).toBeNull();
      expect(await text(page, `${drawer(ID.loose)} .dg-row .mz`)).toBe(
        "none yet — backfill-uids.ts mints one",
      );
    });
  });
});

describe("renaming, moving and deleting a viz", () => {
  it.concurrent("should rename a viz, closing its drawer, and refuse an empty name", async () => {
    const page = await viz.given("Big globe's drawer", async () => {
      const p = await open({ hash: "dashboard", stubs: { "POST move": move } });
      await dashboardReady(p);
      await openDrawer(p, ID.globe);
      return p;
    });

    await viz.when("the user clears the name and saves", async () => {
      await typeInto(page, `${drawer(ID.globe)} [data-fld="name"]`, "");
      await click(page, act(ID.globe, "rename"));
    });

    await viz.then("the drawer asks for a name, and nothing is sent", async () => {
      await statusIs(page, ID.globe, "name required");
      expect(calls(page, "POST move")).toEqual([]);
    });

    await viz.when('they name it "world-globe"', async () => {
      await page.type(`${drawer(ID.globe)} [data-fld="name"]`, "world-globe");
      await click(page, act(ID.globe, "rename"));
    });

    await viz.then(
      "api/move renames it, the drawer closes, and the row carries the new id",
      async () => {
        expect((await nthCall(page, "POST move")).body).toEqual({
          id: ID.globe,
          name: "world-globe",
        });
        const renamed = ID.globe.replace("big-globe", "world-globe");
        await page.waitForSelector(row(renamed));
        expect(await page.$(".slug-drawer")).toBeNull();
        expect(await rowIds(page)).not.toContain(ID.globe);
      },
    );
  });

  it.concurrent("should move a viz only on a confirming second click, and disarm if that click never comes", async () => {
    const page = await viz.given(
      "Big globe's drawer, with the move destinations the library's other containers",
      async () => {
        const p = await open({ hash: "dashboard", realDisarm: true, stubs: { "POST move": move } });
        await dashboardReady(p);
        await openDrawer(p, ID.globe);
        expect(
          await p.$$eval(`${drawer(ID.globe)} [data-fld="toContainer"] option`, (os) =>
            os.map((o) => [o.value, o.textContent]),
          ),
        ).toEqual([
          [ATLAS, "code/atlas/viz-pages"],
          [HARBOR, "code/harbor/viz-pages"],
        ]);
        await p.select(`${drawer(ID.globe)} [data-fld="toContainer"]`, HARBOR);
        return p;
      },
    );

    await viz.when("the user clicks move once", async () => {
      await click(page, act(ID.globe, "move"));
    });

    await viz.then("it asks for confirmation, and nothing is sent", async () => {
      expect(await text(page, act(ID.globe, "move"))).toBe("confirm?");
      await statusIs(page, ID.globe, "click move again to confirm");
      expect(calls(page, "POST move")).toEqual([]);
    });

    await viz.when("they wait, not confirming", async () => {
      await textIs(page, act(ID.globe, "move"), "move", 4000);
    });

    await viz.then(
      "the button and the drawer are back as they were, the destination still the one picked",
      async () => {
        expect(await status(page, ID.globe)).toEqual({ text: "", ok: false, err: false });
        expect(
          await page.$eval(`${drawer(ID.globe)} [data-fld="toContainer"]`, (e) =>
            e instanceof HTMLSelectElement ? e.value : null,
          ),
        ).toBe(HARBOR);
      },
    );

    await viz.when("they click move once more, much later", async () => {
      await click(page, act(ID.globe, "move"));
    });

    await viz.then("it asks again rather than moving", async () => {
      await statusIs(page, ID.globe, "click move again to confirm");
      expect(calls(page, "POST move")).toEqual([]);
    });

    await viz.when("they confirm", async () => {
      await click(page, act(ID.globe, "move"));
    });

    await viz.then("api/move moves it to harbor, and the row lives there now", async () => {
      expect((await nthCall(page, "POST move")).body).toEqual({
        id: ID.globe,
        toContainer: HARBOR,
      });
      const moved = ID.harborMap.replace("harbor-map", "big-globe");
      await page.waitForSelector(row(moved));
      expect(await text(page, `${row(moved)} .slug-host`)).toBe("↳ code/harbor");
    });
  });

  it.concurrent("should show a refused move or rename in the drawer, which stays open", async () => {
    const page = await viz.given("api/move refuses everything", async () => {
      const p = await open({
        hash: "dashboard",
        stubs: { "POST move": fail("refused: linked from a team wiki page") },
      });
      await dashboardReady(p);
      await openDrawer(p, ID.metrics);
      return p;
    });

    await viz.when("the user confirms a move", async () => {
      await click(page, act(ID.metrics, "move"));
      await click(page, act(ID.metrics, "move"));
    });

    await viz.then("the drawer says why, and stays", async () => {
      await statusIs(page, ID.metrics, "refused: linked from a team wiki page");
      expect(await status(page, ID.metrics)).toMatchObject({ err: true });
    });

    await viz.when("they try a rename instead", async () => {
      await typeInto(page, `${drawer(ID.metrics)} [data-fld="name"]`, "metrics-2");
      await click(page, act(ID.metrics, "rename"));
    });

    await viz.then("the same", async () => {
      await statusIs(page, ID.metrics, "refused: linked from a team wiki page");
      expect(calls(page, "POST move").length).toBe(2);
    });
  });

  it.concurrent("should have nowhere to move, mirror or vendor to in a library of one container", async () => {
    const { page, id } = await viz.given(
      "a library whose vizzes all live in the central library",
      async () => {
        const p = await open({
          hash: "dashboard",
          lib: (l) => {
            l.slugs = [
              makeViz("alone", { title: "Alone" }),
              makeViz("also-here", { title: "Also here" }),
            ];
          },
        });
        await dashboardReady(p);
        return { page: p, id: ID.tide.replace("tide-clock", "alone") };
      },
    );

    await viz.when("the user opens a viz's drawer", async () => {
      await openDrawer(page, id);
    });

    await viz.then("every destination menu says there is no other container", async () => {
      expect(
        await page.$$eval(
          `${drawer(id)} [data-fld="toContainer"] option, ${drawer(id)} [data-fld="to"] option, ${drawer(id)} [data-fld="vto"] option`,
          (os) => os.map((o) => o.textContent),
        ),
      ).toEqual(["no other containers", "no other containers", "no other containers"]);
    });

    await viz.when("the user tries each", async () => {
      await click(page, act(id, "vendor-add"));
      await statusIs(page, id, "no sink container");
      await click(page, act(id, "move"));
      await statusIs(page, id, "no destination container");
      await click(page, act(id, "mirror-add"));
      await statusIs(page, id, "no sink container");
    });

    await viz.then("the drawer says what's missing, and nothing is sent", () => {
      expect(page.api.calls.filter((c) => c.method === "POST")).toEqual([]);
    });
  });

  it.concurrent("should delete a viz on a confirming second click, and show a refusal", async () => {
    const page = await viz.given(
      "api/delete removes the viz, but refuses loose-sketch",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST delete": (call, l) => {
              if (call.body.id === ID.loose) return fail("refused: not committed")(call, l);
              l.slugs = l.slugs.filter((s) => s.id !== call.body.id);
              return { ok: true, out: "deleted", err: "" };
            },
          },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.globe);
        return p;
      },
    );

    await viz.when("the user clicks delete once", async () => {
      await click(page, act(ID.globe, "delete"));
    });

    await viz.then("it asks to confirm", async () => {
      await statusIs(page, ID.globe, "click delete again to confirm — this removes the folder");
      expect(await text(page, act(ID.globe, "delete"))).toBe("confirm?");
    });

    await viz.when("they confirm", async () => {
      await click(page, act(ID.globe, "delete"));
    });

    await viz.then("api/delete is asked, and the row is gone", async () => {
      expect((await nthCall(page, "POST delete")).body).toEqual({ id: ID.globe });
      await page.waitForFunction((sel) => !document.querySelector(sel), {}, row(ID.globe));
      expect((await rowTitles(page)).length).toBe(13);
    });

    await viz.when("they delete loose-sketch, which the CLI refuses", async () => {
      await openDrawer(page, ID.loose);
      await click(page, act(ID.loose, "delete"));
      await click(page, act(ID.loose, "delete"));
    });

    await viz.then("the drawer says why, and the row stays", async () => {
      await statusIs(page, ID.loose, "refused: not committed");
      expect(await rowIds(page)).toContain(ID.loose);
    });
  });
});
