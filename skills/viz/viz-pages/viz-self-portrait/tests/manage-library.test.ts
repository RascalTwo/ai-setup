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
  viz,
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
    // GIVEN River poster's drawer open, api/update standing in for the CLI
    const page = await open({ hash: "dashboard", stubs: { "POST update": update } });
    await dashboardReady(page);
    await openDrawer(page, ID.river);

    // WHEN the user makes it public
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

    // THEN the page asked for exactly that change
    expect((await nthCall(page, "POST update")).body).toEqual({ id: ID.river, posture: "public" });
    // THEN the row reads public, the drawer is still open on public, and it still says what the CLI did, as a success
    expect(await text(page, `${row(ID.river)} .axis`)).toBe("public");
    expect(await lit(page, ID.river, "posture")).toEqual(["public"]);
    expect(await status(page, ID.river)).toEqual({
      text: "river-poster: posture → public",
      ok: true,
      err: false,
    });
  });

  it.concurrent("should set listed, approval and the card from the drawer, each labelled with its state", async () => {
    // GIVEN the drawers of River poster (unlisted), Orbit deck (changed since approval) and Atlas weekly
    // metrics (card changed since it was reviewed)
    const page = await open({ hash: "dashboard", stubs: { "POST update": update } });
    await dashboardReady(page);
    await openDrawer(page, ID.river);
    expect(await lit(page, ID.river, "listed")).toEqual(["unlisted"]);
    expect(await axisLabel(page, ID.river, "approved")).toBe("not approved");
    expect(await axisLabel(page, ID.river, "card-public")).toBe("🪪 card not public");
    expect(await lit(page, ID.river, "card-public")).toEqual(["card is not public"]);

    // WHEN the user lists River poster
    await click(page, act(ID.river, "axis", '[data-axis="listed"][data-val="listed"]'));

    // THEN api/update is asked to list it, and the drawer shows it listed
    expect((await nthCall(page, "POST update")).body).toEqual({ id: ID.river, listed: "listed" });
    await statusIs(page, ID.river, "river-poster: listed → listed");
    await textIs(page, `${drawer(ID.river)} .dg-b.on[data-axis="listed"]`, "listed");

    // WHEN they open Orbit deck, which changed since it was approved, and re-approve it
    await openDrawer(page, ID.orbit);
    expect(await page.$(drawer(ID.river))).toBeNull(); // one drawer at a time
    expect(await axisLabel(page, ID.orbit, "approved")).toBe("⚠ changed since approval");
    expect(await text(page, act(ID.orbit, "axis", '[data-val="true"][data-axis="approved"]'))).toBe(
      "re-approve this version",
    );
    await click(page, act(ID.orbit, "axis", '[data-axis="approved"][data-val="true"]'));

    // THEN it reads approved
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

    // WHEN they open Atlas weekly metrics, whose card changed since review, and make the card public
    await openDrawer(page, ID.metrics);
    expect(await axisLabel(page, ID.metrics, "card-public")).toBe(
      "⚠ card changed since reviewed (was not public)",
    );
    expect(await lit(page, ID.metrics, "card-public")).toEqual([]);
    await click(page, act(ID.metrics, "axis", '[data-axis="card-public"][data-val="true"]'));

    // THEN the card is public, and as a public viz outside a lobby it gets a share page (no note says otherwise)
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
  });

  it.concurrent("should say when a public card gets no share page, and why", async () => {
    // GIVEN Big globe's card made public while the viz itself is local, and Harbor timeline's in a lobby
    const page = await open({
      hash: "dashboard",
      lib: (l) => {
        Object.assign(
          l.slugs.find((s) => s.name === "big-globe")!,
          { cardPublic: "public", posture: "local" },
        );
      },
    });
    await dashboardReady(page);

    // WHEN the user opens each drawer
    await openDrawer(page, ID.globe);
    const globe = await page.$$eval(`${drawer(ID.globe)} .mz`, (els) =>
      els.map((e) => e.textContent),
    );
    await openDrawer(page, ID.timeline);
    const timeline = await page.$$eval(`${drawer(ID.timeline)} .mz`, (els) =>
      els.map((e) => e.textContent),
    );

    // THEN each says why there is no share page
    expect(globe).toContain("no share page: posture is local — only public vizzes get one");
    expect(timeline).toContain(
      "no share page: this container has a private lobby — its lobby shim carries the card instead",
    );
  });

  it.concurrent("should show a write the CLI refused as an error, and not refresh", async () => {
    // GIVEN api/update refuses: Atlas weekly metrics is linked from elsewhere
    const page = await open({
      hash: "dashboard",
      stubs: { "POST update": fail("refused: linked from a team wiki page (ADR 0016)") },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.metrics);

    // WHEN the user makes it private
    const gitBefore = calls(page, "GET slugs-git").length; // (slugs are refetched every 5s anyway; the git feed only after a write)
    await click(page, act(ID.metrics, "axis", '[data-axis="posture"][data-val="private"]'));

    // THEN the drawer shows the refusal as an error, the posture is unchanged, and nothing was refetched
    await statusIs(page, ID.metrics, "refused: linked from a team wiki page (ADR 0016)");
    expect(await status(page, ID.metrics)).toMatchObject({ ok: false, err: true });
    expect(await lit(page, ID.metrics, "posture")).toEqual(["public"]);
    await page.waitForNetworkIdle({ idleTime: 150 });
    expect(calls(page, "GET slugs-git").length).toBe(gitBefore);
  });

  for (const [how, shown] of [
    ["api error: git exited 128", "api error: git exited 128"],
    ["", "HTTP 500"],
    ["net", "TypeError: Failed to fetch"],
  ] satisfies [string, string][]) {
    it.concurrent(`should show why a write failed when the server answers ${how === "net" ? "nothing" : how ? "its error page" : "an empty 500"}`, async () => {
      // GIVEN api/update fails that way
      const page = await open({
        hash: "dashboard",
        stubs: { "POST update": () => (how === "net" ? netError() : textReply(500, how)) },
      });
      await dashboardReady(page);
      await openDrawer(page, ID.river);

      // WHEN the user lists River poster
      await click(page, act(ID.river, "axis", '[data-axis="listed"][data-val="listed"]'));

      // THEN the drawer shows the reason, as an error
      await statusIs(page, ID.river, shown);
      expect(await status(page, ID.river)).toMatchObject({ err: true });
    });
  }

  it.concurrent("should fall back to a plain word when the CLI succeeds silently, or fails without a reason", async () => {
    // GIVEN api/update succeeds with no output, and api/move fails with no message
    const page = await open({
      hash: "dashboard",
      stubs: { "POST update": ok(""), "POST move": fail("") },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.river);

    // WHEN the user approves River poster, THEN the drawer says "updated"
    await click(page, act(ID.river, "axis", '[data-axis="approved"][data-val="true"]'));
    await statusIs(page, ID.river, "updated");

    // WHEN they save its title, THEN "saved"
    await click(page, act(ID.river, "meta-save"));
    await statusIs(page, ID.river, "saved");

    // WHEN they rename it and the CLI fails without saying why, THEN "failed", as an error
    await click(page, act(ID.river, "rename"));
    await statusIs(page, ID.river, "failed");
    expect(await status(page, ID.river)).toMatchObject({ err: true });
  });

  it.concurrent("should not show a slow write's answer in the drawer the user moved on to", async () => {
    // GIVEN api/update slow to answer for River poster
    let answer!: () => void;
    const answered = new Promise<void>((r) => {
      answer = r;
    });
    const page = await open({
      hash: "dashboard",
      stubs: {
        "POST update": async (c, l) => {
          await answered;
          return update(c, l);
        },
      },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.river);

    // WHEN the user lists River poster, and opens Big globe's drawer before the answer comes
    await click(page, act(ID.river, "axis", '[data-axis="listed"][data-val="listed"]'));
    await nthCall(page, "POST update");
    await openDrawer(page, ID.globe);
    answer();

    // THEN once the list has refreshed, Big globe's drawer says nothing of River poster's change
    await nthCall(page, "GET slugs-git", 2);
    await textIs(page, `${row(ID.river)} .slug-axes`, "private🪪 card not publicposter");
    expect(await status(page, ID.globe)).toEqual({ text: "", ok: false, err: false });
  });

  it.concurrent("should leave the drawer's typed text alone on the 5s refresh, and show the refreshed viz once closed", async () => {
    // GIVEN Big globe's drawer open with a title half typed
    const page = await open({ hash: "dashboard" });
    await dashboardReady(page);
    await openDrawer(page, ID.globe);
    await typeInto(page, `${drawer(ID.globe)} [data-fld="title"]`, "Big glo");

    // WHEN the viz is retitled elsewhere and a refresh passes
    page.api.lib.slugs.find((s) => s.id === ID.globe)!.title = "Globe (edited elsewhere)";
    // The band is written in the same breath as the page keeping the new list, so it is the
    // signal that the refresh landed (a recorded request, even an idle network, is not: a loaded
    // browser can still be parsing the answer).
    const containers = ++page.api.lib.server.containers;
    await textIs(page, "#server-containers b", String(containers), 10_000);

    // THEN the typed text is still there, and the row not yet redrawn
    expect(
      await page.$eval(`${drawer(ID.globe)} [data-fld="title"]`, (e) =>
        e instanceof HTMLInputElement ? e.value : null,
      ),
    ).toBe("Big glo");
    expect(await text(page, `${row(ID.globe)} .slug-name`)).toBe("centralBig globe");

    // WHEN the user closes the drawer
    await click(page, `${row(ID.globe)} [data-act="toggle"]`);

    // THEN the row shows the new title, and the drawer is gone
    expect(await text(page, `${row(ID.globe)} .slug-name`)).toBe("centralGlobe (edited elsewhere)");
    expect(await page.$(drawer(ID.globe))).toBeNull();
  });
});

describe("editing a viz's words", () => {
  it.concurrent("should save title, description and tags, the tags edited as chips", async () => {
    // GIVEN Big globe's drawer: tags maps and 3d
    const page = await open({ hash: "dashboard", stubs: { "POST update": update } });
    await dashboardReady(page);
    await openDrawer(page, ID.globe);
    const chips = async (): Promise<(string | undefined)[]> => {
      const tags = await page.$$eval(`${drawer(ID.globe)} .chip`, (els) =>
        els.map((e) => (e instanceof HTMLElement ? e.dataset.tag : undefined)),
      );
      return tags;
    };
    const tag = `${drawer(ID.globe)} .tag-input`;
    expect(await chips()).toEqual(["maps", "3d"]);

    // WHEN the user retitles and describes it
    await typeInto(page, `${drawer(ID.globe)} [data-fld="title"]`, "Big globe 2");
    await typeInto(page, `${drawer(ID.globe)} [data-fld="description"]`, "Every port, spinning.");
    // WHEN they add "ports" with Enter, "sea" with a comma, "MAPS" again, an empty Enter, then remove "3d" with its ✕
    await page.type(tag, "ports");
    await page.keyboard.press("Enter");
    await page.type(tag, "sea,");
    await page.type(tag, "MAPS");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await click(page, `${drawer(ID.globe)} .chip[data-tag="3d"] [data-act="chip-rm"]`);

    // THEN each new tag is a chip, once, and the duplicate "MAPS" was not added
    expect(await chips()).toEqual(["maps", "ports", "sea"]);
    expect(await page.$eval(tag, (e) => (e instanceof HTMLInputElement ? e.value : null))).toBe("");

    // WHEN they Backspace in the empty tag box, which removes the last chip, then type "globe" without Enter and save
    await click(page, tag);
    await page.keyboard.press("Backspace");
    expect(await chips()).toEqual(["maps", "ports"]);
    await page.type(tag, "globe");
    await page.keyboard.press("ArrowLeft"); // any other key leaves the chips alone
    expect(await chips()).toEqual(["maps", "ports"]);
    await click(page, act(ID.globe, "meta-save"));

    // THEN api/update gets the new words, the typed tag included
    expect((await nthCall(page, "POST update")).body).toEqual({
      id: ID.globe,
      title: "Big globe 2",
      description: "Every port, spinning.",
      tags: "maps, ports, globe",
    });
    // THEN the row shows them
    await statusIs(page, ID.globe, "big-globe: title → Big globe 2");
    await textIs(page, `${row(ID.globe)} .slug-name`, "centralBig globe 2");
    expect(
      await page.$$eval(`${row(ID.globe)} .tag-chip`, (els) => els.map((e) => e.textContent)),
    ).toEqual(["maps", "ports", "globe"]);
  });

  it.concurrent("should not add a typed tag twice when it is already a chip", async () => {
    // GIVEN Big globe's drawer, "Maps" typed in the tag box without Enter
    const page = await open({ hash: "dashboard", stubs: { "POST update": update } });
    await dashboardReady(page);
    await openDrawer(page, ID.globe);
    await page.type(`${drawer(ID.globe)} .tag-input`, "Maps");

    // WHEN the user saves
    await click(page, act(ID.globe, "meta-save"));

    // THEN the tags are unchanged
    expect((await nthCall(page, "POST update")).body.tags).toBe("maps, 3d");
  });

  it.concurrent("should add and remove where a viz is linked from", async () => {
    // GIVEN Atlas weekly metrics, linked from "a team wiki page"
    const page = await open({ hash: "dashboard", stubs: { "POST update": update } });
    await dashboardReady(page);
    await openDrawer(page, ID.metrics);
    const links = async (): Promise<(string | null)[]> => {
      const chipTexts = await page.$$eval(`${drawer(ID.metrics)} .link-list .mchip`, (els) =>
        els.map((e) => e.firstChild!.textContent),
      );
      return chipTexts;
    };
    expect(await links()).toEqual(["a team wiki page"]);

    // WHEN the user presses add with nothing typed
    await click(page, act(ID.metrics, "link"));

    // THEN the drawer asks for an entry, and nothing is sent
    await statusIs(page, ID.metrics, "entry required");
    expect(calls(page, "POST update")).toEqual([]);

    // WHEN they add "the quarterly deck"
    await page.type(`${drawer(ID.metrics)} [data-fld="linkedFrom"]`, "the quarterly deck");
    await click(page, act(ID.metrics, "link"));

    // THEN it is sent and listed
    expect((await nthCall(page, "POST update")).body).toEqual({
      id: ID.metrics,
      "linked-from": "the quarterly deck",
    });
    await statusIs(page, ID.metrics, "atlas-metrics: linked-from → the quarterly deck");
    expect(await links()).toEqual(["a team wiki page", "the quarterly deck"]);

    // WHEN they remove both
    await click(page, act(ID.metrics, "unlink", '[data-link="a team wiki page"]'));
    await nthCall(page, "POST update", 2);
    await statusIs(page, ID.metrics, "atlas-metrics: unlinked-from → a team wiki page");
    await click(page, act(ID.metrics, "unlink", '[data-link="the quarterly deck"]'));

    // THEN the page says it is not linked, and the row's linked badge is gone
    expect((await nthCall(page, "POST update", 3)).body).toEqual({
      id: ID.metrics,
      "unlinked-from": "the quarterly deck",
    });
    await textIs(page, `${drawer(ID.metrics)} .link-list`, "not linked");
    expect(await text(page, `${row(ID.metrics)} .slug-axes`)).not.toContain("linked");
  });

  it.concurrent("should copy a viz's uid, or say it has none yet", async () => {
    // GIVEN the dashboard, with a clipboard of its own
    const page = await open({ hash: "dashboard" });
    await dashboardReady(page);
    await ownClipboard(page);
    await openDrawer(page, ID.river);
    const uid = page.api.lib.slugs.find((s) => s.id === ID.river)!.uid;

    // WHEN the user clicks River poster's uid
    await click(page, act(ID.river, "copy-uid"));

    // THEN it is on the clipboard, and the drawer says so
    await statusIs(page, ID.river, "uid copied");
    expect(await copied(page)).toEqual([uid]);

    // WHEN the clipboard refuses
    await ownClipboard(page, true);
    await click(page, act(ID.river, "copy-uid"));

    // THEN the drawer says the copy failed
    await statusIs(page, ID.river, "copy failed");
    expect(await status(page, ID.river)).toMatchObject({ err: true });

    // WHEN they open loose-sketch, which has no uid yet
    await openDrawer(page, ID.loose);

    // THEN there is nothing to copy, and the drawer says how one is made
    expect(await page.$(act(ID.loose, "copy-uid"))).toBeNull();
    expect(await text(page, `${drawer(ID.loose)} .dg-row .mz`)).toBe(
      "none yet — backfill-uids.ts mints one",
    );
  });
});

describe("renaming, moving and deleting a viz", () => {
  it.concurrent("should rename a viz, closing its drawer, and refuse an empty name", async () => {
    // GIVEN Big globe's drawer
    const page = await open({ hash: "dashboard", stubs: { "POST move": move } });
    await dashboardReady(page);
    await openDrawer(page, ID.globe);

    // WHEN the user clears the name and saves
    await typeInto(page, `${drawer(ID.globe)} [data-fld="name"]`, "");
    await click(page, act(ID.globe, "rename"));

    // THEN the drawer asks for a name, and nothing is sent
    await statusIs(page, ID.globe, "name required");
    expect(calls(page, "POST move")).toEqual([]);

    // WHEN they name it "world-globe"
    await page.type(`${drawer(ID.globe)} [data-fld="name"]`, "world-globe");
    await click(page, act(ID.globe, "rename"));

    // THEN api/move renames it, the drawer closes, and the row carries the new id
    expect((await nthCall(page, "POST move")).body).toEqual({ id: ID.globe, name: "world-globe" });
    const renamed = ID.globe.replace("big-globe", "world-globe");
    await page.waitForSelector(row(renamed));
    expect(await page.$(".slug-drawer")).toBeNull();
    expect(await rowIds(page)).not.toContain(ID.globe);
  });

  it.concurrent("should move a viz only on a confirming second click, and disarm if that click never comes", async () => {
    // GIVEN Big globe's drawer, with the move destinations the library's other containers
    const page = await open({ hash: "dashboard", realDisarm: true, stubs: { "POST move": move } });
    await dashboardReady(page);
    await openDrawer(page, ID.globe);
    expect(
      await page.$$eval(`${drawer(ID.globe)} [data-fld="toContainer"] option`, (os) =>
        os.map((o) => [o.value, o.textContent]),
      ),
    ).toEqual([
      [ATLAS, "code/atlas/viz-pages"],
      [HARBOR, "code/harbor/viz-pages"],
    ]);
    await page.select(`${drawer(ID.globe)} [data-fld="toContainer"]`, HARBOR);

    // WHEN the user clicks move once
    await click(page, act(ID.globe, "move"));

    // THEN it asks for confirmation, and nothing is sent
    expect(await text(page, act(ID.globe, "move"))).toBe("confirm?");
    await statusIs(page, ID.globe, "click move again to confirm");
    expect(calls(page, "POST move")).toEqual([]);

    // WHEN they wait, not confirming
    await textIs(page, act(ID.globe, "move"), "move", 4000);

    // THEN the button and the drawer are back as they were, the destination still the one picked
    expect(await status(page, ID.globe)).toEqual({ text: "", ok: false, err: false });
    expect(
      await page.$eval(`${drawer(ID.globe)} [data-fld="toContainer"]`, (e) =>
        e instanceof HTMLSelectElement ? e.value : null,
      ),
    ).toBe(HARBOR);

    // WHEN they click move once more, much later
    await click(page, act(ID.globe, "move"));

    // THEN it asks again rather than moving
    await statusIs(page, ID.globe, "click move again to confirm");
    expect(calls(page, "POST move")).toEqual([]);

    // WHEN they confirm
    await click(page, act(ID.globe, "move"));

    // THEN api/move moves it to harbor, and the row lives there now
    expect((await nthCall(page, "POST move")).body).toEqual({ id: ID.globe, toContainer: HARBOR });
    const moved = ID.harborMap.replace("harbor-map", "big-globe");
    await page.waitForSelector(row(moved));
    expect(await text(page, `${row(moved)} .slug-host`)).toBe("↳ code/harbor");
  });

  it.concurrent("should show a refused move or rename in the drawer, which stays open", async () => {
    // GIVEN api/move refuses everything
    const page = await open({
      hash: "dashboard",
      stubs: { "POST move": fail("refused: linked from a team wiki page") },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.metrics);

    // WHEN the user confirms a move
    await click(page, act(ID.metrics, "move"));
    await click(page, act(ID.metrics, "move"));

    // THEN the drawer says why, and stays
    await statusIs(page, ID.metrics, "refused: linked from a team wiki page");
    expect(await status(page, ID.metrics)).toMatchObject({ err: true });

    // WHEN they try a rename instead
    await typeInto(page, `${drawer(ID.metrics)} [data-fld="name"]`, "metrics-2");
    await click(page, act(ID.metrics, "rename"));

    // THEN the same
    await statusIs(page, ID.metrics, "refused: linked from a team wiki page");
    expect(calls(page, "POST move").length).toBe(2);
  });

  it.concurrent("should have nowhere to move, mirror or vendor to in a library of one container", async () => {
    // GIVEN a library whose vizzes all live in the central library
    const page = await open({
      hash: "dashboard",
      lib: (l) => {
        l.slugs = [viz("alone", { title: "Alone" }), viz("also-here", { title: "Also here" })];
      },
    });
    await dashboardReady(page);
    const id = ID.tide.replace("tide-clock", "alone");

    // WHEN the user opens a viz's drawer
    await openDrawer(page, id);

    // THEN every destination menu says there is no other container
    expect(
      await page.$$eval(
        `${drawer(id)} [data-fld="toContainer"] option, ${drawer(id)} [data-fld="to"] option, ${drawer(id)} [data-fld="vto"] option`,
        (os) => os.map((o) => o.textContent),
      ),
    ).toEqual(["no other containers", "no other containers", "no other containers"]);

    // WHEN the user tries each, THEN the drawer says what's missing, and nothing is sent
    await click(page, act(id, "vendor-add"));
    await statusIs(page, id, "no sink container");
    await click(page, act(id, "move"));
    await statusIs(page, id, "no destination container");
    await click(page, act(id, "mirror-add"));
    await statusIs(page, id, "no sink container");
    expect(page.api.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it.concurrent("should delete a viz on a confirming second click, and show a refusal", async () => {
    // GIVEN api/delete removes the viz, but refuses loose-sketch
    const page = await open({
      hash: "dashboard",
      stubs: {
        "POST delete": (call, l) => {
          if (call.body.id === ID.loose) return fail("refused: not committed")(call, l);
          l.slugs = l.slugs.filter((s) => s.id !== call.body.id);
          return { ok: true, out: "deleted", err: "" };
        },
      },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.globe);

    // WHEN the user clicks delete once
    await click(page, act(ID.globe, "delete"));

    // THEN it asks to confirm
    await statusIs(page, ID.globe, "click delete again to confirm — this removes the folder");
    expect(await text(page, act(ID.globe, "delete"))).toBe("confirm?");

    // WHEN they confirm
    await click(page, act(ID.globe, "delete"));

    // THEN api/delete is asked, and the row is gone
    expect((await nthCall(page, "POST delete")).body).toEqual({ id: ID.globe });
    await page.waitForFunction((sel) => !document.querySelector(sel), {}, row(ID.globe));
    expect((await rowTitles(page)).length).toBe(13);

    // WHEN they delete loose-sketch, which the CLI refuses
    await openDrawer(page, ID.loose);
    await click(page, act(ID.loose, "delete"));
    await click(page, act(ID.loose, "delete"));

    // THEN the drawer says why, and the row stays
    await statusIs(page, ID.loose, "refused: not committed");
    expect(await rowIds(page)).toContain(ID.loose);
  });
});

describe("a viz's copies elsewhere", () => {
  it.concurrent("should list, add, edit and remove the mirrors a viz publishes into", async () => {
    // GIVEN Tide clock, mirrored into atlas; api/mirror changing the library's mirrors as the CLI would
    const page = await open({
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
    await dashboardReady(page);
    const mirrors = `${drawer(ID.tide)} .mirror-list`;

    // WHEN the user opens Tide clock's drawer
    await openDrawer(page, ID.tide);

    // THEN its mirrors are listed with their access, the second unlisted with overrides; it is vendored nowhere
    await textIs(
      page,
      mirrors,
      "../../code/atlas/viz-pages [public]✎✕../../code/harbor/viz-pages [private] ·unlisted ·overrides✎✕",
    );
    expect(await text(page, `${drawer(ID.tide)} .vendor-list`)).toBe("none");

    // WHEN the user opens the harbor mirror's editor
    await click(page, `${mirrors} [data-act="mirror-edit"][data-to="../../code/harbor/viz-pages"]`);

    // THEN it is prefilled from the mirror: unlisted, its title override
    const edit = `${drawer(ID.tide)} .mirror-edit`;
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

    // WHEN they list it and change its title
    await page.select(`${edit} [data-fld="m-listed"]`, "listed");
    await typeInto(page, `${edit} [data-fld="m-title"]`, "Tides at the harbor");
    await click(page, `${edit} [data-act="mirror-save"]`);

    // THEN every field goes to api/mirror, the editor closes and the list shows it listed
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

    // WHEN they remove the atlas mirror: once, then again to confirm
    await click(page, `${mirrors} [data-act="mirror-rm"][data-to="../../code/atlas/viz-pages"]`);
    expect(
      await text(page, `${mirrors} [data-act="mirror-rm"][data-to="../../code/atlas/viz-pages"]`),
    ).toBe("✓?");
    await statusIs(page, ID.tide, "click ✕ again to confirm");
    await click(page, `${mirrors} [data-act="mirror-rm"][data-to="../../code/atlas/viz-pages"]`);

    // THEN it is removed
    expect((await nthCall(page, "POST mirror", 2)).body).toEqual({
      id: ID.tide,
      sub: "rm",
      to: "../../code/atlas/viz-pages",
    });
    await statusIs(page, ID.tide, "mirror rm: ../../code/atlas/viz-pages");
    await textIs(page, mirrors, "../../code/harbor/viz-pages [private] ·overrides✎✕");

    // WHEN they add a private mirror into atlas
    await page.select(`${drawer(ID.tide)} [data-fld="to"]`, ATLAS);
    await page.select(`${drawer(ID.tide)} [data-fld="access"]`, "private");
    await click(page, act(ID.tide, "mirror-add"));

    // THEN it is added and listed
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

  it.concurrent("should show a refused mirror add, update or removal", async () => {
    // GIVEN api/mirror refuses everything, an update without saying why
    const page = await open({
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
    await dashboardReady(page);
    await openDrawer(page, ID.tide);
    await textIs(page, `${drawer(ID.tide)} .mirror-list`, "../../code/atlas/viz-pages [public]✎✕");

    // WHEN the user adds a mirror, THEN the refusal shows
    await click(page, act(ID.tide, "mirror-add"));
    await statusIs(page, ID.tide, "refused: atlas is not a git repo");

    // WHEN they save the atlas mirror's editor, THEN "failed", and the editor stays open
    await click(page, `${drawer(ID.tide)} [data-act="mirror-edit"]`);
    await click(page, `${drawer(ID.tide)} [data-act="mirror-save"]`);
    await statusIs(page, ID.tide, "failed");
    expect(await page.$(`${drawer(ID.tide)} .mirror-edit [data-act="mirror-save"]`)).not.toBeNull();

    // WHEN they remove it and that is refused, THEN the refusal shows, and the mirror stays
    await click(page, `${drawer(ID.tide)} [data-act="mirror-rm"]`);
    await click(page, `${drawer(ID.tide)} [data-act="mirror-rm"]`);
    await statusIs(page, ID.tide, "refused: the sink has uncommitted changes");
    expect(calls(page, "GET mirrors").length).toBe(1);
  });

  it.concurrent("should vendor a full copy into another repo on a confirming click, and undeclare one", async () => {
    // GIVEN River poster (private) and Garden planner (vendored into harbor)
    const page = await open({
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
    await dashboardReady(page);
    await openDrawer(page, ID.river);
    await textIs(page, `${drawer(ID.river)} .vendor-list`, "none");

    // WHEN the user picks harbor and clicks "copy as private"
    expect(await text(page, act(ID.river, "vendor-add"))).toBe("copy as private");
    await page.select(`${drawer(ID.river)} [data-fld="vto"]`, HARBOR);
    await click(page, act(ID.river, "vendor-add"));

    // THEN it says what a copy writes, and waits for a second click
    await statusIs(
      page,
      ID.river,
      "click again to copy as private — writes a full copy + a pre-commit guard into the sink repo",
    );
    expect(calls(page, "POST vendor")).toEqual([]);

    // WHEN they click again
    await click(page, act(ID.river, "vendor-add"));

    // THEN api/vendor copies it, and the copy is listed
    expect((await nthCall(page, "POST vendor")).body).toEqual({ id: ID.river, to: HARBOR });
    await statusIs(page, ID.river, `vendored → ${HARBOR}`);
    await textIs(page, `${drawer(ID.river)} .vendor-list`, `${HARBOR} [private]✕`);

    // WHEN they open Garden planner and remove its harbor copy: once, then to confirm
    await openDrawer(page, ID.garden);
    await textIs(page, `${drawer(ID.garden)} .vendor-list`, "../../code/harbor/viz-pages [local]✕");
    await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);
    await statusIs(
      page,
      ID.garden,
      "click ✕ again to confirm — undeclares the copy; it is pruned on the next publish --push-vendors",
    );
    await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);

    // THEN it is undeclared
    expect((await nthCall(page, "POST vendor-rm")).body).toEqual({
      id: ID.garden,
      to: "../../code/harbor/viz-pages",
    });
    await statusIs(page, ID.garden, "vendor removed");
    await textIs(page, `${drawer(ID.garden)} .vendor-list`, "none");
  });

  it.concurrent("should show a refused vendor copy or removal", async () => {
    // GIVEN api/vendor and api/vendor-rm refuse, one silently
    const page = await open({
      hash: "dashboard",
      stubs: { "POST vendor": ok(""), "POST vendor-rm": fail("refused: dirty tree") },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.garden);

    // WHEN the user removes the copy, THEN the refusal shows
    await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);
    await click(page, `${drawer(ID.garden)} [data-act="vendor-rm"]`);
    await statusIs(page, ID.garden, "refused: dirty tree");

    // WHEN they vendor it and the CLI says nothing, THEN "vendored"
    await click(page, act(ID.garden, "vendor-add"));
    await click(page, act(ID.garden, "vendor-add"));
    await statusIs(page, ID.garden, "vendored");
  });

  it.concurrent("should re-sync a vendored copy from its origin, from the copy's own drawer", async () => {
    // GIVEN the harbor copy of Garden planner, and api/vendor-sync
    const page = await open({ hash: "dashboard", stubs: { "POST vendor-sync": ok("") } });
    await dashboardReady(page);

    // WHEN the user opens the origin's drawer
    await openDrawer(page, ID.garden);

    // THEN it has no re-sync: there is nothing to pull from
    expect(await page.$(act(ID.garden, "vendor-sync"))).toBeNull();

    // WHEN they open the copy's drawer
    await openDrawer(page, ID.gardenCopy);

    // THEN it offers re-sync
    expect(await text(page, act(ID.gardenCopy, "vendor-sync"))).toBe("re-sync");

    // WHEN they click it, once and again to confirm
    await click(page, act(ID.gardenCopy, "vendor-sync"));
    await statusIs(
      page,
      ID.gardenCopy,
      "click re-sync again to confirm — overwrites this copy from its origin",
    );
    await click(page, act(ID.gardenCopy, "vendor-sync"));

    // THEN api/vendor-sync re-pulls it
    expect((await nthCall(page, "POST vendor-sync")).body).toEqual({ id: ID.gardenCopy });
    await statusIs(page, ID.gardenCopy, "re-synced");
  });

  it.concurrent("should show a refused re-sync", async () => {
    // GIVEN api/vendor-sync refuses
    const page = await open({
      hash: "dashboard",
      stubs: { "POST vendor-sync": fail("refused: the copy has local edits") },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.gardenCopy);

    // WHEN the user confirms a re-sync
    const gitBefore = calls(page, "GET slugs-git").length; // (slugs are refetched every 5s anyway; the git feed only after a write)
    await click(page, act(ID.gardenCopy, "vendor-sync"));
    await click(page, act(ID.gardenCopy, "vendor-sync"));

    // THEN the refusal shows, and nothing is refetched
    await statusIs(page, ID.gardenCopy, "refused: the copy has local edits");
    await page.waitForNetworkIdle({ idleTime: 150 });
    expect(calls(page, "GET slugs-git").length).toBe(gitBefore);
  });

  it.concurrent("should say the copies are unknown when the lists can't be read", async () => {
    // GIVEN api/mirrors fails at the network
    const page = await open({ hash: "dashboard", stubs: { "GET mirrors": () => netError() } });
    await dashboardReady(page);

    // WHEN the user opens Tide clock's drawer
    await openDrawer(page, ID.tide);

    // THEN the mirror list reads as none, the vendor list is still read
    await textIs(page, `${drawer(ID.tide)} .mirror-list`, "none");
    await textIs(page, `${drawer(ID.tide)} .vendor-list`, "none");
  });

  it.concurrent("should let a viz that a change filters out of the list go, drawer and all", async () => {
    // GIVEN the list filtered to private vizzes, River poster's drawer open
    const page = await open({
      hash: "dashboard&posture=private",
      stubs: { "POST update": update },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.river);

    // WHEN the user makes it public
    await click(page, act(ID.river, "axis", '[data-axis="posture"][data-val="public"]'));
    await nthCall(page, "GET mirrors", 2);

    // THEN it leaves the filtered list, and the page carries on without it
    await page.waitForFunction((sel) => !document.querySelector(sel), {}, row(ID.river));
    await page.waitForNetworkIdle({ idleTime: 100 });
    expect(await rowTitles(page)).toEqual(["Harbor map", "Atlas exchange"]);
    expect(page.errors).toEqual([]);
  });
});

describe("rendering a viz to video", () => {
  it.concurrent("should start a render, show its progress and warnings, then the file it wrote", async () => {
    // GIVEN api/render: a job that runs for two polls, halfway at the second, then is done
    let polls = 0;
    const job = { id: "job-1", state: "running", frame: 0, frames: 0, warnings: [] as string[] };
    const page = await open({
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
    await dashboardReady(page);
    await openDrawer(page, ID.tide);
    const line = `${drawer(ID.tide)} .render-state`;

    // WHEN the user clicks render mp4
    await click(page, act(ID.tide, "render"));

    // THEN a render starts and shows as running, cancellable
    expect((await nthCall(page, "POST render")).body).toEqual({ action: "start", id: ID.tide });
    await textIs(page, line, "rendering ✕");

    // WHEN they click render again while it runs
    await click(page, act(ID.tide, "render"));

    // THEN the progress and the warning show, and at the end the file it wrote
    await textIs(page, line, "rendering 50% ✕ · ⚠ no narration.json", 6000);
    await textIs(page, line, "✓ /tmp/tide-clock.mp4 · ⚠ no narration.json", 6000);
    expect(calls(page, "POST render")[1]!.body).toEqual({ action: "status", job: "job-1" });
    // THEN no second render started
    expect(calls(page, "POST render").filter((c) => c.body.action === "start").length).toBe(1);
  });

  it.concurrent("should cancel a render, keep its line across closing the drawer, and show a failed one's error", async () => {
    // GIVEN api/render: Tide clock's job runs until cancelled; Orbit deck's fails
    let cancelled = false;
    const page = await open({
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
              job: { id: "job-1", state: "cancelled", frame: 1, frames: 4, log: "/tmp/job-1.log" },
            };
          if (body.action === "start")
            return {
              ok: true,
              out: "",
              job: { id: "job-1", state: "running", frame: 1, frames: 4 },
            };
          return { ok: true, out: "", job: { id: "job-1", state: "running", frame: 1, frames: 4 } };
        },
      },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.tide);
    const line = `${drawer(ID.tide)} .render-state`;
    await click(page, act(ID.tide, "render"));
    await textIs(page, line, "rendering 25% ✕");

    // WHEN the user closes the drawer mid-render and opens it again
    await click(page, `${row(ID.tide)} [data-act="toggle"]`);
    await nthCall(page, "POST render", 2, 4000);
    await openDrawer(page, ID.tide);

    // THEN the render's line is still there
    expect(await text(page, line)).toBe("rendering 25% ✕");

    // WHEN they cancel it
    await click(page, `${line} [data-act="render-cancel"]`);

    // THEN the cancel is sent for that job, and the line says it was cancelled, with its log
    expect(calls(page, "POST render").find((c) => c.body.action === "cancel")!.body).toEqual({
      action: "cancel",
      job: "job-1",
    });
    await textIs(page, line, "cancelled (log)", 4000);
    expect(await page.$eval(`${line} span[title]`, (e) => e.getAttribute("title"))).toBe(
      "/tmp/job-1.log",
    );

    // WHEN they render Orbit deck, which has no timeline
    await openDrawer(page, ID.orbit);
    await click(page, act(ID.orbit, "render"));

    // THEN its line says why it failed
    await textIs(
      page,
      `${drawer(ID.orbit)} .render-state`,
      "error: no window.__viz.timeline (log)",
    );
  });

  it.concurrent("should show a render that could not start", async () => {
    // GIVEN api/render refuses to start, and a cancel of an unknown job answers no job
    const page = await open({
      hash: "dashboard",
      stubs: { "POST render": fail("render: chrome not found") },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.tide);

    // WHEN the user clicks render mp4
    await click(page, act(ID.tide, "render"));

    // THEN the drawer shows why, and no job line appears
    await statusIs(page, ID.tide, "render: chrome not found");
    expect(await text(page, `${drawer(ID.tide)} .render-state`)).toBe("");
  });
});

describe("a viz's history", () => {
  it.concurrent("should list the commits touching a viz and restore one on a confirming click", async () => {
    // GIVEN Big globe's drawer, and api/rollback
    const page = await open({
      hash: "dashboard",
      stubs: { "POST rollback": ok("restored big-globe to e5f6a7b\n2 files") },
    });
    await dashboardReady(page);
    await openDrawer(page, ID.globe);

    // WHEN the user opens its history
    await click(page, `${drawer(ID.globe)} summary[data-act="history"]`);

    // THEN each commit is listed by short hash, age and subject
    await page.waitForSelector(`${drawer(ID.globe)} .hist-row`);
    expect(
      await page.$$eval(`${drawer(ID.globe)} .hist-row`, (els) =>
        els.map((e) => [...e.children].slice(0, 3).map((c) => c.textContent)),
      ),
    ).toEqual([
      ["e5f6a7b", "6h", "big-globe: latest edit"],
      ["f6a7b8c", "1mo", "create viz: big-globe"],
    ]);

    // WHEN they click restore on the latest, once, then again
    await click(page, `${drawer(ID.globe)} [data-act="rollback"]`);
    await statusIs(
      page,
      ID.globe,
      "click restore again to roll this viz back to e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
    );
    expect(calls(page, "POST rollback")).toEqual([]);
    await click(page, `${drawer(ID.globe)} [data-act="rollback"]`);

    // THEN api/rollback restores that commit, the drawer says so, and the history is read again
    expect((await nthCall(page, "POST rollback")).body).toEqual({
      id: ID.globe,
      commit: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
    });
    await statusIs(page, ID.globe, "restored big-globe to e5f6a7b");
    await nthCall(page, "GET history", 2);

    // WHEN they open the history again, and close it
    await click(page, `${drawer(ID.globe)} summary[data-act="history"]`);
    await nthCall(page, "GET history", 3);
    await click(page, `${drawer(ID.globe)} summary[data-act="history"]`);

    // THEN opening reads it afresh; closing does not
    await page.waitForNetworkIdle({ idleTime: 100 });
    expect(calls(page, "GET history").length).toBe(3);
    expect(await page.$eval(`${drawer(ID.globe)} details.hist`, (e) => e.open)).toBe(false);
  });

  it.concurrent("should say when a viz has no history, or it can't be read", async () => {
    // GIVEN River poster with no commits, loose-sketch unknown to git, and api/history failing for Tide clock
    const page = await open({
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
    await dashboardReady(page);
    const history = async (id: string) => {
      await openDrawer(page, id);
      await click(page, `${drawer(id)} summary[data-act="history"]`);
      await page.waitForFunction(
        (sel) => document.querySelector(sel)!.textContent !== "…",
        {},
        `${drawer(id)} .hist-rows`,
      );
      return text(page, `${drawer(id)} .hist-rows`);
    };

    // WHEN the user opens each one's history
    // THEN each says why there is nothing to restore
    expect(await history(ID.river)).toBe("no commits touching this viz");
    expect(await history(ID.loose)).toBe("unknown viz id");
    expect(await history(ID.tide)).toBe("no history");
  });

  it.concurrent("should show a refused restore, and carry on when the restored viz leaves the filtered list", async () => {
    // GIVEN the list filtered to public vizzes; api/rollback refuses Tide clock, and restores Big globe to a private version
    const page = await open({
      hash: "dashboard&posture=public",
      stubs: {
        "POST rollback": (call, l) => {
          if (call.body.id === ID.tide) return fail("refused: uncommitted changes")(call, l);
          l.slugs.find((s) => s.id === call.body.id)!.posture = "private";
          return { ok: true, out: "", err: "" };
        },
      },
    });
    await dashboardReady(page);
    const restore = async (id: string) => {
      await openDrawer(page, id);
      await click(page, `${drawer(id)} summary[data-act="history"]`);
      await page.waitForSelector(`${drawer(id)} [data-act="rollback"]`);
      await click(page, `${drawer(id)} [data-act="rollback"]`);
      await click(page, `${drawer(id)} [data-act="rollback"]`);
    };

    // WHEN the user restores Tide clock, THEN the refusal shows
    await restore(ID.tide);
    await statusIs(page, ID.tide, "refused: uncommitted changes");

    // WHEN they restore Big globe, THEN it leaves the list, and nothing breaks
    await restore(ID.globe);
    await page.waitForFunction((sel) => !document.querySelector(sel), {}, row(ID.globe));
    await page.waitForNetworkIdle({ idleTime: 100 });
    expect(page.errors).toEqual([]);
  });
});

describe("a new viz from a template", () => {
  it.concurrent("should open the drawer at 'new from this' from the template badge, and create the viz in a new tab", async () => {
    // GIVEN Orbit deck, a deck template, and api/create; a new tab is recorded rather than opened
    const page = await open({
      hash: "dashboard",
      stubs: {
        "POST create": ({ body: { slug = "" } }, l) => {
          l.slugs.push(viz(slug, { title: "", kind: "deck", ageMs: 1000 }));
          return { ok: true, out: "", id: `.agents/state/viz/${slug}` };
        },
      },
    });
    await dashboardReady(page);
    await ownTabs(page);

    // WHEN the user clicks its "deck template" badge
    await click(page, `${row(ID.orbit)} [data-act="from-open"]`);

    // THEN its drawer opens with the new slug box focused
    await page.waitForSelector(drawer(ID.orbit));
    expect(
      await page.evaluate(() =>
        document.activeElement instanceof HTMLElement
          ? document.activeElement.dataset.fld
          : undefined,
      ),
    ).toBe("newSlug");

    // WHEN they click create with no slug, THEN it asks for one
    await click(page, act(ID.orbit, "create-from"));
    await statusIs(page, ID.orbit, "slug required");

    // WHEN they click the badge again, type a slug and create
    await click(page, `${row(ID.orbit)} [data-act="from-open"]`);
    await page.keyboard.type("my-talk");
    await click(page, act(ID.orbit, "create-from"));

    // THEN api/create makes it from the template, the new tab goes to it, the drawer closes and it is listed
    expect((await nthCall(page, "POST create")).body).toEqual({ from: ID.orbit, slug: "my-talk" });
    await page.waitForFunction(() => window.tabs[0]!.location !== "");
    expect(await tabs(page)).toEqual([["/.agents/state/viz/my-talk/", false]]);
    await page.waitForSelector(row(ID.orbit.replace("orbit-deck", "my-talk")));
    expect(await page.$(".slug-drawer")).toBeNull();
  });

  it.concurrent("should close the new tab and say why when the viz can't be made", async () => {
    // GIVEN api/create refuses, and a browser that blocks the new tab for the second try
    const page = await open({
      hash: "dashboard",
      stubs: { "POST create": fail("refused: my-talk already exists") },
    });
    await dashboardReady(page);
    await ownTabs(page, { blockAfter: 1 });
    await openDrawer(page, ID.starter);

    // WHEN the user creates "my-talk"
    await page.type(`${drawer(ID.starter)} [data-fld="newSlug"]`, "my-talk");
    await click(page, act(ID.starter, "create-from"));

    // THEN the tab opened for it is closed again, and the drawer says why
    await statusIs(page, ID.starter, "refused: my-talk already exists");
    expect(await tabs(page)).toEqual([["", true]]);

    // WHEN they try again with the popup blocked, THEN the same, without a tab to close
    await click(page, act(ID.starter, "create-from"));
    await nthCall(page, "POST create", 2);
    await statusIs(page, ID.starter, "refused: my-talk already exists");
    expect(page.errors).toEqual([]);
  });
});

describe("rows the api describes sparsely", () => {
  it.concurrent("should still say what a build-mirror sink is, and title a thumbnail with no description", async () => {
    // GIVEN a viz carrying a .mirror.json (a build-mirror sink: mirrored in, origin not named), and one with an OG image but no description
    const page = await open({
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
    await dashboardReady(page);

    // WHEN the page has loaded

    // THEN the sink says it is a mirrored-in copy, and can't be managed from here
    expect(
      await page.$eval(`${row(ID.harborMap)} .mirror-on`, (e) => e.getAttribute("title")),
    ).toBe("mirrored-in copy from  — edit the origin viz, not this sink");
    expect(await page.$(`${row(ID.harborMap)} button.manage-btn`)).toBeNull();
    // THEN the thumbnail is titled by its file
    expect(await page.$eval(`${row(ID.river)} .slug-thumb`, (e) => e.getAttribute("title"))).toBe(
      "OG preview (og.auto.png)",
    );
  });
});
