// lib/publish/seal.ts — StatiCrypt sealing and the share links it mints.
//
// Extracted from the since-deleted build.ts, which was 1993 lines.

// ---- StatiCrypt drivers (a pinned dependency; the chosen sealing tool — don't roll our own crypto) ----
// Run from node_modules, not `npx`: a download per seal raced when several seals ran at once
// and left pages unsealed.
// Seal writes the encrypted file; share is a SEPARATE link-only invocation (with
// --share, StatiCrypt prints the link and writes nothing). Same passphrase+salt in
// both, so the #staticrypt_pwd hash in the link matches the sealed file — and that
// hash depends only on passphrase+salt, never the host, so links are host-stable.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { run } from "../proc.ts";
import type { KeyEntry } from "../../keystore.ts";

let stageRoot: string | undefined;
/**
 * A folder for plaintext waiting to be sealed, inside one folder of this process's own. A shared
 * `$TMPDIR/viz-…-stage/<slug>` let two builds at once (two repos with a viz of the same name, or
 * every lobby publish's `.viz-dist`) overwrite each other's plaintext and seal the wrong page.
 * shortcut: removed on a normal exit only; a killed preview leaves it to the OS's temp sweep.
 */
export function sealStage(name: string): string {
  if (!stageRoot) {
    const root = mkdtempSync(path.join(os.tmpdir(), "viz-seal-stage-"));
    process.on("exit", () => rmSync(root, { recursive: true, force: true }));
    stageRoot = root;
  }
  const dir = path.join(stageRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** staticrypt's CLI in the skill's node_modules, resolved on first seal so a missing install names its fix. */
function staticryptCli(): string {
  try {
    return createRequire(import.meta.url).resolve("staticrypt/cli/index.js");
  } catch {
    throw new Error(
      `staticrypt is not installed in the viz skill — run \`npm install\` in ${path.join(import.meta.dirname, "../..")}`,
    );
  }
}

export async function staticrypt(
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; stdout: string }> {
  const r = await run([process.execPath, staticryptCli(), ...args], { cwd });
  const stdout = r.stdout.trim();
  const ok = r.code === 0;
  if (!ok) console.error(`  staticrypt failed: ${r.stderr.trim() || stdout}`);
  return { ok, stdout };
}

export async function seal(
  stageDir: string,
  file: string,
  outDir: string,
  key: KeyEntry,
): Promise<boolean> {
  const { ok } = await staticrypt(
    [file, "-p", key.passphrase, "-s", key.salt, "-d", outDir, "--short", "-c", "false"],
    stageDir,
  );
  return ok;
}

export async function magicLink(
  stageDir: string,
  file: string,
  key: KeyEntry,
  shareBase: string,
): Promise<string> {
  const { ok, stdout } = await staticrypt(
    [file, "-p", key.passphrase, "-s", key.salt, "--short", "-c", "false", "--share", shareBase],
    stageDir,
  );
  const link = stdout.split("\n").find((l) => l.includes("#staticrypt_pwd="));
  return ok && link ? link.trim() : "(failed to produce magic link)";
}
