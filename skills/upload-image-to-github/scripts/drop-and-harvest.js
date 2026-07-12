// In-page snippet for the Chrome MCP `javascript_tool`. Paste the WHOLE thing.
//
// IMPORTANT: use this top-level-await form, NOT an `(async () => {...})()` wrapper.
// javascript_tool returns the last expression's value and supports top-level await,
// but it does NOT await a Promise you hand back — a wrapping async IIFE serializes to
// `{}`. Here the last expression is `out` (the plain result object), so it returns fine.
//
// Precondition: the target image is on the OS clipboard as base64 TEXT (SKILL.md step 1),
// this runs on a GitHub CLASSIC editor (wiki `_new`, which has <file-attachment>), and you
// clicked into the editor body first so the tab has OS focus (clipboard read needs it).
//
// Returns { url, imgTag } on success, or { error } (and, on timeout, the current body).

const fa = document.querySelector("file-attachment");
const body = document.querySelector("#gollum-editor-body");
let out;
if (!fa || !body) {
  out = { error: "no <file-attachment>/#gollum-editor-body — not a classic editor (use the wiki _new page, NOT /issues/new)" };
} else {
  const b64 = (await navigator.clipboard.readText()).trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
    out = { error: "clipboard is not base64 text — re-run the pbcopy step" };
  } else {
    const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([u8], "image.png", { type: "image/png" }));
    // GitHub's uploader listens on <file-attachment> for a real drop.
    for (const t of ["dragenter", "dragover", "drop"])
      fa.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    // Upload is async; it inserts <img src="https://github.com/user-attachments/assets/<uuid>">.
    out = { error: "timed out waiting for user-attachments URL", body: "" };
    for (let i = 0; i < 30; i++) {
      const v = body.value || "";
      const m = v.match(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+/);
      if (m) { out = { url: m[0], imgTag: v.trim() }; break; }
      out.body = v;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
out; // <-- returned value (do NOT wrap the above in an async IIFE)
