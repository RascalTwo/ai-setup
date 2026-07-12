# Backends, streaming, and the tape recorder

For when a viz needs live data (`api.ts`), streams it (SSE), or must survive away from its data source (tape recorder).

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

Frontend calls **relative** URLs: `fetch("api/data")`, `fetch("api/git-log")` — these resolve to `/<slug>/api/data`. Always relative, never a leading slash: `fetch("/api/data")` escapes the slug namespace and 404s. The server hot-reloads `api.ts` on every request (cache-busted import), so edits are picked up without a restart — but that also means **module-level state in `api.ts` is recreated per request**; don't rely on it persisting between calls (write to a file in the slug dir, or re-derive).

`api.ts` runs in the Bun process with full local privileges — any shell command, any filesystem read. The server only binds to `127.0.0.1`. Because the response still goes to a browser, **redact secrets** (master keys, minted tokens) before returning them.

**Streaming live data.** Prefer Server-Sent Events: the handler returns a `text/event-stream` `ReadableStream`, the frontend reads it with `new EventSource("api/run")` (native auto-reconnect). Use a manual `fetch().body.getReader()` + NDJSON loop only when you need a POST body. You do **not** need a keep-alive heartbeat — the server sets `idleTimeout` to its max so long gaps between events won't drop the connection.

**Live demo with a fallback.** If the viz demos a real stack that might be down, pair a `/preflight` route returning `{ ok, checks: [...] }` with a recorded/cached copy of the output baked into the frontend. The page checks preflight on load and plays the cached version when the stack is unreachable, so the viz always tells its story. (Guard the preflight fetch with `AbortSignal.timeout(...)`.)

## Tape recorder: make an API-backed viz survive without its data

An `api.ts`-backed viz only renders where its data source lives. To make it viewable *anywhere* (a clone without the data, a teammate's box), record its responses to a **tape** and serve them frozen. Playback is server-side only — running the server in frozen mode *is* the static experience. Two process flags:

```bash
bun "$SKILL_DIR/.../server.ts" --record   # live api, tees every response into recordings.json
bun "$SKILL_DIR/.../server.ts" --frozen   # serve the tape for every api call; live backend untouched
```

- **Record:** start the server with `--record`, open the viz, **interact** (everything it fetches gets taped against the live backend), stop. For a repo-local viz, do this through its standalone server: `bun viz-pages/.runtime/server.ts --record`. For a central viz, restart the singleton with `--record`.
- The tape is `recordings.json` **beside the viz's `index.html`** — committed, so it travels with the repo. Keyed by `METHOD path?sorted-query` (+ a body hash when the request has a body), last-write-wins.
- **Frozen:** `--frozen` serves the tape for every `api/*` call and injects a slim top banner showing the recording's age, so a viewer never mistakes a snapshot for live data.
- **Live mode never auto-falls-back.** A broken `api.ts` errors loudly; if a tape exists, the error just *hints* to use `--frozen`. This keeps development honest — no silent stale data. Records **everything** (mutations included), so replayed mutations return their recorded response but don't actually mutate.
