#!/usr/bin/env bun
// A throwaway Kelpie run for a fixture walkthrough, so its Send goes through the real `kelpie page`
// without touching the real plan or the real queue: a "Walkthrough fixtures" plan on the sandbox's
// Timeline Studio, its own Kelpie config and state, and the fixture's task "started" in <pane>
// (the build agent that made the walkthrough). A `herdr` first on its PATH runs the real one under
// the real HOME (herdr finds its socket there), so the relay reaches the real pane.
// Prints the walk.json `relay` block. Usage: kelpie-run.ts <sandbox> <fixture spec.json> <pane>
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [sandbox, specFile, pane] = process.argv.slice(2);
if (!sandbox || !specFile || !pane) throw new Error("usage: kelpie-run.ts <sandbox> <spec.json> <pane>");
const base = process.env["SYNC"] ?? "http://localhost:8092";
const R = path.resolve(sandbox, "relay");
const home = path.join(R, "home"), config = path.join(R, "kelpie-config"), state = path.join(R, "kelpie-state");
const tsConfig = path.join(home, ".config/timeline-studio/config.json");

async function call(p: string, body: object | null, token?: string, by = "Joseph") {
  const r = await fetch(base + p, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-timeline-by": by, ...(token && { "x-timeline-token": token }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
}
const cmd = (token: string, c: object, by?: string) =>
  call("/api/commands", { cmd: { ...c, at: new Date().toISOString() } }, token, by);

// One plan for every fixture, made once, set up the way Kelpie's one-time plan setup leaves it.
let token: string;
if (existsSync(tsConfig)) token = JSON.parse(readFileSync(tsConfig, "utf8")).token;
else {
  token = (await call("/api/plan/new", { title: "Walkthrough fixtures (throwaway)" })).shareToken;
  await cmd(token, {
    type: "patchDoc",
    patch: {
      colors: [{ id: "fixtures", label: "Fixtures", color: "#5aa9f0" }],
      borders: [
        { id: "b-none", label: "—", style: "solid" }, { id: "b-needs", label: "Needs review", style: "dotted" },
        { id: "b-changes", label: "Changes requested", style: "dashed" }, { id: "b-approved", label: "Approved", style: "solid" },
      ],
      shapes: [{ id: "s1", label: "—", shape: "soft" }, { id: "agent", label: "Agent", shape: "soft" }],
    },
  });
  mkdirSync(path.dirname(tsConfig), { recursive: true });
  writeFileSync(tsConfig, JSON.stringify({ base, token }), { mode: 0o600 });
}
const bin = path.join(R, "bin");
mkdirSync(bin, { recursive: true });
const realHerdr = Bun.which("herdr");
if (!realHerdr) throw new Error("no herdr on PATH");
writeFileSync(path.join(bin, "herdr"), `#!/bin/sh\nHOME='${process.env["HOME"]}' exec '${realHerdr}' "$@"\n`);
chmodSync(path.join(bin, "herdr"), 0o755);
mkdirSync(path.join(config, "projects"), { recursive: true });
writeFileSync(path.join(config, "config.json"), "{}\n");
writeFileSync(path.join(config, "projects/fixtures.md"), "---\ncolor: fixtures\nspace: Walkthrough fixtures\n---\nThrowaway runs for walkthrough-viz's fixtures.\n");

// The task, mid-build in <pane>: Kelpie's own comment is what tells `kelpie page` where to type.
const spec = JSON.parse(readFileSync(specFile, "utf8"));
const id: string = spec.task.id;
const folder = path.join(state, "runs", "fixtures", id);
const plan = await call("/api/plan", null, token);
if (!plan.doc.tasks.some((t: { id: string }) => t.id === id)) {
  await cmd(token, { type: "addTask", task: { id, label: spec.task.title, dur: 60, color: ["fixtures"], shape: "agent" } });
  await cmd(token, { type: "setRefined", id, refinedAt: spec.signedOffAt });
  await cmd(token, { type: "startTask", id });
}
await cmd(token, { type: "addComment", id, comment: { text: `[dispatch] started pane=${pane} folder=${folder}` } }, "kelpie");
mkdirSync(folder, { recursive: true });
writeFileSync(path.join(folder, ".task.json"), JSON.stringify({ project: "fixtures", id }));
writeFileSync(path.join(folder, "spec.json"), `${JSON.stringify({ ...spec, task: { ...spec.task, folder } }, null, 2)}\n`);
const PATH = `${bin}:${process.env["PATH"] ?? ""}`;
console.log(JSON.stringify({ folder, env: { HOME: home, KELPIE_CONFIG: config, KELPIE_STATE: state, PATH } }));
