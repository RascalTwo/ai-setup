# Publishing — the optional features

Reached from the routing table in the core publishing doc, which is the required path for
every publish. Read only the section the user's request needs. Flags:
`viz publish --help`.

## Contents
- The lobby
- Private lobby — the whole site behind one password
- Open Graph — the card a URL unfurls into
- Card-public share pages — unfurling behind SSO
- Rotating keys
- Refreshing vendored copies

## The lobby

The **lobby** is a container's front page: the `index.html` at the site root listing every
viz in the run as a card, at `<host>/`. `viz publish` regenerates it every run; `viz export`
leaves it alone. Lobby title and blurb are `viz publish` options, as is skipping it.

- **Cards read from source, never the built artifact** (a sealed page's `<head>` is
  encrypted). A **public** card shows title, blurb and tag chips; a **private** card is
  minimal — real title and a 🔒 "Link required", no description — so the lobby lists
  everything without leaking a sealed viz. The lobby never carries a key.
- **Card text** comes from each viz's `<head>`: `viz:title` (else `<title>`),
  `viz:description` (else `description`), and one chip per repeated `viz:tag` meta.
- **List / Grid.** Grid (the default, remembered per browser) leads each card with the
  viz's hero image — the same OG image as below — with the blurb clamped to three lines. A
  public viz with no image gets a gradient placeholder; private cards get a lock. Thumbnails
  are copied to `<out>/_thumbs/`, so grid works in `preview` too.
- **Preamble.** A `_preamble.html` at the **container root** (beside the slug dirs) is
  injected verbatim above the first card — trusted HTML, no escaping, no markdown.

### The lobby's own preview card

With a real `--base-url`, the lobby gets its own Open Graph card *about the collection*: an
auto-rendered 1200×630 montage of the public vizzes' hero thumbnails (never cropped, newest
first, up to 20 plus a `+N` tile) with the site title and count, written to
`_thumbs/lobby-og.png`. Nothing to author — add heroes to your vizzes and it composes itself.
Without `--base-url`, or without Chrome, it degrades to a text-only card. A private lobby gets
no card at all (its head is encrypted).

### Spoiler cards

`<meta name="viz:spoiler" content="true">` makes the lobby blur that card's hero and blurb
until clicked (re-blurs on reload; the title stays visible). It lets you write an honest,
spoiler-full hero and description. **It only guards the lobby**, not the OG unfurl — a link
pasted into Slack still previews the full hero.

## Private lobby — the whole site behind one password

Drop an **empty marker file** at the container root:

```bash
touch <container>/_private-lobby
```

Its presence is the whole signal. A build or preview of that container then:

- **Seals every `public` viz and the lobby** with one shared **lobby key**. `local` vizzes
  are still skipped.
- **Enter once, browse freely.** All lobby-sealed pages share one passphrase, so
  StatiCrypt's remember-me carries across them. The build prints the passphrase and a magic
  link with `&remember_me` (log out with `#staticrypt_logout`).
- **`private` vizzes keep their own key** — having the lobby password is not having the
  private page's. Deliberate compartmentalization.
- **Each public viz still gets a share link** — an unsealed share shim (below) whose hash
  *is* the lobby key, so a per-viz link grants whole-site access. A viz that needs an
  isolated key should be `private`.

The key lives in the machine-local keystore (`<container>#lobby`), auto-minted on first
build, never in git — so it **re-mints on a fresh clone** (rebuild and redistribute). A
committed key was rejected: it opens repo-visibility-flip, fork and CI-token leak paths. The
marker is never emitted into the output. **Fail-closed:** if the container is outside
`$HOME` so its key can't resolve, the build refuses rather than publish in the clear.

## Open Graph — the card a URL unfurls into

Every **public** viz gets `og:*` tags so a pasted link unfurls in Slack, Discord, Webex,
Teams, iMessage. Text comes from `viz:title`/`viz:description`, so a card unfurls even with
no image. `og:url`/`og:image` need a real `--base-url` (crawlers reject relative URLs).

**Sealed vizzes** (`private`, or `public` inside a private lobby) can't carry tags in an
encrypted head, so the build publishes an unsealed **share shim** at a secret path
(`<slug>/<hash>/`) holding the card, which JS-redirects into the sealed page's magic link.
That shim URL — the `🔗` the build prints — is the one to share. It assumes a **private**
source repo; a public one would expose the shim's path and credential.

**The image** is static, **1200×630**, **≤~300 KB**. That is the one ratio verified to
unfurl cleanly on Slack, X, Teams, WebEx and Discord — they centre-crop anything taller, so
keep key content in the middle ~1080×565. An animated card is an option too — see the last
bullet below.

**Provenance is the filename.** The build takes the first of `og.gif` → `og.png` → `og.jpg` →
`og.auto.png`, and **warns** when a public viz would ship a bare page screenshot or nothing,
or when `hero.html` is newer than its `og.auto.png` (re-shoot). Three ways to get one:

- **A hero card (the usual answer).** `viz create --hero` scaffolds a `hero.html` — a
  1200×630 `.og-card` built on `/_kit/viz-og.css`, so it re-themes with the viz; for an
  existing viz, start from the skill's `hero-template.html`. `viz verify <url> --og` renders
  it and clips to the card → `og.auto.png`. Re-run after any edit. **Don't copy another
  viz's hero** — it carries that viz's palette and content. Anatomy: `kit/README.md`.
