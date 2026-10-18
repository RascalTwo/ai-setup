// tests/verify-noise.test.ts — what `viz verify` does NOT call an error.
//
// WHY: verify exits 1 on any error, so a browser habit that looks like a failure trains people to
// ignore red. Chrome cancels an in-flight media request every time the audio is seeked; a viz that
// seeks (a reader, a film scrubber) got one "REQUEST FAILED … ERR_ABORTED" per seek and could never
// pass. And a scrolling ticker or an art bleed is clipped ON PURPOSE, which the clipped check had no
// way to be told.
import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isBenignAbort } from "../lib/verify/noise.ts";
import { parseJson } from "./json.ts";

const SKILL = path.dirname(import.meta.dir);
const TMP = path.join(SKILL, "tests", ".tmp-vizzes-noise");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("a request the browser cancelled on its own", () => {
  test("Given a media request aborted after a seek, when verify classifies it, then it is not an error", () => {
    expect(isBenignAbort("media", "net::ERR_ABORTED")).toBe(true);
  });

  test("Given an aborted request that is not media, when verify classifies it, then it is still an error", () => {
    // a script or fetch that was aborted really did not load
    expect(isBenignAbort("script", "net::ERR_ABORTED")).toBe(false);
    expect(isBenignAbort("fetch", "net::ERR_ABORTED")).toBe(false);
  });

  test("Given a media request that failed some other way, when verify classifies it, then it is still an error", () => {
    // a missing or unreachable clip is a real bug
    expect(isBenignAbort("media", "net::ERR_FILE_NOT_FOUND")).toBe(false);
    expect(isBenignAbort("media", undefined)).toBe(false); // oxlint-disable-line unicorn/no-useless-undefined -- the argument is the case under test
  });
});

// A page that clips a tall child inside a small overflow:hidden box, optionally marked as intended.
function clipped(
  name: string,
  attr: string,
  inner = `<div style="height:200px"><span id="inner">tall</span></div>`,
): string {
  const dir = path.join(TMP, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><h1>Fixture</h1><svg width="200" height="100"><rect width="80" height="60"/><circle cx="140" cy="50" r="30"/></svg><p>A fixture viz with enough on it to pass the layout audit.</p><div id="w" ${attr} style="width:100px;height:20px;overflow:hidden">${inner}</div></body></html>`,
  );
  return dir;
}
async function layoutFindings(dir: string): Promise<string[]> {
  const proc = Bun.spawn(
    ["bun", path.join(SKILL, "viz.ts"), "verify", `file://${dir}/index.html`, "--json"],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, VIZ_NO_OPEN: "1" },
    },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return parseJson<{ layoutFindings: string[] }>(out.slice(out.indexOf("{"))).layoutFindings;
}

describe("content that is cut off on purpose", () => {
  test.concurrent("Given a clipped box nobody marked, when verify runs, then it reports the clipping", async () => {
    const found = await layoutFindings(clipped("unmarked", ""));
    expect(found.join("\n")).toContain("clipped: #w");
  }, 60000);

  test.concurrent("Given a clipped box marked data-verify-clip-ok, when verify runs, then it is not reported", async () => {
    // GIVEN a scrolling ticker: its overflow is the design
    const found = await layoutFindings(clipped("marked", "data-verify-clip-ok"));
    // THEN there is no clipping finding
    expect(found.filter((f) => f.startsWith("clipped:"))).toEqual([]);
  }, 60000);

  test.concurrent("Given a clipped box holding only parked (visibility:hidden) content past its edge, when verify runs, then it is not reported", async () => {
    // GIVEN a deck's off-stage slide, translated below the frame
    const parked = `<div style="height:20px;visibility:hidden;transform:translateY(12px)">parked</div>`;
    expect(
      (await layoutFindings(clipped("parked", "", parked))).filter((f) => f.startsWith("clipped:")),
    ).toEqual([]);
    // AND visible content past the edge is still reported
    expect(
      (await layoutFindings(clipped("shown", "", parked.replace("visibility:hidden;", "")))).join(
        "\n",
      ),
    ).toContain("clipped: #w");
  }, 60000);
});
