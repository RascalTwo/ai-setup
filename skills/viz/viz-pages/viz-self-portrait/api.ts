import { VERSION } from "../../lib/version.ts";
import { approvalOf, cardPublicOf, type CardState } from "../../lib/publish/approval.ts";
import { LOBBY_MARKER } from "../../lib/publish/lobby.ts";
import { kindOf } from "../../lib/publish/meta.ts";
import { hiddenTags, isHidden } from "../../lib/library/hidden.ts";
import { rankingView, loadRankings, saveRankings, blankList } from "../../lib/library/ranking.ts";
import { deployedBaseUrl, shareLinks } from "../../lib/publish/base-url.ts";
import { CENTRAL, idFor, allContainers } from "../../discovery.ts";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The self-portrait lives INSIDE the skill (its bundled viz-pages/), so it imports the
// skill's modules directly — discovery, ranking, base-url — rather than keeping
// hand-mirrored copies that drifted (the old resolveVizRoot copy missed ADR 0012's path).

// Every /ranking write is read-modify-write on one JSON file. Without serialisation two
// requests arriving together both read the same state and the second write discards the
// first's change — and the Rank tab saves after EVERY answer, so a fast answerer races
// itself. The queue lives on globalThis because server.ts hot-reimports this module per
// request, which would reset a module-level variable on every call.
function withRankLock<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as any;
  const next = (g.__vizRankLock ?? Promise.resolve()).then(fn, fn);
  // Keep the chain alive but never let a rejection poison later writers.
  g.__vizRankLock = next.then(() => {}, () => {});
  return next;
}

async function $(cmd: string, args: string[], cwd?: string): Promise<string> {
  try {
    const proc = Bun.spawn([cmd, ...args], { ...(cwd !== undefined && { cwd }), stdout: "pipe", stderr: "pipe" });
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return "";
  }
}

// ---- writes shell out to the skill's CLI, viz.ts (ADR 0009) ----
// Importing is possible now, but every mutation still spawns `viz <verb>` on purpose:
// the CLI owns validation, die()-on-refusal and the auto-commit, and its die() calls
// process.exit — in-process that would take the whole server down. One definition of
// the hard logic, reached the same way a terminal reaches it. server.ts hands us the
// skill dir via env.
const SKILL_DIR = process.env.VIZ_SKILL_DIR;
function vizSpawn(args: string[]): { proc?: Bun.Subprocess<"ignore", "pipe", "pipe">; err?: string } {
  if (!SKILL_DIR) return { err: "VIZ_SKILL_DIR unset — the self-portrait must be served by the central skill server." };
  const vizPath = path.join(SKILL_DIR, "viz.ts");
  if (!existsSync(vizPath)) return { err: `viz.ts not found at ${vizPath}.` };
  // process.execPath, not "bun": under launchd the server inherits PATH=/usr/bin:/bin:/usr/sbin:/sbin,
  // where ~/.bun/bin is absent, and every child spawn died with `Executable not found in $PATH: "bun"`.
  // The server IS bun, so its own binary is the one to re-enter.
  return { proc: Bun.spawn([process.execPath, vizPath, ...args], { stdout: "pipe", stderr: "pipe" }) };
}
async function viz(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const { proc, err } = vizSpawn(args);
  if (!proc) return { ok: false, out: "", err: err! };
  const [out, e] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()]);
  return { ok: (await proc.exited) === 0, out: out.trim(), err: e.trim() };
}
async function readBody(req: Request): Promise<Record<string, any>> {
  return (await req.json().catch(() => ({}))) as Record<string, any>;
}

// ---- live preview: one `viz preview <container>` process at a time ----
// viz preview builds the exact publishable tree then serves it, blocking
// forever and printing `http://127.0.0.1:<port>/` to stdout only once the build
// finishes. We keep ONE handle: starting a new preview kills the prior (the "take
// down the old preview" the user sees). ponytail: single-instance by design → no
// port juggling; on a server.ts restart the child orphans (harmless, replaced next run).
// The handle lives on globalThis, NOT module scope: server.ts hot-reimports this
// api.ts per request (cache-busted import, server.ts:225), so a module-level `let`
// would reset every call — globalThis persists for the server process's life.
const G = globalThis as any;
function killPreview() {
  if (G.__vizPreview) { try { G.__vizPreview.proc.kill(); } catch {} G.__vizPreview = null; }
}
async function drain(stream: ReadableStream | null) {
  if (!stream) return;
  try { const r = stream.getReader(); while (true) { const { done } = await r.read(); if (done) break; } } catch {}
}

