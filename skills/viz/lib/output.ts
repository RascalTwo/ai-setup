// lib/output.ts — the one place a command decides between machine and human output.
//
// Every verb an agent or CI touches supports --json. Keeping the branch here rather
// than in each command means a command author writes the data once and the rendering
// once, and cannot accidentally emit prose into stdout alongside JSON — the mistake
// that made bootstrap's first --json unparseable.

/** JSON to stdout alone so `| jq` works; otherwise run the human renderer. */
export function output(json: boolean | undefined, data: unknown, human: () => void): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  human();
}

/** Fail a command the same way everywhere: message to stderr, chosen exit code. */
export function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}
