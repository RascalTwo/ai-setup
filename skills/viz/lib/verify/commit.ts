// lib/verify/commit.ts — `verify --commit="<msg>"`: commit the viz, but ONLY if the run was clean.
import path from "node:path";
import os from "node:os";
import { CENTRAL } from "../../discovery.ts";

/**
 * Commit the viz at `url` with `commitMsg` and exit with the result.
 *
 * SKILL.md used to admit "There's no hook safety net. If you forget to commit, the
 * changes get bundled into the next commit… Don't forget." Fixing "don't forget"
 * with a flag beats fixing it with a sentence. Deliberately NOT a hook: a hook
 * fires on every save and would bury the git log in noise.
 *
 * Refusing on a dirty run is the point — it makes "verified" and "committed" the
 * same event, so a broken render can't quietly reach the history.
 */
export async function commitViz(
  url: string,
  commitMsg: string,
  errorCount: number,
  layoutFindingCount: number,
): Promise<never> {
  const u = new URL(url);
  const vizDir = path.join(os.homedir(), decodeURIComponent(u.pathname));
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    console.log(`✗ --commit needs a localhost viz target — no viz dir for ${u.hostname}`);
    // oxlint-disable-next-line unicorn/no-process-exit -- the verdict is the exit code (see the comment at the end of verifyViz); this is the CLI entry path
    process.exit(1);
  }
  if (errorCount > 0 || layoutFindingCount > 0) {
    console.log(
      `✗ not committing — ${errorCount} error(s), ${layoutFindingCount} layout finding(s). ` +
        `Fix them and re-run, or commit by hand if they're intentional.`,
    );
    // oxlint-disable-next-line unicorn/no-process-exit -- the verdict is the exit code (see the comment at the end of verifyViz); this is the CLI entry path
    process.exit(1);
  }
  const git = async (a: string[], cwd: string) => {
    const p = Bun.spawn(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(p.stdout).text()).trim();
    return { code: await p.exited, out };
  };
  // Which repo owns this viz? A repo-local viz belongs to its HOST repo (no Session
  // trailer, that project's conventions); a central one to the central library.
  const top = await git(["rev-parse", "--show-toplevel"], vizDir);
  if (top.code !== 0) {
    console.log(`✗ --commit: ${vizDir} isn't inside a git repo`);
    // oxlint-disable-next-line unicorn/no-process-exit -- the verdict is the exit code (see the comment at the end of verifyViz); this is the CLI entry path
    process.exit(1);
  }
  const repo = top.out;
  const central = path.resolve(repo) === path.resolve(CENTRAL);
  const rel = path.relative(repo, vizDir) || ".";
  await git(["add", "--", rel], repo);
  const staged = await git(["diff", "--cached", "--name-only", "--", rel], repo);
  if (!staged.out) {
    console.log(`· nothing to commit in ${rel}`);
    // oxlint-disable-next-line unicorn/no-process-exit -- the verdict is the exit code (see the comment at the end of verifyViz); this is the CLI entry path
    process.exit(0);
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  const body = central && sessionId ? `${commitMsg}\n\nSession: ${sessionId}` : commitMsg;
  const done = await git(["commit", "-q", "-m", body, "--", rel], repo); // only this viz, never other staged work
  console.log(
    done.code === 0
      ? `✓ committed ${staged.out.split("\n").length} file(s) in ${repo}${central ? "" : "  (host repo — no Session trailer)"}`
      : `✗ commit failed in ${repo}`,
  );
  // oxlint-disable-next-line unicorn/no-process-exit -- the verdict is the exit code (see the comment at the end of verifyViz); this is the CLI entry path
  process.exit(done.code === 0 ? 0 : 1);
}
