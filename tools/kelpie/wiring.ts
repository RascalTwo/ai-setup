// The real dependencies the CLI wires together.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { uptime } from "node:os";
import { gate, loadConfig, loadProjects, type Deps } from "./dispatcher.ts";
import { realHerdr } from "./herdr.ts";
import { timelineStudio } from "./timeline-studio.ts";

const HOME = process.env.HOME!;
export const CONFIG = process.env.KELPIE_CONFIG ?? join(HOME, ".config/kelpie");
export const STATE = process.env.KELPIE_STATE ?? join(HOME, ".agents/state/kelpie");
export const TIDEMARK = join(HOME, ".agents/state/ai-tidemark/claude-code");
export const CLI = join(import.meta.dir, "kelpie.ts");
export const PAUSED = join(CONFIG, "paused"); // present = start nothing new

export const log = (s: string) => {
  mkdirSync(STATE, { recursive: true });
  appendFileSync(join(STATE, "tick.log"), `${new Date().toISOString()} ${s}\n`);
};

export function deps(): Deps {
  const config = loadConfig(CONFIG);
  return {
    tracker: timelineStudio(), herdr: realHerdr, config, projects: loadProjects(CONFIG), stateDir: STATE, cli: CLI,
    templates: { work: readFileSync(join(import.meta.dir, "prompt.md"), "utf8"), refine: readFileSync(join(import.meta.dir, "refine.md"), "utf8") },
    gate: () => gate(TIDEMARK, config), now: Date.now, log, bootTime: () => Date.now() - uptime() * 1000,
    paused: () => existsSync(PAUSED),
  };
}
