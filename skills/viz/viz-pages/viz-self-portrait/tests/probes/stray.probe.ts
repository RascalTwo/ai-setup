// Run ONLY by guard.test.ts, in a child `bun test` (not *.test.*, so verify never runs it itself).
// It makes the page write — one Rank answer saves to api/ranking — with or without a stand-in
// for that write (SP_PROBE_STUB=1), so the guard test can see what a whole run does about a stray.
import { it } from "bun:test";
import { open, rankReady, fakes } from "../helpers.ts";

it("answers one Rank pair", async () => {
  const page = await open({
    hash: "rank",
    stubs: process.env.SP_PROBE_STUB ? { "POST ranking": fakes.ranking } : {},
  });
  await rankReady(page);
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() =>
    /saved|FAILED/u.test(document.querySelector("#rk-saved")!.textContent),
  );
  await Bun.sleep(200); // let a stray's rejection land inside this run
});
