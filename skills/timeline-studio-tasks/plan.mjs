#!/usr/bin/env node
// Reads the plan: live when Timeline Studio answers, otherwise from the last copy read, with its age, and with the
// outbox's queued changes laid on top (they are work already done that the service hasn't heard of yet).
//   node plan.mjs ready       what could start now (GET /api/ready)
//   node plan.mjs all         every task with its status (GET /api/ready?all=1)
//   node plan.mjs plan        the whole plan document (GET /api/plan)
//   node plan.mjs task <id>   one task, from the document
// Prints JSON { source: "live" | "cache", asOf, pending, applied, data }: `pending` lists the queued batches (with
// what they change); `applied` says how they were laid on: "replayed" (through the plan's own commands.js, cached
// from the service), "statuses" (only the touched tasks' statuses) or "none". Exit 0 live, 2 from the cache, 1 when
// there is neither.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOME = homedir();
// The overrides are for plan.test.mjs.
const CONFIG = process.env.TIMELINE_STUDIO_CONFIG ?? path.join(HOME, ".config/timeline-studio/config.json");
const STATE = path.join(HOME, ".agents/state/timeline-studio-tasks");
const OUTBOX = process.env.TIMELINE_STUDIO_OUTBOX ?? path.join(STATE, "outbox");
const CACHE = process.env.TIMELINE_STUDIO_CACHE ?? path.join(STATE, "cache");
const HERE = path.dirname(new URL(import.meta.url).pathname);

const VIEWS = { ready: "/api/ready", all: "/api/ready?all=1", plan: "/api/plan", task: "/api/plan" };
const [view, taskId] = process.argv.slice(2);
if (!(view in VIEWS) || (view === "task" && !taskId)) {
  console.error("usage: node plan.mjs ready | all | plan | task <id>");
  process.exit(64);
}
const file = (name) => path.join(CACHE, name);
const cacheName = (route) => ({ "/api/ready": "ready.json", "/api/ready?all=1": "all.json", "/api/plan": "plan.json" })[route];

/** Write privately and whole: a reader never sees half a file, and nobody else on the machine sees it at all. */
function save(name, text) {
  mkdirSync(CACHE, { recursive: true, mode: 0o700 });
  const tmp = `${file(name)}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file(name));
}

async function get(route) {
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const base = config.base ?? "https://timeline-studio.rascaltwo.com";
  const headers = route.endsWith(".js") ? {} : { "x-timeline-token": config.token };
  const res = await fetch(`${base}${route}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${route}: ${res.status}`);
  return res.text();
}

const queued = () =>
  existsSync(OUTBOX)
    ? readdirSync(OUTBOX)
        .filter((f) => f.endsWith(".json") && !f.endsWith(".rejected.json"))
        .toSorted()
        .map((f) => ({ file: f, cmds: JSON.parse(readFileSync(path.join(OUTBOX, f), "utf8")).cmds }))
    : [];

/** What a queued command does to a task's status, for when the plan's own code can't replay it. */
const STATUS = { startTask: "running", finishTask: "done", stopTask: "paused", reopenTask: "todo", addTask: "todo" };
function overlayStatuses(rows, batches) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  for (const { cmds } of batches)
    for (const cmd of cmds) {
      const id = cmd.id ?? cmd.task?.id;
      if (!id || !(cmd.type in STATUS)) continue;
      const row = byId.get(id) ?? { id, label: cmd.task?.label };
      byId.set(id, { ...row, status: STATUS[cmd.type], pending: [...(row.pending ?? []), cmd.type] });
    }
  return [...byId.values()];
}

/** The cached document with the queued batches applied by the plan's own applyCommand, or null if it can't. */
async function replay(doc, batches) {
  try {
    const { applyCommand } = await import(pathToFileURL(file("commands.js")).href);
    let next = structuredClone(doc);
    for (const { cmds } of batches) for (const cmd of cmds) next = applyCommand(next, cmd) ?? next;
    return next;
  } catch {
    return null;
  }
}

async function live() {
  // Something queued and the service back: send it first, so this answer includes it.
  if (queued().length > 0)
    spawnSync("python3", ["-I", path.join(HERE, "outbox.py"), "flush"], { stdio: ["ignore", "ignore", "inherit"] });
  const text = await get(VIEWS[view]);
  save(cacheName(VIEWS[view]), JSON.stringify({ asOf: new Date().toISOString(), body: JSON.parse(text) }));
  // The plan's own code, kept for replaying queued changes while the service is down. Best effort: a host that
  // doesn't serve one of them still answers reads; offline it falls back to the status overlay.
  if (view === "plan" || view === "task")
    for (const js of ["commands.js", "pairwise.js"]) {
      try {
        save(js, await get(`/${js}`));
      } catch {
        // Kept from an earlier read, if there was one.
      }
    }
  return { source: "live", asOf: new Date().toISOString(), pending: queued(), applied: "none", body: JSON.parse(text) };
}

async function cached() {
  const name = cacheName(VIEWS[view]);
  if (!existsSync(file(name))) return null;
  const { asOf, body } = JSON.parse(readFileSync(file(name), "utf8"));
  const batches = queued();
  if (batches.length === 0) return { source: "cache", asOf, pending: [], applied: "none", body };
  if (view === "plan" || view === "task") {
    const doc = await replay(body.doc, batches);
    if (doc) return { source: "cache", asOf, pending: batches, applied: "replayed", body: { ...body, doc } };
    const tasks = overlayStatuses(body.doc.tasks, batches);
    return { source: "cache", asOf, pending: batches, applied: "statuses", body: { ...body, doc: { ...body.doc, tasks } } };
  }
  const rows = overlayStatuses(body.tasks ?? body, batches);
  // `ready` lists only not-started tasks: one a queued command started or finished has left it.
  const shown = view === "ready" ? rows.filter((r) => !r.status || r.status === "todo") : rows;
  return { source: "cache", asOf, pending: batches, applied: "statuses", body: Array.isArray(body) ? shown : { ...body, tasks: shown } };
}

const pick = (result) => {
  if (view !== "task") return result.body;
  return result.body.doc.tasks.find((t) => t.id === taskId) ?? null;
};

let result;
try {
  result = await live();
} catch (error) {
  result = await cached();
  if (!result) {
    console.error(`Timeline Studio is unreachable (${error.message}) and nothing is cached for "${view}" yet`);
    process.exit(1);
  }
}
const { body: _, ...meta } = result;
console.log(JSON.stringify({ ...meta, data: pick(result) }, null, 2));
process.exit(result.source === "live" ? 0 : 2);
