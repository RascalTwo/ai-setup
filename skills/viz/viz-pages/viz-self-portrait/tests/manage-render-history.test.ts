// The Library's management drawer (dashboard.ts, ADR 0009): rendering a viz to video, its history, a new
// viz from a template, and rows the api describes sparsely.
import { describe, it, expect } from "bun:test";
import {
  dashboardReady,
  nthCall,
  calls,
  ok,
  fail,
  reply,
  netError,
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
  statusIs,
  ownTabs,
  tabs,
  text,
  textIs,
} from "./steps-library.ts";

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
