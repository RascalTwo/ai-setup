// feedback-dom.js — the small DOM and data helpers the feedback widget's modules share.
// A leaf: it imports nothing.

/** `<tag>` with attributes and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
/** Put a floating node beside (x, y), kept inside the viewport. */
export function placeNear(node: HTMLElement, x: number, y: number): void {
  const w = node.offsetWidth || 300,
    h = node.offsetHeight || 140;
  node.style.left = Math.max(8, Math.min(x + 12, innerWidth - w - 8)) + "px";
  node.style.top = Math.max(8, Math.min(y + 12, innerHeight - h - 8)) + "px";
}
/** `document.querySelector` that reads a selector which no longer parses (or is missing) as no element. */
export const safeQuery = (sel: string | null | undefined): Element | null => {
  try {
    return sel ? document.querySelector(sel) : null;
  } catch {
    return null;
  }
};
/** Let a promise run on its own: if it fails, the console hears of it (it is never silently dropped). */
export function detach(p: Promise<unknown>): void {
  p.catch((err: unknown) => {
    console.error(err);
  });
}
export const newId = (): string => Math.random().toString(36).slice(2, 10);
// oxlint-disable-next-line typescript/promise-function-async -- the promise is the whole body: nothing to await
export const dataUrl = (b: Blob): Promise<string> =>
  new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.addEventListener("load", () => done(typeof r.result === "string" ? r.result : ""));
    r.addEventListener("error", () => fail(r.error ?? new Error("could not read the blob")));
    r.readAsDataURL(b);
  });
export const escHtml = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
