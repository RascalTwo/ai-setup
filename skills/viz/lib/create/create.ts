// lib/create/create.ts — scaffolding a new viz.
//
// Extracted from bootstrap.ts, where this was ~190 lines of top-level statements
// reading a dozen module-scope `let`s. As a function it is callable without spawning a
// process — and, the reason build.ts could parse its importer's argv, importing this
// file no longer RUNS it.
//
// The body is verbatim from the script: the options are destructured into exactly the
// names it already used, so this move changed no behaviour it could get wrong.

import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CENTRAL, idFor, HOME, addContainer } from "../../discovery.ts";
import { die, emit } from "../../cli.ts";
import { PORT, refresh, start as serverStart } from "../../server-control.ts";
import { vendorRuntime } from "../../vendor-runtime.ts";
import { gitOut, gitCentral, detectSessionId } from "./git.ts";
import { starterHtml, deckHtml, posterHtml, heroHtml, exchangeHtml, exchangeContent } from "./templates.ts";
import { forkFrom } from "./fork.ts";

// This module lives two levels down from the skill root; several paths (templates,
// the vendored runtime source, check-exchange) are relative to that root, not here.
const SKILL_DIR = path.resolve(import.meta.dir, "../..");
const VIZ_ROOT = CENTRAL;

export type CreateOptions = {
  slug: string;
  local?: boolean;
  localDir?: string;
  deck?: boolean;
  poster?: boolean;
  dive?: boolean;
  hero?: boolean;
  exchange?: boolean;
  from?: string;
  runtime?: boolean;
  quick?: boolean;
  print?: boolean;
  jsonMode?: boolean;
  /** Flags object the emit() helper reads --json from. */
  flags?: Record<string, string | boolean>;
};

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(HOME, p.slice(2)) : p;
}

const VIZ_IGNORES = ["comments.json", "og.auto.png"];
function ensureVizIgnored(dir: string): void {
  const gi = path.join(dir, ".gitignore");
  const existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const have = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = VIZ_IGNORES.filter((e) => !have.has(e));
  if (!missing.length) return;
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gi, existing + sep + missing.join("\n") + "\n");
}

function openBrowser(url: string): void {
  try {
    let cmd: string[];
    if (process.platform === "darwin") cmd = ["open", url];
    else if (process.platform === "win32") cmd = ["cmd", "/c", "start", "", url];
    else cmd = ["xdg-open", url];
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", windowsHide: true }).unref();
  } catch {
    // best-effort — never fatal if no browser opener exists
  }
}