- **Auto, as a floor.** Without a `hero.html`, `viz verify <url> --og` shoots the live page at
  card aspect. Add a `verify.interactions.ts` if the page needs setup to look good.
- **A human image.** Normalize a supplied image deterministically (macOS built-ins, no
  install):

  ```bash
  # clipboard → file (optional)
  osascript -e 'set f to (open for access POSIX file "/tmp/og-src.png" with write permission)' \
    -e 'write (the clipboard as «class PNGf») to f' -e 'close access f'
  # centre-crop to 1.91:1, then scale to 1200×630
  read -r SW SH < <(sips -g pixelWidth -g pixelHeight src.png | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w,h}')
  CW=$((SH*1200/630)); CH=$SH; [ "$CW" -gt "$SW" ] && { CW=$SW; CH=$((SW*630/1200)); }
  sips -c "$CH" "$CW" src.png --out crop.png >/dev/null   # -c is HEIGHT WIDTH, centred
  sips -z 630 1200 crop.png --out <vizdir>/og.png >/dev/null
  # over ~300 KB → JPEG
  for Q in 85 75 65 55; do sips -s format jpeg -s formatOptions $Q og.png --out og.jpg >/dev/null
    [ "$(stat -f%z og.jpg)" -le 307200 ] && { rm og.png; break; }; done
  ```

  A human `og.gif`/`og.png`/`og.jpg` always wins over `og.auto.png`.
- **Animated: `og.gif`, plus `og.mp4`.** For a viz whose point is motion. `og.gif` becomes the
  image: Slack and Telegram animate it, and everywhere else shows its **first frame** — so
  cut the loop to start on the frame that works as the still. `og.mp4` beside it becomes
  `og:video`, which Discord, Telegram and iMessage can play; the rest ignore it. Sizes are
  read from the files. Budget the GIF **under 1 MB** (Slack and iMessage drop bigger ones;
  the build warns) — around 800 wide, 8 fps, 64 colours, `dither=none`, `stats_mode=full`
  for a 20-second loop. LinkedIn may reject GIF previews outright and WhatsApp caps
  images at 600 KB, so stay static if those matter. Record with the `browser-capture`
  skill's `record-flow.js` against a **built** copy (`viz publish … --out`), never the dev
  server, whose overlays land in the frame. Worked example with the exact commands:
  `ai-setup/viz-pages/tool-ttyimgspool/og-flow.js`.

## Card-public share pages — unfurling behind SSO

If the host gates the whole site (e.g. behind CloudFront-AuthGuard), an unfurler gets a
login redirect and never sees the tags. A **public** viz whose card a human has reviewed as
safe (`viz update <viz> --card-public true`) gets, in a build with `--base-url`:

- `share/<slug>/index.html` — `noindex`, holds the OG tags with `og:url` set to itself,
  and redirects to `<base-url>/<slug>/` by JS only (a meta refresh would send the crawler
  into the login and lose the card). The target is fixed at build time, so it isn't an
  open redirect.
- `share/<slug>/<og image>` — a copy of the hero.
- `_public-paths.txt` at the out root — one URL path per share file, for the host's
  exact-path allowlist. Always written with `--base-url`; empty when there are no shares.

The build prints `🔗 share: <url>` per page — that's the one to paste; the viz itself stays
behind the login. No page is emitted for a card that is `not-public`, `stale` (changed since
review), `unreviewed`, private or lobby-sealed, or without `--base-url`. A viz slugged
`share` makes the build refuse. `viz urls <container>` lists the share URLs later. ADR 0018.

## Rotating keys

`viz rotate <viz>` revokes a private viz's magic link; `viz rotate <container> --lobby`
revokes the lobby key and passphrase for the whole site. The old link dies at once; the next
publish and redeploy mint the new one, which you then redistribute. A linked viz refuses
without `--break-links` (ADR 0016).

## Refreshing vendored copies

A **vendored** copy is a viz living as *source* in another repo so that repo can run it on
its own. `viz publish <origin-container> --push-vendors` refreshes every declared copy.

**Opt-in on purpose:** it writes recursive source trees — and prunes with `rm -rf` — into
another repo's working tree, so it must never be a side effect of "I ran a build". Without
the flag nothing is written; with `--out` it is still skipped (a throwaway dist), and
`preview` never pushes.

Per declared sink, a push:

1. Copies each viz dir verbatim, stripping machine-local files (`VENDOR_STRIP` in
   `lib/publish/vendors.ts`: the feedback log `.viz-data/`, markers, `.runtime/`, `.verify/`).
2. Writes a committed `.vendored.json` receipt — `{ origin, access, vendoredAt }`, with a
   `$HOME`-relative origin, never an absolute path.
3. **Prunes origin-scoped** — only sink dirs whose receipt names *this* container and are no
   longer declared.

Two refusals: **`access` must equal the origin's posture** (the copy is byte-identical, so
posture can't be re-framed; rewriting would fork the keystore and mint a dead link), and
**any failed edge cancels the prune for that sink** — if a renamed copy's write failed,
pruning would delete the sink's only copy. Stale beats absent. Drift is caught separately
by `viz vendor check`.
