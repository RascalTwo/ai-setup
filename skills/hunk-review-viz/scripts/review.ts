#!/usr/bin/env bun
// review.ts — the agent's side of hunk-review-viz.
//
//   bun review.ts open <name> --repo <path> --range <base>...<head> [--repo … --range …] [--label <repo-name>]
//       make (or re-point) the review page; prints its URL
//   bun review.ts refresh <name>        re-read git; the open page reloads where it was
//   bun review.ts status <name> [--json] [--all]
//       what the reviewer flagged, asked or approved, by spoken ID (--all: every hunk)
//   bun review.ts reply <name> <id> [--line <n>] <text>   answer a flag or question on its hunk; --line pins it under
//                                       that line of the new file (else it sits under the lines changed since the mark)
//   bun review.ts ids <name>            every commit, file and hunk with its ID, for writing order.json
//   bun review.ts dir <name>            the page's folder (order.json goes there)
//
// Reviews are listed in ~/.agents/state/hunk-review-viz/reviews.json, name → page folder and URL.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ReviewConfig, ReviewView } from "../template/contract.ts";
import { buildReview, findById, readState, setReply } from "../lib/review.ts";
import { normalizeId } from "../lib/words.ts";

const SKILL = resolve(import.meta.dir, "..");
const HOME = process.env.HOME ?? "";
const INDEX_DIR = join(HOME, ".agents", "state", "hunk-review-viz");
const INDEX = join(INDEX_DIR, "reviews.json");
const VIZ = join(process.env.VIZ_SKILL_DIR ?? join(HOME, ".claude", "skills", "viz"), "viz.ts");

type Index = Record<string, { dir: string; url: string }>;
const readIndex = (): Index => (existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, "utf8")) as Index) : {});
const saveIndex = (i: Index) => {
  mkdirSync(INDEX_DIR, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(i, null, 2));
};
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
const lookup = (name: string) => readIndex()[name] ?? die(`no review named "${name}" (bun review.ts open ${name} …)`);

function open(name: string, args: string[]) {
  const repos: ReviewConfig["repos"] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo") repos.push({ name: "", path: resolve(args[++i] ?? die("--repo needs a path")), range: "" });
    else if (args[i] === "--range") (repos.at(-1) ?? die("--range comes after its --repo")).range = args[++i] ?? die("--range needs a range");
    else if (args[i] === "--label") (repos.at(-1) ?? die("--label comes after its --repo")).name = args[++i] ?? die("--label needs a name");
    else die(`unknown argument ${args[i]}`);
  }
  if (!repos.length) die("give at least one --repo <path> --range <base>...<head>");
  for (const r of repos) {
    if (!r.range) die(`--repo ${r.path} has no --range`);
    r.name ||= basename(r.path);
  }
  const index = readIndex();
  let entry = index[name];
  if (!entry) {
    const p = Bun.spawnSync(["bun", VIZ, "create", `hunk-review-${slug(name)}`, "--from", join(SKILL, "template"), "--json"], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) die(`viz create failed: ${p.stderr.toString()}${p.stdout.toString()}`);
    const made = JSON.parse(p.stdout.toString()) as { dir: string; url: string };
    entry = { dir: made.dir, url: made.url };
    index[name] = entry;
    saveIndex(index);
  }
  const cfg: ReviewConfig = { name, skillDir: SKILL, repos };
  writeFileSync(join(entry.dir, "review.json"), JSON.stringify(cfg, null, 2));
  refresh(name);
  console.log(entry.url);
}

function refresh(name: string) {
  const { dir } = lookup(name);
  // Any file written beside the page reloads it; the page keeps its place in the URL hash.
  writeFileSync(join(dir, "refreshed.txt"), `${new Date().toISOString()}\n`);
}

