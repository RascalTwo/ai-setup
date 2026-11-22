// What the coverage floor counts: the skill's own TypeScript that vitest loads. Not the tests, the
// vizzes (they verify themselves), the browser kit, vendored copies, or what only a spawned CLI runs.
export default {
  include: (path) =>
    /\.ts$/.test(path) &&
    !/^(tests|viz-pages|kit|templates|types|node_modules|out|\.verify|\.mcpb-dist)\//.test(path) &&
    !path.endsWith(".d.ts"),
  inputs: ["out/coverage/unit"],
};
