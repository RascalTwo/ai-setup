// The stat band above the list: posture, kind and size distributions and the totals.
import { byKind } from "./dashboard-dom.js";
import { fmtSize, fmtUptime } from "./dashboard-format.js";
import { gitFor, state } from "./dashboard-state.js";
import type { Slug } from "./dashboard-types.js";

function kindStats(natives: Slug[]) {
  // Kind. `page` is the absent case, named the way the lobby names it.
  // Kinds are OPEN — any template can declare a new one. The built-ins keep a fixed
  // order so the bar doesn't reshuffle under you as the library changes; any other
  // kind follows, alphabetically.
  const kindCount: Record<string, number> = {};
  for (const v of natives) kindCount[v.kind || "page"] = (kindCount[v.kind || "page"] ?? 0) + 1;
  const FIXED = ["page", "poster-dive", "poster", "exchange", "deck"];
  const KINDS = [
    ...FIXED,
    ...Object.keys(kindCount)
      .filter((k) => !FIXED.includes(k))
      .toSorted(),
  ];
  const kindSel = byKind("#f-kind", HTMLSelectElement);
  for (const k of KINDS.slice(1)) {
    if (kindCount[k] && ![...kindSel.options].some((o) => o.value === k))
      kindSel.add(new Option(k, k));
  }
  const curKind = kindSel.value;
  return { kindCount, KINDS, curKind };
}

function sizeBins(natives: Slug[]) {
  // Log bins over viz size on disk.
  const BINS: { lo: number; hi: number; label: string; n?: number }[] = [
    // Short labels: the stat band gained a fourth column when the kind
    // axis landed, and the old "0.5–2 MB" style ran into its neighbours.
    // Upper bound per bin, which reads fine left-to-right under a histogram.
    { lo: 0, hi: 32 * 1024, label: "32K" },
    { lo: 32 * 1024, hi: 128 * 1024, label: "128K" },
    { lo: 128 * 1024, hi: 512 * 1024, label: "512K" },
    { lo: 512 * 1024, hi: 2048 * 1024, label: "2M" },
    { lo: 2048 * 1024, hi: Infinity, label: "2M+" },
  ];
  for (const b of BINS)
    b.n = natives.filter((s) => s.sizeBytes >= b.lo && s.sizeBytes < b.hi).length;
  const binMax = Math.max(1, ...BINS.map((b) => b.n!));
  return { BINS, binMax };
}

