import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "BYTES ONTO THE CLIPBOARD",
    rows: [
      ["base64 -i … | tr -d '\\n' | pbcopy", "text, one line", "ok"],
      ["through the agent's context", "never", "ok"],
      ["an image on the clipboard", "unreadable from a page", "bad"],
    ],
    lede: "As <b>text</b>, because <code>navigator.clipboard.readText()</code> hands a page text. The skill also records that a synthetic <code>cmd+v</code> never delivered image bytes to GitHub's paste handler.",
  },
  {
    t: "FIND A CLASSIC EDITOR",
    rows: [
      ["/wiki/_new", "has &lt;file-attachment&gt;", "ok"],
      ["#gollum-editor-body", "present", "ok"],
      ["/issues/new (React)", "no uploader element", "bad"],
      ["wiki disabled", "redirects to the repo home", "bad"],
    ],
    lede: "GitHub's uploader is bound to a <code>&lt;file-attachment&gt;</code> element that only the classic editors have. Both checks must be true before anything is dropped.",
  },
  {
    t: "VALIDATE AND REBUILD",
    rows: [
      ["editor body emptied first", "one URL, this upload's", "ok"],
      ["/^[A-Za-z0-9+/=]+$/", "it really is base64", "ok"],
      ["atob → Uint8Array → File", "name + type from __upload", "ok"],
      ["stale clipboard", "refused, not uploaded", "bad"],
    ],
    lede: "Defaults are <code>image.png</code> / <code>image/png</code>; set <code>window.__upload</code> first for an mp4, mov or webm. A stale clipboard fails loudly instead of uploading whatever was on it.",
  },
  {
    t: "DISPATCH A REAL DROP",
    rows: [
      ["dragenter", "on &lt;file-attachment&gt;", "ok"],
      ["dragover", "same target", "ok"],
      ["drop", "carrying the DataTransfer", "ok"],
      ["each event", "bubbles + cancelable", "ok"],
    ],
    lede: "The three events a human drag produces, in order, each a real <code>DragEvent</code>. GitHub's own uploader takes over, with its own auth, scoping and CDN.",
  },
  {
    t: "POLL FOR THE URL",
    rows: [
      ["180 attempts × 500 ms", "90 s ceiling", "ok"],
      ["user-attachments/assets/&lt;uuid&gt;", "matched in the body", "ok"],
      ["returns", "{ url, imgTag, bytes }", "ok"],
      ["timeout", "{ error, body }", "bad"],
    ],
    lede: "The drop returns immediately; the upload does not, and a video takes longer than an image. On timeout the <b>current body</b> comes back too, so you can see what GitHub actually inserted.",
  },
  {
    t: "THE IIFE TRAP",
    rows: [
      ["top-level await", "supported", "ok"],
      ["last expression `out`", "returned", "ok"],
      ["(async () => {…})()", "serializes to {}", "bad"],
      ["recovery", "re-read the body", "ok"],
    ],
    lede: "<code>javascript_tool</code> returns the last expression but will <b>not await a Promise you hand back</b>. The snippet's bare trailing <code>out</code> exists precisely for this.",
  },
  {
    t: "SPEND IT, DON'T SAVE",
    rows: [
      ["gh pr edit --body-file", "URL is plain text", "ok"],
      ["clear body + input event", "first", "ok"],
      ["window.onbeforeunload = null", "then navigate", "ok"],
      ["navigate first", "'Leave site?' dialog", "bad"],
    ],
    lede: "The wiki page is never saved and nothing is committed. The asset outlives the editor it came through.",
  },
  {
    t: "VERIFY BY HASH",
    rows: [
      ["bytes in the result", "== the file's size", "ok"],
      ["gh api markdown → signed URL", "curl | shasum -a256", "ok"],
      ["a spinner on a fresh upload", "not a failed upload", "ok"],
      ["broken image in the PR", "wrong repo scope", "bad"],
    ],
    lede: "Chrome loads no video in a background tab and a fresh upload can take a minute to serve, so the page alone can mislead. The <b>hash</b> settles it; a broken image on the PR means the repo scope was wrong.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "drop" });
$("#next")!.addEventListener("click", () => st.next());
$("#prev")!.addEventListener("click", () => st.prev());
const play = $("#play")!;
let on = false;
play.addEventListener("click", () => {
  on = !on;
  if (on) st.play();
  else st.pause();
  play.textContent = on ? "❚❚ pause" : "▶ play";
});
const stopPlay = (): void => {
  on = false;
  play.textContent = "▶ play";
};
for (const el of [$("#next")!, $("#prev")!]) el.addEventListener("click", stopPlay);
