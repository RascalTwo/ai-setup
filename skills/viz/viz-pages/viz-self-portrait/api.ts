import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mirror of the skill's discovery layer (the self-portrait lives in the viz repo,
// not the skill dir, so it can't import discovery.ts — these stay in lockstep).
const HOME = os.homedir();
function resolveVizRoot(): string {
  if (process.env.VIZ_PAGES_DIR) return process.env.VIZ_PAGES_DIR;
  const neutral = path.join(HOME, ".viz-pages");
  const legacy = path.join(HOME, ".claude", "viz-pages");
  if (existsSync(neutral)) return neutral;
  if (existsSync(legacy)) return legacy;
  return neutral;
}
const CENTRAL = resolveVizRoot();
const REGISTRY = path.join(CENTRAL, ".discovered.json");

function idFor(absDir: string): string | null {
  const rel = path.relative(HOME, absDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}
function readRegistry(): string[] {
  try {
    const raw = JSON.parse(readFileSync(REGISTRY, "utf8"));
    return Array.isArray(raw) ? raw.filter((p) => typeof p === "string" && existsSync(p)) : [];
  } catch {
    return [];
  }
}
function allContainers(): string[] {
  return [...new Set([CENTRAL, ...readRegistry()])].filter((c) => existsSync(c));
}

async function $(cmd: string, args: string[], cwd?: string): Promise<string> {
  try {
    const proc = Bun.spawn([cmd, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return "";
  }
}

// ---- writes shell out to the skill's manage.ts (ADR 0009) ----
// The self-portrait lives in the viz repo and can't import skill modules, so every
// mutation (move/update/mirror) spawns `bun manage.ts <verb>` — one definition of
// the hard logic (mirror migration, fail-closed validation, surgical-staging commit)
// lives there, never a drifting copy here. server.ts hands us the skill dir via env.
const SKILL_DIR = process.env.VIZ_SKILL_DIR;
async function manage(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  if (!SKILL_DIR) return { ok: false, out: "", err: "VIZ_SKILL_DIR unset — the self-portrait must be served by the central skill server." };
  const managePath = path.join(SKILL_DIR, "manage.ts");
  if (!existsSync(managePath)) return { ok: false, out: "", err: `manage.ts not found at ${managePath}.` };
  const proc = Bun.spawn(["bun", managePath, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { ok: (await proc.exited) === 0, out: out.trim(), err: err.trim() };
}
async function readBody(req: Request): Promise<Record<string, any>> {
  return (await req.json().catch(() => ({}))) as Record<string, any>;
}

// ---- live preview: one `build.ts preview <container>` process at a time ----
// build.ts preview builds the exact publishable tree then serves it, blocking
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
// metas are the SAME source of truth build.ts reads — posture (access),
// listed (index advertisement), kind (frozen-shelf-life). Cheap enough for the
// fast path: one small file read per slug.
function grabMeta(html: string, name: string): string {
  // content=(["'])(.*?)\1 — match the delimiter, then anything up to the SAME
  // delimiter. A plain [^"'] class truncates at the first apostrophe inside a
  // double-quoted value (e.g. "Claude Code's ...").
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "i");
  return (html.match(re)?.[2] ?? "").trim();
}
// Meta content is stored HTML-escaped (manage.ts / inline.ts) — decode back to raw
// text for JSON so the UI escapes exactly once and edit inputs prefill cleanly.
function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e as string]!);
}
function grabMetaAll(html: string, name: string): string[] {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "gi");
  return [...html.matchAll(re)].map((m) => decode(m[2].trim())).filter(Boolean);
}
type Axes = {
  posture: "public" | "private" | "local" | "untagged";
  listed: boolean;
  kind: "operational" | "explanatory";
  triaged: boolean;
  title: string;
  description: string;
  tags: string[];
};
function readAxes(dir: string): Axes {
  try {
    const html = readFileSync(path.join(dir, "index.html"), "utf8");
    const p = grabMeta(html, "viz:posture").toLowerCase();
    const posture = p === "public" || p === "private" || p === "local" ? p : "untagged";
    const l = grabMeta(html, "viz:listed").toLowerCase();
    const listed = l !== "false" && l !== "unlisted";
    const kind = grabMeta(html, "viz:kind").toLowerCase() === "operational" ? "operational" : "explanatory";
    return {
      posture,
      listed,
      kind,
      triaged: grabMeta(html, "viz:triaged").toLowerCase() === "true",
      title: decode(grabMeta(html, "viz:title")),
      description: decode(grabMeta(html, "viz:description")),
      tags: grabMetaAll(html, "viz:tag"),
    };
  } catch {
    return { posture: "untagged", listed: true, kind: "explanatory", triaged: false, title: "", description: "", tags: [] };
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
      names = readdirSync(container, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
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
  return container === CENTRAL ? ".claude/viz-pages" : (idFor(path.dirname(container)) ?? container);
}
// Same label, derived from a viz id ("<repo>/viz-pages/<slug>" → repo scope).
function scopeOfVizId(vizId: string): string {
  const repo = vizId.split("/").slice(0, -2).join("/");
  return repo === ".claude" ? ".claude/viz-pages" : (repo || vizId);
}
// A vendored copy (manage.ts vendor) carries a .vendored.json marker naming its origin.
// Unlike a build-mirror sink, it's a REAL runnable viz — so it lists natively; we only
// label it as a copy. Returns the origin viz id, or null for an ordinary viz.
function vendoredOrigin(dir: string): string | null {
  const p = path.join(dir, ".vendored.json");
  if (!existsSync(p)) return null;
  try { return String(JSON.parse(readFileSync(p, "utf8")).origin || "") || null; } catch { return null; }
}

export default {
  // FAST path (5s refresh): pure disk stats for every viz across every root.
  "/slugs": async () => {
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
        kind: axes.kind,
        triaged: axes.triaged,
        title: axes.title,
        description: axes.description,
        tags: axes.tags,
        mtime: newestMtime(s.dir),
        created: createdMs(s.dir),
        sizeBytes: dirSize(s.dir),
        og: ["og.png", "og.jpg", "og.auto.png"].find((f) => files.includes(f)) ?? null, // OG preview image, if any
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
      bunVersion: Bun.version,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      central: CENTRAL,
      containers: allContainers().length,
      port: 5180,
    });
  },

  // ---- mutations: read here, write through manage.ts (ADR 0009) ----

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

  // Axis toggles (posture | listed | kind | triaged) plus free-text frame metadata
  // (title | description | tags). Each is independent — only an explicit triaged
  // toggle changes triaged (no auto-stamp), same as the CLI.
  "/update": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const args = ["update", s.dir];
    for (const axis of ["posture", "listed", "kind", "triaged"]) {
      if (b[axis] !== undefined && b[axis] !== null && b[axis] !== "") args.push(`--${axis}`, String(b[axis]));
    }
    // Free-text fields: empty string is a meaningful clear, so only undefined/null skip.
    for (const f of ["title", "description", "tags"]) {
      if (b[f] !== undefined && b[f] !== null) args.push(`--${f}`, String(b[f]));
    }
    const r = await manage(args);
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
    const r = await manage(["move", s.dir, destDir]);
    return Response.json({ ...r, newId: idFor(destDir) }, { status: r.ok ? 200 : 400 });
  },

  // Delete a viz folder (and its mirror declarations). Client re-fetches /slugs after.
  "/delete": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const r = await manage(["delete", s.dir]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Mirror config: sub = ls|add|update|rm. (ls is also served read-only by /mirrors.)
  "/mirror": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const args = ["mirror", String(b.sub), s.dir];
    // `to` may arrive absolute (add: a picked container) or container-relative (rm:
    // a stored mirrors.json path). manage.ts resolves --to from CWD, not the viz
    // container, so anchor it here — absolute stays absolute, relative resolves right.
    if (b.to) args.push("--to", path.resolve(s.container, String(b.to)));
    for (const f of ["access", "listed", "title", "description", "tags"]) {
      if (b[f] !== undefined && b[f] !== null && b[f] !== "") args.push(`--${f}`, String(b[f]));
    }
    const r = await manage(args);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Vendor: copy the whole viz into another container as a self-contained, runnable
  // copy (manage.ts also stamps .vendored.json and installs a drift-guard pre-commit
  // hook in the sink repo). `to` is a picked container path, anchored like /mirror.
  "/vendor": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    if (!b.to) return Response.json({ ok: false, err: "no sink container" }, { status: 400 });
    const r = await manage(["vendor", s.dir, "--to", path.resolve(s.container, String(b.to))]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // Re-pull a vendored copy from its origin (only valid on a copy carrying .vendored.json).
  "/vendor-sync": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const b = await readBody(req);
    const s = slugById(b.id);
    if (!s) return Response.json({ ok: false, err: `unknown viz id: ${b.id}` }, { status: 404 });
    const r = await manage(["vendor-sync", s.dir]);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  },

  // ---- live preview: build a container exactly as it would publish, serve locally ----
  // POST {container}. Kills any running preview, spawns `build.ts preview`, and resolves
  // once the served URL prints (= build finished) — so the request takes as long as the
  // build and returns { url }. If the process dies before serving (a publish gate refused
  // it), returns its stderr. The child keeps serving until the next preview or /preview-stop.
  "/preview": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    if (!SKILL_DIR) return Response.json({ ok: false, err: "VIZ_SKILL_DIR unset — the self-portrait must be served by the central skill server." }, { status: 400 });
    const buildPath = path.join(SKILL_DIR, "build.ts");
    if (!existsSync(buildPath)) return Response.json({ ok: false, err: `build.ts not found at ${buildPath}.` }, { status: 400 });
    const b = await readBody(req);
    const container = b.container ? path.resolve(String(b.container)) : "";
    if (!container || !existsSync(container)) return Response.json({ ok: false, err: `unknown container: ${b.container}` }, { status: 404 });

    killPreview(); // take down the old one first

    const proc = Bun.spawn(["bun", buildPath, "preview", container], { stdout: "pipe", stderr: "pipe" });
    const result = await new Promise<string>((resolve, reject) => {
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
              const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//);
              if (m) { found = true; clearTimeout(timer); resolve(m[0]); drain(proc.stderr); }
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

    if (typeof result !== "string") {
      try { proc.kill(); } catch {}
      G.__vizPreview = null;
      return Response.json({ ok: false, err: (result as any).__err }, { status: 400 });
    }
    G.__vizPreview = { proc, container, url: result };
    return Response.json({ ok: true, url: result, container });
  },

  // Take down the running preview (a new /preview auto-invokes this first).
  "/preview-stop": async (req: Request) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const was = G.__vizPreview?.url ?? null;
    killPreview();
    return Response.json({ ok: true, stopped: was });
  },
};
