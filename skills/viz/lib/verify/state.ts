// Everything verify produces or remembers for one viz lives in `<viz>/.verify/`: its report,
// screenshots and test output (generated, git-ignored) and `floor.json` (the coverage floor:
// committed, so it ratchets for everyone). The folder ignores itself, so a viz needs no .gitignore line.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const VERIFY_DIR = ".verify";
const FLOOR = "floor.json";

/** `<viz>/.verify/`, created with its own .gitignore (everything but the floor and itself). */
export function verifyDir(vizDir: string): string {
  const dir = path.join(vizDir, VERIFY_DIR);
  mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, `*\n!.gitignore\n!${FLOOR}\n`);
  return dir;
}

/** The floor's path. A floor still at the old `tests/coverage-floor.json` is moved here first, so no run starts from nothing. */
export function floorFile(vizDir: string): string {
  const fp = path.join(verifyDir(vizDir), FLOOR);
  const old = path.join(vizDir, "tests", "coverage-floor.json");
  if (!existsSync(fp) && existsSync(old)) renameSync(old, fp);
  return fp;
}
