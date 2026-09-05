# The exchange contract

Everything you need to build one. **You should not need to read `exchange.js`.**

## What an exchange is

A diagram of **something being presented, passed or proven between parties** —
a credential, a token, a request, an obligation. Actors sit in phase bands,
declared wires run between them, a labelled packet animates along a wire, and a
stepper narrates the hops one at a time.

**It is not a UML sequence diagram, and the difference is load-bearing.** There
are no lifelines: the vertical axis is **phase**, not time, and an actor is
repeated in every band it takes part in. You give up the continuous lifeline and
get to say how *often* each band happens — `once` / `per token` / `per request` —
which a sequence diagram cannot express. If you want lifelines, this is the
wrong tool.

**Reach for it when** the subject is a hop between parties. **Don't** reach for
it just because something has steps: a stepped explanation of one *value* or one
*page* is an ordinary viz with `stepper()` from `/_kit/viz.js`.

## The split

| | |
|---|---|
| `/_kit/exchange.js` + `.css` | The **experience** — zones, lanes, wires, animated packets, result panels, stepper, autoscroll. Shared by every exchange in every repo. |
| `<viz>/content.js` | The **content** — which boxes exist, where they sit, what flows between them, what each step says. |
| `<viz>/index.html` | ~20 lines bolting the two together, plus this page's own styles. |

**Rule: never edit `/_kit/exchange.*` to change one exchange.** Every exchange in
every repo shares it, so an edit there changes all of them — including ones
another agent is working on right now. If you think you need a runtime change,
stop and say so.

Nothing in a viz folder is imported by any other viz, so two agents editing two
exchanges **cannot** collide.

## Making a new one

```bash
bun ~/.claude/skills/viz/bootstrap.ts my-exchange --exchange --local
# edit my-exchange/content.js — and, for page-specific styling, its index.html
bun ~/.claude/skills/viz/check-exchange.ts my-exchange   # before you open a browser
```

`--exchange` composes with `--local` / `--global` like the other scaffolds.
To fork a working one instead, `bootstrap.ts <new-slug> --from <viz-folder>`.

## `content.js` shape

```js
export default {
  title: '…',                      // required — shown top-left
  subtitle: '…',
  stage: { w: 1780, h: 1630 },     // logical canvas; scaled to fit the window
  stepMs: 2400,                    // autoplay interval
  autoscroll: false,               // opt out of re-centring the view on every step
  theme: { accent:'#4aa8ff' },     // optional; any exchange.css :root var, without the --
  browser: { at:'admin', url:'…', body:'…' },  // optional travelling browser frame
  browserPhase: 1,                 // it dims outside this phase

  zones:     [ { cls, x, y, w, h, title, sub } ],
  firewalls: [ { x, y, h, label, labelAt } ],
  lanes:     [ { id, y, h, tag, name, tagX } ],
  nodes:     { id: { x, y, w, h, lane, cls, name, role, tag, spec } },
  boxes:     { id: { x, y, w, h } },   // non-node geometry wires may target
  panels:    [ { id, x, y, w, title, body, bodyCls, cls } ],
  labels:    [ { id, text, x, y } ],   // small green chips pinned on a handoff wire
  wires:     [ [from, to, opts] ],
  steps:     [ { p, t, from, to, pkt, ret, lit, browser, set } ],
};
```

### nodes

`cls` composes: `actor` (a person/system), `edge` (amber, the WAF), `store` (a datastore),
`db` (draws an actual database cylinder), `tall` (spans lanes — use for one store two
phases share), `bare` (name only, vertically centred — use when the name says it all).

`name` is required. `role` is the small grey line under it — **omit it** when the name is
self-explanatory; boxes with no role read much cleaner. `tag` is the little chip above-right
(`browser`, `curl`). `spec` is the violet badge naming the OAuth2 role this box plays
(`OAuth2 client`, `OAuth2 authorization server`, `OAuth2 resource server`,
`OAuth2 client registration`) — use it wherever it is true; it is one of the most useful
things on the diagram.

