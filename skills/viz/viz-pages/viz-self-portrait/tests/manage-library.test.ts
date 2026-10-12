// The Library's management drawer (dashboard.ts, ADR 0009): every change a user can make to one
// viz from its row, what the page asks api/ for, and what it shows afterwards.
import { describe, it, expect } from "bun:test";
import {
  dashboardReady,
  nthCall,
  calls,
  ok,
  fail,
  reply,
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
  ownTabs,
  tabs,
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

describe("a viz's copies elsewhere", () => {
  it.concurrent("should list, add, edit and remove the mirrors a viz publishes into", async () => {
    const { page, mirrors, edit } = await viz.given(
      "Tide clock, mirrored into atlas; api/mirror changing the library's mirrors as the CLI would",
      async () => {
        const p = await open({
          hash: "dashboard",
          lib: (l) => {
            l.mirrors[ID.tide]!.push({
              to: "../../code/harbor/viz-pages",
              access: "private",
              listed: false,
              overrides: { title: "Harbor tides" },
            });
          },
          stubs: {
            "POST mirror": ({ body: { id = "", sub, to = "", access = "", listed, title } }, l) => {
              const list = (l.mirrors[id] ??= []);
              if (sub === "add") list.push({ to, access, listed: true, overrides: null });
              if (sub === "rm") l.mirrors[id] = list.filter((m) => m.to !== to);
              if (sub === "update")
                Object.assign(
                  list.find((m) => m.to === to)!,
                  { listed: listed === "listed", overrides: { title } },
                );
              return { ok: true, out: `mirror ${sub}: ${to}`, err: "" };
            },
          },
        });
        await dashboardReady(p);
        return {
          page: p,
          mirrors: `${drawer(ID.tide)} .mirror-list`,
          edit: `${drawer(ID.tide)} .mirror-edit`,
        };
      },
    );

    await viz.when("the user opens Tide clock's drawer", async () => {
      await openDrawer(page, ID.tide);
    });

    await viz.then(
      "its mirrors are listed with their access, the second unlisted with overrides; it is vendored nowhere",
      async () => {
        await textIs(
          page,
          mirrors,
          "../../code/atlas/viz-pages [public]✎✕../../code/harbor/viz-pages [private] ·unlisted ·overrides✎✕",
        );
        expect(await text(page, `${drawer(ID.tide)} .vendor-list`)).toBe("none");
      },
    );

    await viz.when("the user opens the harbor mirror's editor", async () => {
      await click(
        page,
        `${mirrors} [data-act="mirror-edit"][data-to="../../code/harbor/viz-pages"]`,
      );
    });

    await viz.then("it is prefilled from the mirror: unlisted, its title override", async () => {
      expect(
        await page.$$eval(`${edit} [data-fld]`, (els) =>
          els.map((e) =>
            e instanceof HTMLInputElement ||
            e instanceof HTMLSelectElement ||
            e instanceof HTMLTextAreaElement
              ? e.value
              : null,
          ),
        ),
      ).toEqual(["unlisted", "Harbor tides", "", ""]);
    });

    await viz.when("they list it and change its title", async () => {
      await page.select(`${edit} [data-fld="m-listed"]`, "listed");
      await typeInto(page, `${edit} [data-fld="m-title"]`, "Tides at the harbor");
      await click(page, `${edit} [data-act="mirror-save"]`);
    });

    await viz.then(
      "every field goes to api/mirror, the editor closes and the list shows it listed",
      async () => {
        expect((await nthCall(page, "POST mirror")).body).toEqual({
          id: ID.tide,
          sub: "update",
          to: "../../code/harbor/viz-pages",
          listed: "listed",
          title: "Tides at the harbor",
          description: "",
          tags: "",
        });
        await statusIs(page, ID.tide, "mirror update: ../../code/harbor/viz-pages");
        expect(await page.$eval(edit, (e) => e.innerHTML)).toBe("");
        await textIs(
          page,
          mirrors,
          "../../code/atlas/viz-pages [public]✎✕../../code/harbor/viz-pages [private] ·overrides✎✕",
        );
      },
    );

    await viz.when("they remove the atlas mirror: once, then again to confirm", async () => {
      await click(page, `${mirrors} [data-act="mirror-rm"][data-to="../../code/atlas/viz-pages"]`);
      expect(
        await text(page, `${mirrors} [data-act="mirror-rm"][data-to="../../code/atlas/viz-pages"]`),
      ).toBe("✓?");
      await statusIs(page, ID.tide, "click ✕ again to confirm");
      await click(page, `${mirrors} [data-act="mirror-rm"][data-to="../../code/atlas/viz-pages"]`);
    });

    await viz.then("it is removed", async () => {
      expect((await nthCall(page, "POST mirror", 2)).body).toEqual({
        id: ID.tide,
        sub: "rm",
        to: "../../code/atlas/viz-pages",
      });
      await statusIs(page, ID.tide, "mirror rm: ../../code/atlas/viz-pages");
      await textIs(page, mirrors, "../../code/harbor/viz-pages [private] ·overrides✎✕");
    });

    await viz.when("they add a private mirror into atlas", async () => {
      await page.select(`${drawer(ID.tide)} [data-fld="to"]`, ATLAS);
      await page.select(`${drawer(ID.tide)} [data-fld="access"]`, "private");
      await click(page, act(ID.tide, "mirror-add"));
    });

    await viz.then("it is added and listed", async () => {
      expect((await nthCall(page, "POST mirror", 3)).body).toEqual({
        id: ID.tide,
        sub: "add",
        to: ATLAS,
        access: "private",
      });
      await statusIs(page, ID.tide, `mirror add: ${ATLAS}`);
      await textIs(
        page,
        mirrors,
        `../../code/harbor/viz-pages [private] ·overrides✎✕${ATLAS} [private]✎✕`,
      );
    });
  });

  it.concurrent("should show a refused mirror add, update or removal", async () => {
    const page = await viz.given(
      "api/mirror refuses everything, an update without saying why",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST mirror": (call, l) =>
              call.body.sub === "rm"
                ? fail("refused: the sink has uncommitted changes")(call, l)
                : call.body.sub === "add"
                  ? fail("refused: atlas is not a git repo")(call, l)
                  : fail("")(call, l),
          },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.tide);
        await textIs(p, `${drawer(ID.tide)} .mirror-list`, "../../code/atlas/viz-pages [public]✎✕");
        return p;
      },
    );

    await viz.when("the user adds a mirror", async () => {
      await click(page, act(ID.tide, "mirror-add"));
    });

    await viz.then("the refusal shows", async () => {
      await statusIs(page, ID.tide, "refused: atlas is not a git repo");
    });

    await viz.when("they save the atlas mirror's editor", async () => {
      await click(page, `${drawer(ID.tide)} [data-act="mirror-edit"]`);
      await click(page, `${drawer(ID.tide)} [data-act="mirror-save"]`);
    });

    await viz.then('"failed", and the editor stays open', async () => {
      await statusIs(page, ID.tide, "failed");
      expect(
        await page.$(`${drawer(ID.tide)} .mirror-edit [data-act="mirror-save"]`),
      ).not.toBeNull();
    });

    await viz.when("they remove it and that is refused", async () => {
      await click(page, `${drawer(ID.tide)} [data-act="mirror-rm"]`);
      await click(page, `${drawer(ID.tide)} [data-act="mirror-rm"]`);
    });

    await viz.then("the refusal shows, and the mirror stays", async () => {
      await statusIs(page, ID.tide, "refused: the sink has uncommitted changes");
      expect(calls(page, "GET mirrors").length).toBe(1);
    });
  });

  it.concurrent("should vendor a full copy into another repo on a confirming click, and undeclare one", async () => {
    const page = await viz.given(
      "River poster (private) and Garden planner (vendored into harbor)",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST vendor": ({ body: { id = "", to = "" } }, l) => {
              (l.vendors[id] ??= []).push({ to, access: "private" });
              return { ok: true, out: `vendored → ${to}`, err: "" };
            },
            "POST vendor-rm": ({ body: { id = "" } }, l) => {
              l.vendors[id] = [];
              return { ok: true, out: "", err: "" };
            },
          },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.river);
        await textIs(p, `${drawer(ID.river)} .vendor-list`, "none");
        return p;
      },
    );

    await viz.when('the user picks harbor and clicks "copy as private"', async () => {
      expect(await text(page, act(ID.river, "vendor-add"))).toBe("copy as private");
      await page.select(`${drawer(ID.river)} [data-fld="vto"]`, HARBOR);
      await click(page, act(ID.river, "vendor-add"));
    });

    await viz.then("it says what a copy writes, and waits for a second click", async () => {
      await statusIs(
        page,
        ID.river,
        "click again to copy as private — writes a full copy + a pre-commit guard into the sink repo",
      );
      expect(calls(page, "POST vendor")).toEqual([]);
    });

    await viz.when("they click again", async () => {
      await click(page, act(ID.river, "vendor-add"));
    });

    await viz.then("api/vendor copies it, and the copy is listed", async () => {
      expect((await nthCall(page, "POST vendor")).body).toEqual({ id: ID.river, to: HARBOR });
      await statusIs(page, ID.river, `vendored → ${HARBOR}`);
      await textIs(page, `${drawer(ID.river)} .vendor-list`, `${HARBOR} [private]✕`);
    });

    await viz.when(
      "they open Garden planner and remove its harbor copy: once, then to confirm",
      async () => {
        await openDrawer(page, ID.garden);
        await textIs(
          page,
          `${drawer(ID.garden)} .vendor-list`,
          "../../code/harbor/viz-pages [local]✕",
        );
        await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);
        await statusIs(
          page,
          ID.garden,
          "click ✕ again to confirm — undeclares the copy; it is pruned on the next publish --push-vendors",
        );
        await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);
      },
    );

    await viz.then("it is undeclared", async () => {
      expect((await nthCall(page, "POST vendor-rm")).body).toEqual({
        id: ID.garden,
        to: "../../code/harbor/viz-pages",
      });
      await statusIs(page, ID.garden, "vendor removed");
      await textIs(page, `${drawer(ID.garden)} .vendor-list`, "none");
    });
  });

  it.concurrent("should show a refused vendor copy or removal", async () => {
    const page = await viz.given("api/vendor and api/vendor-rm refuse, one silently", async () => {
      const p = await open({
        hash: "dashboard",
        stubs: { "POST vendor": ok(""), "POST vendor-rm": fail("refused: dirty tree") },
      });
      await dashboardReady(p);
      await openDrawer(p, ID.garden);
      return p;
    });

    await viz.when("the user removes the copy", async () => {
      await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);
      await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);
    });

    await viz.then("the refusal shows", async () => {
      await statusIs(page, ID.garden, "refused: dirty tree");
    });

    await viz.when("they vendor it and the CLI says nothing", async () => {
      await click(page, act(ID.garden, "vendor-add"));
      await click(page, act(ID.garden, "vendor-add"));
    });

    await viz.then('"vendored"', async () => {
      await statusIs(page, ID.garden, "vendored");
    });
  });

  it.concurrent("should re-sync a vendored copy from its origin, from the copy's own drawer", async () => {
    const page = await viz.given(
      "the harbor copy of Garden planner, and api/vendor-sync",
      async () => {
        const p = await open({ hash: "dashboard", stubs: { "POST vendor-sync": ok("") } });
        await dashboardReady(p);
        return p;
      },
    );

    await viz.when("the user opens the origin's drawer", async () => {
      await openDrawer(page, ID.garden);
    });

    await viz.then("it has no re-sync: there is nothing to pull from", async () => {
      expect(await page.$(act(ID.garden, "vendor-sync"))).toBeNull();
    });

    await viz.when("they open the copy's drawer", async () => {
      await openDrawer(page, ID.gardenCopy);
    });

    await viz.then("it offers re-sync", async () => {
      expect(await text(page, act(ID.gardenCopy, "vendor-sync"))).toBe("re-sync");
    });

    await viz.when("they click it, once and again to confirm", async () => {
      await click(page, act(ID.gardenCopy, "vendor-sync"));
      await statusIs(
        page,
        ID.gardenCopy,
        "click re-sync again to confirm — overwrites this copy from its origin",
      );
      await click(page, act(ID.gardenCopy, "vendor-sync"));
    });

    await viz.then("api/vendor-sync re-pulls it", async () => {
      expect((await nthCall(page, "POST vendor-sync")).body).toEqual({ id: ID.gardenCopy });
      await statusIs(page, ID.gardenCopy, "re-synced");
    });
  });

  it.concurrent("should show a refused re-sync", async () => {
    const page = await viz.given("api/vendor-sync refuses", async () => {
      const p = await open({
        hash: "dashboard",
        stubs: { "POST vendor-sync": fail("refused: the copy has local edits") },
      });
      await dashboardReady(p);
      await openDrawer(p, ID.gardenCopy);
      return p;
    });

    const gitBefore = await viz.when("the user confirms a re-sync", async () => {
      const before = calls(page, "GET slugs-git").length; // (slugs are refetched every 5s anyway; the git feed only after a write)
      await click(page, act(ID.gardenCopy, "vendor-sync"));
      await click(page, act(ID.gardenCopy, "vendor-sync"));
      return before;
    });

    await viz.then("the refusal shows, and nothing is refetched", async () => {
      await statusIs(page, ID.gardenCopy, "refused: the copy has local edits");
      await page.waitForNetworkIdle({ idleTime: 150 });
      expect(calls(page, "GET slugs-git").length).toBe(gitBefore);
    });
  });

  it.concurrent("should say the copies are unknown when the lists can't be read", async () => {
    const page = await viz.given("api/mirrors fails at the network", async () => {
      const p = await open({ hash: "dashboard", stubs: { "GET mirrors": () => netError() } });
      await dashboardReady(p);
      return p;
    });

    await viz.when("the user opens Tide clock's drawer", async () => {
      await openDrawer(page, ID.tide);
    });

    await viz.then("the mirror list reads as none, the vendor list is still read", async () => {
      await textIs(page, `${drawer(ID.tide)} .mirror-list`, "none");
      await textIs(page, `${drawer(ID.tide)} .vendor-list`, "none");
    });
  });

  it.concurrent("should let a viz that a change filters out of the list go, drawer and all", async () => {
    const page = await viz.given(
      "the list filtered to private vizzes, River poster's drawer open",
      async () => {
        const p = await open({
          hash: "dashboard&posture=private",
          stubs: { "POST update": update },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.river);
        return p;
      },
    );

    await viz.when("the user makes it public", async () => {
      await click(page, act(ID.river, "axis", '[data-axis="posture"][data-val="public"]'));
      await nthCall(page, "GET mirrors", 2);
    });

    await viz.then("it leaves the filtered list, and the page carries on without it", async () => {
      await page.waitForFunction((sel) => !document.querySelector(sel), {}, row(ID.river));
      await page.waitForNetworkIdle({ idleTime: 100 });
      expect(await rowTitles(page)).toEqual(["Harbor map", "Atlas exchange"]);
      expect(page.errors).toEqual([]);
    });
  });
});

