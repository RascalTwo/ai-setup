# Publishing a viz to a static host

When the user wants a viz reachable **over the internet** (not just on localhost), publish it. Publishing produces one **self-contained HTML** (kit inlined) per viz that any dumb static host serves — GitHub Pages or GitLab Pages alike. A **static viz** (no `api.ts`) ships as a plain inlined page — no tape, no shim, **no frozen-snapshot banner**. An **api-backed viz** is machine-bound, so record a tape first (see `reference/backend.md`); it then ships as a **frozen tape** — the tape + a client-side `api/*` shim are inlined and a frozen-snapshot banner is added so a viewer never mistakes the snapshot for live data.

The tool is `build.ts` (central-only, never vendored — publishing is an author action). There is **no `--public`/`--private` flag** — each viz declares its own posture (see below), so the CLI is invoked the same way every time:

```bash
bun "$SKILL_DIR/build.ts" preview <container> [--port <n>] [--open]      # SEE what would publish, served locally
bun "$SKILL_DIR/build.ts" <container> [--out <dir>] [--base-url <url>]   # build a whole container
bun "$SKILL_DIR/build.ts" export <vizDir> [--out <dir>]                  # one viz (dev/test primitive; no index)
bun "$SKILL_DIR/build.ts" rotate <vizDir>                                # revoke + re-mint a private link
bun "$SKILL_DIR/build.ts" rotate <container> --lobby                     # revoke + re-mint a container's LOBBY key
```

## Preview what would publish — locally, first

When the user asks to *see what would be published* ("show me the published site", "what would this look like deployed", "preview the static build") — use `preview`, **not** the live dev server (which serves editable source from `127.0.0.1:5180`). `preview` builds the **exact publishable tree** — self-contained artifacts, mirrored-in vizzes copied verbatim, the composed lobby, private vizzes sealed behind their StatiCrypt gate — into a throwaway temp dir and serves it over plain HTTP, so you're looking at the real deployable bytes, not the dev experience.

```bash
bun "$SKILL_DIR/build.ts" preview <container> [--port <n>] [--open]
```

