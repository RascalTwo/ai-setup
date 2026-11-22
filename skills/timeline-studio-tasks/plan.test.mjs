// plan.mjs against a fake Timeline Studio: live reads cached privately, the cache served with its age when the service
// is down, queued changes laid on (replayed through the plan's own commands.js, or as statuses when that can't
// load), the outbox sent first once it's back, and a clear failure with nothing cached.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const tmp = mkdtempSync(path.join(tmpdir(), "plan-test-"));
const [config, outbox, cache] = ["config.json", "outbox", "cache"].map((f) => path.join(tmp, f));
const posted = [];
const ROWS = [
  { id: "a", label: "A", status: "todo", ready: true },
  { id: "b", label: "B", status: "todo", ready: true },
];
const DOC = { tasks: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
// The plan's own command code, as the service serves it: a stand-in with the real one's contract (it changes the
// document in place and returns nothing), whose finishTask marks a task done.
const COMMANDS = `import { MARK } from "./pairwise.js";
export function applyCommand(doc, cmd) {
  for (const t of doc.tasks) if (t.id === cmd.id && cmd.type === "finishTask") t.done = MARK;
}`;

const server = createServer((req, res) => {
  const send = (body, type = "application/json") => {
    res.writeHead(200, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (req.method === "POST") {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      posted.push(JSON.parse(data));
      send({ ok: true });
    });
  } else if (req.url === "/api/ready") send(ROWS);
  else if (req.url === "/api/ready?all=1") send(ROWS);
  else if (req.url === "/api/plan") send({ seq: 1, doc: DOC });
  else if (req.url === "/commands.js") send(COMMANDS, "text/javascript");
  else if (req.url === "/pairwise.js") send("export const MARK = true;", "text/javascript");
  else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const UP = `http://127.0.0.1:${server.address().port}`;
const use = (base) => writeFileSync(config, JSON.stringify({ base, token: "t0ken" }));
const env = { ...process.env, TIMELINE_STUDIO_CONFIG: config, TIMELINE_STUDIO_OUTBOX: outbox, TIMELINE_STUDIO_CACHE: cache };
// Async, not spawnSync: the child talks to the fake server, which answers on this process's event loop.
const read = (...args) =>
  new Promise((done) => {
    const p = spawn(process.execPath, [path.join(HERE, "plan.mjs"), ...args], { env });
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.on("exit", (code) => done({ code, json: out ? JSON.parse(out) : null }));
  });
const queue = (name, cmds) => {
  mkdirSync(outbox, { recursive: true });
  writeFileSync(path.join(outbox, `${name}.json`), JSON.stringify({ cmds }));
};
let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed++;
};

// GIVEN the service up: reads are live, and each one is kept privately for later
use(UP);
let r = await read("ready");
check("a live read says so", r.code === 0 && r.json.source === "live" && r.json.data.length === 2);
check("the copy is private (0600)", (statSync(path.join(cache, "ready.json")).mode & 0o777) === 0o600);
await read("all");
await read("plan");
check("the plan's own code is kept too", readdirSync(cache).includes("commands.js") && readdirSync(cache).includes("pairwise.js"));

// WHEN the service goes away
use("http://127.0.0.1:9");
r = await read("ready");
check("the copy answers, with its age", r.code === 2 && r.json.source === "cache" && typeof r.json.asOf === "string");
check("…unchanged with nothing queued", r.json.data.length === 2 && r.json.applied === "none");

// AND a change is queued while it's down (task a finished)
queue("1", [{ type: "finishTask", id: "a", at: "2026-10-28T14:00:00Z" }]);
r = await read("ready");
check("ready no longer lists the finished task", r.json.data.map((t) => t.id).join() === "b");
r = await read("all");
const a = r.json.data.find((t) => t.id === "a");
check("all shows it done, marked pending", a.status === "done" && a.pending.join() === "finishTask" && r.json.pending.length === 1);
r = await read("task", "a");
check("the plan replays it through the plan's own code", r.json.applied === "replayed" && r.json.data.done === true);

// AND the cached code can't load: the statuses still show
writeFileSync(path.join(cache, "commands.js"), "this is not javascript (");
r = await read("task", "a");
check("falls back to statuses when the code can't load", r.json.applied === "statuses" && r.json.data.status === "done");

// WHEN it's back, the next read sends the queue first
use(UP);
r = await read("ready");
check("back: live again", r.json.source === "live");
check("…and the queued change was sent first", posted.length === 1 && posted[0].cmds[0].type === "finishTask");
check("…leaving nothing pending", r.json.pending.length === 0);

// AND with nothing cached and nothing answering, it says so
use("http://127.0.0.1:9");
const empty = { ...env, TIMELINE_STUDIO_CACHE: path.join(tmp, "empty-cache") };
const none = spawnSync(process.execPath, [path.join(HERE, "plan.mjs"), "ready"], { env: empty, encoding: "utf8" });
check("nothing cached and down: exit 1, saying why", none.status === 1 && /unreachable.*nothing is cached/u.test(none.stderr));

server.close();
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
