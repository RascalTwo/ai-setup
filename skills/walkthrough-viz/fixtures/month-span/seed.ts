#!/usr/bin/env bun
// A fresh demo plan on the throwaway Timeline Studio for the month-span walkthrough, its share
// token written to <token file> (0600). Every run makes a new plan, so Start over is a clean start.
// Usage: seed.ts <sync server base> <token file>
import { chmodSync, writeFileSync } from "node:fs";

const [base = "http://localhost:8092", tokenFile = "plan.token"] = process.argv.slice(2);
const post = async (path: string, body: object, token?: string) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-timeline-by": "walkthrough-seed", ...(token && { "x-timeline-token": token }) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

const plan = await post("/api/plan/new", { title: "Demo: month span" });
const Z = "-05:00"; // America/Chicago in October
const at = (d: string, a: string, b: string) => ({ start: `2026-${d}T${a}:00${Z}`, stop: `2026-${d}T${b}:00${Z}` });
const cmds: object[] = [{ type: "patchDoc", patch: { timeZone: "America/Chicago", weekStart: 1, start: "2026-10-01" } }];
const task = (id: string, label: string, dur: number, o: { sessions?: object[]; planned?: object[]; done?: boolean } = {}) => {
  cmds.push({ type: "addTask", task: { id, label, dur } });
  if (o.sessions) cmds.push({ type: "setSessions", id, sessions: o.sessions });
  if (o.planned) cmds.push({ type: "setPlanned", id, planned: o.planned });
  if (o.done) cmds.push({ type: "finishTask", id });
};
// Time worked earlier in the month.
task("onboarding", "Write the onboarding guide", 300, { sessions: [at("10-06", "09:00", "11:00"), at("10-07", "13:00", "16:00")], done: true });
task("export-bug", "Fix the CSV export bug", 600, { sessions: [at("10-14", "10:00", "12:00"), at("10-21", "14:00", "15:30")] });
// An overnight job across midnight and the month's end.
task("migration", "Data migration (overnight)", 480, { planned: [{ start: `2026-10-31T20:00:00${Z}`, stop: `2026-11-01T04:00:00${Z}` }] });
// A day too full to show: nine meetings on Wednesday 28 October.
const day: [string, string, string][] = [
  ["08:00", "08:30", "Inbox"], ["09:00", "09:30", "Standup"], ["10:00", "11:00", "Design review"],
  ["11:30", "12:00", "1:1 with Sam"], ["12:00", "12:30", "Lunch and learn"], ["13:00", "14:00", "Planning"],
  ["14:30", "15:00", "Vendor call"], ["16:00", "16:30", "Retro"], ["17:00", "17:30", "Wrap-up"],
];
day.forEach(([a, b, n], i) => task(`mtg${i}`, n, 30, { planned: [at("10-28", a, b)] }));
// Work still to do, forecast from now.
task("settings", "Design the settings page", 480);
task("notes", "Write release notes", 120);
await post("/api/commands", { cmds }, plan.shareToken);
writeFileSync(tokenFile, plan.shareToken);
chmodSync(tokenFile, 0o600);
console.log(`seeded a fresh demo plan (${plan.id})`);
