// lib/publish/tree.ts — Building one container's publishable tree.
//
// Extracted from build.ts, which was 1993 lines.

// ---- Build one container's publishable tree (shared by `publish` and `preview`) ----
// Builds NATIVE vizzes (per their viz:posture), copies MIRRORED-IN artifacts verbatim,
// and regenerates the lobby index — into `outRoot`. This is the build-and-STOP core:
// it writes ONLY inside outRoot. It does NOT push mirrors (an OUTBOUND write into other
// containers) and does NOT deploy — those are layered on top by `publish` alone, so
// `preview` can reuse this to produce an identical tree with zero outside side effects.
import { MIRROR_SIDECAR } from "./constants.ts";
import { writeLobby } from "./lobby-write.ts";
import { readLobby } from "./lobby.ts";
import { readListed, readPosture } from "./meta.ts";
import { approvalOf } from "./approval.ts";
import { composeCards, readSidecar } from "./mirrors.ts";
import { OG_NAMES } from "./og.ts";
import { publishOne, vizzesIn } from "./publish-one.ts";
import { magicLink, seal } from "./seal.ts";
import { die } from "../../cli.ts";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function buildPublishableTree(
  container: string,
  outRoot: string,
  shareHost: string,
  opts: { noIndex?: boolean; indexTitle?: string; indexDescription?: string; gateApproval?: boolean } = {},
): Promise<{ built: number; anyPrivate: boolean; mirroredIn: number; empty: boolean }> {
  const children = vizzesIn(container);
  const mirroredInDirs = children.filter((d) => existsSync(path.join(d, MIRROR_SIDECAR)));
  const natives = children.filter((d) => !existsSync(path.join(d, MIRROR_SIDECAR)));
  // A PRIVATE lobby (_private-lobby marker) seals every public-tier page + the lobby page
  // itself behind one key; `lobby` here is that key (null when the lobby is public).
  const lobby = await readLobby(container);

  // Resolve each native's posture — public/private build, local is skipped, undeclared
  // refuses the whole run (nothing is published, nor withheld, on a guess).
  const resolved: { vizDir: string; slug: string; private: boolean; listed: boolean }[] = [];
  const undeclared: string[] = [];
  const skippedLocal: string[] = [];
  for (const vizDir of natives) {
    const posture = readPosture(vizDir);
    if (posture === "local") skippedLocal.push(path.basename(vizDir));
    else if (!posture) undeclared.push(path.basename(vizDir));
    else resolved.push({ vizDir, slug: path.basename(vizDir), private: posture === "private", listed: readListed(vizDir) });
  }
  if (undeclared.length) {
    die(
      `ERROR: no posture declared for: ${undeclared.join(", ")}\n` +
        `Add <meta name="viz:posture" content="public"> (or "private", or "local" to keep it\n` +
        `off the host) to each viz's index.html. There is no default — nothing is published,\n` +
        `nor withheld, on a guess.`,
      2,
    );
  }
  // ADR 0013 + 0015: nothing reaches a site without a human approving THIS VERSION of it.
  // Only vizzes that would actually deploy are gated — `local` ones were skipped above, so
  // a deliberately-local viz never nags and the worklist can reach zero.
  //
  // `stale` and `never` are reported separately because they need different words: one
  // says "you approved a different version of this", the other "you have not looked".
  const stale: string[] = [], never: string[] = [];
  for (const r of resolved) {
    const a = approvalOf(r.vizDir);
    if (a.state === "stale") stale.push(r.slug);
    else if (a.state === "never") never.push(r.slug);
  }
  //
  // PREVIEW IS NOT GATED (opts.gateApproval === false). The gate's guarantee is about what
  // reaches a SITE, and preview reaches no site — it builds into a temp dir and serves it on
  // localhost. Gating it inverted the workflow: looking at a viz is how you decide whether to
  // approve it, so refusing to show you the thing until you have approved it left you nothing
  // to approve against. It also broke preview for a whole container whenever any one viz in it
  // was mid-edit, which after ADR 0015 made approval perishable is most of the time.
  // Preview still REPORTS the counts below, so the worklist stays visible where it is useful.
  if (stale.length || never.length) {
    if (opts.gateApproval === false) {
      console.log(
        `Unapproved (previewing anyway — nothing here reaches a site):` +
          (never.length ? ` ${never.length} never approved;` : "") +
          (stale.length ? ` ${stale.length} changed since approval;` : "") +
          ` publish will refuse until re-approved.`,
      );
    } else if (process.env.VIZ_ALLOW_UNAPPROVED !== "1") {
      die(
        `ERROR: ${stale.length + never.length} viz(es) would deploy without an approval of their current content:\n` +
          (never.length ? `\n  never approved (${never.length}):\n    ${never.join(", ")}\n` : "") +
          (stale.length ? `\n  CHANGED since approval (${stale.length}):\n    ${stale.join(", ")}\n` : "") +
          `\nApproval records a hash of the viz's content, so an edit revokes it. Re-approve:\n` +
          `  viz update <viz-folder> --approved true\n\n` +
          `Override for an emergency (it will still deploy unapproved): VIZ_ALLOW_UNAPPROVED=1`,
        2,
      );
    }
  }
  if (skippedLocal.length) {
    console.log(`Skipping ${skippedLocal.length} local viz(es) — viz:posture=local, never published: ${skippedLocal.join(", ")}`);
  }
  if (resolved.length === 0 && mirroredInDirs.length === 0) {
    return { built: 0, anyPrivate: false, mirroredIn: 0, empty: true };
  }

  mkdirSync(outRoot, { recursive: true });
  if (resolved.length) {
    const split = resolved.map((t) => `${t.slug} → ${t.private ? "PRIVATE" : "PUBLIC"}${t.listed ? "" : " (unlisted)"}`).join("   ·   ");
    console.log(`Building ${resolved.length} viz(es) → ${outRoot}`);
    console.log(`Postures:  ${split}\n`);
  }

  let anyPrivate = false;
  for (const t of resolved) {
    const r = await publishOne(t.vizDir, outRoot, t.private, shareHost, lobby ? { lobby } : undefined);
    const tier = t.private ? "private (sealed)" : lobby ? "public (lobby-sealed)" : "public";
    console.log(`• ${r.slug} — ${tier}${t.listed ? "" : ", unlisted (hidden from index)"}`);
    for (const w of r.warnings) console.log(`    ⚠️  ${w}`);
    if (r.link) console.log(`    🔗 ${r.link}`);
    if (t.private) anyPrivate = true;
  }

  // Mirrored-in artifacts: copy verbatim (never rebuild a possibly-sealed file); the
  // index composes their card from the sidecar (the only local card-truth when sealed).
  for (const dir of mirroredInDirs) {
    const slug = path.basename(dir);
    const dest = path.join(outRoot, slug);
    mkdirSync(dest, { recursive: true });
    cpSync(path.join(dir, "index.html"), path.join(dest, "index.html"));
    cpSync(path.join(dir, MIRROR_SIDECAR), path.join(dest, MIRROR_SIDECAR));
    const side = readSidecar(dir);
    // Carry a PUBLIC mirror's hero.html + preview image too (native vizzes get these via
    // publishOne) so its card shows a real thumbnail and its hero page is viewable. A private
    // mirror stays sealed/verbatim — never emit its plaintext hero at a guessable path.
    if (!side?.card.private) {
      for (const f of ["hero.html", ...OG_NAMES]) {
        if (existsSync(path.join(dir, f))) cpSync(path.join(dir, f), path.join(dest, f));
      }
    }
    // A lobby also seals PUBLIC mirrored-in artifacts (a private one is already sealed
    // with its origin's key — leave it verbatim, it keeps its own password).
    if (lobby && side && !side.card.private) {
      const stageDir = path.join(os.tmpdir(), "viz-lobby-mirror-stage", slug);
      mkdirSync(stageDir, { recursive: true });
      cpSync(path.join(dir, "index.html"), path.join(stageDir, "index.html"));
      const ok = await seal(stageDir, "index.html", dest, lobby);
      console.log(`• ${slug} — mirrored-in, ${ok ? "lobby-sealed" : "SEAL FAILED (left verbatim)"}${side ? `, origin ${side.origin}` : ""}`);
    } else if (side) {
      console.log(`• ${slug} — mirrored-in (copied verbatim, origin ${side.origin})`);
    } else {
      console.log(`• ${slug} — mirrored-in (copied verbatim)`);
      console.log(`    ⚠️  ${MIRROR_SIDECAR} is malformed — this viz will be MISSING from the lobby index`);
    }
  }

  // The lobby (index.html) — one writer-agnostic rule (ADR 0006): native dirs card-from-source-
  // head, mirrored-in dirs card-from-sidecar; both filtered by `listed`.
  if (!opts.noIndex) {
    const { cards, unlisted } = composeCards(container);
    await writeLobby(outRoot, cards, opts.indexTitle ?? "Visualizations", container, shareHost, {
      sealed: !!lobby, // a private lobby's index is sealed after this — no plaintext OG head
      description: opts.indexDescription,
    });
    const pub = cards.filter((c) => !c.private).length;
    const prv = cards.length - pub;
    const mi = cards.filter((c) => existsSync(path.join(container, c.slug, MIRROR_SIDECAR))).length;
    const hidden = unlisted ? `; ${unlisted} unlisted (built, hidden from the lobby)` : "";
    console.log(
      `\nLobby → ${path.join(outRoot, "index.html")}  ` +
        `(${cards.length} listed: ${pub} public, ${prv} private${mi ? `, ${mi} mirrored-in` : ""}${hidden})`,
    );

    // Private lobby: seal the lobby page itself with the lobby key, then print the one
    // password + magic link that opens the whole site. The link carries #staticrypt_pwd
    // (host-independent hash) plus &remember_me, so opening it stores the credential and
    // every same-key page (public-tier vizzes) auto-decrypts — enter once, browse freely.
    if (lobby) {
      const stageDir = path.join(os.tmpdir(), "viz-lobby-index-stage", path.basename(outRoot));
      mkdirSync(stageDir, { recursive: true });
      cpSync(path.join(outRoot, "index.html"), path.join(stageDir, "index.html"));
      const ok = await seal(stageDir, "index.html", outRoot, lobby);
      const link = (await magicLink(stageDir, "index.html", lobby, shareHost.replace(/\/$/, "") + "/")) + "&remember_me";
      console.log(`\n🔒 Lobby — whole site sealed behind ONE password (enter once, browse freely):`);
      console.log(`   index seal: ${ok ? "ok" : "FAILED — index left in plaintext!"}`);
      console.log(`   passphrase: ${lobby.passphrase}`);
      console.log(`   link:       ${link}`);
      console.log(`   (already-private vizzes keep their own separate links)`);
    }
  }

  return { built: resolved.length, anyPrivate, mirroredIn: mirroredInDirs.length, empty: false };
}