### wires

One entry per connection. The **third element picks the shape**; omit it for a normal
left-to-right hop between adjacent boxes.

| opt | shape | use for |
|---|---|---|
| *(none)* | horizontal S-curve | the ordinary next hop |
| `{dip:1}` | ducks below the row | reaching past a box in the way |
| `{up:1}` | curves up into a box in the lane above | a later phase calling back to a shared service |
| `{back:1}` | drops, sweeps right-to-left, ends horizontally in a box | the response returning to a result panel |
| `{hand:1}` | short vertical | one phase's result feeding the next phase's actor |

`{cls:'…'}` is **not** a shape — it appends a class to the path so a variant can style
that wire in its own `index.html`. Use it when a wire differs in *kind* rather than in
*route* (e.g. proposed-vs-existing). It composes with any shape opt. Do not add styles
for it to `exchange.css`; that would leak one variant's meaning into all of them.

Endpoints are computed from geometry, so **moving a box never strands its arrows.**
A `{back:1}` wire must target a `boxes` entry (a result panel), not a node.

### steps

```js
{ p: 2,                          // lane id — highlights that lane
  t: 'The auth service reads the store',   // the one line in the footer
  from: 'auth', to: 'sqlcred',   // must have a wire between them (either direction)
  pkt: 'SELECT',                 // packet label; '' animates the wire with no chip
  ret: 1,                        // green packet (a response) instead of blue
  lit: ['auth','sqlcred'],       // override which nodes glow; defaults to from+to
  browser: { at:'eadv', url:'…', body:'…' },
  set: { 'p-tok': '<span class="s">…</span>' } }   // fill panels by id
```

`also: [{from, to, pkt, ret, green}]` flies **extra packets at the same time** as the
step's own. Use it when a hop has a side effect that genuinely happens *with* it rather
than after it — an audit log, a mirror write, a fan-out. Each entry needs a declared wire
just like `from`/`to`, and `check-exchange.ts` enforces that. Everything it touches lights up too.
Prefer this over a follow-up step whenever the two things are simultaneous in reality:
a separate step says "and later…", which is a different claim.

`set` is how a step changes a panel. The engine has **no idea** what any panel means —
it just writes your HTML into that panel's body. Declare the panel in `panels`, fill it
from a step. Keep short hops' `pkt` labels short: the chip parks at the wire's midpoint,
and a 20-character label on a 60px gap will overlap its neighbours.

### body HTML classes

`mono` (set as `bodyCls` on the panel), then inside: `k` key, `s` string/value,
`c` comment/dim, `mid` the highlighted id you are tracing through the whole exchange.
Using `mid` for one value in three different panels is what makes a thread followable.

## Layout budget — read before placing anything

These are the mistakes that cost the most rework:

- **Decide the columns and row centres first.** Give every box on a row the same vertical
  centre, then vary heights around it. Retro-fitting a row is what breaks arrows.
- **Leave ≥80px between boxes on a row.** Packet chips park in that gap.
- **Panels stack in the left column**: actor → what it sends → result. Leave ~14px between
  them; a panel's real height is content-driven and will exceed the `h` you guessed.
- **Anything in `boxes` is invisible** — it exists only so a wire can aim at it. Give a
  result panel a `panels` entry *and* a `boxes` entry with the same rect.
- `check-exchange.ts` catches over-stage and overlapping boxes. It cannot see a panel that grew
  taller than you expected — measure that in the browser.

## Verify before you call it done

```bash
bun ~/.claude/skills/viz/check-exchange.ts <viz-dir>   # structure
bun ~/.claude/skills/viz/verify.ts <url>                # renders, no errors, no layout findings
```

`verify.ts` writes a screenshot to its `.verify/latest.png` — look at it. A clean run means
nothing is broken, not that it reads well.