/** The stat band over the library's real vizzes (mirror rows are duplicate views, not vizzes). */
export function renderStatBand(natives: Slug[]): void {
  const centralCount = natives.filter((s) => s.isCentral).length;
  const externalCount = natives.length - centralCount;

  // Totals — git-derived numbers only count ids that have landed in gitFeed.
  const totals = {
    files: 0,
    commits: 0,
    bytes: 0,
    posture: { public: 0, private: 0, local: 0, untagged: 0 },
  };
  for (const s of natives) {
    const g = gitFor(s.id);
    totals.posture[s.posture]++;
    totals.files += s.fileCount;
    totals.commits += g ? g.commitCount : 0;
    totals.bytes += s.sizeBytes;
  }

  const pc = totals.posture;
  const commitVal = state.gitLoaded ? totals.commits : "—";

  // ---- Stat band ------------------------------------------------------
  // These numbers used to be a row of text, which made the one tab that is
  // otherwise a real instrument the worst offender on bar 1 of the skill's
  // own standard. Now the two that have shape get shape:
  //   posture   a stacked bar, segment width = share of the library. It is
  //             also a CONTROL — clicking a segment drives the posture
  //             filter, so the chart and the filter are one object.
  //   size      a log-binned histogram, because viz sizes span 4 orders of
  //             magnitude and a linear axis renders it as one bar.
  // The rest stay as counts; a count with no distribution behind it is
  // honestly just a number.
  const POSTURE_TONE = {
    public: "var(--good)",
    private: "var(--c4)",
    local: "var(--muted)",
    untagged: "var(--danger)",
  };
  const segs = (["public", "private", "local", "untagged"] as const)
    .map((k) => ({ k, n: pc[k] }))
    .filter((s) => s.n > 0);
  const nTot = natives.length || 1;
  const curPosture = byKind("#f-posture", HTMLSelectElement).value;

  const { kindCount, KINDS, curKind } = kindStats(natives);
  const { BINS, binMax } = sizeBins(natives);

  document.querySelector("#slug-totals")!.innerHTML = `
      <div class="stat-band">
        <div class="stat-block posture-block">
          <div class="stat-cap">posture <span>${natives.length} vizzes · click to filter</span></div>
          <div class="posture-bar" role="group" aria-label="Posture split, click a segment to filter">
            ${segs
              .map(
                (s) => `
              <button class="pb-seg${curPosture === s.k ? " on" : ""}"
                      style="--tone:${POSTURE_TONE[s.k]}; flex:${s.n}"
                      data-posture="${s.k}" data-viz-id="posture-${s.k}"
                      data-label="${s.n} ${s.k} vizzes"
                      title="${s.n} ${s.k} — ${((s.n / nTot) * 100).toFixed(1)}% of the library. Click to filter.">
                <span class="pb-n">${s.n}</span>
              </button>`,
              )
              .join("")}
          </div>
          <div class="legend posture-legend">
            ${segs.map((s) => `<span class="legend-item"><i class="swatch dot" style="background:${POSTURE_TONE[s.k]}"></i>${s.k}</span>`).join("")}
          </div>
        </div>

        <div class="stat-block kind-block">
          <div class="stat-cap">kind <span>width = share · click to filter</span></div>
          <!-- Bar carries the magnitude, legend carries the vocabulary — the
               same split the posture block above uses. Labels were originally
               inside the segments, but the distribution is far too skewed for
               that: plain pages are ~71% and the tail segments are ~30px, so
               even "poster dive" clipped. verify's audit caught it; the fix is to
               stop asking a 30px box to hold a two-word name. -->
          <div class="kind-bar" role="group" aria-label="Kind split, click a segment to filter">
            ${KINDS.filter((k) => kindCount[k])
              .map(
                (k) => `
              <button class="sb-seg${curKind === k ? " on" : ""}"
                      style="flex:${kindCount[k]}" data-kind="${k}"
                      data-viz-id="kind-${k}" data-label="${kindCount[k]} ${k} vizzes"
                      aria-label="${k.replace("-", " ")}: ${kindCount[k]} vizzes"
                      title="${kindCount[k]} ${k} — ${((kindCount[k]! / nTot) * 100).toFixed(1)}% of the library. Click to filter.">
                <span class="sb-n">${kindCount[k]}</span>
              </button>`,
              )
              .join("")}
          </div>
        </div>

        <div class="stat-block size-block">
          <div class="stat-cap">size on disk <span>${fmtSize(totals.bytes)} total · bin upper bound</span></div>
          <div class="size-hist" role="img" aria-label="Distribution of viz sizes on disk">
            ${BINS.map(
              (b) => `
              <span class="sh-col" title="${b.n} viz${b.n === 1 ? "" : "zes"} between ${b.label}"
                    data-viz-id="sizebin-${b.label}" data-label="${b.n} vizzes, ${b.label}">
                <i style="height:${((b.n! / binMax) * 100).toFixed(1)}%"></i>
                <em>${b.label}</em>
              </span>`,
            ).join("")}
          </div>
        </div>

        <!-- Every number says what it is, in place. These used to be bare
             figures with the meaning hidden in a title, so "235  13c / 222x"
             read as one run-on number you had to hover to decode. -->
        <div class="stat-block counts-block">
          <span class="tnum" title="${centralCount} in the central library, ${externalCount} living inside your own repos">
            <b>${natives.length}</b><i>vizzes</i></span>
          <span class="tnum" title="${totals.files.toLocaleString()} file${totals.files === 1 ? "" : "s"} on disk across every viz">
            <b>${totals.files}</b><i>files</i></span>
          <span class="tnum" title="${state.gitLoaded ? totals.commits.toLocaleString() + " commits across all host repos" : "git feed still loading…"}">
            <b>${commitVal}</b><i>commits</i></span>
          <span class="tnum" title="${totals.bytes.toLocaleString()} bytes on disk">
            <b>${fmtSize(totals.bytes)}</b><i>on disk</i></span>
          <span class="tnum" id="server-uptime" title="how long this viz server has been up">
            <b>${state.lastServerInfo ? fmtUptime(state.lastServerInfo.uptimeSec) : "…"}</b><i>uptime</i></span>
          <span class="tnum" id="server-containers" title="viz-pages folders this server is currently serving">
            <b>${state.lastServerInfo ? state.lastServerInfo.containers : "…"}</b><i>containers</i></span>
        </div>
      </div>`;
}
