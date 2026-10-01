import { stepper, $ } from "/_kit/viz.js";

type Step = { t: string; rows: [string, string, "ok" | "bad"][]; lede: string };

const S: Step[] = [
  { t: "RESOLVE cloudId + pageId",
    rows: [["a page URL", "id from /pages/{id}/ · host as cloudId", "ok"], ["a bare numeric id", "ask which site", "ok"],
           ["no page named at all", "ask. never guess.", "bad"]],
    lede: "The only ambiguous input is which page gets overwritten, so this is the one thing it refuses to infer. Everything downstream is mechanical." },
  { t: "FETCH THE CURRENT PAGE — AND KEEP IT",
    rows: [["getConfluencePage", "contentFormat: \"adf\"", "ok"], ["saved to", "/tmp/current-page.json", "ok"],
           ["the page title", "captured, reused unless you change it", "ok"], ["a 404", "stop and report", "bad"]],
    lede: "Not just an access check. The current body is the <b>only copy</b> of the Confluence-native elements somebody added in the UI, and the next step needs it to put them back." },
  { t: "CONVERT — md-to-adf.py",
    rows: [["headings · tables · links · emphasis", "converted", "ok"], ["YYYY-MM-DD in a table cell", "a real ADF date pill", "ok"],
           ["--drop-row \"Source\"", "local-only rows stripped", "ok"], ["lists · code fences · nested tables", "not handled — extend the script", "bad"]],
    lede: "Pure file-in, stdout-out, <b>no network I/O at all</b> — which is what makes it safe to re-run and easy to extend. The narrowness is deliberate; hand-editing the ADF it emits is the thing you must not do." },
  { t: "SPLICE — preserve-extensions.py",
    rows: [["extension · bodiedExtension", "lifted off the old page", "ok"], ["inlineCard · blockCard · embedCard", "lifted off the old page", "ok"],
           ["anchored to", "the nearest preceding heading", "ok"], ["a macro type outside PRESERVE_TYPES", "lost on republish", "bad"]],
    lede: "ToC macros, info panels, Smart Links and Jira embeds have <b>no markdown equivalent</b>, so a fresh conversion would silently delete them. They're re-inserted at the same relative position instead." },
  { t: "PUSH — FROM DISK, NEVER INLINE",
    rows: [["args built into", "/tmp/update-args.json", "ok"], ["mcp-http-call.py", "keychain token → handshake → tools/call", "ok"],
           ["tested at", "≥600KB of args", "ok"], ["inlining the body in a tool call", "refused", "bad"]],
    lede: "The rule the last two steps exist to serve: <b>the body never travels through the model's output tokens</b>, where corruption, escaping bugs and size limits live. Then it reports the page URL and the new version number." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3000, hashKey: "pipeline" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
