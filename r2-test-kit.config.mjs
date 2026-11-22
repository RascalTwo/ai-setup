// What the coverage floor counts: the repo's own TypeScript that the tests/ suite imports in-process.
// Not the skills and tools (each has its own suite), and not the entry scripts that run at import
// (install.ts, scripts/check.ts, scripts/check-posters.ts), which only their shell tests drive.
export default {
  include: (path) => /^scripts\/(?:manifest|install-strip)\.ts$/.test(path),
  inputs: ["out/coverage/unit"],
};
