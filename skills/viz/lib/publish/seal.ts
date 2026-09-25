// lib/publish/seal.ts — StatiCrypt sealing and the share links it mints.
//
// Extracted from build.ts, which was 1993 lines.

// ---- StatiCrypt drivers (run via bunx; the chosen sealing tool — don't roll our own crypto) ----
// Seal writes the encrypted file; share is a SEPARATE link-only invocation (with
// --share, StatiCrypt prints the link and writes nothing). Same passphrase+salt in
// both, so the #staticrypt_pwd hash in the link matches the sealed file — and that
// hash depends only on passphrase+salt, never the host, so links are host-stable.
import { KeyEntry } from "../../keystore.ts";

export async function staticrypt(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  // `bun x`, not `bunx`: identical command, but re-entering our own binary means no PATH
  // lookup — under launchd the server's PATH has no ~/.bun/bin, so a bare `bunx` was ENOENT.
  const proc = Bun.spawn([process.execPath, "x", "staticrypt", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = (await new Response(proc.stdout).text()).trim();
  const ok = (await proc.exited) === 0;
  if (!ok) {
    const err = (await new Response(proc.stderr).text()).trim();
    console.error(`  staticrypt failed: ${err || stdout}`);
  }
  return { ok, stdout };
}

export async function seal(stageDir: string, file: string, outDir: string, key: KeyEntry): Promise<boolean> {
  const { ok } = await staticrypt(
    [file, "-p", key.passphrase, "-s", key.salt, "-d", outDir, "--short", "-c", "false"],
    stageDir,
  );
  return ok;
}

export async function magicLink(stageDir: string, file: string, key: KeyEntry, shareBase: string): Promise<string> {
  const { ok, stdout } = await staticrypt(
    [file, "-p", key.passphrase, "-s", key.salt, "--short", "-c", "false", "--share", shareBase],
    stageDir,
  );
  const link = stdout.split("\n").find((l) => l.includes("#staticrypt_pwd="));
  return ok && link ? link.trim() : "(failed to produce magic link)";
}
