// The app's settings, all optional, from r2-test-kit.config.mjs in its root. Path filters are functions
// of the path relative to the app root: a glob would silently match nothing under a dot-folder.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Source files to count: under src/, not tests, not the entry file. */
export const defaultInclude = (path) => /^src\/.*\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\.|(^|\/)main\.[jt]sx?$|\.d\.ts$/.test(path);

export const defaults = {
  include: defaultInclude,
  inputs: ["out/coverage/unit", "out/coverage/e2e"],
  floorFile: "coverage-floor.json",
  reportDir: "out/coverage/merged",
};

export async function loadConfig(root) {
  const file = join(root, "r2-test-kit.config.mjs");
  const own = existsSync(file) ? (await import(pathToFileURL(file).href)).default : {};
  return { ...defaults, ...own };
}
