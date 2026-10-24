// lib/server/api.ts — Per-viz api.ts backends, and the tape recorder in front of them.
//
// Extracted from server.ts, which was 522 lines.

import { registerKitResolver } from "./kit-resolve.ts";
import { MODE } from "./config.ts";
import { envelopeFrom, hasTape, lookup, recordKey, replay, writeEntry } from "../../recordings.ts";
import { existsSync } from "node:fs";
import path from "node:path";

registerKitResolver();
type Routes = Record<string, unknown>;
const isRoutes = (x: unknown): x is Routes => typeof x === "object" && x !== null;
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isHandler = (f: unknown): f is (req: Request) => unknown => typeof f === "function";

export async function handleApi(slugDir: string, route: string, req: Request): Promise<Response> {
  const rkey = await recordKey(req, route);

  // Frozen: serve the tape, never touch the live backend.
  if (MODE === "frozen") {
    const env = lookup(slugDir, rkey);
    if (env) return replay(env);
    return new Response(`no recording for ${rkey}`, { status: 404 });
  }

  // Live (and --record). On any failure, add a hint if a tape could rescue this —
  // but never auto-serve it (that silent-stale-fallback is the trap we avoid).
  const errored = (msg: string, status: number): Response => {
    const hint = hasTape(slugDir)
      ? `\n(a recording exists — run the server with --frozen to replay it)`
      : "";
    return new Response(msg + hint, { status });
  };

  const apiPath = path.join(slugDir, "api.ts");
  if (!existsSync(apiPath)) return errored("api.ts not found", 404);

  // Cache-bust the import so edits to api.ts are picked up without a restart.
  // A syntax/transpile/import error throws HERE — surface it as a clean 500 with
  // the message instead of an opaque uncaught rejection ("check api before serve").
  let mod: unknown;
  try {
    mod = await import(apiPath + "?t=" + Date.now());
  } catch (e) {
    return errored("api.ts failed to load: " + msgOf(e), 500);
  }
  const routes: Routes = isRoutes(mod) ? (isRoutes(mod.default) ? mod.default : mod) : {};
  const routeKey = "/" + route;
  const handler = routes[routeKey] ?? routes[route];
  if (!isHandler(handler)) return errored("route not found: " + routeKey, 404);

  let res: Response;
  try {
    // A handler may return the reply itself (typed by the viz's contract, /_kit/api.js) or a Response.
    const out = await handler(req);
    res = out instanceof Response ? out : Response.json(out ?? null);
  } catch (e) {
    return errored("api error: " + msgOf(e), 500);
  }

  // Record: tee a clone of the live response into the tape (best-effort).
  if (MODE === "record") {
    try {
      await writeEntry(slugDir, rkey, await envelopeFrom(res));
    } catch (e) {
      console.error("record failed for", rkey, msgOf(e));
    }
  }
  return res;
}
