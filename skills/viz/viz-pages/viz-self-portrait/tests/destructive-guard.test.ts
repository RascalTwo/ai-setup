// The backend's writes (delete, move, rotate…) answer the Library page's own requests only: an agent's
// curl or another website's fetch must never reach them.
import { describe, it, expect } from "bun:test";
import path from "node:path";
import { onlyFromThisPage } from "../guard.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const ask = (method: string, site?: string) =>
  onlyFromThisPage(() => "handled")(
    new Request("http://127.0.0.1:5180/api/delete", {
      method,
      ...(site && { headers: { "sec-fetch-site": site } }),
    }),
  );

describe("the backend's writes", () => {
  it("should refuse a POST from anywhere but the page itself", async () => {
    const sites = await viz.given(
      "a bare client (no Sec-Fetch-Site: curl, an agent's fetch) and every other site a browser can report",
      () => [undefined, "cross-site", "same-site", "none"],
    );

    const replies = await viz.when("each POSTs", async () =>
      Promise.all(
        sites.map(async (site) => {
          const res = await ask("POST", site);
          if (!(res instanceof Response))
            throw new Error(`POST from ${String(site)} reached the handler, not a refusal`);
          return { site, res };
        }),
      ),
    );

    await viz.then("each is refused outright, and says why", async () => {
      await Promise.all(
        replies.map(async ({ site, res }) => {
          expect([site, res.status]).toEqual([site, 403]);
          const refusal: unknown = await res.json();
          expect(
            typeof refusal === "object" && refusal !== null && "err" in refusal
              ? refusal.err
              : undefined,
          ).toContain("only answers the Library page");
        }),
      );
    });
  });

  it("should answer the page's own POST, and leave reads alone", async () => {
    await viz.given("the page's own POST, and a plain GET with no Sec-Fetch-Site");

    const replies = await viz.when("each is asked", () => ({
      post: ask("POST", "same-origin"),
      get: ask("GET"),
    }));

    await viz.then("both reach the handler", () => {
      expect(replies.post).toBe("handled");
      expect(replies.get).toBe("handled");
    });
  });

  it("should stand in front of every route the real api.ts serves", async () => {
    const script = await viz.given(
      "api.ts loaded as the server loads it (its own process: importing it here would put its untested lines in this page's coverage)",
      () => `import api from ${JSON.stringify(path.resolve(import.meta.dir, "../api.ts"))};
      const out = {};
      for (const [route, h] of Object.entries(api)) out[route] = (await h(new Request("http://127.0.0.1:5180/api" + route, { method: "POST", body: JSON.stringify({ id: "no/such/viz", list: "no-such-list" }) }))).status;
      console.log(JSON.stringify(out));`,
    );

    const out = await viz.when("every route is POSTed with no Sec-Fetch-Site", async () => {
      const proc = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
      const parsed: unknown = JSON.parse(await new Response(proc.stdout).text());
      if (!isRecord(parsed)) throw new Error("api.ts printed no JSON object");
      return parsed;
    });

    await viz.then("every one is refused: none got as far as acting", () => {
      expect(Object.keys(out).length).toBeGreaterThan(15);
      expect(Object.entries(out).filter(([, status]) => status !== 403)).toEqual([]);
    });
  });
});
