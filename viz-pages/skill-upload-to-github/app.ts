import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "BYTES ONTO THE CLIPBOARD",
    rows: [["base64 -i … | tr -d '\\n' | pbcopy", "text, one line", "ok"], ["through the agent's context", "never", "ok"],
           ["an image on the clipboard", "unreadable from a page", "bad"]],
    lede: "As <b>text</b>, not as an image — because <code>navigator.clipboard.readText()</code> can reach text from inside a page and cannot reach an image. Same reason synthetic <code>cmd+v</code> was a dead end." },
  { t: "FIND A CLASSIC EDITOR",
    rows: [["/wiki/_new", "has <file-attachment>", "ok"], ["#gollum-editor-body", "present", "ok"],
           ["/issues/new (React)", "no uploader element", "bad"], ["wiki disabled", "redirects home", "bad"]],
    lede: "GitHub's uploader is bound to a <code>&lt;file-attachment&gt;</code> element that only the classic editors have. Both checks must be true before anything is dropped." },
  { t: "VALIDATE AND REBUILD",
    rows: [["/^[A-Za-z0-9+/=]+$/", "it really is base64", "ok"], ["atob → Uint8Array", "bytes back", "ok"],
           ["new File([u8], 'image.png')", "image/png", "ok"], ["stale clipboard", "refused, not uploaded", "bad"]],
    lede: "Validation before decode. A stale clipboard fails loudly rather than becoming a corrupt <code>File</code> that GitHub accepts and renders as garbage." },
  { t: "DISPATCH A REAL DROP",
    rows: [["dragenter", "on <file-attachment>", "ok"], ["dragover", "establishes drop state", "ok"],
           ["drop", "with the DataTransfer", "ok"], ["drop alone", "handler never armed", "bad"]],
    lede: "Three events, not one. GitHub's handler arms itself on the enter/over pair — a bare <code>drop</code> lands on an element that was never told a drag was in progress." },
  { t: "POLL FOR THE URL",
    rows: [["180 attempts × 500ms", "90s ceiling", "ok"], ["user-attachments/assets/<uuid>", "matched in the body", "ok"],
           ["returns", "{ url, imgTag, bytes }", "ok"], ["timeout", "{ error, body }", "bad"]],
    lede: "The drop returns immediately; the upload does not. On timeout the <b>current body</b> comes back too, so you can see what GitHub actually inserted instead of guessing." },
  { t: "THE IIFE TRAP",
    rows: [["top-level await", "supported", "ok"], ["last expression `out`", "returned", "ok"],
           ["(async () => {…})()", "serializes to {}", "bad"], ["recovery", "re-read the body", "ok"]],
    lede: "<code>javascript_tool</code> returns the last expression but will <b>not await a Promise you hand back</b>. The snippet's bare trailing <code>out</code> exists precisely for this." },
  { t: "SPEND IT, DON'T SAVE",
    rows: [["gh pr edit --body-file", "URL is plain text", "ok"], ["clear body + input event", "first", "ok"],
           ["window.onbeforeunload = null", "then navigate", "ok"], ["navigate first", "'Leave site?' dialog", "bad"]],
    lede: "The wiki page is never saved and nothing is committed — the asset outlives the editor it came through. Then open the PR and <b>look at it</b>: a broken image means wrong repo scope." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "drop" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
