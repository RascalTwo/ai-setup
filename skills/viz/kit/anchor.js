// GENERATED from kit/src/anchor.ts by `bun run sync:kit` — edit that file, not this one.
// anchor.js — a selector for an element that survives reloads. Shared by the feedback widget
// (a line's anchor) and the presence layer (a ping's anchor), so both name an element the same way.
// Prefer a stable identity (id → data-viz-id → other data-*/aria-label/name), falling
// back to a structural :nth-of-type path. Works on SVG nodes too.
const isUnique = (sel) => {
    try {
        return document.querySelectorAll(sel).length === 1;
    }
    catch {
        return false;
    }
};
const escAttr = (s) => String(s).replace(/(["\\])/g, "\\$1");
export function uniqueSelector(node) {
    if (node.id && isUnique(`#${CSS.escape(node.id)}`))
        return `#${CSS.escape(node.id)}`;
    const tag = node.tagName.toLowerCase();
    for (const a of ["data-viz-id", "data-label", "aria-label", "name", "data-id"]) {
        const v = node.getAttribute(a);
        if (v && isUnique(`${tag}[${a}="${escAttr(v)}"]`))
            return `${tag}[${a}="${escAttr(v)}"]`;
    }
    const parts = [];
    for (let cur = node; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
        let part = cur.tagName.toLowerCase();
        const v = cur.getAttribute("data-viz-id");
        if (v)
            part += `[data-viz-id="${escAttr(v)}"]`;
        else {
            const tagName = cur.tagName;
            const sames = [...(cur.parentNode?.children ?? [])].filter((c) => c.tagName === tagName);
            if (sames.length > 1)
                part += `:nth-of-type(${sames.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        if (isUnique(parts.join(" > ")))
            break;
    }
    return parts.join(" > ");
}
