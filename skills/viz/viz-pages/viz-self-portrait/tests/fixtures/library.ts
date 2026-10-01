// A SYNTHETIC viz library — the stand-in's world. Every name, path and repo here is invented;
// never paste real `api/slugs` output in (it names client projects, and this repo is published).
//
// The shapes are api.ts's: `Slug` is one row of GET api/slugs, and so on. `library()` returns a
// fresh, mutable copy each call, so a test (or a stub standing in for a write) can change it and
// the page's next poll sees the change.
//
// What the default library covers, so a test can pick a row by what it needs:
//   posture     public · private · local · untagged          (tide-clock, river-poster, garden-planner, loose-sketch)
//   listed      listed · unlisted                            (river-poster, atlas-dive are unlisted)
//   approval    approved · stale · never                     (tide-clock, orbit-deck, river-poster)
//   card        public · not-public · stale · unreviewed     (tide-clock, river-poster, atlas-metrics, garden-planner)
//   kind        page · deck · poster · poster-dive · exchange
//   template    deck (orbit-deck) · poster (poster-starter)
//   copies      a publish-mirror row (tide-clock ↦ atlas) · a vendored copy (garden-planner → harbor)
//   hidden      secret-notes carries a hidden tag (only shown under "show all")
//   lobby       the harbor container is a _private-lobby
//   linked      atlas-metrics is linked from elsewhere
//   no uid      loose-sketch (so Rank leaves it out)

export const HOME = "/Users/ada";
export const CENTRAL = `${HOME}/.agents/state/viz`;
export const ATLAS = `${HOME}/code/atlas/viz-pages`;
export const HARBOR = `${HOME}/code/harbor/viz-pages`;

export type CardState = "public" | "not-public" | "unreviewed" | "stale";
export interface Slug {
  id: string; name: string; isCentral: boolean; container: string;
  mirroredIn: boolean; isMirror: boolean; isVendored: boolean; vendorOrigin: string | null; mirrorFrom?: string;
  mirrorsOut: string[]; vendoredOut: string[]; originId?: string; host: string | null;
  fileCount: number; hasApi: boolean; hasTape: boolean; posture: string; listed: boolean;
  approval: "approved" | "stale" | "never"; title: string; description: string; tags: string[];
  hidden: boolean; linkedFrom: string[]; uid: string; cardPublic: CardState; cardWas: string;
  lobby: boolean; kind: string; template: string; mtime: number; created: number;
  sizeBytes: number; og: string | null; hero: boolean;
}
export interface Commit { hash: string; subject: string; when: string }
export interface ServerInfo { vizVersion: string; bunVersion: string; pid: number; uptimeSec: number; central: string; containers: number; port: number }
export interface Mirror { to: string; access: string; listed: boolean; overrides: { title?: string; description?: string; tags?: string[] } | null }
export interface Vendor { to: string; access: string }
export interface HistoryCommit { hash: string; date: string; subject: string }
export interface RankItem { title: string; url: string; key: string; desc: string; media: string[]; tags: string[]; vizId: string; approval: Slug["approval"] }
export interface RankList { name: string; log: [string, number][]; benched: string[]; priority: string[] }

