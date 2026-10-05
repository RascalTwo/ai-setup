// The stand-in api/ itself (helpers.ts): no test may reach the real library. A write with no
// stand-in never passes through to the server, and it fails the run.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { open, rankReady } from "./helpers.ts";

// A child `bun test` of probes/stray.probe.ts, the way verify runs a test file. Its own output
// dir, so its coverage never mixes into this run's.
async function probe(stub: boolean) {
  const proc = Bun.spawn(
    [
      "bun",
      "test",
      "--preload",
      path.resolve(import.meta.dir, "../../../lib/testing/preload.ts"),
      "--timeout",
      "60000",
      "./tests/probes/stray.probe.ts",
    ],
    {
      cwd: viz.dir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        VIZ_OUT: mkdtempSync(path.join(tmpdir(), "sp-probe-")),
        SP_PROBE_STUB: stub ? "1" : "",
      },
    },
  );
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  return { code: await proc.exited, out };
}

describe("the stand-in api", () => {
  it.concurrent("should answer an unstubbed write itself, never the real server, and report it", async () => {
    // GIVEN Rank with NO stand-in for its save (POST api/ranking), strays collected instead of failing
    const strays: string[] = [];
    const page = await open({
      hash: "rank",
      onStray: (m) => {
        strays.push(m);
      },
    });
    await rankReady(page);

    // WHEN the user answers a pair, which saves
    await page.keyboard.press("ArrowLeft");

    // THEN the page got the stand-in's refusal — the save failed rather than reaching the library
    await page.waitForFunction(
      () => document.querySelector("#rk-saved")!.textContent === "SAVE FAILED",
    );
    // THEN the stray is named, with the body the page tried to write
    expect(page.api.strays).toEqual(["POST ranking"]);
    expect(strays[0]).toStartWith('STRAY API CALL: POST ranking {"list":"best","log":[[');
  });

  it.concurrent("should fail a whole test run that makes an unstubbed write, and only that", async () => {
    // GIVEN the same one-answer journey, run as its own `bun test`, with and without a stand-in
    // WHEN both runs finish
    const [bare, stubbed] = await Promise.all([probe(false), probe(true)]);

    // THEN the run without one fails, naming the stray
    expect(bare.out).toContain("STRAY API CALL: POST ranking");
    expect(bare.code).not.toBe(0);
    // THEN the run with one passes: the failure is the stray's, not the journey's
    expect(stubbed.out).not.toContain("STRAY");
    expect(stubbed.code).toBe(0);
  });
});
