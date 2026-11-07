// The walkthrough's stage: where the two builds run, putting the throwaway copy back to its start,
// running one real command, and Send. Only a POST acts; the page sends one only when pressed.
import type { Handlers } from "@viz/kit/api.js";
import { relay } from "@viz/kit/server/kelpie-relay.ts";
import { approve } from "./approve.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { WalkSchema } from "./walk.schema.ts";
import type { Routes } from "./contract.ts";

const walk = () =>
  WalkSchema.parse(JSON.parse(readFileSync(path.join(import.meta.dir, "walk.json"), "utf8")));
const sh = (cmd: string[]) => {
  const r = Bun.spawnSync(cmd, { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: (r.stdout.toString() + r.stderr.toString()).trim() };
};
const token = (file: string | undefined) =>
  file && existsSync(file) ? readFileSync(file, "utf8").trim() : "";
const refuse = (message: string) => Response.json({ ok: false, message }, { status: 409 });

export default {
  // The guided frame gets ?tour and a fresh run id, so the guide starts at step 1 after a reset.
  "/stage": () => {
    const s = walk().stage;
    if (!s) return { now: "", before: null };
    const t = token(s.token);
    return {
      now: `${s.now}?tour&run=${Date.now()}#${t}`,
      before: s.before ? `${s.before}#${t}` : null,
    };
  },
  "/reset": (req) => {
    if (req.method !== "POST") return refuse("not available");
    const r = sh(walk().reset);
    return { ok: r.ok, message: r.out.split("\n").at(-1) ?? "" };
  },
  "/cmd": async (req) => {
    if (req.method !== "POST")
      return Response.json({ ok: false, output: "not available" }, { status: 409 });
    const { side, args } = await req.json();
    const c = walk().cmd;
    if (!c) return { ok: false, output: "this walkthrough has no commands" };
    const r = sh([...c[side], ...args]);
    return { ok: r.ok, output: r.out };
  },
  // Accepted approves the task (approve.ts); Changes relays through the kit, like any correction.
  // Both refuse `viz verify` and its tests (VizAutomation): they never reach a real task or pane.
  "/sent": async (req) => {
    const { relay: r } = walk();
    const { words = "", decision = "Changes" } = req.method === "POST" ? await req.json() : {};
    return decision === "Accepted"
      ? approve(req, words, r.folder, r.env)
      : relay(req, words, r.folder, r.env);
  },
} satisfies Handlers<Routes>;
