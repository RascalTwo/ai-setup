// Generates fixtures/demo.json: what the page shows online, or with ?demo.
//
// Three weeks of plausible Claude Code + Codex usage, simulated from a fixed seed
// and written as the recorder's own raw JSONL into a throwaway $HOME, then shaped by
// the real api.ts. So the demo exercises the same code path as live data, and none
// of it comes from anyone's real history. Deterministic: rerunning changes nothing.
//
//   bun viz-pages/ai-tidemark/fixtures/generate.ts [out.json]   (default: fixtures/demo.json)
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const H = 3_600_000, NOW = Date.parse("2026-09-26T21:40:00Z");
let seed = 42;
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);

const home = mkdtempSync(join(tmpdir(), "tidemark-demo-"));
const cc = join(home, ".agents/state/ai-tidemark/claude-code"), cx = join(home, ".agents/state/ai-tidemark/codex");
mkdirSync(cc, { recursive: true }); mkdirSync(cx, { recursive: true });
writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { organizationRateLimitTier: "default_claude_max_20x" } }));
const iso = (ms: number) => new Date(ms).toISOString();
const month = (ms: number) => iso(ms).slice(0, 7) + ".jsonl";

// Weekly windows reset Saturdays 06:00 UTC. Local day is UTC-5.
const weekReset = (t: number) => { let r = Date.parse("2026-09-05T06:00:00Z"); while (r <= t) r += 168 * H; return r; };
let wk = 0, wkReset = weekReset(NOW - 21 * 24 * H), five = 0, fiveReset = 0, cxWk = 0, cxReset = weekReset(NOW - 21 * 24 * H) + 3 * H;

for (let t = NOW - 21 * 24 * H; t <= NOW; t += 15 * 60_000) {
  const local = new Date(t - 5 * H), hour = local.getUTCHours(), day = local.getUTCDay();
  if (t >= wkReset) { wk = 0; wkReset = weekReset(t); }
  if (t >= fiveReset) five = 0;
  if (t >= cxReset) { cxWk = 0; cxReset += 168 * H; }
  const workday = day >= 1 && day <= 5, awake = hour >= 7 && hour <= 23;
  const busy = awake && rand() < (workday && hour >= 9 && hour <= 18 ? 0.65 : 0.12);
  if (busy) {
    if (!five) fiveReset = t + 5 * H;
    const burn = rand() * (day === 5 ? 7 : 4);   // Fridays run hot
    five = Math.min(100, five + burn);
    wk = Math.min(100, wk + burn * 0.17);
    if (rand() < 0.08) cxWk = Math.min(100, cxWk + rand() * 3);
  }
  // The poller only runs while the Mac is awake.
  if (awake) appendFileSync(join(cc, month(t)), JSON.stringify({ t: iso(t), src: "api", usage: {
    five_hour: five ? { utilization: Math.round(five), resets_at: iso(fiveReset) } : { utilization: 0, resets_at: null },
    seven_day: { utilization: Math.round(wk), resets_at: iso(wkReset) } } }) + "\n");
  if (busy && rand() < 0.3) appendFileSync(join(cc, month(t)), JSON.stringify({ t: iso(t + 60_000), src: "statusline", rate_limits: {
    ...(five && { five_hour: { used_percentage: Math.max(0, Math.round(five) - 2), resets_at: fiveReset / 1000 } }),
    seven_day: { used_percentage: Math.max(0, Math.round(wk) - 1), resets_at: wkReset / 1000 } } }) + "\n");
  if (busy && rand() < 0.1) appendFileSync(join(cx, month(t)), JSON.stringify({ t: iso(t), src: "codex", rate_limits: {
    primary: { used_percent: Math.round(cxWk), window_minutes: 10080, resets_at: cxReset / 1000 }, plan_type: "plus" } }) + "\n");
}

process.env.HOME = home;
const { default: routes } = await import("../api.ts");
const data = await (await routes["/data"]()).json();
Object.assign(data, { now: NOW, demo: true, errors: `${iso(NOW - 30 * H)} access token expired; run Claude Code to refresh it\n${iso(NOW - 30 * H)} HTTP 401 Unauthorized retry-after=None` });
writeFileSync(process.argv[2] ?? join(import.meta.dir, "demo.json"), JSON.stringify(data));
console.log(`demo.json: ${data.sources.map((s: any) => `${s.id} ${s.samples.length} samples`).join(", ")}`);
