// lib/render/align.ts — put a transcript's word times onto the script's own words.
//
// A speech recogniser spells things its own way ("forty one" -> "fortyone", "41" -> "forty-one"), but
// the page keys pointers to the SCRIPT's words, so the script is the spine and the transcript only
// lends times. Letters are aligned (longest common subsequence), so merges and splits fall out
// for free; a script word the transcript never heard gets its time interpolated from its neighbours.

export type Word = [string, number, number];
export type Heard = { word: string; start: number; end: number };
type Span = { s: number; e: number; hits: number };
type Letter = { c: string; s: number; e: number };

// The same word shape the pointer code counts with (pr-viz.ts `words`).
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const letters = (s: string): string[] =>
  Array.from(s.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, ""));
const r3 = (n: number): number => +n.toFixed(3);

/** Each heard letter, timed evenly across its word. */
const heardLetters = (heard: Heard[]): Letter[] =>
  heard.flatMap((h) => {
    const cs = letters(h.word);
    const w = (h.end - h.start) / cs.length;
    return cs.map((c, k) => ({ c, s: h.start + k * w, e: h.start + (k + 1) * w }));
  });

/** For each script word, the time span of the heard letters its own letters matched (LCS). */
function matchSpans(script: string[], hay: Letter[]): Map<number, Span> {
  const need = script.flatMap((w, i) => letters(w).map((c) => ({ c, i })));
  const n = need.length;
  const m = hay.length;
  // t[i][j] = LCS length of need[i..] and hay[j..]; a cue is a sentence or two, so this stays small.
  const t = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  const get = (i: number, j: number): number => t[i]?.[j] ?? 0;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const row = t[i];
      if (row)
        row[j] =
          need[i]?.c === hay[j]?.c ? get(i + 1, j + 1) + 1 : Math.max(get(i + 1, j), get(i, j + 1));
    }
  const span = new Map<number, Span>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const a = need[i];
    const h = hay[j];
    if (a && h && a.c === h.c && get(i, j) === get(i + 1, j + 1) + 1) {
      const cur = span.get(a.i);
      span.set(
        a.i,
        cur
          ? { s: Math.min(cur.s, h.s), e: Math.max(cur.e, h.e), hits: cur.hits + 1 }
          : { s: h.s, e: h.e, hits: 1 },
      );
      i++;
      j++;
    } else if (get(i + 1, j) >= get(i, j + 1)) i++;
    else j++;
  }
  return span;
}

/** One [word, start, end] per word of `text`, timed from what was `heard`. */
export function alignWords(text: string, heard: Heard[]): Word[] {
  const script = text.match(WORD) ?? [];
  const span = matchSpans(script, heardLetters(heard));
  // A word that kept under half its letters was not really heard: treat it as missing.
  const timed = script.map((w, k) => {
    const s = span.get(k);
    return s && s.hits * 2 >= letters(w).length ? s : null;
  });
  // Missing words share the gap between their timed neighbours, by letter count.
  const lastEnd = heard.at(-1)?.end ?? 0;
  const out: Word[] = [];
  let k = 0;
  while (k < script.length) {
    const s = timed[k];
    if (s) {
      out.push([script[k] ?? "", r3(s.s), r3(s.e)]);
      k++;
      continue;
    }
    let end = k;
    while (end < script.length && !timed[end]) end++;
    const from = out.at(-1)?.[2] ?? 0;
    const to = timed[end]?.s ?? lastEnd;
    const run = script.slice(k, end);
    const total = run.reduce((a, w) => a + letters(w).length, 0) || 1;
    let at = from;
    for (const w of run) {
      const d = ((to - from) * letters(w).length) / total;
      out.push([w, r3(at), r3(at + d)]);
      at += d;
    }
    k = end;
  }
  return out;
}