export interface Library {
  slugs: Slug[];
  git: Record<string, { commitCount: number }>;
  log: Commit[];
  server: ServerInfo;
  mirrors: Record<string, Mirror[]>;   // by viz id
  vendors: Record<string, Vendor[]>;   // by viz id
  history: Record<string, HistoryCommit[]>; // by viz id; a missing id answers { ok: false }
  ranking: { items: RankItem[]; current: string; lists: Record<string, RankList> };
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const idOf = (container: string, name: string) => container.slice(HOME.length + 1) + "/" + name;
const hostOf = (container: string) => container === CENTRAL ? null : container.slice(HOME.length + 1).replace(/\/viz-pages$/, "");

/** One native viz, defaults a plain listed public page in the central library. */
export function viz(name: string, o: Partial<Slug> & { ageMs?: number } = {}): Slug {
  const container = o.container ?? CENTRAL;
  const now = Date.now(), { ageMs = HOUR, ...rest } = o;
  return {
    id: idOf(container, name), name, isCentral: container === CENTRAL, container,
    mirroredIn: false, isMirror: false, isVendored: false, vendorOrigin: null,
    mirrorsOut: [], vendoredOut: [], host: hostOf(container),
    fileCount: 3, hasApi: false, hasTape: false, posture: "public", listed: true,
    approval: "never", title: "", description: "", tags: [], hidden: false, linkedFrom: [],
    uid: "v-" + [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(12, "0").slice(0, 12),
    cardPublic: "unreviewed", cardWas: "", lobby: container === HARBOR, kind: "", template: "",
    mtime: now - ageMs, created: now - ageMs - 30 * DAY, sizeBytes: 20_000, og: null, hero: false,
    ...rest,
  };
}

/** A fresh copy of the default library. */
export function library(): Library {
  const tide = viz("tide-clock", { title: "Tide clock", description: "When the water turns, as a dial.", posture: "public",
    approval: "approved", cardPublic: "public", tags: ["ocean", "time"], og: "og.png", hero: true,
    ageMs: 5 * MIN, sizeBytes: 60_000, fileCount: 5 });
  const garden = viz("garden-planner", { title: "Garden planner", posture: "local", hasApi: true, tags: ["home"],
    ageMs: 3 * HOUR, sizeBytes: 300_000, fileCount: 9 });
  const natives: Slug[] = [
    tide,
    viz("orbit-deck", { title: "Orbit deck", description: "Twelve slides on how orbits decay.", approval: "stale",
      kind: "deck", template: "deck", tags: ["space", "slides"], ageMs: 20 * MIN, sizeBytes: 900_000, fileCount: 14 }),
    viz("river-poster", { title: "River poster", posture: "private", listed: false, cardPublic: "not-public",
      kind: "poster", ageMs: 2 * DAY, sizeBytes: 150_000 }),
    garden,
    viz("loose-sketch", { title: "", posture: "untagged", uid: "", ageMs: 40 * DAY, sizeBytes: 4_000, fileCount: 1 }),
    viz("poster-starter", { title: "Poster starter", kind: "poster", template: "poster", ageMs: 10 * DAY, sizeBytes: 50_000 }),
    viz("big-globe", { title: "Big globe", description: "A spinning globe with every port on it.", tags: ["maps", "3d"],
      ageMs: 6 * HOUR, sizeBytes: 3_500_000, fileCount: 22 }),
    viz("secret-notes", { title: "Secret notes", posture: "local", tags: ["wip"], hidden: true, ageMs: 2 * MIN }),
    viz("atlas-metrics", { container: ATLAS, title: "Atlas weekly metrics", posture: "public", approval: "approved",
      hasApi: true, linkedFrom: ["a team wiki page"], cardPublic: "stale", cardWas: "not-public",
      tags: ["metrics", "ops", "weekly", "team"], ageMs: 1 * DAY, sizeBytes: 120_000, fileCount: 7 }),
    viz("atlas-exchange", { container: ATLAS, title: "Atlas exchange", posture: "private", approval: "approved",
      kind: "exchange", ageMs: 4 * DAY, sizeBytes: 40_000 }),
    viz("atlas-dive", { container: ATLAS, title: "Atlas deep dive", listed: false, approval: "stale",
      kind: "poster-dive", ageMs: 8 * DAY, sizeBytes: 700_000 }),
    viz("harbor-map", { container: HARBOR, title: "Harbor map", posture: "private", tags: ["maps"], ageMs: 12 * HOUR }),
    viz("harbor-timeline", { container: HARBOR, title: "Harbor timeline", approval: "approved", cardPublic: "public",
      ageMs: 3 * DAY, sizeBytes: 90_000 }),
    viz("garden-planner", { container: HARBOR, title: "Garden planner", posture: "local", isVendored: true, mirroredIn: true,
      vendorOrigin: garden.id, mirrorFrom: ".agents/state/viz", ageMs: 5 * DAY }),
  ];
  garden.vendoredOut = ["code/harbor"];
  tide.mirrorsOut = ["code/atlas"];
  const mirrorRow: Slug = { ...tide, id: `${tide.id}↦${ATLAS}`, originId: tide.id, isMirror: true, mirroredIn: true,
    mirrorsOut: [], mirrorFrom: ".agents/state/viz", container: ATLAS, isCentral: false, host: "code/atlas", lobby: false };

  const slugs = [...natives, mirrorRow].sort((a, b) => b.mtime - a.mtime);
  const git = Object.fromEntries(natives.map((s, i) => [s.id, { commitCount: (i * 7) % 23 + 1 }]));

  return {
    slugs,
    git,
    log: [
      { hash: "a1b2c3d", subject: "tide-clock: slow the second hand", when: "5 minutes ago" },
      { hash: "b2c3d4e", subject: "create viz: orbit-deck", when: "2 hours ago" },
      { hash: "c3d4e5f", subject: "secret-notes: draft", when: "3 hours ago" },
      { hash: "d4e5f6a", subject: "update the lobby", when: "2 days ago" },
    ],
    server: { vizVersion: "9.9.9-test", bunVersion: "1.3.11", pid: 4242, uptimeSec: 3725, central: CENTRAL, containers: 3, port: 5180 },
    mirrors: { [tide.id]: [{ to: "../../code/atlas/viz-pages", access: "public", listed: true, overrides: null }] },
    vendors: { [garden.id]: [{ to: "../../code/harbor/viz-pages", access: "local" }] },
    history: Object.fromEntries(natives.map((s) => [s.id, [
      { hash: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4", date: new Date(s.mtime).toISOString(), subject: `${s.name}: latest edit` },
      { hash: "f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5", date: new Date(s.created).toISOString(), subject: `create viz: ${s.name}` },
    ]])),
    // Rank's corpus is derived like rankingView(): natives with a uid, copies left out.
    ranking: {
      items: natives.filter((s) => s.uid && !s.mirroredIn).map((s) => ({
        title: s.title || s.name, url: "viz://" + s.uid, key: "viz://" + s.uid, desc: s.description,
        media: s.og ? [`/${s.id}/${s.og}`] : [], tags: [s.isCentral ? "central" : s.host!.split("/").pop()!, s.posture],
        vizId: s.id, approval: s.approval,
      })),
      current: "best",
      lists: { best: { name: "Best", log: [], benched: [], priority: [] } },
    },
  };
}

/** GET api/ranking, as rankingView() answers it. */
export function rankingView(l: Library) {
  const r = l.ranking, cur = r.lists[r.current]!;
  return {
    items: r.items, current: r.current,
    lists: Object.entries(r.lists).map(([id, x]) => ({ id, name: x.name, answered: x.log.length })),
    log: cur.log, benched: cur.benched, priority: cur.priority, skippedNoUid: 0, updated: null,
  };
}
