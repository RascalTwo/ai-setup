import { stepper, need } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "THE ASK",
    rows: [
      ['"turn on the desk plug"', "a name, not an id", "bad"],
      ["switch.plug_a", "the id it needs", "ok"],
    ],
    lede: "Entity ids keep what a device was paired as, so the name in the request can't be used directly.",
  },
  {
    t: "FIND",
    rows: [
      ["ha.py find office desk --domain switch", "POST /api/template", "ok"],
      ["id, name, area, device, labels", "contain every word", "ok"],
      ["switch.plug_a = off", "one match", "ok"],
    ],
    lede: "The instance answers, so the lookup can't go stale. If several entities fit, the skill says to ask which one.",
  },
  {
    t: "CALL",
    rows: [
      ["ha.py on switch.plug_a", "id shape checked", "ok"],
      ["POST /api/services/switch/turn_on", "bearer token from disk", "ok"],
    ],
    lede: "The token is read inside the script. The transcript keeps a command and an entity id.",
  },
  {
    t: "CONFIRM",
    rows: [
      ["GET /api/states/switch.plug_a", "polled for up to 10 s", "ok"],
      ["state = on", "exit 0, (confirmed)", "ok"],
      ["still off or unavailable", "exit 1, NOT confirmed", "bad"],
    ],
    lede: "Success means Home Assistant reports the new state. A climate entity reports its mode, so anything but off, unavailable or unknown counts as on.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const render = (i: number): void => {
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "call" });
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
