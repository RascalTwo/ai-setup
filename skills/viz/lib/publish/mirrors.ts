// lib/publish/mirrors.ts — mirrors.json: validation, resolution and the outbound push.
//
// Extracted from build.ts, which was 1993 lines.

import { createHash } from "node:crypto";
import { MIRROR_SIDECAR } from "./constants.ts";
import { Card, cardFor, vizCreated, vizMtime, writeLobby } from "./lobby-write.ts";
import { readListed, readPosture, vizCardMeta } from "./meta.ts";
import { findOgImage } from "./og.ts";
import { publishOne, vizzesIn } from "./publish-one.ts";
import { die } from "../../cli.ts";
import { idFor } from "../../discovery.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type MirrorOverrides = { title?: string; description?: string; tags?: string[] };
export type MirrorVizEntry = { slug: string; access: "public" | "private"; listed?: boolean; overrides?: MirrorOverrides };
export type MirrorTarget = { path: string; vizzes: MirrorVizEntry[] };

// A `vendors` array in the SAME manifest declares where a container's native vizzes are
// VENDORED (ADR 0010) — copied verbatim as runnable source, not built into an artifact.
// Declaring at the origin is what makes a vendored copy refreshable and rename-safe; the
// copy's own .vendored.json receipt stays the record of what that directory IS.
//
//   access   REQUIRED per (viz × vendor edge), "public" | "private". Unlike a mirror's
//            access it is NOT a re-framing: the copy is byte-identical to its origin, so
//            access is an ACKNOWLEDGEMENT, checked against the origin's own viz:posture.
//            A mismatch fails that edge rather than rewriting the copy — stamping posture
//            would break byte-identity and fork the keystore (idFor is path-based).
//   NO overrides / listed — a vendored copy carries its origin's meta verbatim.
export type VendorVizEntry = { slug: string; access: "public" | "private" };
export type VendorTarget = { path: string; vizzes: VendorVizEntry[] };

// The sidecar's card is a lobby Card minus the slug (the dir name IS the slug).
export type SidecarCard = { title: string; description: string; tags: string[]; scaffold: string; listed: boolean; private: boolean };
export type Sidecar = { origin: string; card: SidecarCard };

// Read + validate a child dir's .mirror.json. A dir carrying one is a mirrored-in
// artifact (terminal — never re-mirrored, never rebuilt). Returns null if absent/bad.
export function readSidecar(dir: string): Sidecar | null {
  const p = path.join(dir, MIRROR_SIDECAR);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j && typeof j.origin === "string" && j.card && typeof j.card === "object") return j as Sidecar;
  } catch {
    /* fall through */
  }
  return null;
}

// Read + FAIL-CLOSED validate <container>/mirrors.json. Returns [] if no file.
// Collects ALL problems and refuses (non-zero, naming offenders) BEFORE anything is
// written — mirroring the undeclared-posture refusal. `nativeSlugs` is the set of
// the container's own native vizzes; a mirror entry may only name one of those (you
// mirror only what you own).
// A mirrors.json maps to sibling-repo filesystem PATHS — it's local-only by policy
// (committing it exposes where other repos live). Self-heal: ensure the enclosing
// git repo ignores it so it can never be committed. Idempotent; no-op outside a repo.
export function ensureMirrorsIgnored(mirrorsFile: string): void {
  const abs = path.resolve(mirrorsFile);
  let dir = path.dirname(abs);
  let repoRoot = "";
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) { repoRoot = dir; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!repoRoot) return; // not inside a git repo — nothing to ignore
  const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
  const giPath = path.join(repoRoot, ".gitignore");
  const existing = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  const lines = existing.split("\n").map((l) => l.trim());
  if (lines.includes(rel) || lines.includes("mirrors.json") || lines.includes("**/mirrors.json")) return;
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(giPath, existing + sep + "\n# viz mirror config: sibling-repo paths — local-only, never commit\n" + rel + "\n");
  console.error(`  ↳ gitignored ${rel} (local-only mirror config)`);
}

