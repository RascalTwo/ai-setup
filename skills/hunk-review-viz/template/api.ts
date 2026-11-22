// api.ts — the review page's backend. Reads git and the reviewer's marks through the skill's
// lib/review.ts, whose path `review.ts open` wrote into review.json beside this file.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Handlers } from "@viz/kit/api.js";
import type { MarkBody, ReviewConfig, ReviewView, Routes } from "./contract.ts";

/** The part of the skill's lib/review.ts this page calls. */
interface Lib {
  buildReview(dir: string): ReviewView;
  setMark(dir: string, body: MarkBody): void;
  fileAt(dir: string, repo: string, sha: string, path: string): string[] | null;
}

const DIR = import.meta.dirname;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: `review.ts open` writes this file
const cfg = JSON.parse(readFileSync(path.join(DIR, "review.json"), "utf8")) as ReviewConfig;
const LIB = path.join(cfg.skillDir, "lib", "review.ts");
let loaded: { at: number; lib: Lib } | undefined;
/**
 * The skill's lib, re-imported when its file changes: the viz server keeps this module alive across
 * requests, and Node caches an import by URL, so an updated skill would otherwise keep serving old code.
 * (Only review.ts itself is watched; its own imports reload with the server.)
 */
async function lib(): Promise<Lib> {
  const at = statSync(LIB).mtimeMs;
  if (loaded?.at !== at) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the skill's lib lives outside this page; Lib names what it exports
    loaded = { at, lib: (await import(`${LIB}?v=${at}`)) as Lib };
  }
  return loaded.lib;
}

export default {
  "/review": async () => (await lib()).buildReview(DIR),
  "/file": async (req) => {
    const q = new URL(req.url).searchParams;
    return {
      lines: (await lib()).fileAt(
        DIR,
        q.get("repo") ?? "",
        q.get("sha") ?? "",
        q.get("path") ?? "",
      ),
    };
  },
  "/mark": async (req) => {
    (await lib()).setMark(DIR, await req.json());
    return { ok: true as const };
  },
} satisfies Handlers<Routes>;
