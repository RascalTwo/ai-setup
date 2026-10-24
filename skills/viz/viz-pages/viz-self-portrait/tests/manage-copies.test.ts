// The Library's management drawer (dashboard.ts, ADR 0009): a viz's copies elsewhere (mirrors and
// vendored copies), what the page asks api/ for, and what it shows afterwards.
import { describe, it, expect } from "bun:test";
import {
  dashboardReady,
  nthCall,
  calls,
  ok,
  fail,
  netError,
  rowTitles,
  ATLAS,
  HARBOR,
} from "./helpers.ts";
import {
  open,
  click,
  ID,
  act,
  row,
  drawer,
  openDrawer,
  statusIs,
  update,
  text,
  typeInto,
  textIs,
} from "./steps-library.ts";

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
