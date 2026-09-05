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
import { composeCards, readSidecar } from "./mirrors.ts";
import { OG_NAMES } from "./og.ts";
import { publishOne, vizzesIn } from "./publish-one.ts";
import { magicLink, seal } from "./seal.ts";
import { die } from "../../cli.ts";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export async function buildPublishableTree(
  container: string,
  outRoot: string,
  shareHost: string,
  opts: { noIndex?: boolean; indexTitle?: string; indexDescription?: string } = {},
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
