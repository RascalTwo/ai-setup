// GENERATED from kit/src/film-timing.ts by `bun run sync:kit` — edit that file, not this one.
// film-timing.ts — how long everything lasts. Timing comes from narration.json + the compiled
// .tts/manifest.json: a beat lasts as long as its spoken line plus a breath, so the picture waits
// for the voice by construction. Before the first `viz verify` compiles the clips, it estimates
// from word count.
/** "1-4" / "5,6" / "7" → [1,2,3,4] … */
function beatList(spec) {
    return spec.split(",").flatMap((part) => {
        const [a = 0, b] = part.split("-").map(Number);
        return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
    });
}
/** How long each spoken line (by text) and each cue slot (by "at") lasts, from the compiled clips. */
function clipDurations(compiled) {
    const clip = new Map((compiled?.cues ?? []).filter((c) => c.text).map((c) => [c.text, c.dur]));
    const slot = new Map();
    const cues = (compiled?.tracks ?? [{ cues: compiled?.cues ?? [] }])
        .flatMap((t) => t.cues)
        .filter((c) => c.at !== undefined);
    for (const c of cues) {
        const at = String(c.at);
        slot.set(at, Math.max(slot.get(at) ?? 0, Math.max(c.slotDur ?? 0, c.dur)));
    }
    return { clip, slot };
}
/** `url` as JSON, or `fallback` when it is missing or unreachable (a bad body still throws). */
async function fetchJson(url, fallback) {
    const r = await fetch(url).catch(() => null);
    if (!r?.ok)
        return fallback;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: narration.json and the manifest are what the toolchain wrote
    return (await r.json());
}
export async function loadTimings(scenes, { pad, gap, script, manifest }) {
    // A published single-file export inlines the manifest; the script is only needed for which
    // line belongs to which beat, so a missing script falls back to the manifest's own order.
    const narration = await fetchJson(script, { cues: [] });
    const compiled = window.__vizTts ?? (await fetchJson(manifest, null));
    const { clip, slot } = clipDurations(compiled);
    const say = new Map(narration.cues.map((c) => [Number(String(c.at).split(":")[1]), c.say ?? ""]));
    const chapters = [];
    const beats = [];
    let t = 0;
    scenes.forEach((s, ci) => {
        const c = {
            n: ci + 1,
            title: s.dataset["title"] ?? `Chapter ${ci + 1}`,
            t0: t,
            dur: 0,
            beats: beatList(s.dataset["beats"] ?? ""),
        };
        for (const b of c.beats) {
            const line = say.get(b) ?? "";
            const dur = (slot.get(`beat:${b}`) ??
                clip.get(line) ??
                Math.max(1.5, line.split(/\s+/u).length / 2.6)) + pad;
            beats[b - 1] = { ci, t0: t, dur };
            t += dur;
        }
        t += gap;
        c.dur = t - c.t0;
        chapters.push(c);
    });
    const total = Math.round(t * 100) / 100;
    const start = (b) => beats[b - 1]?.t0 ?? Infinity;
    return { chapters, beats, total, start };
}
