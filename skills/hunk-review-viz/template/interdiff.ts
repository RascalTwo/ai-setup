// interdiff.ts — what changed in a hunk since the reviewer last saw it. Both versions are reduced to
// their new side (the code as it would read), then diffed line by line (longest common subsequence).
// Unchanged runs keep `context` lines either side; longer stretches become one "⋯" line.

/** The code a diff hunk leaves behind: its context and added lines, without the prefix. */
export const newSide = (lines: string[]): string[] =>
  lines.filter((l) => l.startsWith(" ") || l.startsWith("+")).map((l) => l.slice(1));

/** Above this many cells the LCS table costs too much; the caller shows the whole hunk instead. */
const MAX_CELLS = 4_000_000;

/** Line operations from `a` to `b` (" " kept, "-" removed, "+" added), removals before additions. */
function lineOps(a: string[], b: string[]): string[] {
  // lcs[i * w + j] = length of the longest common subsequence of a[i..] and b[j..].
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  const at = (i: number, j: number) => lcs[i * w + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  const ops: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push(` ${a[i++]}`);
      j++;
    } else if (i < a.length && (j >= b.length || at(i + 1, j) >= at(i, j + 1)))
      ops.push(`-${a[i++]}`);
    else ops.push(`+${b[j++]}`);
  }
  return ops;
}

/** Keeps changes and `context` unchanged lines either side; each longer stretch becomes one "~⋯ N unchanged lines". */
function foldUnchanged(ops: string[], context: number): string[] {
  const changed = ops.map((o) => !o.startsWith(" "));
  const near = ops.map((_, k) =>
    changed.slice(Math.max(0, k - context), k + context + 1).some(Boolean),
  );
  const out: string[] = [];
  let gap = 0;
  const flush = () => {
    if (gap > 0) out.push(`~⋯ ${gap} unchanged line${gap === 1 ? "" : "s"}`);
    gap = 0;
  };
  for (const [k, o] of ops.entries()) {
    if (near[k]) {
      flush();
      out.push(o);
    } else gap++;
  }
  flush();
  return out;
}

/** What changed from `before` to `after`, folded for reading. Undefined when they're too large to compare. */
export function interdiff(before: string[], after: string[], context = 3): string[] | undefined {
  if (before.length * after.length > MAX_CELLS) return undefined;
  return foldUnchanged(lineOps(before, after), context);
}