describe("rendering a viz to video", () => {
  it.concurrent("should start a render, show its progress and warnings, then the file it wrote", async () => {
    const { page, line } = await viz.given(
      "api/render: a job that runs for two polls, halfway at the second, then is done",
      async () => {
        let polls = 0;
        const job = {
          id: "job-1",
          state: "running",
          frame: 0,
          frames: 0,
          warnings: [] as string[],
        };
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST render": (call, l) => {
              if (call.body.action === "start") return { ok: true, out: "", job: { ...job } };
              polls++;
              if (polls === 1) return fail("render status: busy")(call, l); // a status read can fail; the poll carries on
              if (polls === 2)
                return {
                  ok: true,
                  out: "",
                  job: { ...job, frame: 50, frames: 100, warnings: ["no narration.json"] },
                };
              return {
                ok: true,
                out: "",
                job: {
                  ...job,
                  state: "done",
                  frame: 100,
                  frames: 100,
                  out: "/tmp/tide-clock.mp4",
                  warnings: ["no narration.json"],
                },
              };
            },
          },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.tide);
        return { page: p, line: `${drawer(ID.tide)} .render-state` };
      },
    );

    await viz.when("the user clicks render mp4", async () => {
      await click(page, act(ID.tide, "render"));
    });

    await viz.then("a render starts and shows as running, cancellable", async () => {
      expect((await nthCall(page, "POST render")).body).toEqual({ action: "start", id: ID.tide });
      await textIs(page, line, "rendering ✕");
    });

    await viz.when("they click render again while it runs", async () => {
      await click(page, act(ID.tide, "render"));
    });

    await viz.then(
      "the progress and the warning show, and at the end the file it wrote",
      async () => {
        await textIs(page, line, "rendering 50% ✕ · ⚠ no narration.json", 6000);
        await textIs(page, line, "✓ /tmp/tide-clock.mp4 · ⚠ no narration.json", 6000);
        expect(calls(page, "POST render")[1]!.body).toEqual({ action: "status", job: "job-1" });
      },
    );
    await viz.then("no second render started", () => {
      expect(calls(page, "POST render").filter((c) => c.body.action === "start").length).toBe(1);
    });
  });

  it.concurrent("should cancel a render, keep its line across closing the drawer, and show a failed one's error", async () => {
    const { page, line } = await viz.given(
      "api/render: Tide clock's job runs until cancelled; Orbit deck's fails",
      async () => {
        let cancelled = false;
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST render": ({ body }) => {
              if (body.action === "start" && body.id === ID.orbit)
                return {
                  ok: true,
                  out: "",
                  job: {
                    id: "job-2",
                    state: "error",
                    frame: 0,
                    frames: 0,
                    error: "no window.__viz.timeline",
                    log: "/tmp/job-2.log",
                  },
                };
              if (body.action === "cancel") cancelled = true;
              if (cancelled)
                return {
                  ok: true,
                  out: "",
                  job: {
                    id: "job-1",
                    state: "cancelled",
                    frame: 1,
                    frames: 4,
                    log: "/tmp/job-1.log",
                  },
                };
              if (body.action === "start")
                return {
                  ok: true,
                  out: "",
                  job: { id: "job-1", state: "running", frame: 1, frames: 4 },
                };
              return {
                ok: true,
                out: "",
                job: { id: "job-1", state: "running", frame: 1, frames: 4 },
              };
            },
          },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.tide);
        const renderLine = `${drawer(ID.tide)} .render-state`;
        await click(p, act(ID.tide, "render"));
        await textIs(p, renderLine, "rendering 25% ✕");
        return { page: p, line: renderLine };
      },
    );

    await viz.when("the user closes the drawer mid-render and opens it again", async () => {
      await click(page, `${row(ID.tide)} [data-act="toggle"]`);
      await nthCall(page, "POST render", 2, 4000);
      await openDrawer(page, ID.tide);
    });

    await viz.then("the render's line is still there", async () => {
      expect(await text(page, line)).toBe("rendering 25% ✕");
    });

    await viz.when("they cancel it", async () => {
      await click(page, `${line} [data-act="render-cancel"]`);
    });

    await viz.then(
      "the cancel is sent for that job, and the line says it was cancelled, with its log",
      async () => {
        expect(calls(page, "POST render").find((c) => c.body.action === "cancel")!.body).toEqual({
          action: "cancel",
          job: "job-1",
        });
        await textIs(page, line, "cancelled (log)", 4000);
        expect(await page.$eval(`${line} span[title]`, (e) => e.getAttribute("title"))).toBe(
          "/tmp/job-1.log",
        );
      },
    );

    await viz.when("they render Orbit deck, which has no timeline", async () => {
      await openDrawer(page, ID.orbit);
      await click(page, act(ID.orbit, "render"));
    });

    await viz.then("its line says why it failed", async () => {
      await textIs(
        page,
        `${drawer(ID.orbit)} .render-state`,
        "error: no window.__viz.timeline (log)",
      );
    });
  });

  it.concurrent("should show a render that could not start", async () => {
    const page = await viz.given(
      "api/render refuses to start, and a cancel of an unknown job answers no job",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: { "POST render": fail("render: chrome not found") },
        });
        await dashboardReady(p);
        await openDrawer(p, ID.tide);
        return p;
      },
    );

    await viz.when("the user clicks render mp4", async () => {
      await click(page, act(ID.tide, "render"));
    });

    await viz.then("the drawer shows why, and no job line appears", async () => {
      await statusIs(page, ID.tide, "render: chrome not found");
      expect(await text(page, `${drawer(ID.tide)} .render-state`)).toBe("");
    });
  });
});

