// lib/server/relay.ts — `_relay`: the 🎙 💬 panel's Send on a page made inside a Kelpie run. The page
// declares its run with `<meta name="viz:kelpie-run" content="<run folder>">` (grill-me-viz and pr-viz
// add it when made in a run); this reads that tag from the page's own file, never from the request, and
// hands the panel's words (what is on the page, as `viz feedback` prints it) to the kit's relay. The
// panel shows the answer, and logs its `send` only once the words are on the task.
// A page without the tag answers no-run and the panel behaves as it always has. Spec and walkthrough
// pages carry no tag: they relay through their own api.ts, so one press never relays twice.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { relay, type Relayed } from "../../kit/server/kelpie-relay.ts";

const TAG = /<meta\s+name=["']viz:kelpie-run["']\s+content=["']([^"']+)["']/u;

/** The run folder the page was made with, from its index.html; undefined when it declares none. */
export const declaredRun = (dir: string): string | undefined => {
  const html = path.join(dir, "index.html");
  return existsSync(html) ? readFileSync(html, "utf8").match(TAG)?.[1] : undefined;
};

export async function handleRelay(dir: string, req: Request): Promise<Relayed> {
  const folder = declaredRun(dir);
  if (!folder || req.method !== "POST") return relay(req, "", folder);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the panel sends {words}
  const { words } = ((await req.json().catch(() => ({}))) ?? {}) as { words?: string };
  return relay(req, words ?? "", folder);
}
