// keystore.ts — the per-viz secrets for PRIVATE (encrypted) publishing.
//
// One central, gitignored file: CENTRAL/.keystore.json (beside .discovered.json,
// in the home library — outside any project repo, so it can never ride along in a
// public-facing commit). It maps a viz's id -> { passphrase, salt, version }:
//
//   - passphrase  the StatiCrypt password the artifact is sealed with. It also
//                 rides in the magic link's #fragment (--share), so possession of
//                 the link = access.
//   - salt        StatiCrypt's --salt (32 hex chars). Fixed per (viz,version) so
//                 re-exporting at the same version yields the SAME ciphertext key
//                 and existing magic links keep working across redeploys.
//   - version     bump it (rotate) to mint a fresh passphrase+salt — the old magic
//                 link dies, a new one is minted.
//
// This file is the SOLE source of truth for private links. By design there is no
// committed marker, no recovery layer: lose this file and you regenerate (rotate)
// and redistribute new links. Simple and explicit — the user chose this tradeoff.

import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { CENTRAL } from "./discovery.ts";

export const KEYSTORE_PATH = path.join(CENTRAL, ".keystore.json");
const GITIGNORE_PATH = path.join(CENTRAL, ".gitignore");

export type KeyEntry = { passphrase: string; salt: string; version: number };
type Keystore = { version: number; vizzes: Record<string, KeyEntry> };

// A URL-safe passphrase (rides in the magic-link #fragment) with ~144 bits of
// entropy, and StatiCrypt's 32-hex-char salt.
function mintSecrets(): { passphrase: string; salt: string } {
  return {
    passphrase: randomBytes(18).toString("base64url"),
    salt: randomBytes(16).toString("hex"),
  };
}

function readStore(): Keystore {
  if (existsSync(KEYSTORE_PATH)) {
    try {
      const s = JSON.parse(readFileSync(KEYSTORE_PATH, "utf8")) as Keystore;
      if (s && typeof s === "object" && s.vizzes) return s;
    } catch {
      // fall through to a fresh store on a corrupt file
    }
  }
  return { version: 1, vizzes: {} };
}

// Belt-and-suspenders: ensure the central repo ignores the keystore (and the
// other machine-local dotfiles). The central repo only ever `git add`s named
// slugs, so this is defense-in-depth against an accidental `git add .`.
async function ensureGitignored(): Promise<void> {
  const needed = [".keystore.json", ".discovered.json", ".server.pid", ".server.log"];
  let body = "";
  try {
    body = readFileSync(GITIGNORE_PATH, "utf8");
  } catch {
    // no .gitignore yet
  }
  const have = new Set(body.split("\n").map((l) => l.trim()));
  const missing = needed.filter((n) => !have.has(n));
  if (missing.length === 0 && body) return;
  const next = (body && !body.endsWith("\n") ? body + "\n" : body) + missing.join("\n") + "\n";
  await Bun.write(GITIGNORE_PATH, next);
}

async function writeStore(store: Keystore): Promise<void> {
  await ensureGitignored();
  await Bun.write(KEYSTORE_PATH, JSON.stringify(store, null, 2) + "\n");
}

// Return the viz's secrets, minting (and persisting) a fresh entry at version 1 if
// none exists yet. This is the "auto-create on first publish" path — the only
// bookkeeping the keystore needs, since there is no separate manifest.
export async function getOrCreate(id: string): Promise<KeyEntry> {
  const store = readStore();
  const existing = store.vizzes[id];
  if (existing) return existing;
  const entry: KeyEntry = { ...mintSecrets(), version: 1 };
  store.vizzes[id] = entry;
  await writeStore(store);
  return entry;
}

// Bump the viz's version and regenerate its secrets → next publish mints a fresh
// magic link and kills the old one. Returns the new entry.
export async function rotate(id: string): Promise<KeyEntry> {
  const store = readStore();
  const prev = store.vizzes[id];
  const entry: KeyEntry = { ...mintSecrets(), version: (prev?.version ?? 0) + 1 };
  store.vizzes[id] = entry;
  await writeStore(store);
  return entry;
}

// Peek without creating (e.g. to report what's published). Null if absent.
export function peek(id: string): KeyEntry | null {
  return readStore().vizzes[id] ?? null;
}
