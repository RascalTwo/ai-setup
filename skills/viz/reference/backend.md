# Backends, streaming, and the tape recorder

For when a viz needs live data (`api.ts`), streams it (SSE), or must survive away from its data source (tape recorder).

## If the page only needs to save input

Answers, votes, a transcript — anything the page collects — needs no `api.ts`. POST a JSON
object to the page data route and it is appended to `<viz>/.viz-data/<name>.jsonl`:

```js
await fetch("_log/answers", { method: "POST", body: JSON.stringify({ pick: "Q3:B" }) });
const all = await (await fetch("_log/answers")).json();   // every line, oldest first
```

Each line gets an `at` timestamp unless you send one. `DELETE _log/<name>` clears the log.
Names are `a-z 0-9 . _ -` only; entries are capped at 1 MB, logs at 10 MB. `.viz-data/` is
git-ignored and never published, and writing to it doesn't reload the page. Live server
only: a frozen run has no route. Why it exists and what it deliberately can't do: ADR 0019.

## If you need a backend

Write `$VIZ/<slug>/api.ts` exporting handlers as a default object:

```ts
export default {
  "/data": async () => Response.json({ hello: "world" }),
  "/git-log": async () => {
    const proc = Bun.spawn(["git", "log", "--oneline", "-20"], { cwd: "/path/to/repo" });
    const out = await new Response(proc.stdout).text();
    return Response.json({ lines: out.trim().split("\n") });
  },
};
```

**Type the contract once.** A viz with a backend writes `contract.ts` and both sides use it, so a shape is never written twice:

```ts
// contract.ts
export interface Routes {
  "/run":    { body: { stage: string }; reply: { jobId: string } };
  "/status": { body: null;              reply: { done: boolean } };   // null body = a GET
  "/step":   { body: null; method: "POST"; query: { id: string }; reply: { ok: true } };   // POST, data in the URL
}
// api.ts — return the reply itself; the server sends it as JSON
import type { Handlers } from "@viz/kit/api.js";
import type { Routes } from "./contract.ts";
export default {
  "/run": async (req) => { const { stage } = await req.json(); return { jobId: start(stage) }; },
  "/status": () => ({ done: isDone() }),
  "/step": (req) => { step(new URL(req.url).searchParams.get("id")); return { ok: true as const }; },
} satisfies Handlers<Routes>;
// app.ts
import { api } from "@viz/kit/api.js";  import type { Routes } from "./contract.js";
const { get, post } = api<Routes>();
const { jobId } = await post("/run", { body: { stage: "drafts" } });  const { done } = await get("/status");  await post("/step", { query: { id: "a" } });
```

`satisfies` compares the returned value with the contract (a wrong, missing or extra field is a type error under `viz verify`); `as` would not. Never write `as Routes[...]` or `as unknown as` to get past it. `get` takes the routes without a body, `post` the rest, so the wrong verb is a type error. The request body is declared, not validated, and a query is typed for the page only. Any call takes `timeout` (ms), `signal` and `cache`; a non-2xx answer throws an `ApiError` with `status` and the parsed `body`, so a page that treats a 400 as data does `catch (e) { if (e instanceof ApiError) … e.body }` instead of dropping to a raw `fetch`. Return a `Response` instead of a value for a status, headers or a stream; the compiler cannot look inside one.

**A route that ACTS when the page loads must refuse for `viz verify`.** Routes are method-agnostic, and the browser `viz verify` and screenshots drive loads the page like a reader, so a route that spawns servers, rotates a credential or calls a paid model fires on every check. Those browsers carry `VizAutomation` in their user agent (`lib/automation.ts`); test it and answer a harmless stub: `if (req.headers.get("user-agent")?.includes("VizAutomation")) return { up: false }` (or a 409 the page reads as "not available").

**JSON from another server: parse it, never cast it.** Bun types `res.json()` as `unknown`, and `as Foo` (or `JSON.parse(text)`, which is `any`) only asserts. Where a backend reads a reply it does not control, describe the fields it uses with the kit's Zod and let the type come from the schema:

```ts
import { z } from "@viz/kit/zod.js";   // a bundle in kit/, so it works from any repo with no install
const Token = z.object({ access_token: z.string(), expires_in: z.number().optional() });
const { access_token } = Token.parse(await res.json());   // a wrong shape throws here, naming the field
```

Use it for upstream replies, not for the page/backend contract above (that stays plain types).

Frontend calls **relative** URLs: `fetch("api/data")`, `fetch("api/git-log")` — these resolve to `/<slug>/api/data`. Always relative, never a leading slash: `fetch("/api/data")` escapes the slug namespace and 404s. The server hot-reloads `api.ts` on every request (cache-busted import), so edits are picked up without a restart — but that also means **module-level state in `api.ts` is recreated per request**; don't rely on it persisting between calls (write to a file in the slug dir, or re-derive).

`api.ts` runs in the Bun process with full local privileges — any shell command, any filesystem read. The server only binds to `127.0.0.1`. Because the response still goes to a browser, **redact secrets** (master keys, minted tokens) before returning them.

**Streaming live data.** Prefer Server-Sent Events: the handler returns a `text/event-stream` `ReadableStream`, the frontend reads it with `new EventSource("api/run")` (native auto-reconnect). Use a manual `fetch().body.getReader()` + NDJSON loop only when you need a POST body. You do **not** need a keep-alive heartbeat — the server sets `idleTimeout` to its max so long gaps between events won't drop the connection.

> Budget your streams: Chromium allows **6 HTTP/1.1 connections per origin**, and every open `EventSource` holds one for as long as the tab lives. Two streaming vizzes open in three tabs each will wedge the whole server — requests just queue forever. If a viz needs more than one long-lived stream, or you routinely keep many tabs of it open, use a WebSocket instead (separate pool, 255/host). This is exactly why the hot-reload channel itself is a websocket — see `kit/reload.ts`.

**Live demo with a fallback.** If the viz demos a real stack that might be down, pair a `/preflight` route returning `{ ok, checks: [...] }` with a recorded/cached copy of the output baked into the frontend. The page checks preflight on load and plays the cached version when the stack is unreachable, so the viz always tells its story. (Guard the preflight fetch with `AbortSignal.timeout(...)`.)

## Tape recorder: make an API-backed viz survive without its data

An `api.ts`-backed viz only renders where its data source lives. To make it viewable *anywhere* (a clone without the data, a teammate's box, a published site), record its responses to a **tape** and serve them frozen. Playback is server-side only — running the server in frozen mode *is* the static experience. Both are process-wide server modes, chosen when the server starts: stop the running one, then `viz server start` in record or frozen mode (flags: `viz server start --help`).

- **Record:** start in record mode, open the viz, **interact** (everything it fetches gets taped against the live backend), then restart normally. A repo-local viz with a standalone runtime is recorded through that runtime's own server instead.
- The tape is `recordings.json` **beside the viz's `index.html`** — committed, so it travels with the repo. Keyed by `METHOD path?sorted-query` (+ a body hash when the request has a body), last-write-wins.
- **Frozen:** frozen mode serves the tape for every `api/*` call and injects a slim top banner showing the recording's age, so a viewer never mistakes a snapshot for live data.
- **Live mode never auto-falls-back.** A broken `api.ts` errors loudly; if a tape exists, the error just *hints* at frozen mode. This keeps development honest — no silent stale data. Records **everything** (mutations included), so replayed mutations return their recorded response but don't actually mutate.