// Pure fail-closed validation of an already-parsed mirrors.json `raw`. Collects ALL
// problems; returns them alongside the cleaned targets so a caller can refuse BEFORE
// writing (manage.ts validates a candidate in memory; readMirrors dies on a bad file).
export function validateMirrors(raw: any, container: string, nativeSlugs: Set<string>): { targets: MirrorTarget[]; vendors: VendorTarget[]; errors: string[] } {
  const errors: string[] = [];
  const targets: MirrorTarget[] = [];
  const vendors: VendorTarget[] = [];
  if (!raw || !Array.isArray(raw.mirrors)) {
    return { targets, vendors, errors: ['must be an object with a "mirrors" array'] };
  }
  raw.mirrors.forEach((m: any, mi: number) => {
    const where = `mirrors[${mi}]`;
    if (!m || typeof m.path !== "string" || !m.path.trim()) {
      errors.push(`${where}: missing/invalid "path" (must be a non-empty string)`);
      return;
    }
    if (!Array.isArray(m.vizzes)) {
      errors.push(`${where} (path="${m.path}"): missing "vizzes" array`);
      return;
    }
    const vizzes: MirrorVizEntry[] = [];
    m.vizzes.forEach((v: any, vi: number) => {
      const vw = `${where}.vizzes[${vi}]`;
      if (!v || typeof v.slug !== "string") {
        errors.push(`${vw}: missing "slug" (string)`);
        return;
      }
      if (!nativeSlugs.has(v.slug)) {
        errors.push(`${vw}: "${v.slug}" is not a native viz in ${container} — you mirror only what you own`);
        return;
      }
      if (v.access !== "public" && v.access !== "private") {
        errors.push(
          `${vw} ("${v.slug}"): "access" is REQUIRED and must be "public" or "private" — ` +
            `posture is re-decided per mirror (trust boundary), never inherited`,
        );
        return;
      }
      const entry: MirrorVizEntry = { slug: v.slug, access: v.access };
      if (v.listed !== undefined) {
        if (typeof v.listed !== "boolean") {
          errors.push(`${vw} ("${v.slug}"): "listed" must be a boolean`);
          return;
        }
        entry.listed = v.listed;
      }
      if (v.overrides !== undefined) {
        const o = v.overrides;
        if (!o || typeof o !== "object" || Array.isArray(o)) {
          errors.push(`${vw} ("${v.slug}"): "overrides" must be an object`);
          return;
        }
        const ov: MirrorOverrides = {};
        if (o.title !== undefined) {
          if (typeof o.title !== "string") { errors.push(`${vw}: overrides.title must be a string`); return; }
          ov.title = o.title;
        }
        if (o.description !== undefined) {
          if (typeof o.description !== "string") { errors.push(`${vw}: overrides.description must be a string`); return; }
          ov.description = o.description;
        }
        if (o.tags !== undefined) {
          if (!Array.isArray(o.tags) || o.tags.some((t: any) => typeof t !== "string")) {
            errors.push(`${vw}: overrides.tags must be an array of strings`);
            return;
          }
          ov.tags = o.tags;
        }
        entry.overrides = ov;
      }
      vizzes.push(entry);
    });
    targets.push({ path: m.path, vizzes });
  });

  // ---- vendors (ADR 0010) — same file, deliberately smaller entry shape ----
  if (raw.vendors !== undefined) {
    if (!Array.isArray(raw.vendors)) {
      errors.push('"vendors" must be an array');
    } else {
      raw.vendors.forEach((t: any, ti: number) => {
        const where = `vendors[${ti}]`;
        if (!t || typeof t.path !== "string" || !t.path.trim()) {
          errors.push(`${where}: missing/invalid "path" (must be a non-empty string)`);
          return;
        }
        if (!Array.isArray(t.vizzes)) {
          errors.push(`${where} (path="${t.path}"): missing "vizzes" array`);
          return;
        }
        const vizzes: VendorVizEntry[] = [];
        t.vizzes.forEach((v: any, vi: number) => {
          const vw = `${where}.vizzes[${vi}]`;
          if (!v || typeof v.slug !== "string") {
            errors.push(`${vw}: missing "slug" (string)`);
            return;
          }
          if (!nativeSlugs.has(v.slug)) {
            errors.push(`${vw}: "${v.slug}" is not a native viz in ${container} — you vendor only what you own`);
            return;
          }
          if (v.access !== "public" && v.access !== "private") {
            errors.push(
              `${vw} ("${v.slug}"): "access" is REQUIRED and must be "public" or "private" — ` +
                `it acknowledges the posture you are sending across a trust boundary, and is checked against the origin's viz:posture`,
            );
            return;
          }
          for (const k of ["overrides", "listed"]) {
            if (v[k] !== undefined) {
              errors.push(`${vw} ("${v.slug}"): "${k}" is not valid on a vendor entry — a vendored copy is byte-identical to its origin`);
              return;
            }
          }
          vizzes.push({ slug: v.slug, access: v.access });
        });
        vendors.push({ path: t.path, vizzes });
      });
    }
  }

  // A slug may not be BOTH mirrored and vendored into the same sink — the two would
  // fight over one directory (a sealed terminal artifact vs. a runnable source copy).
  const mirroredAt = new Set<string>();
  for (const m of targets) for (const v of m.vizzes) mirroredAt.add(`${path.resolve(container, m.path)}\0${v.slug}`);
  for (const t of vendors) {
    for (const v of t.vizzes) {
      if (mirroredAt.has(`${path.resolve(container, t.path)}\0${v.slug}`)) {
        errors.push(`"${v.slug}" is declared as BOTH a mirror and a vendor into ${t.path} — pick one (they write the same directory)`);
      }
    }
  }

  return { targets, vendors, errors };
}

