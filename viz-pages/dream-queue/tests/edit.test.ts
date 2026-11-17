// /edit against a throwaway repo: the reviewer's text lands as a commit on the dream/ branch,
// a stale `before` is refused, and only files the proposal already changes are editable.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const T = mkdtempSync(path.join(tmpdir(), "dream-edit-"));
const repo = path.join(T, "repo");
const state = path.join(T, "state");
const git = (...a: string[]) => {
  const r = Bun.spawnSync(["git", "-C", repo, ...a], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

// Plain `bun test` has no `viz` global (only `viz verify` preloads it): run the steps bare there.
const bare = async <T>(_sentence: string, fn?: () => T | Promise<T>) => fn?.();
if (typeof viz === "undefined")
  // oxlint-disable-next-line unicorn/no-thenable -- the viz global names its steps given/when/then
  Object.assign(globalThis, { viz: { given: bare, when: bare, then: bare } });

type Routes = Record<string, (req: Request) => Promise<Response>>;
type Reply = { ok: boolean; error?: string };
const isReply = (v: unknown): v is Reply =>
  typeof v === "object" && v !== null && "ok" in v && typeof v.ok === "boolean";

let routes: Routes = {};
const edit = async (b: object): Promise<Reply> => {
  const route = routes["/edit"];
  if (!route) throw new Error("no /edit route");
  const j: unknown = await (
    await route(new Request("http://x/edit", { method: "POST", body: JSON.stringify(b) }))
  ).json();
  if (!isReply(j)) throw new Error("/edit did not answer with an envelope");
  return j;
};

beforeAll(async () => {
  mkdirSync(path.join(repo, "skills/dream/scripts"), { recursive: true });
  copyFileSync(
    path.join(import.meta.dir, "../../../skills/dream/scripts/propose-branch.sh"),
    path.join(repo, "skills/dream/scripts/propose-branch.sh"),
  );
  writeFileSync(path.join(repo, "AGENTS.md"), "one\ntwo\nthree\n");
  writeFileSync(path.join(repo, "other.md"), "x\n");
  git("init", "-q", "-b", "private/trunk");
  git("-c", "core.hooksPath=/dev/null", "add", ".");
  git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "base");
  git("checkout", "-qb", "dream/p-1-demo");
  writeFileSync(path.join(repo, "AGENTS.md"), "one\ntwo\nproposed line\nthree\n");
  git("-c", "core.hooksPath=/dev/null", "commit", "-qam", "dream(p-1): demo");
  git("checkout", "-q", "private/trunk");
  mkdirSync(path.join(state, "proposals"), { recursive: true });
  writeFileSync(
    path.join(state, "proposals/p-1.json"),
    JSON.stringify({ id: "p-1", title: "demo", branch: "dream/p-1-demo", status: "pending" }),
  );
  writeFileSync(path.join(state, "proposals/p-1.change.md"), "Add a line.\n");
  writeFileSync(
    path.join(state, "proposals/m-1.json"),
    JSON.stringify({
      id: "m-1",
      title: "fix a note",
      status: "pending",
      memory_edits: [{ path: "a.md", before_sha: "x", after: "m-1.memory/0.md" }],
    }),
  );
  writeFileSync(
    path.join(state, "proposals/m-1.change.md"),
    "### basic-memory://a.md\n-old\n+new\n",
  );
  Object.assign(process.env, {
    DREAM_REPO: repo,
    DREAM_STATE: state,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  });
  git("config", "core.hooksPath", "/dev/null");
  const api: Routes = (await import("../api.ts")).default;
  routes = api;
});
afterAll(() => rmSync(T, { recursive: true, force: true }));

test("an edit is committed on the proposal's branch, trunk untouched", async () => {
  await viz.given("a proposal whose branch adds a line to AGENTS.md", () => {
    expect(git("show", "dream/p-1-demo:AGENTS.md")).toContain("proposed line");
  });

  const r = await viz.when("the reviewer rewrites that line and saves", async () =>
    edit({
      id: "p-1",
      file: "AGENTS.md",
      start: 1,
      before: "one\ntwo\nproposed line\nthree",
      after: "one\ntwo\nmy wording\nthree",
    }),
  );

  await viz.then("the branch carries their wording", () => {
    expect(r.ok).toBe(true);
    expect(git("show", "dream/p-1-demo:AGENTS.md")).toBe("one\ntwo\nmy wording\nthree");
  });
  await viz.then("trunk and the worktree list are untouched", () => {
    expect(git("show", "private/trunk:AGENTS.md")).toBe("one\ntwo\nthree");
    expect(git("worktree", "list").split("\n")).toHaveLength(1);
  });
});

test("a stale before is refused and the branch does not move", async () => {
  const head = await viz.given("a branch whose line has since changed", () =>
    git("rev-parse", "dream/p-1-demo"),
  );

  const r = await viz.when("an edit is saved against the old text", async () =>
    edit({
      id: "p-1",
      file: "AGENTS.md",
      start: 1,
      before: "one\ntwo\nproposed line\nthree",
      after: "nope",
    }),
  );

  await viz.then("it is refused as changed-since", () => {
    expect(r.ok).toBe(false);
    expect(r.error).toContain("changed since");
  });
  await viz.then("the branch has not moved", () => {
    expect(git("rev-parse", "dream/p-1-demo")).toBe(head);
  });
});

test("files the proposal does not change cannot be edited", async () => {
  await viz.given("a file the proposal's branch leaves alone", () => {
    expect(git("diff", "--name-only", "private/trunk...dream/p-1-demo")).not.toContain("other.md");
  });

  const r = await viz.when("the reviewer tries to edit it", async () =>
    edit({ id: "p-1", file: "other.md", start: 1, before: "x", after: "y" }),
  );

  await viz.then("it is refused as not part of the proposal", () => {
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not part of this proposal");
  });
});

test("a basic-memory proposal shows its plan file, with no branch needed", async () => {
  const call = async (route: string, url: string): Promise<unknown> => {
    const fn = routes[route];
    if (!fn) throw new Error("no " + route + " route");
    return (await fn(new Request(url))).json();
  };
  await viz.given("a memory-pass proposal: memory_edits and a plan file, no branch", () => {
    expect(git("branch", "--list", "dream/m-1*")).toBe("");
  });

  const [diff, stat] = await viz.when("the reviewer expands it and the list sizes it", async () => [
    await call("/diff", "http://x/diff?id=m-1"),
    await call("/diffstat", "http://x/diffstat"),
  ]);

  await viz.then("the diff is the plan file, and the size says so", () => {
    expect(diff).toMatchObject({ ok: true, from_plan: true });
    expect(JSON.stringify(diff)).toContain("basic-memory://a.md");
    expect(stat).toMatchObject({ ok: true, stats: { "m-1": { plan: true } } });
  });
});
