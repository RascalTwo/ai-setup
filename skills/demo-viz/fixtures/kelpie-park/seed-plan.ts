#!/usr/bin/env bun
// One side's starting point for the kelpie-park demo: a fresh plan on the sandbox's Timeline
// Studio with an agent mid-build on calendar-week-numbers (signed off, started) and another task
// waiting in the build queue, the config pointing that side's kelpie at it, and the task's run
// folder made by that side's own createFolder. Usage: seed-plan.ts <side dir> <kelpie dir> <sync base>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [side, kelpie, base] = process.argv.slice(2) as [string, string, string];
const { createFolder, loadProjects } = await import(join(kelpie, "dispatcher.ts"));
const made = await (await fetch(`${base}/api/plan/new`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Calendar app (kelpie park demo)" }) })).json();
const token: string = made.shareToken;
let by = "Joseph";
const ago = (m: number) => new Date(Date.now() - m * 6e4).toISOString();
async function cmd(c: object, mins = 0) {
  const r = await fetch(`${base}/api/commands`, { method: "POST", headers: { "x-timeline-token": token, "x-timeline-by": by, "content-type": "application/json" }, body: JSON.stringify({ cmd: { ...c, at: ago(mins) } }) });
  if (!r.ok) throw new Error(`${JSON.stringify(c).slice(0, 80)}: ${r.status} ${await r.text()}`);
}
await cmd({ type: "patchDoc", patch: {
  colors: [{ id: "calendar", label: "Calendar", color: "#5aa9f0" }],
  borders: [{ id: "b-none", label: "—", style: "solid" }, { id: "b-needs", label: "Needs review", style: "dotted" },
    { id: "b-changes", label: "Changes requested", style: "dashed" }, { id: "b-approved", label: "Approved", style: "solid" }],
  shapes: [{ id: "s1", label: "—", shape: "soft" }, { id: "agent", label: "Agent", shape: "soft" }],
} });
const W = "calendar-week-numbers", I = "calendar-export-ics";
const add = (id: string, label: string, desc: string) => cmd({ type: "addTask", task: { id, label, desc, dur: 120, color: ["calendar"], shape: "agent" } }, 300);
await add(W, "Calendar: show week numbers", "Show the ISO week number at the left of the month grid.\n\nBuild with: sonnet");
await add("calendar-agenda-dark-mode", "Calendar: dark mode for the agenda view", "The agenda view ignores the dark theme.");
await add(I, "Calendar: export agenda as ICS", "Download the visible range as an .ics file.\n\nBuild with: sonnet");
const state = process.env["KELPIE_STATE"] ?? "";
const folder = join(state, "runs/calendar", W);
// Kelpie's own writes carry x-timeline-by: kelpie. Week numbers: refined, signed off, then building.
const k = (text: string, mins: number) => { by = "kelpie"; return cmd({ type: "addComment", id: W, comment: { text } }, mins); };
await k("[dispatch] refining", 240);
await k(`[dispatch] started pane=sandbox-w1:p0 folder=${folder}`, 240);
await k("[dispatch] signoff\n\nSigned off, on the human's word:\n\n> looks right, build it", 200);
by = "Joseph"; await cmd({ type: "setRefined", id: W, refinedAt: ago(200) }, 200);
await k("[dispatch] refined", 195);
await k("[dispatch] dispatching", 45);
by = "Joseph"; await cmd({ type: "startTask", id: W }, 45);
await k(`[dispatch] started pane=sandbox-w1:p1 folder=${folder}`, 45);
// ICS: signed off, waiting in the build queue.
by = "Joseph"; await cmd({ type: "setRefined", id: I, refinedAt: ago(120) }, 120);

mkdirSync(join(side, "home/.config/timeline-studio"), { recursive: true });
writeFileSync(join(side, "home/.config/timeline-studio/config.json"), JSON.stringify({ base, token }));
const p = loadProjects(process.env["KELPIE_CONFIG"] ?? "").find((x: { id: string }) => x.id === "calendar");
createFolder(state, p, { id: W, label: "Calendar: show week numbers" });
console.log(`${side}: plan ${made.id}`);