export function readMirrors(container: string, nativeSlugs: Set<string>): { mirrors: MirrorTarget[]; vendors: VendorTarget[] } {
  const file = path.join(container, "mirrors.json");
  if (!existsSync(file)) return { mirrors: [], vendors: [] };
  ensureMirrorsIgnored(file);
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    die(`ERROR: ${file} is not valid JSON: ${(e as Error).message}`, 2);
  }
  const { targets, vendors, errors } = validateMirrors(raw, container, nativeSlugs);
  if (errors.length) {
    die(`ERROR: invalid ${file} — NOTHING was written:\n  - ${errors.join("\n  - ")}`, 2);
  }
  return { mirrors: targets, vendors };
}

// Resolve a (viz × mirror) card: access decides `private`; everything else inherits
// the source viz's viz:* meta unless an override is present.
export function resolveMirrorCard(vizDir: string, entry: MirrorVizEntry): SidecarCard {
  const base = vizCardMeta(readFileSync(path.join(vizDir, "index.html"), "utf8"));
  const o = entry.overrides ?? {};
  return {
    title: o.title ?? base.title,
    description: o.description ?? base.description,
    tags: o.tags ?? base.tags,
    scaffold: base.scaffold,   // structural fact of the page — never overridable
    listed: entry.listed ?? readListed(vizDir),
    private: entry.access === "private",
  };
}

