# Publishing a viz to a static host

Read this whole file before any publish. The optional features are split out:

| If the user wants… | Read |
|---|---|
| to publish, preview the deployed site, or deploy | this file — all of it |
| the lobby's look (title, intro blurb, list/grid, its own preview card), spoiler cards | `reference/publishing-advanced.md` → **The lobby** |
| the whole site behind one password | `reference/publishing-advanced.md` → **Private lobby** |
| a better link-preview card, or publish warned that a public viz has no designed card image | `reference/publishing-advanced.md` → **Open Graph** |
| links that unfurl although the host sits behind SSO | `reference/publishing-advanced.md` → **Card-public share pages** |
| to revoke and re-issue a private link or lobby key | `reference/publishing-advanced.md` → **Rotating keys** |
| to refresh vendored copies in other repos | `reference/publishing-advanced.md` → **Refreshing vendored copies** |

## Preview, publish, export

Publishing turns a **container** (the central library, or a repo's `viz-pages/`) into one
**self-contained HTML** per viz (kit inlined) plus a **lobby** index page, for any static
host (GitHub/GitLab Pages or anything else). Flags: `viz <verb> --help`.

- **`viz preview <container>`** — builds the exact deployable tree into a temp dir and
  serves it on localhost. Use it when the user asks to *see what would publish*; the dev
  server shows editable source, not the deployed bytes. Side-effect free: no pushes to
  other repos, no deploy, no commit. For an agent: run it in the background and open the
  printed URL with browser tools.
- **`viz publish <container>`** — builds the container into a dist dir. **It never deploys.**
- **`viz export <viz>`** — builds one viz with no lobby; a dev/test primitive.

A **static viz** ships as a plain inlined page. A page that `fetch()`es its own files at
runtime (a `plan.json`, `data.json`, a `scenes/` folder) declares them —
`<meta name="viz:bundle" content="data.json scenes/">` — and the export carries them inside
the one file; anything it fetches without declaring it warns. An **api-backed viz** only works where its
data lives, so it needs a recorded tape first (`reference/backend.md`); it ships as a
frozen tape behind a snapshot banner so no one mistakes it for live data.

## Posture and listing — declared in the viz, never on the command line

Each viz's `index.html` carries its own axes, set with `viz update`:

- **`public`** — hosted as-is; anyone with the URL sees it.
- **`private`** — sealed with StatiCrypt (AES-256) and shared as a **magic link** whose key
  rides in the URL `#fragment`. The encryption *is* the access control: possession of the
  link is access, so forwards are fine and the random internet is not. Keys live in a
  gitignored local keystore and stay stable across redeploys.
- **`local`** — never published; skipped with a one-line note. New vizzes start here.
- **No posture = the whole run refuses**, naming the offenders. Nothing is published or
  withheld on a guess; to keep a viz off the host, tag it `local`.
- **`unlisted`** keeps a viz off the lobby but still hosted — reachable by anyone with the
  URL. It is non-advertisement, not security: a sensitive name or content needs `private`
  **and** a non-revealing slug.

## Before every publish: two gates

### 1. Secret scan — yours

The build seals whatever tape is on disk; sanitizing it is your job. For each viz being
published, **read its `recordings.json`** and look for anything that shouldn't leave the
machine: keys, tokens, internal hosts/IPs, emails, revealing paths, customer data. **Advise,
don't auto-redact** — surface concrete findings (*"`GET /meta` line 40 looks like an AWS key
— leave it in?"*) or give the all-clear. There is deliberately no scrubber; the human decides
and hand-edits the tape. A `public` viz has no encryption backstop, so be thorough there
first.

### 2. Approval — the human's

**`viz publish` refuses** while any viz that would deploy is unapproved or has changed since
it was approved (ADR 0013, 0015); `local` vizzes are exempt. Approval stores a hash of the
viz's content, so **every edit revokes it** — expect to re-approve after each round of changes.

- **The human signs off, not you.** Show them the viz (or `viz preview`, which is not gated
  and reports the unapproved counts), and only when they say this version is fit to publish,
  run `viz update <viz> --approved true`. Approving on their behalf defeats the one control
  standing between a draft and a public site.
- `viz ls` filtered by approval state is the worklist.
- The refusal names an emergency override. Using it is the user's explicit decision, never
  your way around a refusal.

## Deploying — only when the user says so

`viz publish` stops at a dist dir. Deploying is the container's own `deploy.sh` — it lives in
the container because only the container knows its host, remote and base URL.

- One container: `bash <container>/deploy.sh` (`DRY_RUN=1` builds without pushing). Where a
  `deploy-live.sh` wrapper exists, it runs instead.
- Every container at once: `viz deploy-all`. Two deliberate guards make it safe to run
  broadly: a container **without** a `deploy.sh` is skipped (that is how scratch and client
  containers stay off the internet — never add one to a container you don't want shipped),
  and a container with a **dirty** `viz-pages` subtree is skipped, so what ships matches git.
  Commit first.
- A `deploy.sh` need not target Pages — one container deploys behind an SSO gate. Read the
  container's own before assuming what it does.

**Deploying is human-confirmed**: run it when the user asks, never on your own initiative.

## After publishing

- Present what the build printed: each private viz's magic link, share links, and the
  dist path.
- After a deploy, `viz urls <container>` gives the real deployed base URL and share links —
  hand the user those rather than composing a URL by guess.
