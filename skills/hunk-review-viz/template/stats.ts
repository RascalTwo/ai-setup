// stats.ts — how big a change is, in lines, the way a reviewer feels it: added, changed, removed.
// A run of removed lines followed by added lines is a change of min(removed, added) lines; the rest
// of the run is plain additions or removals. Counts roll up by summing (hunk → file → commit → review).

export interface Counts {
  add: number;
  chg: number;
  del: number;
}

export const ZERO: Counts = { add: 0, chg: 0, del: 0 };

/** Counts one hunk's diff lines (" ", "+", "-" and "\" prefixes). */
export function countLines(lines: string[]): Counts {
  const c = { ...ZERO };
  let dels = 0;
  let adds = 0;
  const flush = () => {
    const chg = Math.min(dels, adds);
    c.chg += chg;
    c.add += adds - chg;
    c.del += dels - chg;
    dels = 0;
    adds = 0;
  };
  for (const l of lines) {
    if (l.startsWith("-")) {
      if (adds > 0) flush(); // a removal after additions starts a new run
      dels++;
    } else if (l.startsWith("+")) adds++;
    else if (!l.startsWith("\\")) flush();
  }
  flush();
  return c;
}

export function sum(cs: Counts[]): Counts {
  const t = { ...ZERO };
  for (const c of cs) {
    t.add += c.add;
    t.chg += c.chg;
    t.del += c.del;
  }
  return t;
}

/** Lines a reviewer reads: each changed line once, plus additions and removals. */
export const size = (c: Counts): number => c.add + c.chg + c.del;

/** "+12 ~3 −4" with a small bar whose segments are those three, to scale within it. */
export function countsHtml(c: Counts): string {
  const n = size(c) || 1;
  const seg = (k: keyof Counts) =>
    c[k] > 0 ? `<i class="${k}" style="flex:${c[k] / n}"></i>` : "";
  return `<span class="counts" title="${c.add} added, ${c.chg} changed, ${c.del} removed"><b class="add">+${c.add}</b><b class="chg">~${c.chg}</b><b class="del">−${c.del}</b><span class="mini">${seg("add")}${seg("chg")}${seg("del")}</span></span>`;
}

/** A share of a whole, as "37%" (or "<1%" for a sliver). */
export function share(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const p = (100 * part) / whole;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}
