import { stepper, need } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "COPY INTO BROWSE'S FILE ROOT",
    rows: [
      ["browse execute --json 'return files.dir'", "jq -r .value", "ok"],
      ["cp file into files.dir", "removed on exit", "ok"],
      ["a path in the shared temp dir", "ExecuteFileAccessError", "bad"],
      ["through the agent's context", "never", "ok"],
    ],
    lede: "<code>setInputFiles</code> only takes files under <code>files.dir</code>, browse's private folder, so the script copies the file there first and cleans up after itself.",
  },
  {
    t: "FIND A CLASSIC EDITOR",
    rows: [
      ["/wiki/_new", "has &lt;file-attachment&gt;", "ok"],
      ["#gollum-editor-body", "present", "ok"],
      ["/issues/new (React)", "no uploader element", "bad"],
      ["wiki disabled or not editable", "redirects to the repo home", "bad"],
    ],
    lede: "GitHub's uploader is bound to a <code>&lt;file-attachment&gt;</code> element that only the classic editors have. Both checks must be true before anything is staged, and the failure names the URL it landed on.",
  },
  {
    t: "EMPTY THE EDITOR",
    rows: [
      ['body.fill("")', "one URL, this upload's", "ok"],
      ['page.on("dialog")', "accept the leave-site guard", "ok"],
      ["a second upload into a full editor", "can land above the first URL", "bad"],
    ],
    lede: "Starting empty means the only <code>user-attachments</code> URL in the body afterwards belongs to this file.",
  },
  {
    t: "STAGE THE FILE",
    rows: [
      ["file-attachment input[type=file]", "#wiki-fileupload", "ok"],
      ["setInputFiles(files.path(name))", "{ timeout: 5000 }", "ok"],
      ["accept", ".png .jpg .gif .svg .webp .mp4 .mov .webm", "ok"],
      ["--dry-run", "stops before this step", "ok"],
    ],
    lede: "The same change event a person's file picker fires. GitHub's own uploader takes over, with its own auth, scoping and CDN. This is the step that publishes, so it is the one step not run in testing.",
  },
  {
    t: "POLL FOR THE URL",
    rows: [
      ["180 attempts × 500 ms", "90 s ceiling", "ok"],
      ["user-attachments/assets/&lt;uuid&gt;", "matched in the body", "ok"],
      ["returns", "{ url, imgTag }", "ok"],
      ["timeout", "{ error, body }", "bad"],
    ],
    lede: "The input returns immediately; the upload does not, and a video takes longer than an image. On timeout the <b>current body</b> comes back too, so you can see what GitHub actually inserted.",
  },
  {
    t: "SPEND IT, DON'T SAVE",
    rows: [
      ["gh pr edit --body-file", "URL is plain text", "ok"],
      ['body.fill("") then goto about:blank', "dialog accepted", "ok"],
      ["page.evaluate onbeforeunload = null", "isolated world, no effect", "bad"],
      ["save the wiki page", "never", "bad"],
    ],
    lede: "The wiki page is never saved and nothing is committed. The asset outlives the editor it came through.",
  },
  {
    t: "VERIFY BY HASH",
    rows: [
      ["gh api markdown → signed URL", "curl | shasum -a256", "ok"],
      ["a spinner on a fresh upload", "not a failed upload", "ok"],
      ["no video in a background tab", "not a failed upload", "ok"],
      ["broken image in the PR", "wrong repo scope", "bad"],
    ],
    lede: "A fresh upload can take a minute to serve, so the page alone can mislead. The <b>hash</b> settles it; a broken image on the PR means the repo scope was wrong.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const render = (i: number) => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
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
need("#next").addEventListener("click", () => st.next());
need("#prev").addEventListener("click", () => st.prev());
const play = need("#play");
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
for (const el of [need("#next"), need("#prev")]) el.addEventListener("click", stopPlay);