// Lift the lobby key out of a preview build's stdout. The build already prints all of it for a
// `_private-lobby` container ("passphrase:", "link: …#staticrypt_pwd=<hash>&remember_me", and a
// "🔗" share-shim URL per viz) — this endpoint used to discard it, which meant the only way to
// learn the password was to read a terminal. Nothing is recomputed here; there is no second
// source of truth. Returns null for a container with no private lobby.
//
// `shims` is filtered to URLs carrying the LOBBY hash: a posture:private viz emits a 🔗 too, but
// sealed with its OWN key, and offering it under a "lobby key" heading would be a lie.
function parseLobbyKey(log: string): { passphrase: string; hash: string; shims: string[] } | null {
  const passphrase = log.match(/^\s*passphrase:\s*(\S+)\s*$/m)?.[1];
  const hash = log.match(/#staticrypt_pwd=([^&\s]+)/)?.[1];
  if (!passphrase || !hash) return null;
  const shims = [...log.matchAll(/🔗\s*(\S+)/g)].map((m) => m[1]!).filter((u) => u.includes(`/${hash}/`));
  return { passphrase, hash, shims };
}

function dirSize(p: string): number {
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else
      try {
        total += statSync(full).size;
      } catch {}
  }
  return total;
}
// Read a viz's self-declared axes straight out of its index.html <head>. These
// metas are the SAME source of truth the publish build reads — posture (access),
// listed (index advertisement), kind (frozen-shelf-life). Cheap enough for the
// fast path: one small file read per slug.
function grabMeta(html: string, name: string): string {
  // content=(["'])(.*?)\1 — match the delimiter, then anything up to the SAME
  // delimiter. A plain [^"'] class truncates at the first apostrophe inside a
  // double-quoted value (e.g. "Claude Code's ...").
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "i");
  return (html.match(re)?.[2] ?? "").trim();
}
// Meta content is stored HTML-escaped (viz update / inline.ts) — decode back to raw
// text for JSON so the UI escapes exactly once and edit inputs prefill cleanly.
function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e as string]!);
}
function grabMetaAll(html: string, name: string): string[] {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "gi");
  return [...html.matchAll(re)].map((m) => decode(m[2]!.trim())).filter(Boolean);
}

type Axes = {
  posture: "public" | "private" | "local" | "untagged";
  listed: boolean;
  approval: "approved" | "stale" | "never";
  title: string;
  description: string;
  tags: string[];
  linkedFrom: string[]; // ADR 0016 — non-empty = linked; move/delete/posture refuse in the CLI
  cardPublic: CardState; // ADR 0018 — "public" gets a /share/<slug>/ page when built
  cardWas: string;       // the decision a stale card last carried; "" otherwise
  kind: string;     // "" = a plain page; else deck, poster… (open — any template can add one)
  template: string; // the kind this viz is a TEMPLATE for; "" = not a template
  uid: string;   // ADR 0014 — durable identity; "" for anything not yet backfilled
};
function readAxes(dir: string): Axes {
  try {
    const html = readFileSync(path.join(dir, "index.html"), "utf8");
    const p = grabMeta(html, "viz:posture").toLowerCase();
    const posture = p === "public" || p === "private" || p === "local" ? p : "untagged";
    const l = grabMeta(html, "viz:listed").toLowerCase();
    const listed = l !== "false" && l !== "unlisted";
    return {
      posture,
      listed,
      approval: approvalOf(dir).state,

      uid: grabMeta(html, "viz:uid").trim(),
      title: decode(grabMeta(html, "viz:title")),
      description: decode(grabMeta(html, "viz:description")),
      tags: grabMetaAll(html, "viz:tag"),
      linkedFrom: grabMetaAll(html, "viz:linked-from"),
      ...(({ state, was }) => ({ cardPublic: state, cardWas: was }))(cardPublicOf(dir)),
      kind: kindOf(html),
      template: grabMeta(html, "viz:template").toLowerCase(),
    };
  } catch {
    return { posture: "untagged", listed: true, approval: "never" as const, title: "", description: "", tags: [], linkedFrom: [], cardPublic: "unreviewed" as const, cardWas: "", kind: "", template: "", uid: "" };
  }
}

function newestMtime(p: string): number {
  let max = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(p, entry.name);
    try {
      const st = statSync(full);
      const t = entry.isDirectory() ? newestMtime(full) : st.mtimeMs;
      if (t > max) max = t;
    } catch {}
  }
  return max || statSync(p).mtimeMs;
}