- **Side-effect-free by design.** It is the build-and-STOP core *without* the outbound steps: it **never pushes mirrors** into other containers and **never deploys**. Previewing a source container does not touch its mirror sinks. Nothing is committed.
- **Port:** omit `--port` and the OS assigns a free one (printed in the output); pass `--port <n>` to pin it.
- **Opening it:** the command prints the URL. For an agent, run it **in the background** and open the printed URL with the browser tools (so you can screenshot/inspect); a human can pass `--open` to launch the OS default browser, or just click the URL. The server runs until `Ctrl-C` (or the process is killed).
- Honors the same gates as publish: an **undeclared `viz:posture` still refuses** (you preview exactly what would/wouldn't publish), `local` vizzes are skipped, `unlisted` are built-but-off-the-index.

## Posture is per-viz — declared in the viz, not on the command line

Each viz declares its **posture** — `public`, `private`, or `local` — **in its own `index.html`**:

```html
<meta name="viz:posture" content="public">   <!-- or "private", or "local" -->
```

This meta is the **sole source of truth**. Consequences:

- **One run can mix postures** — a container is no longer all-or-nothing. Each viz builds (or is skipped) per its own posture.
- **Redeploys need no re-input** — the posture rides in the committed source, so rerunning the same command reproduces the same split (and the same magic links — keystore is stable until `rotate`).
- **Untagged = hard error.** A viz with no `viz:posture` makes the whole run **refuse**, naming the offenders. Nothing is ever published *or withheld* on a guess — to deliberately keep a viz off the host, tag it `local` (don't just leave it untagged). Bootstrap scaffolds new vizzes with `local`, so this rarely bites.
- **`public`** — hosted as-is; anyone with the URL sees it. No encryption.
- **`private`** — sealed with StatiCrypt (AES-256) and shared via a **magic link** (the decryption key rides in the URL `#fragment`, never sent to the server). **The encryption *is* the access control** — host/site visibility is irrelevant. Possession of the link = access. Threat model: *people I share with, and their forwards, are fine; random internet is not.* Secrets live in a local, gitignored keystore (`CENTRAL/.keystore.json`); links are **stable across redeploys** until you `rotate`.
- **`local`** — **never published.** The run silently skips it (printing a one-line note); the viz and its source stay on your machine, never reaching the host. This is the default a new viz is scaffolded with — flip it to `public`/`private` only when you mean to share.

## Listing is a separate axis — hide a viz from the lobby

Posture controls *access*; **listing** controls whether a viz shows up on the lobby. They're independent. Add to a viz's `index.html`:

```html
<meta name="viz:listed" content="unlisted">   <!-- "listed" | "unlisted"; legacy "false" also unlists -->
```

A viz with no `viz:listed` meta (or `listed`/`true`) is **listed**; new vizzes are scaffolded `unlisted` as the safe default. An **unlisted** viz is still **built and hosted** — reachable by anyone who has its direct URL. It's just absent from the lobby (no card, public or private). This is **UX-level non-advertisement, not security**: a determined visitor can still reach it by guessing the slug, via a public dist repo's file tree, sitemaps, or referrers. So if a viz's *name or content* is sensitive, don't lean on `unlisted` — use `private` (sealed) **and a non-revealing slug**. Unlisted is the "don't advertise this, but I'm fine if it's found" knob, and it composes with any posture (a `private` + unlisted viz is sealed *and* off the lobby).

## Kind is a third axis — explanatory vs operational

Posture controls *access*; listing controls *advertisement*; **kind** describes *what sort of viz this is* — and unlike the other two it's a **view-time** concern, not a publish-time one. Add to a viz's `index.html`:

```html
<meta name="viz:kind" content="operational">   <!-- "explanatory" (default) | "operational" -->
```

- **`explanatory`** (default, and what every absent/unrecognized value falls back to) — a timeless diagram, chart, or illustration. Freezing it loses nothing; a recorded snapshot is just as good as the live page.
- **`operational`** — a live-monitoring tool whose truth has a **shelf life** (queue depths, run status, live metrics). A frozen copy looks identical to live data but is stale the moment the tape was cut.

The litmus test: *"if I froze this, would it still do its job?"* If no, it's `operational`. The flag is **human-set** — having an `api.ts` does **not** make a viz operational; plenty of api-backed vizzes are explanatory. Two effects, both no-ops for `explanatory`:

1. **Louder frozen banner** — when viewed frozen (server `--frozen`, or a published export replaying a tape), an operational viz shows a red "live monitoring tool, NOT current state" banner instead of the plain amber "Frozen snapshot".
2. **Operational badge** on the lobby card (⚡ Operational), so real tools are distinguishable from sketches at a glance.

Kind does **not** gate publishing — an operational viz publishes exactly like any other; it just warns harder when its data is frozen.

## The lobby — a container's front page

The **lobby** is a container's front page: the auto-generated `index.html` at the site root that lists every viz as a card. It's what a visitor lands on at `<host>/`, and it's the term used everywhere for this page. Like a viz, a lobby has a **public/private** axis: by default it's **public** (open the URL, you're in); drop a `_private-lobby` marker and it becomes **private** — the whole site sits behind one password and the public vizzes inside inherit it (see [Private lobby](#private-lobby--seal-the-whole-lobby-behind-one-password) below).

A deployment place holds **many vizzes** — one self-contained page per slug dir (`<out>/<slug>/index.html`), reachable at `<host>/<slug>/`. The container run regenerates the **lobby (`index.html`)** at the out root listing **every viz in the run**, so the result is a browsable multi-viz site at `<host>/`.

- **Cards read from source, never the built artifact** (a sealed private page's `<head>` is encrypted). A **public** card shows title + blurb + eyebrow; a **private** card is minimal — real title + a 🔒 "Link required", **no description** — so the lobby lists everything without leaking a sealed viz's content. Clicking a private card lands on the StatiCrypt gate; the lobby never carries the key.
- **Card text** comes from each viz's own `<head>`: title from `<meta name="viz:title">` (else `<title>`), blurb from `<meta name="viz:description">` (else `<meta name="description">`), and optional eyebrow tags from one or more `<meta name="viz:tag">` elements — repeat the element to attach several tags (each renders as its own chip). A viz with `viz:kind=operational` also gets a ⚡ Operational badge (see "Kind is a third axis").
- **List / Grid views.** The lobby has a **List ↔ Grid** toggle (top-right, shown once there are ≥2 vizzes). **List** is the original stacked layout. **Grid** lays the cards out in columns, each led by the viz's **hero image** — the very same OG image (`og.png`/`og.jpg`/`og.auto.png`, see below) — with the description clamped to three lines. A public viz with no OG image gets a subtle gradient placeholder banner; **private** cards stay minimal (no image — a lock placeholder in grid) so nothing leaks. The chosen view is remembered per browser (localStorage); the page **opens in Grid by default**. The thumbnail is copied into `<out>/_thumbs/<slug>.<ext>` at build time, so grid works in `preview` too (independent of `--base-url`, unlike the OG unfurl image).
- **Preamble (optional):** drop a `_preamble.html` at the **container root** (next to the slug dirs, not inside one) and its contents are injected verbatim into the lobby, between the "visualizations" eyebrow and the first card. It's authored HTML — trusted, emitted as-is, no escaping and no markdown engine — so write whatever you want (a `<h2>` intro, a `<p>` with links, a note). Absent file → no preamble. It's per container, so each deployment place sets its own. (`.preamble` styling — muted body text, accent links, mono `code` — is in the generated page's CSS.)
- **Flags:** `--no-index` skips index regeneration; `--index-title <t>` sets the lobby title (default "Visualizations"); `--index-description <t>` sets its unfurl blurb (default: an auto count, e.g. "7 interactive visualizations").
- The container run owns the lobby and regenerates it each run; a single `export` builds one artifact and leaves the lobby alone.

### The lobby's own hero — a "meta" OG card (auto-generated)

The lobby is itself a shareable link, so it gets its **own** rich preview — the same Open Graph treatment an individual viz gets, but *about the collection*. With a real `--base-url`, build injects `og:title`/`og:description` into the lobby head and auto-renders a **1200×630 montage** that showcases the contained vizzes: a grid of their **hero thumbnails** shown whole at their own aspect (never cropped; the column count is chosen dynamically to make the tiles as large as they can be for the actual viz count, newest first, up to 20 with a `+N` tile for the rest) with the site title + count on a slim caption strip below. It's written to the dist as `_thumbs/lobby-og.png` and pointed at by `og:image`, so pasting the site root into Slack/Discord/etc. unfurls into a card that literally previews what's inside.

- **Auto, no authoring.** The montage is rendered from the same hero thumbnails the grid view already uses (headless Chrome, the engine behind `verify.ts --og`). Nothing to draw — add heroes to your vizzes and the lobby card composes itself. Regenerated every build.
- **Blurb.** Defaults to a count (`N interactive visualizations`); override with `--index-description "<t>"`. The title is `--index-title` (default "Visualizations").
- **Degrades gracefully.** No `--base-url` (e.g. plain `preview`) → a **text-only** card (title + blurb, no image), and no Chrome is launched — so live-reload preview stays fast. If Chrome is unavailable the build still succeeds with the text-only card. Only **public** heroes feed the montage (a private viz never contributes its thumbnail).
- **Private lobby.** A `_private-lobby` (sealed) lobby gets **no** OG card at all — its head is encrypted, so a preview would leak nothing and unfurl nothing by design. This is a public-lobby feature.

## Private lobby — seal the whole lobby behind ONE password

Making a lobby **private** puts the *entire* published site (the lobby page + every `public` viz in it) behind a single StatiCrypt password, instead of (or on top of) per-viz postures. Opt in by dropping an **empty marker file** at the container root:

```bash
touch <container>/_private-lobby
```

Its **presence** is the whole signal (contents are ignored — it's not JSON). With it, a build/preview of that container:

- **Seals every `public` viz *and* the lobby** with one shared **lobby key** (passphrase + salt). Public mirrored-in artifacts are sealed too; a `local` viz is still skipped entirely.
- **Every `public` viz still gets a per-viz share link.** A sealed page can't unfurl (its `<head>` is encrypted), so build emits an unsealed OG-card **share shim** at `<slug>/<lobby-hash>/` that redirects in with the lobby key + `&remember_me`. Paste *that* `🔗` (build prints one per viz) for a rich preview that also opens the site. Its hash IS the lobby key, so the per-viz link grants whole-site access — that's the lobby model (one password, browse freely); reach for posture:`private` when a viz needs an isolated key.
- **`private` vizzes keep their OWN key.** A lobby visitor sees their minimal card on the (now-sealed) index but must still open that page's own magic link — deliberate compartmentalization ("having the lobby password ≠ having the private page's password").
- **Enter once, browse freely.** Because all lobby-sealed pages share one passphrase+salt, StatiCrypt's *remember-me* carries across them: unlock the lobby once and every public page auto-decrypts as you navigate — no re-prompt. `build.ts` prints the lobby **passphrase** and a **magic link** with `&remember_me` appended, so opening the link stores the credential and the whole site just opens. (Log out with `#staticrypt_logout`.)

**The key lives in the machine-local keystore**, keyed `<container>#lobby` — exactly like a private viz's key. It is **auto-minted on first build**, never touches git, and — same tradeoff as all keystore keys — **re-mints on a fresh clone** (the old lobby link dies; rebuild + redistribute). Only the `_private-lobby` marker is committed; the secret is not. *(We deliberately did NOT store the passphrase in the repo — a committed key opens repo-visibility-flip / fork / CI-token leak paths we chose not to take.)*

**Guarantees:**
- The marker is **read at build time and never emitted** into the output tree (like `_preamble.html` / `mirrors.json`) — the site's own directory listing never exposes it.
- **Fail-closed:** if `_private-lobby` is present but the container is outside `$HOME` (so its key can't be resolved), the build **refuses** rather than silently publishing everything in the clear.
- **`preview` seals too** — you see the locked lobby exactly as it will deploy.

**Cards don't change** — public cards stay full, private cards stay minimal; the only new output is the sealed `index.html`. Because the whole index is behind the lobby password, the full public-card blurbs are only visible to someone who already has the lobby key.

## Rich link previews (Open Graph) — the card a URL unfurls into

When a viz's URL is pasted into Slack/Discord/Webex/Teams/iMessage/etc., the platform fetches the page and builds a preview card from `<head>` meta tags. `build.ts` injects these automatically. For a plain **public** viz they go straight into the plaintext page head. A **sealed** viz — whether posture:`private` *or* a `public` page inside a **lobby** — can't carry a card in its encrypted head, so build instead publishes an unsealed **share shim** at a secret path (`<slug>/<staticrypt-hash>/`) that holds the card and JS-redirects to the sealed page's `#staticrypt_pwd` magic link — the shim URL becomes the thing you share (the `🔗` build prints), and its image lives under the same secret path so nothing leaks at a guessable URL. A **private** viz's shim uses that viz's own key; a **lobby** viz's shim uses the shared lobby key and its redirect adds `&remember_me` (open one viz → the whole site unlocks as you browse) — which also means a lobby share link *grants whole-site access*, so use posture:`private` for a viz that must keep its own separate key. Needs `--base-url`; assumes a **private** source repo (a public repo would expose the shim's path and credential). Either way the tags are:

- **Text** (`og:title`/`og:description`) — from the viz's `viz:title`/`viz:description` (same source as the lobby card). Always present; the card unfurls even with no image.
- **Image** (`og:image`) — optional, **static**, **1200×630** (1.91:1), **≤~300 KB**. Animated GIFs animate in cards on Discord *only* (everywhere else shows frame 1), so don't bother — a crisp still is the whole game. `og:url`/`og:image` are emitted only with a real `--base-url` (absolute URLs are required; crawlers reject relative and `data:` URIs).

**Image provenance is the filename** (no embedded metadata — visible in `ls`/`git`, no `exiftool` dep). `build.ts` picks the first of: `og.png` → `og.jpg` → `og.auto.png`, and **warns at publish** when a public viz would ship a bare live-page `og.auto.png` (auto) or nothing — your cue that the card still wants a real picture. A hero-backed `og.auto.png` (Path A2) is treated as the polished card, so it draws no nag — but if `hero.html` is *newer* than `og.auto.png`, build warns it's stale (re-run `--og`).

**Path A — auto (a non-embarrassing floor):**
```bash
bun "$SKILL_DIR/verify.ts" <id> --og     # 1200×630 shot → <vizdir>/og.auto.png
```
Reuses the verify screenshot; if the viz needs setup to look good, add a `verify.interactions.ts` (click/scroll to a good state — it runs before the shot). Captures at the card aspect, so no cropping.

**Path A2 — hero card (the polish, without leaving HTML):** drop a `hero.html` in the viz dir — a self-contained page whose 1200×630 OG surface is an element with class `.og-card` (or `.card`). `verify.ts --og` detects it, renders *it* instead of the live page, and clips to that element → `og.auto.png`. This is the sweet spot: a designed card (headline, mini-scenes, brand) authored in the same HTML/CSS as the viz, regenerated by re-running `--og` after any edit. Same tokens as the viz? `<link rel="stylesheet" href="/_kit/viz-kit.css">`. Because the card lives in `git`, it's diffable and survives retitles — just re-shoot.

**Path B — human image (the polish), normalized deterministically:** the agent takes an image you provide and fits it to spec. No manual editing — the only taste call (what to capture) is already made.

1. **Get the source.** A file path you give, a file dropped in the viz dir, or your clipboard on macOS (no install):
   ```bash
   osascript -e 'set f to (open for access POSIX file "/tmp/og-src.png" with write permission)' \
     -e 'write (the clipboard as «class PNGf») to f' -e 'close access f'
   ```
2. **Normalize** to 1200×630 with built-in `sips` (center-crop to aspect → scale; verified exact):
   ```bash
   read -r SW SH < <(sips -g pixelWidth -g pixelHeight src.png | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w,h}')
   CW=$((SH*1200/630)); CH=$SH; [ "$CW" -gt "$SW" ] && { CW=$SW; CH=$((SW*630/1200)); }
   sips -c "$CH" "$CW" src.png --out crop.png >/dev/null   # -c is HEIGHT WIDTH, centered
   sips -z 630 1200 crop.png --out <vizdir>/og.png >/dev/null
   ```
3. **Size budget** — if `og.png` > ~300 KB, re-encode as JPEG until it fits (PNG is lossless, so this is the only knob), writing `og.jpg` instead:
   ```bash
   for Q in 85 75 65 55; do sips -s format jpeg -s formatOptions $Q og.png --out og.jpg >/dev/null
     [ "$(stat -f%z og.jpg)" -le 307200 ] && { rm og.png; break; }; done
   ```

A human `og.png`/`og.jpg` always wins over `og.auto.png`, so dropping one in silently clears the publish warning. `sips`/`osascript` are macOS-only, but this is a local author action — the build itself stays cross-platform and only cares that a ~1200×630 `og.png` exists.

## The secret-scan + human gate — DO THIS before every publish (public or private)

`build.ts` is purely mechanical: **it seals whatever tape is on disk.** Sanitizing the tape is *your* job, not the tool's. Before publishing, for each viz being published:

1. **Read its `recordings.json`** and scan for anything that should not leave the machine — API keys, tokens, internal hostnames/IPs, emails, paths that reveal more than intended, customer data.
2. **Advise the user, don't auto-redact.** Surface concrete findings (e.g. *"⚠️ `GET /meta` body line 40 looks like an AWS access key — leave it in?"*) or give the all-clear (*"nothing jumped out"*). There is deliberately **no scrubber** — the human decides and hand-edits the tape.
3. Only after the human signs off, run `build.ts`.

For a **private** viz the encryption is a backstop, but the scan still matters (defense-in-depth). For a **public** viz there is **no backstop at all** — the scan is the only thing between the tape and the open internet, so be thorough. In a mixed run, scan every viz, and pay closest attention to the public ones.

## After publishing

- `build.ts` prints each magic link (private) and writes artifacts to a local `dist` dir. **It does not deploy.** Present the links / dist path to the user.
- **Deploying is a separate, explicit, human-confirmed step** — force-push the sealed set to the Pages branch (`gh-pages`) only when the user says so. Never push on your own initiative.
- **Rotation revokes:** `build.ts rotate <vizDir>` bumps the version so the next publish of that (private) viz mints a fresh magic link and the old one dies. For a **lobby**, `build.ts rotate <container> --lobby` rotates the container's lobby key (`<container>#lobby`) — the next publish + redeploy mints a new lobby link *and* passphrase, killing the old ones for the whole site; redistribute the new link.