describe("a viz's history", () => {
  it.concurrent("should list the commits touching a viz and restore one on a confirming click", async () => {
    const page = await viz.given("Big globe's drawer, and api/rollback", async () => {
      const p = await open({
        hash: "dashboard",
        stubs: { "POST rollback": ok("restored big-globe to e5f6a7b\n2 files") },
      });
      await dashboardReady(p);
      await openDrawer(p, ID.globe);
      return p;
    });

    await viz.when("the user opens its history", async () => {
      await click(page, `${drawer(ID.globe)} summary[data-act="history"]`);
    });

    await viz.then("each commit is listed by short hash, age and subject", async () => {
      await page.waitForSelector(`${drawer(ID.globe)} .hist-row`);
      expect(
        await page.$$eval(`${drawer(ID.globe)} .hist-row`, (els) =>
          els.map((e) => [...e.children].slice(0, 3).map((c) => c.textContent)),
        ),
      ).toEqual([
        ["e5f6a7b", "6h", "big-globe: latest edit"],
        ["f6a7b8c", "1mo", "create viz: big-globe"],
      ]);
    });

    await viz.when("they click restore on the latest, once, then again", async () => {
      await click(page, `${drawer(ID.globe)} [data-act="rollback"]`);
      await statusIs(
        page,
        ID.globe,
        "click restore again to roll this viz back to e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
      );
      expect(calls(page, "POST rollback")).toEqual([]);
      await click(page, `${drawer(ID.globe)} [data-act="rollback"]`);
    });

    await viz.then(
      "api/rollback restores that commit, the drawer says so, and the history is read again",
      async () => {
        expect((await nthCall(page, "POST rollback")).body).toEqual({
          id: ID.globe,
          commit: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
        });
        await statusIs(page, ID.globe, "restored big-globe to e5f6a7b");
        await nthCall(page, "GET history", 2);
      },
    );

    await viz.when("they open the history again, and close it", async () => {
      await click(page, `${drawer(ID.globe)} summary[data-act="history"]`);
      await nthCall(page, "GET history", 3);
      await click(page, `${drawer(ID.globe)} summary[data-act="history"]`);
    });

    await viz.then("opening reads it afresh; closing does not", async () => {
      await page.waitForNetworkIdle({ idleTime: 100 });
      expect(calls(page, "GET history").length).toBe(3);
      expect(await page.$eval(`${drawer(ID.globe)} details.hist`, (e) => e.open)).toBe(false);
    });
  });

  it.concurrent("should say when a viz has no history, or it can't be read", async () => {
    const history = await viz.given(
      "River poster with no commits, loose-sketch unknown to git, and api/history failing for Tide clock",
      async () => {
        const p = await open({
          hash: "dashboard",
          lib: (l) => {
            l.history[ID.river] = [];
            Reflect.deleteProperty(l.history, ID.loose);
          },
          stubs: {
            "GET history": ({ query }, l) =>
              query.id === ID.tide
                ? netError()
                : l.history[query.id!]
                  ? { ok: true, commits: l.history[query.id!] }
                  : reply(404, { ok: false, err: "unknown viz id" }),
          },
        });
        await dashboardReady(p);
        return async (id: string) => {
          await openDrawer(p, id);
          await click(p, `${drawer(id)} summary[data-act="history"]`);
          await p.waitForFunction(
            (sel) => document.querySelector(sel)!.textContent !== "…",
            {},
            `${drawer(id)} .hist-rows`,
          );
          return text(p, `${drawer(id)} .hist-rows`);
        };
      },
    );

    const reads = await viz.when("the user opens each one's history", async () => {
      const river = await history(ID.river);
      const loose = await history(ID.loose);
      const tide = await history(ID.tide);
      return { river, loose, tide };
    });

    await viz.then("each says why there is nothing to restore", () => {
      expect(reads.river).toBe("no commits touching this viz");
      expect(reads.loose).toBe("unknown viz id");
      expect(reads.tide).toBe("no history");
    });
  });

  it.concurrent("should show a refused restore, and carry on when the restored viz leaves the filtered list", async () => {
    const { page, restore } = await viz.given(
      "the list filtered to public vizzes; api/rollback refuses Tide clock, and restores Big globe to a private version",
      async () => {
        const p = await open({
          hash: "dashboard&posture=public",
          stubs: {
            "POST rollback": (call, l) => {
              if (call.body.id === ID.tide) return fail("refused: uncommitted changes")(call, l);
              l.slugs.find((s) => s.id === call.body.id)!.posture = "private";
              return { ok: true, out: "", err: "" };
            },
          },
        });
        await dashboardReady(p);
        const restoreOf = async (id: string) => {
          await openDrawer(p, id);
          await click(p, `${drawer(id)} summary[data-act="history"]`);
          await p.waitForSelector(`${drawer(id)} [data-act="rollback"]`);
          await click(p, `${drawer(id)} [data-act="rollback"]`);
          await click(p, `${drawer(id)} [data-act="rollback"]`);
        };
        return { page: p, restore: restoreOf };
      },
    );

    await viz.when("the user restores Tide clock", async () => {
      await restore(ID.tide);
    });

    await viz.then("the refusal shows", async () => {
      await statusIs(page, ID.tide, "refused: uncommitted changes");
    });

    await viz.when("they restore Big globe", async () => {
      await restore(ID.globe);
    });

    await viz.then("it leaves the list, and nothing breaks", async () => {
      await page.waitForFunction((sel) => !document.querySelector(sel), {}, row(ID.globe));
      await page.waitForNetworkIdle({ idleTime: 100 });
      expect(page.errors).toEqual([]);
    });
  });
});