function resolveId(name: string, view: ReviewView, spoken: string): { fp: string; label: string } {
  const id = normalizeId(spoken);
  const hit = findById(view, id);
  if (hit) {
    const t = hit.hunk ?? hit.file;
    // Answering an addressed hunk answers the mark it carries.
    return { fp: t.was?.fp ?? t.fp, label: `${id} (${hit.file.path})` };
  }
  // A flagged hunk the agent has since changed is gone from the review; its mark still knows its ID.
  const state = readState(lookup(name).dir);
  const old = Object.entries(state.marks).find(([, m]) => m.id === id);
  if (old) return { fp: old[0], label: `${id} (${old[1].path}, since changed)` };
  return die(`no hunk or file with ID "${id}" in ${name}`);
}

function status(name: string, json: boolean, all: boolean) {
  const view = buildReview(lookup(name).dir);
  const rows: { id: string; status: string; repo: string; path: string; commit: string; note?: string; reply?: string }[] = [];
  let total = 0;
  let done = 0;
  for (const c of view.commits)
    for (const f of c.files) {
      const push = (id: string, s: string, note?: string, reply?: string) => {
        const r: (typeof rows)[number] = { id, status: s, repo: f.repo, path: f.path, commit: c.subject };
        if (note) r.note = note;
        if (reply) r.reply = reply;
        rows.push(r);
      };
      if (f.status !== "unreviewed" && f.status !== "ok") push(f.id, f.status, f.note, f.reply);
      for (const h of f.hunks) {
        total++;
        if (h.status === "ok") done++;
        if (all || (h.status !== "unreviewed" && h.status !== "ok")) push(h.id, h.status, h.note, h.reply);
      }
    }
  if (json) {
    console.log(JSON.stringify({ name, approved: done, hunks: total, items: rows, orphans: view.orphans, repos: view.repos }, null, 2));
    return;
  }
  for (const r of view.repos) if (r.error) console.log(`! ${r.name}: ${r.error}`);
  console.log(`${name}: ${done} / ${total} hunks approved`);
  const ICON: Record<string, string> = { change: "✎", question: "?", answered: "?✓", addressed: "↻", changed: "●", ok: "✓", unreviewed: "·" };
  for (const r of rows)
    console.log(
      `${ICON[r.status] ?? r.status} ${r.id.padEnd(24)} ${r.status.padEnd(10)} ${r.path}  [${r.commit}]${r.note ? `\n    note: ${r.note}` : ""}${r.reply ? `\n    reply: ${r.reply}` : ""}`,
    );
  for (const o of view.orphans) console.log(`✗ ${o.id.padEnd(24)} ${o.mark.padEnd(10)} ${o.path}  (content gone, nothing to carry it to)${o.note ? `\n    note: ${o.note}` : ""}`);
}

function ids(name: string) {
  const view = buildReview(lookup(name).dir);
  for (const c of view.commits) {
    console.log(`${c.repo} ${c.sha.slice(0, 8)} ${c.subject}`);
    for (const f of c.files) {
      console.log(`  ${f.id.padEnd(24)} ${f.kind.padEnd(6)} ${f.path}`);
      for (const h of f.hunks) console.log(`    ${h.id.padEnd(22)} ${h.header.slice(0, 60)}`);
    }
  }
}

const [cmd, name, ...rest] = process.argv.slice(2);
if (!cmd || !name) die("usage: review.ts open|refresh|status|reply|ids|dir <name> … (see the header)");
else if (cmd === "open") open(name, rest);
else if (cmd === "refresh") refresh(name);
else if (cmd === "status") status(name, rest.includes("--json"), rest.includes("--all"));
else if (cmd === "ids") ids(name);
else if (cmd === "dir") console.log(lookup(name).dir);
else if (cmd === "reply") {
  const li = rest.indexOf("--line");
  const line = li >= 0 ? Number(rest[li + 1]) : undefined;
  if (li >= 0 && !Number.isInteger(line)) die("--line needs a line number (the new file's)");
  const [id, ...text] = li >= 0 ? rest.filter((_, i) => i !== li && i !== li + 1) : rest;
  if (!id || !text.length) die("usage: review.ts reply <name> <id> [--line <n>] <text>");
  const view = buildReview(lookup(name).dir);
  const t = resolveId(name, view, id);
  setReply(lookup(name).dir, t.fp, text.join(" "), line);
  refresh(name);
  console.log(`replied on ${t.label}`);
} else die(`unknown command ${cmd}`);
