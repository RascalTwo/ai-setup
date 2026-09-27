// ai-tidemark's backend: reads the recorder's JSONL off disk on every request and
// shapes it into one sample format per source. A source with no history is simply
// absent, so a Claude-only, Codex-only or empty machine all get a working page.
//
// Sample: { t: ms, w: window minutes (300 | 10080), v: % used, r: resets_at ms,
//           q: "exact" (API / Codex, accurately timed) | "lagged" (statusline) }
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// resets_at jitters between calls within one window (18:49:59 vs 18:50:00). Snap to
// 10 minutes so one window has one key.
const snap = (ms: number) => Math.round(ms / 600_000) * 600_000;
const toMs = (v: string | number | null | undefined) =>
  v == null ? null : snap(typeof v === "number" ? v * 1000 : Date.parse(v));

function records(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n"))
    .filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// The subscription tier Claude Code stores for this account, and the tier below it.
// The line sits at (lower ÷ this) of a 5-hour window — only ratios documented as
// multiples of Pro. Unrecognised tiers get no line rather than a guess.
const TIERS: Record<string, { name: string; down: string; line: number }> = {
  default_claude_max_20x: { name: "Max 20x", down: "Max 5x", line: 25 },
  default_claude_max_5x: { name: "Max 5x", down: "Pro", line: 20 },
};
function claudeTier(home: string) {
  try {
    const id = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).oauthAccount?.organizationRateLimitTier;
    return TIERS[id] ?? null;
  } catch { return null; }
}

function claude(root: string, home: string) {
  const samples: any[] = [];
  // Statusline readings are lagged and every open session renders its own stale
  // cache. Keep the max per 5-minute bucket per window: a lower bound on the truth.
  const lagged = new Map<string, any>();
  for (const r of records(join(root, "claude-code"))) {
    const t = Date.parse(r.t);
    const windows = r.src === "api"
      ? [[300, r.usage?.five_hour?.utilization, r.usage?.five_hour?.resets_at], [10080, r.usage?.seven_day?.utilization, r.usage?.seven_day?.resets_at]]
      : [[300, r.rate_limits?.five_hour?.used_percentage, r.rate_limits?.five_hour?.resets_at], [10080, r.rate_limits?.seven_day?.used_percentage, r.rate_limits?.seven_day?.resets_at]];
    for (const [w, v, reset] of windows) {
      if (v == null || reset == null) continue;
      const s = { t, w, v, r: toMs(reset), q: r.src === "api" ? "exact" : "lagged" };
      if (s.q === "exact") { samples.push(s); continue; }
      s.t = Math.floor(t / 300_000) * 300_000;
      const k = `${s.t}|${w}|${s.r}`;
      if (!lagged.has(k) || v > lagged.get(k).v) lagged.set(k, s);
    }
  }
  samples.push(...lagged.values());
  if (!samples.length) return null;
  return { id: "claude", label: "Claude Code", tier: claudeTier(home), samples: samples.sort((a, b) => a.t - b.t) };
}

function codex(root: string) {
  const samples: any[] = [], seen = new Set<string>();
  let plan: string | null = null;
  for (const r of records(join(root, "codex"))) {
    plan = r.rate_limits?.plan_type ?? plan;
    for (const w of [r.rate_limits?.primary, r.rate_limits?.secondary]) {
      if (!w?.window_minutes) continue;
      const s = { t: Date.parse(r.t), w: w.window_minutes, v: w.used_percent, r: toMs(w.resets_at), q: "exact" };
      const k = `${s.w}|${s.r}|${s.v}`;   // Codex re-reports the same reading many times a second
      if (!seen.has(k)) { seen.add(k); samples.push(s); }
    }
  }
  if (!samples.length) return null;
  return { id: "codex", label: "Codex", plan, tier: null, samples: samples.sort((a, b) => a.t - b.t) };
}

export default {
  "/data": async () => {
    const home = process.env.HOME!;
    const root = join(home, ".agents/state/ai-tidemark");
    let errors = "";
    try { errors = readFileSync(join(root, "claude-code/poll-errors.log"), "utf8").trim().split("\n").slice(-8).join("\n"); } catch {}
    return Response.json({ now: Date.now(), demo: false, sources: [claude(root, home), codex(root)].filter(Boolean), errors });
  },
};