describe("a new viz from a template", () => {
  it.concurrent("should open the drawer at 'new from this' from the template badge, and create the viz in a new tab", async () => {
    const page = await viz.given(
      "Orbit deck, a deck template, and api/create; a new tab is recorded rather than opened",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "POST create": ({ body: { slug = "" } }, l) => {
              l.slugs.push(makeViz(slug, { title: "", kind: "deck", ageMs: 1000 }));
              return { ok: true, out: "", id: `.agents/state/viz/${slug}` };
            },
          },
        });
        await dashboardReady(p);
        await ownTabs(p);
        return p;
      },
    );

    await viz.when('the user clicks its "deck template" badge', async () => {
      await click(page, `${row(ID.orbit)} [data-act="from-open"]`);
    });

    await viz.then("its drawer opens with the new slug box focused", async () => {
      await page.waitForSelector(drawer(ID.orbit));
      expect(
        await page.evaluate(() =>
          document.activeElement instanceof HTMLElement
            ? document.activeElement.dataset.fld
            : undefined,
        ),
      ).toBe("newSlug");
    });

    await viz.when("they click create with no slug", async () => {
      await click(page, act(ID.orbit, "create-from"));
    });

    await viz.then("it asks for one", async () => {
      await statusIs(page, ID.orbit, "slug required");
    });

    await viz.when("they click the badge again, type a slug and create", async () => {
      await click(page, `${row(ID.orbit)} [data-act="from-open"]`);
      await page.keyboard.type("my-talk");
      await click(page, act(ID.orbit, "create-from"));
    });

    await viz.then(
      "api/create makes it from the template, the new tab goes to it, the drawer closes and it is listed",
      async () => {
        expect((await nthCall(page, "POST create")).body).toEqual({
          from: ID.orbit,
          slug: "my-talk",
        });
        await page.waitForFunction(() => window.tabs[0]!.location !== "");
        expect(await tabs(page)).toEqual([["/.agents/state/viz/my-talk/", false]]);
        await page.waitForSelector(row(ID.orbit.replace("orbit-deck", "my-talk")));
        expect(await page.$(".slug-drawer")).toBeNull();
      },
    );
  });

  it.concurrent("should close the new tab and say why when the viz can't be made", async () => {
    const page = await viz.given(
      "api/create refuses, and a browser that blocks the new tab for the second try",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: { "POST create": fail("refused: my-talk already exists") },
        });
        await dashboardReady(p);
        await ownTabs(p, { blockAfter: 1 });
        await openDrawer(p, ID.starter);
        return p;
      },
    );

    await viz.when('the user creates "my-talk"', async () => {
      await page.type(`${drawer(ID.starter)} [data-fld="newSlug"]`, "my-talk");
      await click(page, act(ID.starter, "create-from"));
    });

    await viz.then("the tab opened for it is closed again, and the drawer says why", async () => {
      await statusIs(page, ID.starter, "refused: my-talk already exists");
      expect(await tabs(page)).toEqual([["", true]]);
    });

    await viz.when("they try again with the popup blocked", async () => {
      await click(page, act(ID.starter, "create-from"));
      await nthCall(page, "POST create", 2);
    });

    await viz.then("the same, without a tab to close", async () => {
      await statusIs(page, ID.starter, "refused: my-talk already exists");
      expect(page.errors).toEqual([]);
    });
  });
});

