// The shapes of this viz's own api/ routes, and the page-wide window typings. Types only.

declare global {
  interface Window {
    showTab(name: string, stop?: string | null): void;
    /** location.hash as the page was opened, before anything rewrote it. */
    __initialHash: string;
    /** Stamped by viz publish on a static copy. */
    __VIZ_STATIC__?: boolean;
  }
  interface WindowEventMap {
    "guide:shown": CustomEvent<{ stop: string | null | undefined }>;
  }
}

// The shapes of this viz's own api/ routes (api.ts). Every field api/slugs always sends is
// required here, so the page doesn't guard against its absence.
type CardState = "public" | "not-public" | "unreviewed" | "stale";
export interface Slug {
  id: string;
  name: string;
  isCentral: boolean;
  container: string;
  mirroredIn: boolean;
  isMirror: boolean;
  isVendored: boolean;
  mirrorFrom?: string;
  mirrorsOut: string[];
  vendoredOut: string[];
  originId?: string;
  host: string | null;
  fileCount: number;
  hasApi: boolean;
  posture: "public" | "private" | "local" | "untagged";
  listed: boolean;
  approval: "approved" | "stale" | "never";
  title: string;
  description: string;
  tags: string[];
  hidden: boolean;
  linkedFrom: string[];
  uid: string;
  cardPublic: CardState;
  cardWas: string;
  lobby: boolean;
  kind: string;
  template: string;
  mtime: number;
  created: number;
  sizeBytes: number;
  og: string | null;
  hero: boolean;
  hasSpec: boolean;
}
export interface ServerInfo {
  bunVersion: string;
  pid: number;
  uptimeSec: number;
  port: number;
  containers: number;
  vizVersion?: string;
}
export interface Commit {
  hash: string;
  subject: string;
  when: string;
}
export interface Lobby {
  passphrase: string;
  hash: string;
  shims: string[];
}
export interface RenderJob {
  id: string;
  state: string;
  frame: number;
  frames: number;
  warnings?: string[];
  out?: string;
  error?: string;
  log?: string;
}
export interface Mirror {
  to: string;
  access: string;
  listed: boolean;
  overrides?: { title?: string; description?: string; tags?: string[] };
}
/** What every POST to api/ answers (see mgmt()). `out` is the CLI's stdout. */
export type Mgmt = {
  url?: string;
  lobby?: Lobby | null;
  shares?: string[];
  job?: RenderJob;
  id?: string;
} & ({ ok: true; out: string; err?: string } | { ok: false; err: string; out?: string });
