import { expect, test } from "bun:test";
import { readTimeline } from "../lib/render/capture.ts";

test("a short cut's sparse beats keep their position, so beat:N still means beat N", () => {
  // The page declares beats 1-2 and 4; JSON turns the gap at beat 3 into null.
  const tl = readTimeline({
    total: 9,
    beats: [{ t0: 0, dur: 1 }, { t0: 1, dur: 1 }, null, { t0: 4, dur: 2 }],
  });
  expect(tl?.beats?.[3]).toEqual({ t0: 4, dur: 2 });
  expect(tl?.beats?.[2]).toBeNull();
});