describe("rows the api describes sparsely", () => {
  it.concurrent("should still say what a build-mirror sink is, and title a thumbnail with no description", async () => {
    const page = await viz.given(
      "a viz carrying a .mirror.json (a build-mirror sink: mirrored in, origin not named), and one with an OG image but no description",
      async () => {
        const p = await open({
          hash: "dashboard",
          lib: (l) => {
            Object.assign(
              l.slugs.find((s) => s.id === ID.harborMap)!,
              { mirroredIn: true, mirrorFrom: undefined },
            );
            Object.assign(
              l.slugs.find((s) => s.id === ID.river)!,
              { og: "og.auto.png" },
            );
          },
        });
        await dashboardReady(p);
        return p;
      },
    );

    await viz.when("the page has loaded");

    await viz.then(
      "the sink says it is a mirrored-in copy, and can't be managed from here",
      async () => {
        expect(
          await page.$eval(`${row(ID.harborMap)} .mirror-on`, (e) => e.getAttribute("title")),
        ).toBe("mirrored-in copy from  — edit the origin viz, not this sink");
        expect(await page.$(`${row(ID.harborMap)} button.manage-btn`)).toBeNull();
      },
    );
    await viz.then("the thumbnail is titled by its file", async () => {
      expect(await page.$eval(`${row(ID.river)} .slug-thumb`, (e) => e.getAttribute("title"))).toBe(
        "OG preview (og.auto.png)",
      );
    });
  });
});