// The ONE writer-agnostic composition rule (ADR 0006), run over a SOURCE container:
// a native child dir is carded from its (plaintext) <head>; a child dir carrying a
// .mirror.json is carded from that sidecar (load-bearing — a sealed mirror's head is
// encrypted). Both filtered by `listed`. LENIENT about natives that are
// undeclared/local/unlisted (skips them) so a foreign push never fails on a sink's
// own posture hygiene — refuse-on-undeclared is enforced only by a container's own
// publish over its own natives.
export function composeCards(sourceContainer: string): { cards: Card[]; unlisted: number } {
  const cards: Card[] = [];
  let unlisted = 0;
  for (const dir of vizzesIn(sourceContainer)) {
    const slug = path.basename(dir);
    const side = readSidecar(dir);
    if (side) {
      if (!side.card.listed) { unlisted++; continue; }
      const { title, description, tags, scaffold, private: isPriv } = side.card;
      // ponytail: mirrored-in cards aren't spoiler-gated (sidecar carries no spoiler flag) —
      // add it to the sidecar schema if a mirrored viz ever needs it.
      cards.push({ slug, title, description, tags, scaffold: scaffold ?? "", private: isPriv, spoiler: false, image: isPriv ? undefined : findOgImage(dir) || undefined, mtime: vizMtime(dir), created: vizCreated(dir) });
    } else {
      const posture = readPosture(dir);
      if (!posture || posture === "local") continue;
      if (!readListed(dir)) { unlisted++; continue; }
      cards.push(cardFor(slug, dir, posture === "private"));
    }
  }
  return { cards, unlisted };
}

// Push a container's native vizzes into each declared mirror target: write the
// self-describing units (artifact + sidecar), origin-scoped-prune our stale ones,
// then regenerate the sink's index from local presence. Build-and-STOP boundary is
// unchanged — this writes finished files into the mirror paths and does not deploy.
export async function pushMirrors(container: string, mirrors: MirrorTarget[], shareHost: string): Promise<void> {
  const originPath = idFor(container) ?? container;
  // origin is an OWNERSHIP TAG for prune-matching only — mirrored-in artifacts are
  // terminal (copied verbatim, never rebuilt from here), so the sink never needs the
  // real source path. Hash it so the committed .mirror.json carries a stable id, not
  // a revealing filesystem path. Writer + pruner both use originId, so matching holds.
  const originId = "src-" + createHash("sha256").update(originPath).digest("hex").slice(0, 12);
  for (const mt of mirrors) {
    const mirrorPath = path.resolve(container, mt.path);
    mkdirSync(mirrorPath, { recursive: true });
    console.log(`\nMirror → ${mirrorPath}\n  origin: ${originPath}`);

    const kept = new Set<string>();
    for (const entry of mt.vizzes) {
      const vizDir = path.join(container, entry.slug);
      const card = resolveMirrorCard(vizDir, entry);
      const r = await publishOne(vizDir, mirrorPath, card.private, shareHost, {
        overrides: { title: card.title, description: card.description, tags: card.tags },
        sidecar: { origin: originId, card },
      });
      // Only a successfully-written unit is "kept" — a failed push must NOT spare a
      // stale/partial dir of the same slug from the origin-scoped prune below.
      if (r.ok) kept.add(entry.slug);
      const status = r.ok ? (card.private ? "private (sealed)" : "public") : "FAILED — not written";
      console.log(`  • ${r.slug} — ${status}${r.ok && !card.listed ? ", unlisted" : ""}`);
      for (const w of r.warnings) console.log(`      ⚠️  ${w}`);
      if (r.link) console.log(`      🔗 ${r.link}`);
    }

    // Origin-scoped prune: drop ONLY our stale mirrored dirs (origin == us, no longer
    // listed). Never touch the sink's natives or another origin's mirrored-in dirs.
    let pruned = 0;
    for (const dir of vizzesIn(mirrorPath)) {
      const side = readSidecar(dir);
      if (side && side.origin === originId && !kept.has(path.basename(dir))) {
        rmSync(dir, { recursive: true, force: true });
        pruned++;
        console.log(`  ✂️  pruned ${path.basename(dir)} (dropped from manifest)`);
      }
    }

    // Regenerate the sink's index from local presence (same rule any writer applies).
    const { cards } = composeCards(mirrorPath);
    await writeLobby(mirrorPath, cards, "Visualizations", mirrorPath, shareHost);
    console.log(`  index → ${path.join(mirrorPath, "index.html")}  (${cards.length} listed${pruned ? `, ${pruned} pruned` : ""})`);
  }
}
