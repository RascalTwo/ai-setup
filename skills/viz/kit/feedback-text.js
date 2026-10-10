// GENERATED from kit/src/feedback-text.ts by `bun run sync:kit` — edit that file, not this one.
// feedback-text.js — the feedback log (ADR 0021) folded into what's on the page, and that as text.
//
// One source for both readers: `viz feedback` prints it for the agent, and the widget's Copy
// puts the same text on the clipboard (with crops named by their number on the contact sheet
// instead of by file), so what a person pastes reads exactly like what the agent reads.
/** "Name: " before a line, once the lines have more than one author; else nothing. */
export const byNote = (lines) => {
    const many = new Set(lines.map((l) => l.by?.name)).size > 1;
    return (l) => (many && l.by ? `${l.by.name}: ` : "");
};
/** Fold the log: the lines on the page now (edits applied, deletions gone), the latest pick per question, and every send. */
export function foldFeedback(entries) {
    const lines = new Map();
    const picks = {};
    const sends = [];
    for (const e of entries) {
        const id = e.id ?? "";
        const l = lines.get(id);
        if (e.type === "speech" || e.type === "comment")
            lines.set(id, { ...e, id, type: e.type, text: e.text ?? "", at: e.at ?? "", done: false });
        else if (e.type === "edit" && l)
            l.text = e.text ?? "";
        else if (e.type === "retract")
            lines.delete(id);
        else if (e.type === "resolve" && l) {
            l.done = true;
            l.note = e.note;
        }
        else if (e.type === "clear")
            lines.clear();
        else if (e.type === "pick")
            picks[e.q ?? ""] = e.opt ?? "";
        else if (e.type === "send")
            sends.push(e);
    }
    return { lines: [...lines.values()], picks, sends };
}
/** How a person would name what a line is attached to. */
export const nameOf = (a) => a
    ? a.label !== undefined && a.label !== ""
        ? a.label
        : a.text
            ? `"${a.text.slice(0, 40)}"`
            : (a.selector ?? "page")
    : "page";
/** "from <start anchor>" when speech began on something other than where it ended; else nothing. */
export const fromNote = (l) => l.from && nameOf(l.from.anchor) !== nameOf(l.anchor) ? `  ← from ${nameOf(l.from.anchor)}` : "";
const pointerLine = (w, at, tag = "") => `            ${tag}pointer ${w.x},${w.y} · window ${w.w}×${w.h} · scroll ${w.sx},${w.sy}` +
    `${w.hash ? ` · ${w.hash}` : ""}${w.exact ? ` · exactly on ${w.exact}` : ""}${at ? ` · ${at}` : ""}`;
/**
 * The folded lines grouped by what they're attached to, then the picks. `detail` adds where the
 * pointer was and the screenshots, each named by `shot` (a file path for the agent, "crop 3" in a copy).
 */
export function feedbackText(lines, picks, detail, shot) {
    const out = [];
    const who = byNote(lines);
    const groups = new Map();
    for (const l of lines) {
        const k = nameOf(l.anchor);
        groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    for (const [name, ls] of groups) {
        out.push("", `[${name}]${detail && ls[0]?.anchor ? `  ${ls[0].anchor.selector ?? ""}` : ""}`);
        for (const l of ls) {
            out.push(`  ${l.id}  ${l.done ? "✓ " : ""}${l.type === "comment" ? "(typed) " : ""}${who(l)}${l.text}${fromNote(l)}${l.shots ? "  📷" : ""}${l.note ? `  — ${l.note}` : ""}`);
            if (!detail || !l.where)
                continue;
            if (l.from?.where) {
                const sel = l.from.anchor?.selector;
                out.push(pointerLine(l.from.where, "", "start ") + (sel ? ` · on ${sel}` : ""));
            }
            out.push(pointerLine(l.where, l.at, l.from?.where ? "end   " : ""));
            if (l.shots)
                out.push(`            screenshots: ${Object.entries(l.shots)
                    .map(([k, f]) => shot(f, k))
                    .join(" · ")}`);
        }
    }
    if (Object.keys(picks).length > 0)
        out.push("", `picks: ${Object.entries(picks)
            .map(([q, o]) => `${q}:${o}`)
            .join("  ")}`);
    return out;
}
