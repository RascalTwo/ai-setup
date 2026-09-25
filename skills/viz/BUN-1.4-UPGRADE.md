# Handoff — upgrade this machine to Bun 1.4

Written 2026-08-23, three days after Bun 1.4 shipped. Nothing here has been executed yet;
this is a plan with the research already paid for. Read it before running anything.

Current state: **Bun 1.3.11** (`~/.bun/bin/bun`, 58.2 MB).

---

## The one idea

**The upgrade is worth doing for exactly one reason: it can take the viz skill to zero
dependencies.** Everything else in 1.4 is either free (perf, memory, stack traces) or
irrelevant to this machine. Do not let the length of the release notes talk you into a
feature tour — there is a "not worth it here" list at the bottom and it is longer than the
"worth it" list on purpose.

---

## What 1.4 actually is

[Bun 1.4](https://bun.com/blog/bun-v1.4), 2026-08-20. **Bun is now written in Rust** — a
~1M-line rewrite of the core, replacing the Zig implementation. First release on it.

Claimed: every benchmark matches or beats 1.3, ~17% smaller binary on Linux/Windows, 5×
idle CPU reduction, 13–48% less memory for HTTP servers, 2× faster startup on Linux.
Claude Code ran the Rust port in production for months before release, and Prisma shipped
Prisma Compute on it.

Despite the `1.x` version number, treat this as the largest single change in the project's
history. It is not a routine minor bump.

---

## Reasons NOT to upgrade (weigh these, then upgrade anyway)

- **It is three days old.** A rewrite this size will surface bugs that no amount of
  pre-release testing caught. You are early.
- **`bun` is machine-global.** One binary at `~/.bun/bin/bun` serves everything:
  - Skills: `viz`, `prototype`, `repo-issue-scanner`, `ai-setup-audit`
  - Projects with a `bun.lock`: `ai-setup`, `handy` (102 KB lock — the biggest exposure),
    `r2-pa`, `r2-smart-life`
  - **A launchd-managed always-on server**: `com.rascaltwo.viz-server` (currently PID
    22675) plus `com.rascaltwo.viz-server-restart`. Upgrading swaps the binary out from
    under a running daemon.
- **There is no automatic rollback.** `bun upgrade` has only `--canary`; it takes no target
  version and the docs describe no backup. Downgrading means re-running the installer.

Counterweight: the runtime you are reading this in has been on the Rust build for months.
It is early, not unproven.

**Verdict: upgrade, but back the binary up first and prove the viz path before trusting it.**

---

## Do this first — the 10-second insurance

```sh
cp ~/.bun/bin/bun ~/.bun/bin/bun-1.3.11    # there is no built-in rollback; make one
bun --version                               # confirm 1.3.11 before you change anything
```

Documented downgrade if you need it:

```sh
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.11"
```

---

## The upgrade

```sh
launchctl stop com.rascaltwo.viz-server     # don't hot-swap under a running daemon
bun upgrade
bun --version                                # expect 1.4.x
launchctl start com.rascaltwo.viz-server
```

### Verify before declaring done

Each of these has a falsifier — if the "then" doesn't happen, stop and roll back.

- [ ] **Given** the server restarted, **when** you `curl -s localhost:5180/_health`,
      **then** it answers. *Falsifier: connection refused or a non-2xx.*
- [ ] **Given** a real multi-file viz, **when** you rebuild it, **then** the bundler still
      inlines siblings. Use the hydra page — it is the hardest case on the machine (an
      827 KB single-line `data.js`):
      ```sh
      cd ~/Desktop/Desktop/Code/sai-project-hydra/viz-pages/hydra-team-composition
      node build.mjs
      cd ~/.claude/skills/viz && bun -e '
        const { buildSelfContained } = await import("./inline.ts");
        const r = buildSelfContained("/Users/jmilliken/Desktop/Desktop/Code/sai-project-hydra/viz-pages/hydra-team-composition");
        console.log("bytes:", r.html.length, "warnings:", r.warnings);
        console.log("data inlined:", r.html.includes("data_default"));
      '
      ```
      *Falsifier: `data inlined: false`, a non-empty warnings array, or a byte count wildly
      off from ~1 MB.*
- [ ] **Given** puppeteer-core is still installed, **when** you regenerate an og image,
      **then** it renders. *Falsifier: a launch error from `puppeteer.launch()` — 1.4 adds
      +1,517 Node compat tests but `puppeteer-core` is the one real dependency here and it
      is the most likely thing to break.*
- [ ] **Given** the other bun projects, **when** you `bun install --dry-run` in `handy`,
      **then** the lockfile resolves unchanged. *Falsifier: lockfile churn or resolution
      errors. 1.4 changes `bun install` substantially — global virtual store, and
      `trustedDependencies` now applies only to npm-registry packages.*

Behavioral shifts the release notes flag that could bite silently:
- Subprocesses spawned at module scope are killed when the file ends.
- `process.chdir()` no longer affects subsequent files.
- `--sourcemap` is disabled by default in production for HTML routes.

---

## The actual prize: `Bun.WebView` → delete the last dependency

`skills/viz/package.json` has exactly one entry:

```json
{ "dependencies": { "puppeteer-core": "^25.2.1" } }
```

Used in three files — `build.ts:65`, `verify.ts:40`, `_cvdprobe.ts:3` — for og images and
verification screenshots. The API surface is small and fully enumerated:

```
browser.close  browser.newPage
page.addStyleTag  page.content  page.evaluate  page.goto  page.on
page.screenshot  page.setContent  page.setViewport  page.waitForSelector
```

### Read this before you swap anything

**`Bun.WebView` is not Puppeteer and does not embed Chromium.** It drives *OS-native*
engines, and it has two modes:

1. **System WebKit on macOS** — the Safari engine.
2. **Chrome / Chromium / Edge over the Chrome DevTools Protocol** on macOS, Linux, Windows.

Mode 2 is the same protocol `puppeteer-core` already speaks, against the same browser
binary `chromePath()` already resolves. **Use mode 2.** If you let it default to system
WebKit on macOS, every og image and verification screenshot silently switches from Blink to
WebKit, and this codebase renders and *measures* pages for a living — `verify.ts:395` clips
a screenshot to an exact 1200×630 box, and `vizAudit()` in the kit compares SVG `getBBox()`
against `<rect>` geometry to catch text overflow. A different text-shaping engine moves
those numbers. That is a real regression dressed as a rendering preference.

### Sequence it safely

1. Upgrade and verify (above) with `puppeteer-core` **still installed and in use**. Land
   that as its own commit. The runtime change and the dependency change must not be one
   diff — if screenshots break you need to know which caused it.
2. Port `_cvdprobe.ts` first. It is the smallest of the three and nothing depends on it.
3. Diff the og images before/after, pixel-wise, on the same viz. Do not eyeball them.
4. Only then port `build.ts` and `verify.ts`, and drop the dependency.

Unverified: the announcement names navigation, clicking, scrolling, JS execution, and
screenshots. It does **not** name equivalents for `waitForSelector`, `addStyleTag`, or
`page.on`. Check those exist before committing to the port — if `waitForSelector` is
missing, the whole thing is a poll loop and may not be worth it.

---

## Also plausibly worth it here

- **`Bun.serve()` file serving** — `sendfile`, Range requests, ETags, 304s. `server.ts:337`
  currently ends in a bare `return new Response(file)`. Range support in particular matters
  for the recordings/video assets the skill serves. Small, real, low-risk.
- **`Bun.cron()`** — OS-level scheduling (launchd on macOS). Could collapse
  `com.rascaltwo.viz-server-restart.plist` into code. Low value; the plist works. Only do
  this if you are already in that file.
- **Async stack traces** — errors point at the `await` rather than a native frame. Free, no
  work, and this codebase is full of async browser driving.

---

## NOT worth it here — checked, and the hook isn't there

Do not spend a turn on these. Each was checked against the actual code:

- **`Bun.Image`** — there is no image resizing in this codebase. Thumbnails are produced by
  the *browser*, via `page.screenshot({ clip: … })` at `verify.ts:395`. Nothing to replace.
- **`Bun.markdown`** — no markdown engine is used. `build.ts:540` deliberately emits
  verbatim ("no escaping, no markdown engine") and `server.ts:379` only sets a MIME type.
- **`bun test --parallel/--isolate/--shard/--changed`** — `grep -rl "bun:test"` across the
  skill returns nothing. There are no bun tests to parallelize. `.verify/` is screenshot
  and console artifacts, not a test suite.
- **Built-in React Compiler** — no React.
- **`Bun.JSON5` / `JSONL` / `JSONC` / `XML` / `TOML` / `Archive`, `Bun.Terminal`** — nothing
  in this codebase parses those formats or needs a PTY.
- **HTTP/3** — the release marks it experimental and not production-ready.

---

## When you're done

Commit the upgrade separately from the puppeteer removal (see sequencing above). Update
`skills/viz/package.json` only in the second commit. If `puppeteer-core` does come out,
say so in `skills/viz/README.md` — "zero dependencies" is a claim worth making explicitly,
and it is the whole reason this upgrade was worth doing.

Sources: [Bun v1.4](https://bun.com/blog/bun-v1.4) ·
[Bun installation / pinning a version](https://bun.com/docs/installation)