// Filesystem birth time of the viz dir — a "created" proxy. Caveat: birthtime is
// reset by anything that re-creates the dir (clone, `git checkout`/restore, a
// cross-container move), so it tracks "first appeared on THIS disk", not the
// viz's true authoring date. Falls back to mtime where birthtime is unavailable.
function createdMs(p: string): number {
  try {
    const st = statSync(p);
    return st.birthtimeMs || st.mtimeMs;
  } catch {
    return 0;
  }
}

// One slug = one immediate child dir of a container.
type Slug = { id: string; name: string; container: string; dir: string; isCentral: boolean };
function listSlugs(): Slug[] {
  const out: Slug[] = [];
  for (const container of allContainers()) {
    let names: string[];
    try {
      // A viz is a dir WITH an index.html — the same rule lib/publish/publish-one.ts
      // `vizzesIn` uses. Filtering only dotfiles (as this did) let container-level
      // support dirs through: `_thumbs/` showed up in the dashboard as a viz with
      // posture "untagged", which also put it in the triage worklist that is supposed
      // to drain to zero. Keep this predicate identical to vizzesIn's.
      names = readdirSync(container, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .filter((d) => existsSync(path.join(container, d.name, "index.html")))
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = path.join(container, name);
      const id = idFor(dir);
      if (!id) continue;
      out.push({ id, name, container, dir, isCentral: container === CENTRAL });
    }
  }
  return out;
}
function slugById(id: string): Slug | null {
  return listSlugs().find((s) => s.id === id) ?? null;
}

// Declaration-only mirrors: every container's mirrors.json says "this container's
// native viz X is mirrored INTO sink container Y". No build/materialization needed
// to know the relationship — reading the declarations is enough to surface it.
type MirrorDecl = { originContainer: string; originName: string; sinkContainer: string; access: string; listed: boolean };
function allMirrorDecls(): MirrorDecl[] {
  const out: MirrorDecl[] = [];
  for (const container of allContainers()) {
    const file = path.join(container, "mirrors.json");
    if (!existsSync(file)) continue;
    let raw: any;
    try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    for (const m of raw?.mirrors ?? []) {
      const sink = path.resolve(container, m.path ?? "");
      for (const v of m.vizzes ?? []) {
        if (!v?.slug) continue;
        out.push({ originContainer: container, originName: v.slug, sinkContainer: sink, access: v.access ?? "public", listed: v.listed !== false });
      }
    }
  }
  return out;
}
// Human-readable scope label for a container (matches the frontend's f-scope labels).
function scopeLabel(container: string): string {
  // Label the central library by where it RESOLVED, not by a hardcoded name: it has
  // moved twice (~/.claude/viz-pages → ~/.viz-pages → ~/.agents/state/viz), and a literal
  // here is a label that silently lies on every machine but the one it was written on.
  return container === CENTRAL ? (idFor(CENTRAL) ?? CENTRAL) : (idFor(path.dirname(container)) ?? container);
}
// Same label, derived from a viz id ("<repo>/viz-pages/<slug>" → repo scope).
function scopeOfVizId(vizId: string): string {
  const repo = vizId.split("/").slice(0, -2).join("/");
  return repo === ".claude" || repo === ".agents/state" ? scopeLabel(CENTRAL) : (repo || vizId);
}
// A vendored copy (viz vendor add) carries a .vendored.json marker naming its origin.
// Unlike a build-mirror sink, it's a REAL runnable viz — so it lists natively; we only
// label it as a copy. Returns the origin viz id, or null for an ordinary viz.
function vendoredOrigin(dir: string): string | null {
  const p = path.join(dir, ".vendored.json");
  if (!existsSync(p)) return null;
  try { return String(JSON.parse(readFileSync(p, "utf8")).origin || "") || null; } catch { return null; }
}

export default {
  // ---- ranking (ADR 0014; engine: @rascaltwo/pairwise-sorter via kit/pairwise.js) ----
  // The corpus derivation and storage live in lib/library/ranking.ts (shared with
  // `viz ranking`); this route only adds the dimension edits and the locked writes.
  "/ranking": async (req: Request) => {
    const load = loadRankings;
    const save = saveRankings;

    if (req.method === "POST") {
      const b = await readBody(req);
      return withRankLock(async () => {
      const d = load();

      if (b.action === "new") {
        const name = String(b.name ?? "").trim();
        if (!name) return Response.json({ ok: false, err: "a dimension needs a name" }, { status: 400 });
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list";
        if (d.lists[id]) return Response.json({ ok: false, err: `"${name}" already exists` }, { status: 409 });
        d.lists[id] = blankList(name);
        d.current = id;
        await save(d);
        return Response.json({ ok: true, current: id });
      }
      if (b.action === "rename") {
        if (!d.lists[b.list]) return Response.json({ ok: false, err: `no dimension "${b.list}"` }, { status: 404 });
        const name = String(b.name ?? "").trim();
        if (!name) return Response.json({ ok: false, err: "a dimension needs a name" }, { status: 400 });
        const clash = Object.entries(d.lists).find(([id, l]: any) => id !== b.list && l.name.toLowerCase() === name.toLowerCase());
        if (clash) return Response.json({ ok: false, err: `"${name}" is already taken` }, { status: 409 });
        // The ID does NOT change. It is the key the log lives under, and deriving it from
        // the (mutable) name would orphan every answer on a rename — the same mistake
        // viz:uid exists to prevent. The name is a label; the id is identity.
        d.lists[b.list] = { ...d.lists[b.list], name };
        await save(d);
        return Response.json({ ok: true, list: b.list, name });
      }
      if (b.action === "delete") {
        if (!d.lists[b.list]) return Response.json({ ok: false, err: `no dimension "${b.list}"` }, { status: 404 });
        // Refuse to delete the last one: an empty picker has no recoverable state and
        // the next read would silently invent a default, losing the name you chose.
        if (Object.keys(d.lists).length === 1)
          return Response.json({ ok: false, err: "that is the only dimension — rename it or add another first" }, { status: 409 });
        const answered = (d.lists[b.list].log ?? []).length;
        delete d.lists[b.list];
        if (d.current === b.list) d.current = Object.keys(d.lists)[0];
        await save(d);
        return Response.json({ ok: true, deleted: b.list, answered, current: d.current });
      }
      if (b.action === "select") {
        if (!d.lists[b.list]) return Response.json({ ok: false, err: `no dimension "${b.list}"` }, { status: 404 });
        d.current = b.list;
        await save(d);
        return Response.json({ ok: true, current: d.current });
      }

      // default: record progress against a named list (never "whatever is current" —
      // a stale tab could otherwise write one dimension's answers into another).
      const id = String(b.list ?? d.current);
      if (!d.lists[id]) return Response.json({ ok: false, err: `no dimension "${id}"` }, { status: 404 });
      if (!Array.isArray(b.log)) return Response.json({ ok: false, err: "log must be an array" }, { status: 400 });
      d.lists[id] = { ...d.lists[id], log: b.log,
        benched: Array.isArray(b.benched) ? b.benched : [],
        priority: Array.isArray(b.priority) ? b.priority : [],
        updated: new Date().toISOString() };
      await save(d);
      return Response.json({ ok: true, list: id, answered: b.log.length });
      });
    }

    return Response.json(rankingView());
  },

  "/slugs": async () => {
    const hidden = hiddenTags();
    const natives = listSlugs().map((s) => {
      const files = readdirSync(s.dir).filter((f) => !f.startsWith("."));
      // Host = the repo/dir that owns an external viz (the container's parent).
      const hostDir = path.dirname(s.container);
      const axes = readAxes(s.dir);
      const vOrigin = vendoredOrigin(s.dir); // origin id if this is a vendored copy
      return {
        id: s.id,
        name: s.name,
        isCentral: s.isCentral,
        container: s.container,
        // A vendored copy or a build-mirror sink both read as "mirrored-in" for the UI.
        mirroredIn: vOrigin ? true : existsSync(path.join(s.dir, ".mirror.json")),
        isMirror: false,          // a synthetic declaration-mirror row (set below)
        isVendored: !!vOrigin,    // a real full copy carrying .vendored.json
        vendorOrigin: vOrigin,    // its origin id (for the origin-side annotation)
        mirrorFrom: vOrigin ? scopeOfVizId(vOrigin) : undefined,
        mirrorsOut: [] as string[],  // sink scopes this native is publish-mirrored INTO
        vendoredOut: [] as string[], // sink scopes this native is vendored INTO
        host: s.isCentral ? null : (idFor(hostDir) ?? hostDir),
        fileCount: files.length,
        hasApi: files.includes("api.ts"),
        hasTape: files.includes("recordings.json"),
        posture: axes.posture,
        listed: axes.listed,
        approval: axes.approval,
        title: axes.title,
        description: axes.description,
        tags: axes.tags,
        hidden: isHidden(axes.tags, hidden), // a hidden tag (ADR 0020) — the UI shows it only under "show all"
        linkedFrom: axes.linkedFrom,
        uid: axes.uid,
        cardPublic: axes.cardPublic,
        cardWas: axes.cardWas,
        // A _private-lobby container seals its public vizzes, so the build gives them a
        // lobby shim instead of a card-public share page. The marker's presence is the
        // whole signal — readLobby() would also mint the lobby key, which a read must not.
        lobby: existsSync(path.join(s.container, LOBBY_MARKER)),
        kind: axes.kind, // "" = plain page; else deck, poster… (open set)
        template: axes.template,
        mtime: newestMtime(s.dir),
        created: createdMs(s.dir),
        sizeBytes: dirSize(s.dir),
        og: ["og.gif", "og.png", "og.jpg", "og.auto.png"].find((f) => files.includes(f)) ?? null, // OG preview image, if any
        hero: files.includes("hero.html"), // hand-authored OG card source
      };
    });

    // Origin side of a vendored copy: flag each origin with the scopes it's vendored INTO
    // (the copies themselves already list natively in their sink's scope).
    const byId = new Map(natives.map((n) => [n.id, n]));
    for (const n of natives) {
      if (!n.vendorOrigin) continue;
      const origin = byId.get(n.vendorOrigin);
      if (origin) origin.vendoredOut.push(scopeLabel(n.container));
    }

    // Surface each declared (publish) mirror as an extra row in its SINK's scope
    // (mirroredIn:true → the UI badges it and "originals only" hides it), and flag the
    // ORIGIN with where it's mirrored TO. So the relationship shows from both sides.
    const byOrigin = new Map(natives.map((n) => [n.container + "\0" + n.name, n]));
    const mirrors = [];
    for (const d of allMirrorDecls()) {
      const origin = byOrigin.get(d.originContainer + "\0" + d.originName);
      if (!origin) continue; // declaration for a viz that no longer exists — skip
      origin.mirrorsOut.push(scopeLabel(d.sinkContainer));
      const sinkCentral = d.sinkContainer === CENTRAL;
      mirrors.push({
        ...origin,
        id: `${origin.id}↦${d.sinkContainer}`, // unique row key; href uses originId
        originId: origin.id,
        isMirror: true,
        mirroredIn: true,
        mirrorsOut: [],
        mirrorFrom: scopeLabel(d.originContainer),
        container: d.sinkContainer,
        isCentral: sinkCentral,
        host: sinkCentral ? null : (idFor(path.dirname(d.sinkContainer)) ?? d.sinkContainer),
        posture: d.access, // a mirror re-decides its own trust boundary
        listed: d.listed,
      });
    }

    return Response.json([...natives, ...mirrors].sort((a, b) => b.mtime - a.mtime));
  },

  // SLOW path (on load / on rescan): git-derived stats per host repo.
  // Central uses an efficient 2-pass over the whole central repo (its slugs are
  // top-level). External vizzes are scoped per-slug to their host repo's path.
  "/slugs-git": async () => {
    const byId: Record<string, { commitCount: number }> = {};

    // --- Central: 2-pass, attribute by top-level dir (the slug name) ---
    const log = await $("git", ["log", "--pretty=format:%H", "--name-only"], CENTRAL);
    const commitsByName = new Map<string, number>();
    let touched = new Set<string>();
    let inCommit = false;
    const flush = () => {
      for (const s of touched) commitsByName.set(s, (commitsByName.get(s) ?? 0) + 1);
      touched = new Set<string>();
    };
    for (const line of log.split("\n")) {
      if (/^[0-9a-f]{40}$/.test(line)) {
        if (inCommit) flush();
        inCommit = true;
      } else if (line && inCommit) {
        const top = line.split("/")[0];
        if (top && !top.startsWith(".")) touched.add(top);
      }
    }
    if (inCommit) flush();

    for (const s of listSlugs().filter((s) => s.isCentral)) {
      byId[s.id] = {
        commitCount: commitsByName.get(s.name) ?? 0,
      };
    }

    // --- External: scope each slug to its host repo's path ---
    const externals = listSlugs().filter((s) => !s.isCentral);
    const repoRootCache = new Map<string, string>();
    for (const s of externals) {
      let repoRoot = repoRootCache.get(s.container);
      if (repoRoot === undefined) {
        repoRoot = await $("git", ["-C", s.container, "rev-parse", "--show-toplevel"], undefined);
        repoRootCache.set(s.container, repoRoot);
      }
      if (!repoRoot) {
        byId[s.id] = { commitCount: 0 };
        continue;
      }
      const rel = path.relative(repoRoot, s.dir);
      const oneline = await $("git", ["-C", repoRoot, "log", "--oneline", "--", rel]);
      byId[s.id] = { commitCount: oneline.split("\n").filter(Boolean).length };
    }

    return Response.json(byId);
  },

  "/log": async () => {
    const out = await $("git", ["log", "--pretty=format:%h\t%s\t%ar"], CENTRAL);
    const commits = out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, when] = line.split("\t");
        return { hash, subject, when };
      });
    return Response.json(commits);
  },

  "/server-info": async () => {
    return Response.json({
      // The skill's own version, so this page can say which release it documents. It
      // matters because .mcpb has no auto-update: someone reading a published copy of
      // this page has no other way to tell whether it describes what they installed.
      vizVersion: VERSION,
      bunVersion: Bun.version,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      central: CENTRAL,
      containers: allContainers().length,
      port: 5180,
    });
  },

  // ---- mutations: read here, write through viz.ts (ADR 0009) ----

  // Mirror declarations for one viz — a plain local mirrors.json read + filter (no
  // validation needed for display; only writes cross the shell boundary).
  "/mirrors": async (req: Request) => {
    const s = slugById(new URL(req.url).searchParams.get("id") ?? "");
    if (!s) return Response.json([]);
    const file = path.join(s.container, "mirrors.json");
    if (!existsSync(file)) return Response.json([]);
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      return Response.json(
        (raw.mirrors ?? []).flatMap((m: any) =>
          (m.vizzes ?? [])
            .filter((v: any) => v.slug === s.name)
            .map((v: any) => ({ to: m.path, access: v.access, listed: v.listed !== false, overrides: v.overrides ?? null })),
        ),
      );
    } catch {
      return Response.json([]);
    }
  },

  // Axis toggles (posture | listed | approved) plus free-text frame metadata
  // (title | description | tags). Each is independent. `approved` stores a hash of the
  // viz's current content (ADR 0015), so the CLI computes it — never pass a value here
  // other than true|false.
  "/update": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const args = ["update", s.dir];
    // `card-public` stores a card fingerprint (ADR 0018); a refusal (no designed hero)
    // comes back as the CLI's own message.
    for (const axis of ["posture", "listed", "approved", "card-public"]) {
      if (b[axis] !== undefined && b[axis] !== null && b[axis] !== "") args.push(`--${axis}`, String(b[axis]));
    }
    // Free-text fields: empty string is a meaningful clear, so only undefined/null skip.
    for (const f of ["title", "description", "tags"]) {
      if (b[f] !== undefined && b[f] !== null) args.push(`--${f}`, String(b[f]));
    }
    // One linked-from entry added or removed per call (ADR 0016). No --break-links here:
    // breaking a linked viz's URL stays a CLI decision, so the refusal reaches the UI as-is.
    for (const f of ["linked-from", "unlinked-from"]) {
      if (b[f]) args.push(`--${f}`, String(b[f]));
    }
    const r = await viz(args);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Rename (new name, same container) or cross-container move (toContainer). Either
  // changes the id = URL, so the client re-fetches /slugs after.
  "/move": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const destDir = path.join(b.toContainer ? path.resolve(b.toContainer) : s.container, b.name ?? s.name);
    const r = await viz(["move", s.dir, destDir]);
    return Response.json({ ...r, newId: idFor(destDir) }, { status: r.ok ? 200 : 400 });
  },

  // Delete a viz folder (and its mirror declarations). Client re-fetches /slugs after.
  "/delete": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const r = await viz(["delete", s.dir]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Mirror config: sub = add|update|rm. (ls is served read-only by /mirrors.)
  "/mirror": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    // A literal list, not a pass-through: it is what the drawer spawns, and
    // tests/ui-coverage.test.ts reads it to hold the CLI's ui declarations to the truth.
    const MIRROR_SUBS = ["add", "update", "rm"];
    if (!MIRROR_SUBS.includes(String(b.sub))) return Response.json({ ok: false, err: `unknown mirror sub: ${b.sub}` }, { status: 400 });
    const args = ["mirror", String(b.sub), s.dir];
    // `to` may arrive absolute (add: a picked container) or container-relative (rm:
    // a stored mirrors.json path). viz resolves --to from CWD, not the viz
    // container, so anchor it here — absolute stays absolute, relative resolves right.
    if (b.to) args.push("--to", path.resolve(s.container, String(b.to)));
    for (const f of ["access", "listed"]) {
      if (b[f] !== undefined && b[f] !== null && b[f] !== "") args.push(`--${f}`, String(b[f]));
    }
    // Overrides: empty string is a meaningful clear (drops that override), like /update.
    for (const f of ["title", "description", "tags"]) {
      if (b[f] !== undefined && b[f] !== null) args.push(`--${f}`, String(b[f]));
    }
    const r = await viz(args);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Vendor: copy the whole viz into another container as a self-contained, runnable
  // copy (the CLI also stamps .vendored.json and installs a drift-guard pre-commit
  // hook in the sink repo). `to` is a picked container path, anchored like /mirror.
  // --access is the viz's OWN posture: the CLI demands it as an acknowledgement of what
  // crosses the trust boundary, and the UI shows it in the confirm ("copy as <posture>").
  // Omitting it (as this route once did) made every copy fail.
  "/vendor": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    if (!b.to) return Response.json({ ok: false, err: "no sink container" }, { status: 400 });
    const r = await viz(["vendor", "add", s.dir, "--to", path.resolve(s.container, String(b.to)), "--access", readAxes(s.dir).posture]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Re-pull a vendored copy from its origin (only valid on a copy carrying .vendored.json).
  "/vendor-sync": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const r = await viz(["vendor", "sync", s.dir]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Undeclare a vendor edge. The copy itself is pruned on the next --push-vendors.
  "/vendor-rm": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    if (!b.to) return Response.json({ ok: false, err: "no sink container" }, { status: 400 });
    const r = await viz(["vendor", "rm", s.dir, "--to", path.resolve(s.container, String(b.to))]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // This viz's vendor declarations, read straight from mirrors.json like /mirrors.
  "/vendors": async (req: Request) => {
    const s = slugById(new URL(req.url).searchParams.get("id") ?? "");
    if (!s) return Response.json([]);
    try {
      const raw = JSON.parse(readFileSync(path.join(s.container, "mirrors.json"), "utf8"));
      return Response.json((raw.vendors ?? []).flatMap((t: any) =>
        (t.vizzes ?? []).filter((v: any) => v.slug === s.name).map((v: any) => ({ to: t.path, access: v.access }))));
    } catch {
      return Response.json([]);
    }
  },

  // Per-viz git log via `viz history --json` — [{hash, date, subject}].
  "/history": async (req: Request) => {
    const s = slugById(new URL(req.url).searchParams.get("id") ?? "");
    if (!s) return Response.json({ ok: false, err: "unknown viz id" }, { status: 404 });
    const r = await viz(["history", s.dir, "--n", "20", "--json"]);
    if (!r.ok) return Response.json(r, { status: 400 });
    return Response.json({ ok: true, commits: JSON.parse(r.out) });
  },

  // Render to mp4 — the same background job the CLI and MCP start (`viz render`). start
  // returns at once; the page polls status for progress. Nothing here waits on a render.
  "/render": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    let r;
    if (b.action === "start") {
      const s = slugById(b.id);
      if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
      r = await viz(["render", "start", s.id, "--json"]);
    } else {
      if (!/^[\w.-]+$/.test(String(b.job ?? ""))) return Response.json({ ok: false, err: "job must be a render job id" }, { status: 400 });
      r = b.action === "cancel" ? await viz(["render", "cancel", String(b.job), "--json"]) : await viz(["render", "status", String(b.job), "--json"]);
    }
    let job = null;
    try { job = JSON.parse(r.out); } catch {}
    return Response.json({ ...r, job }, { status: job ? 200 : 400 });
  },

  // Restore a viz's files to an earlier commit (commits the restore, like every write).
  "/rollback": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    if (!/^[0-9a-f]{7,40}$/.test(String(b.commit ?? ""))) return Response.json({ ok: false, err: "commit must be a hash" }, { status: 400 });
    const r = await viz(["rollback", s.dir, String(b.commit)]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // New viz from a template (or any viz — create --from forks by path). Central unless
  // `local` names a repo dir. --json keeps stdout parseable AND stops create opening a
  // browser tab; the page opens the new viz itself.
  "/create": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const src = slugById(b.from);
    if (!src) return Response.json({ ok: false, err: `unknown viz id: ${b.from}` }, { status: 404 });
    const slug = String(b.slug ?? "").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return Response.json({ ok: false, err: "slug: lowercase letters, digits and dashes" }, { status: 400 });
    const r = await viz(["create", slug, "--from", src.dir, "--json", ...(b.local ? ["--local", path.resolve(String(b.local))] : [])]);
    if (!r.ok) return Response.json(r, { status: 400 });
    let made: any = {};
    try { made = JSON.parse(r.out); } catch {}
    return Response.json({ ...r, id: made.id ?? null, url: made.url ?? null });
  },

  // Rotate a container's LOBBY key — every existing lobby link and passphrase dies. The
  // new key is minted on the next build, so the page re-runs preview to show it.
  "/rotate": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const container = b.container ? path.resolve(String(b.container)) : "";
    if (!container || !allContainers().includes(container)) return Response.json({ ok: false, err: `unknown container: ${b.container}` }, { status: 404 });
    const r = await viz(["rotate", container, "--lobby"]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // ---- live preview: build a container exactly as it would publish, serve locally ----
  // POST {container}. Kills any running preview, spawns `viz preview`, and resolves
  // once the served URL prints (= build finished) — so the request takes as long as the
  // build and returns { url }. If the process dies before serving (a publish gate refused
  // it), returns its stderr. The child keeps serving until the next preview or /preview-stop.
  "/preview": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const container = b.container ? path.resolve(String(b.container)) : "";
    if (!container || !existsSync(container)) return Response.json({ ok: false, err: `unknown container: ${b.container}` }, { status: 404 });

    killPreview(); // take down the old one first

    const { proc, err } = vizSpawn(["preview", container]);
    if (!proc) return Response.json({ ok: false, err }, { status: 400 });
    const result = await new Promise<{ url: string; log: string }>((resolve, reject) => {
      // ponytail: 180s ceiling — a first build with Chrome OG generation is the slow
      // case; bump if a huge container ever legitimately needs longer.
      const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("preview build timed out after 180s")); }, 180_000);
      (async () => {
        const reader = proc.stdout.getReader();
        const dec = new TextDecoder();
        let out = "", found = false;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!found) {
              out += dec.decode(value, { stream: true });
              // Anchored to the "👀 Preview" banner, which preview prints LAST — a bare
              // /127\.0\.0\.1:\d+\// would now also match the share-shim links printed
              // mid-build and resolve before the lobby key had been logged.
              const m = out.match(/👀 Preview[\s\S]*?(http:\/\/127\.0\.0\.1:\d+\/)/);
              if (m) { found = true; clearTimeout(timer); resolve({ url: m[1]!, log: out }); drain(proc.stderr); }
            }
            // once found we keep reading & discarding so the pipe never blocks the child
          }
        } catch {}
        if (!found) {
          clearTimeout(timer);
          const err = (await new Response(proc.stderr).text()).trim();
          reject(new Error(err || out.trim() || "preview exited without serving a URL"));
        }
      })();
    }).catch((e) => ({ __err: String(e?.message || e) }));

    if (!("url" in (result as any))) {
      try { proc.kill(); } catch {}
      G.__vizPreview = null;
      return Response.json({ ok: false, err: (result as any).__err }, { status: 400 });
    }
    const { url, log } = result as { url: string; log: string };
    G.__vizPreview = { proc, container, url };
    return Response.json({ ok: true, url, container, lobby: parseLobbyKey(log) });
  },

  // ---- the base-url.sh contract: ask a container where it deploys ----
  // POST {container}. Deliberately NOT called on scope selection — only on an explicit
  // click — because this executes a script out of whichever repo is selected, and the
  // answer feeds share links that carry the lobby key. The run (fail-closed) and the
  // share-link list live in lib/publish/base-url.ts, shared with `viz urls`.
  "/base-url": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const container = b.container ? path.resolve(String(b.container)) : "";
    if (!container || !existsSync(container)) return Response.json({ ok: false, err: `unknown container: ${b.container}` }, { status: 404 });
    const r = await deployedBaseUrl(container);
    return Response.json(r.ok ? { ...r, shares: shareLinks(container, r.url) } : r);
  },

  // Take down the running preview (a new /preview auto-invokes this first).
  "/preview-stop": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const was = G.__vizPreview?.url ?? null;
    killPreview();
    return Response.json({ ok: true, stopped: was });
  },
};