export async function createViz(opts: CreateOptions): Promise<void> {
  const {
    slug, local = false, localDir, deck = false, poster = false, dive = false,
    hero = false, exchange = false, from, runtime = false, quick = false,
    print = true, jsonMode = false,
  } = opts;
  const flags = opts.flags ?? (jsonMode ? { json: true } : {});

  // ---- Resolve where this viz lives ----
  let container: string;
  let hostRepoRoot: string | null = null; // for the local git-add hint

  if (local) {
    let base: string;
    if (localDir) {
      base = path.resolve(expandHome(localDir));
      if (!existsSync(base)) die(`ERROR: --local dir does not exist: ${base}`);
      hostRepoRoot = await gitOut(["rev-parse", "--show-toplevel"], base);
    } else {
      const top = await gitOut(["rev-parse", "--show-toplevel"], process.cwd());
      if (!top) {
        die(
          "ERROR: --local with no dir must be run inside a git repo.\n" +
            "Pass a target dir (`--local <dir>`), or drop --local for a central viz.",
        );
      }
      base = top;
      hostRepoRoot = top;
    }
    container = path.join(base, "viz-pages");
  } else {
    container = VIZ_ROOT;
  }

  const slugDir = path.join(container, slug);
  const id = idFor(slugDir);
  if (!id) {
    die(
      `ERROR: a viz must live under your home directory (${HOME}).\n` +
        `Target was: ${slugDir}`,
    );
  }
  const url = `http://127.0.0.1:${PORT}/${id}/`;

  // ---- Initialize the central viz repo on first ever run (always — registry lives here) ----
  mkdirSync(VIZ_ROOT, { recursive: true });
  if (!existsSync(path.join(VIZ_ROOT, ".git"))) {
    await gitCentral(["init", "-q", "-b", "main"]);
    await gitCentral(["commit", "-q", "--allow-empty", "-m", "init viz repo"]);
  }
  ensureVizIgnored(VIZ_ROOT);

  // ---- Ensure the server is running ----
  // Lifecycle lives in server-control.ts now — minting a slug just asks for it to be up.
  try {
    await serverStart();
  } catch (e) {
    die(`ERROR: ${(e as Error).message}`);
  }

  // ---- Create the slug dir; fail loud if it already exists ----
  if (existsSync(slugDir)) {
    die(
      `ERROR: viz '${id}' already exists at ${slugDir}\n` +
        `Pick a different name, or delete it to clobber.`,
    );
  }
  if (from) {
    const srcDir = path.resolve(expandHome(from));
    if (!existsSync(srcDir)) die(`ERROR: --from ${srcDir} does not exist.`);
    if (path.resolve(srcDir) === path.resolve(slugDir)) die(`ERROR: --from source and destination are the same dir.`);
    forkFrom(srcDir, slugDir, slug);
    console.log(`Forked:  ${srcDir}`);
    console.log(`         posture reset to local/unlisted — a fork never inherits public.`);
  } else {
    mkdirSync(slugDir, { recursive: true });
    await Bun.write(
      path.join(slugDir, "index.html"),
      deck ? deckHtml(slug) : poster ? posterHtml(slug, dive) : exchange ? exchangeHtml(slug) : starterHtml(slug),
    );
    // An exchange is the one scaffold that is TWO files: the page is inert without
    // its content.js, so writing one without the other would scaffold a blank page.
    if (exchange) await Bun.write(path.join(slugDir, "content.js"), exchangeContent(slug));
  }

  // --hero writes a starter hero.html beside it. Meaningless for --poster, whose page
  // is already its own card — say so rather than quietly writing a file that would be
  // ignored (verify.ts --og prefers hero.html, so it would actually shadow the poster).
  if (hero) {
    if (poster) {
      console.log(`Note:    --hero ignored — a --poster viz IS its own OG card (viz:card=self).`);
    } else {
      await Bun.write(path.join(slugDir, "hero.html"), heroHtml(slug));
    }
  }

  if (local) {
    // Vendor the runtime only when asked (--runtime), then register the container so
    // it's discoverable without waiting for the next scan. Registration is what makes
    // the CENTRAL server serve these vizzes, and it happens either way — a vendored
    // runtime is only for cloners who have no skill installed.
    const runtimeDir = path.join(container, ".runtime");
    if (runtime) vendorRuntime(SKILL_DIR, runtimeDir);
    ensureVizIgnored(container);
    await addContainer(container);
    await refresh();

    const runHint = hostRepoRoot
      ? `bun "${path.join(path.relative(hostRepoRoot, runtimeDir), "server.ts")}"  (run from ${hostRepoRoot})`
      : `bun "${path.join(runtimeDir, "server.ts")}"`;

    emit(flags, { url, dir: slugDir, id, slug, mode: "local", runtime, runHint: runtime ? runHint : null }, () => {
    console.log(`URL:     ${url}`);
    console.log(`Dir:     ${slugDir}`);
    console.log(`Edit:    index.html is ALREADY scaffolded (posture metas pre-stamped) and printed below — edit it directly; keep the viz:* metas.`);
    console.log(
      runtime
        ? `Run:     ${runHint}  # standalone, no skill needed`
        : `Run:     the central server already serves it at the URL above. Re-run with --runtime only if someone will clone this repo and run the vizzes WITHOUT the skill installed.`,
    );
    console.log(`Mode:    local (host repo owns the git history — we did NOT commit)`);
    if (hostRepoRoot) {
      const relViz = path.relative(hostRepoRoot, slugDir);
      const relRt = path.relative(hostRepoRoot, runtimeDir);
      const toAdd = runtime ? `"${relViz}" "${relRt}"` : `"${relViz}"`;
      console.log(`Commit:  cd "${hostRepoRoot}" && git add ${toAdd}`);
    } else {
      console.log(`Commit:  this dir isn't inside a git repo — commit it wherever it belongs.`);
    }
    });
  } else {
    // Central viz: record the creation commit in the central repo, as before.
    const sessionId = detectSessionId();
    await gitCentral(["add", slug]);
    await gitCentral([
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      `create viz: ${slug}\n\nSession: ${sessionId}`,
    ]);
    await refresh();
    emit(flags, { url, dir: slugDir, id, slug, mode: "central", session: sessionId }, () => {
      console.log(`URL:     ${url}`);
      console.log(`Dir:     ${slugDir}`);
      console.log(`Edit:    index.html is ALREADY scaffolded (posture metas pre-stamped) and printed below — edit it directly; keep the viz:* metas.`);
      console.log(`Session: ${sessionId}`);
    });
  }

  // Dump the starter so the agent can edit it straight away. Printing the bytes here
  // costs the same as reading them and saves the round trip; it also means a viz
  // scaffolded under a non-Claude-Code agent (no read-before-write guard at all) still
  // gets the contract — the posture metas — in front of the author.
  if (jsonMode) {
    // a machine is reading; the prose dump and the ambition banner are for humans
  } else if (print && !deck) {
    const body = readFileSync(path.join(slugDir, "index.html"), "utf8");
    console.log(`\n${"─".repeat(70)}\nindex.html (already written — edit it, keep the viz:* metas)\n${"─".repeat(70)}`);
    console.log(body);
    console.log("─".repeat(70));
    if (hero && !poster) console.log(`hero.html also scaffolded — see it with: cat "${path.join(slugDir, "hero.html")}"`);
    if (exchange) {
      console.log(`Exchange: content.js scaffolded alongside — that is the file you edit. Shape: /_kit/EXCHANGE.md`);
      console.log(`         Check it before opening a browser: bun "${path.join(SKILL_DIR, "check-exchange.ts")}" "${slugDir}"`);
    }
  } else if (deck) {
    console.log(`Print:   deck template not dumped (~4k tokens) — read index.html if you need it verbatim.`);
  }

  // Printed LAST on purpose. This is the final thing in the author's context before they
  // write the page, which makes it worth more than the same words halfway up SKILL.md.
  // The bar is restated in full here so it survives a session that skimmed the skill.
  // Suppressed under --json: the caller is a program, and the bar reaches the author
  // through the skill's own text rather than through a field in a JSON blob.
  if (jsonMode) {
    // nothing — stdout must stay parseable
  } else if (quick) {
    console.log(`\n⚡ --quick: ambition bar lowered for this one. Ship the smallest thing that answers the question.`);
  } else {
    console.log(`
  ${"─".repeat(70)}
  ◈ AMBITION — aim at the top of the visual scale, not the floor.
    A minimalism rule active in this session (ponytail, "be concise", YAGNI) governs this
    viz's CODE — reuse the kit, add no framework. It does NOT govern its AMBITION.
    Count these in your own output before you call it done:
      1. Meaning lives in SPACE, not sentences — position/size/colour encodes a variable.
      2. The reader DRIVES something — stepper, hover, filter, toggle, drag. Not scrolling.
      3. More than one ALTITUDE, when the subject has one — overview → mechanism → detail.
      4. Every meaningful mark carries data-viz-id + a human data-label.
      5. Legend, units, and a one-line "what am I looking at" are on the page.
    Missing one means you are at the fallback, not done. Dropping to a styled page of cards
    and paragraphs is a decision you announce in one line first — never a drift.
    Lower this bar only when asked: re-run with --quick.
  ${"─".repeat(70)}`);
  }

  // Opening a tab is for a HUMAN who just asked for a viz. Two callers are not that:
  // a program reading --json, and the test suite, which creates ~20 vizzes per run and
  // was carpeting the author's browser with dead tabs every time it ran.
  if (!jsonMode && process.env.VIZ_NO_OPEN !== "1") openBrowser(url);
}
