# Transport: direct HTTP (preferred)

For a sync server implementing the agent API. No browser anywhere in the write
path. One request per operation, and the server broadcasts each change to everyone
with the board open.

## Configuration

The sync server base URL comes from **`TLDRAW_SYNC_URL`**.

```bash
BASE="${TLDRAW_SYNC_URL:?set TLDRAW_SYNC_URL to the tldraw sync server base URL}"
```

If it isn't set, **ask** — don't guess, and don't reuse a previous session's value.
Suggest persisting it in the shell profile or the project's `CLAUDE.md`.

Ask for the web app origin too, so you can hand back a clickable
`<web-origin>/r/<roomId>` link.

Auth is typically **none**: the roomId is the capability, because joining the sync
websocket already grants full write. Treat a roomId like a password — never put one
in a commit, an issue, or anything public.

## Is this transport available?

```bash
curl -s -o /dev/null -w '%{http_code}' "$BASE/agent/room/probe-does-not-exist"
```

`404` with a JSON body → the API is there (that's the handler answering). Any HTML
error page, `405`, or a connection failure → it isn't; fall back to
`transport-browser.md`.

## Wake a cold server

Deployments that scale to zero answer `/health` non-200 when parked:

```bash
curl -s -o /dev/null -w '%{http_code}' "$BASE/health"
```

Waking is usually triggered by loading the web app, not by an endpoint you can
call. **Ask the user to open the board in a browser**, then poll `/health` until it
returns `200` (cold start is typically 30–90s). Don't build against a parked
server — every write fails.

## Read

```bash
curl -s "$BASE/agent/room/$ROOM" | jq '{viewers, shapes: (.shapes|length), pages}'
```

Returns `{roomId, viewers, pages, shapes, bindings}` with `richText` flattened to
`props.text` and coordinates rounded, so it's cheap to read. `?full=1` gives raw
records — use it when you need to copy an existing shape's exact prop shape.

`viewers` is how many people have the board open **right now**. `0` means you're
working unobserved; non-zero means humans see every intermediate state.

Take the page id from `.pages[0].id` — it's the `parentId` for top-level shapes.

## Write

```bash
curl -s -X POST "$BASE/agent/room/$ROOM" -H 'content-type: application/json' \
  -d '{"put":[ ...records... ],"delete":["shape:ai-old"]}'
```

Returns `{ok, put, deleted}`. Shapes and their bindings can go in one `put` array.

**Records here are complete, not partials** — every field of the envelope and every
prop. There is no `Editor` to fill in defaults. See `records.md`; its templates are
written for this transport.

A malformed record returns `400` carrying the schema's own message:

```
At shape(type = geo).props.color: Expected "black" or "grey" or … got chartreuse
```

That message enumerates the valid values — read it and correct the record rather
than guessing.

When someone is watching, splitting a build into a few logical batches makes it
animate in front of them instead of appearing all at once.

## Verify — records

```bash
curl -s "$BASE/agent/room/$ROOM" | jq '{shapes:[.shapes[]|{id,type,x,y,text:.props.text}], bindings:[.bindings[]|{from:.fromId,to:.toId,terminal:.props.terminal}]}'
```

This is the source of truth for **what exists**. Confirm every shape exists, every
arrow has **two** bindings, and no two bounding boxes overlap.

## Verify — layout

It is not the source of truth for **how it looks**, and treating it as one is the
most expensive mistake on this transport. Nothing here measures text: a `text`
shape with `autoSize: false` wraps past its `w` and collides with whatever is
below, while the read cheerfully echoes back the `x`/`y`/`w` you asked for. The
read looks clean on a render that isn't. **Only a screenshot catches it.**

So for anything text-heavy, borrow a browser tab purely to look — you are still
writing over HTTP:

1. Open the board's **web app** origin (not `$BASE` — the two hosts differ; see
   below) at `/r/$ROOM`.
2. Point the camera at the region you care about. You already know its coordinates,
   because you computed them when you built it. No bootstrap injection needed —
   `window.editor` is on the page:

```js
window.editor.zoomToBounds({x: -6400, y: 24540, w: 3350, h: 560}, {inset: 20})
```

3. Screenshot, and check it against the layout rules in `SKILL.md`.

`zoomToShapes([ids])` and `zoomToFit()` also work, but bounds are usually what you
want: a generated board is often thousands of units tall, and `zoomToFit` on one
renders every chart too small to judge.

**The web origin and `$BASE` are frequently different hosts.** The web app is an
SPA that answers `200` + `index.html` for any path, so probing `/agent/room/<id>`
there returns HTML — which means *wrong host*, not *no API*. Try the sync host
before concluding this transport is unavailable.

## Server contract

Any sync server built on `@tldraw/sync-core` can support this by adding two routes —
roughly 90 lines.

**`GET /agent/room/:roomId`** → `{roomId, viewers, pages, shapes, bindings}`.
Prefer the live room when one is open, else load the snapshot from storage —
**a read must not open a room**, or it creates one with no session attached.

```js
const open = rooms.get(roomId)              // already-open room, or undefined
const room = open ? await open : undefined
const snapshot = room ? room.getCurrentSnapshot() : await loadRoomSnapshot(roomId)
const records = snapshot.documents.map(d => d.state)
// viewers: room?.getNumActiveSessions() ?? 0
```

**`POST /agent/room/:roomId`** with `{put?, delete?}` → `{ok, put, deleted}`, or
`400` carrying the validator's message.

```js
const room = await makeOrLoadRoom(roomId)
await room.updateStore(store => {
  for (const id of del) store.delete(id)
  for (const rec of put) store.put(rec)
})
await closeRoomIfUnused(roomId)
```

**`closeRoomIfUnused` is the part that's easy to miss.** `onSessionRemoved` only
fires when a *session* goes away, and an HTTP write never creates one — so without
it the room pins in memory forever and any open-room-count signal never returns to
zero. A deployment that scales to zero on that signal will never scale down again.
Flush the snapshot, `close()`, and unregister when `getNumActiveSessions() === 0`.

**Do not add an `exec`-style endpoint** that runs caller-supplied JavaScript.
tldraw's desktop app has one, but it binds to localhost behind a per-launch token.
A sync server on the public internet with only a roomId in front of it would be
turning a leaked roomId into code execution. Structured put/delete only.
