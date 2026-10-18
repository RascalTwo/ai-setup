import { stepper, arrowMarkers, connect, labelBox, esc, $ } from "@viz/kit";

type Node = { x: number; y: number; w: number; h: number };

// ── pipeline nodes ─────────────────────────────────────────────────────────────
const N = {
  webex: { x: 8, y: 96, w: 140, h: 66 },
  wx: { x: 184, y: 96, w: 140, h: 66 },
  json: { x: 366, y: 96, w: 134, h: 66 },
  brain: { x: 540, y: 96, w: 128, h: 66 },
  google: { x: 700, y: 96, w: 102, h: 66 },
} satisfies Record<string, Node>;
type Id = keyof typeof N;
const IDS: Id[] = ["webex", "wx", "json", "brain", "google"];

const LABEL: Record<Id, [string, string]> = {
  webex: ["Webex app", "accessibility tree"],
  wx: ["wx", "Swift, read-only"],
  json: ["week.json", "the extract"],
  brain: ["the agent", "gate · classify"],
  google: ["Google", "Calendar"],
};

type Line = [number | string | null, string];
interface Step {
  t: string;
  on: Id[];
  fence: boolean;
  approve?: boolean;
  code: Line[];
  lede: string;
}

const S: Step[] = [
  {
    t: "BRING WEBEX FORWARD, PROMISE TO GIVE IT BACK",
    on: ["wx"],
    fence: true,
    code: [
      [7, '[ "$bin" -nt wx.swift ] || swiftc -O wx.swift -o "$bin" || exit 1'],
      [10, "trap restore EXIT INT TERM"],
      [11, `osascript -e 'tell application "Webex" to activate' >/dev/null 2>&1`],
      [12, "sleep 0.8"],
      [13, 'perl -e \'alarm 300; exec @ARGV\' "$bin" "$@"'],
    ],
    lede: "<code>run.sh</code> recompiles <code>wx</code> only if <code>wx.swift</code> is newer, remembers which app was frontmost, activates Webex, and runs the extractor under a <b>300 second alarm</b>. The <code>trap</code> means that however the run ends, even on an error, the previous app is activated again (unless that app was Webex itself).",
  },
  {
    t: "GET TO A KNOWN SCREEN",
    on: ["webex", "wx"],
    fence: true,
    code: [
      [
        61,
        'guard AXIsProcessTrusted() else { log("ERROR not trusted for accessibility"); exit(2) }',
      ],
      [
        62,
        'guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "Cisco-Systems.Spark").first else { log("ERROR Webex not running"); exit(2) }',
      ],
      [82, 'setView("List")'],
      [
        83,
        'guard viewPopup().map({ txt($0).hasSuffix(", List") }) ?? false else { log("ERROR could not switch to List view"); exit(3) }',
      ],
      [85, 'log("baseline ok: Meetings > Calendar > List")'],
    ],
    lede: "Everything after this assumes one screen: <b>Meetings, Calendar tab, List view, side panel closed</b>. The program presses its way there through the accessibility tree and checks it arrived. Not trusted, not running, or can't reach the screen: it exits 2 or 3 with an <code>ERROR</code> line, and the agent reports and stops.",
  },
  {
    t: "READ THE WHOLE LIST AS ROWS",
    on: ["webex", "wx"],
    fence: true,
    code: [
      [
        91,
        "func scan() -> [Row] {   // the whole list as rows; re-run when the list was rebuilt under us (row indexes shift)",
      ],
      [96, "        if t.count == 1, let d = headFmt.date(from: t[0]) { curDate = d; continue }"],
      [
        99,
        '        else if t.count >= 4, t[1] == "-" { out.append(Row(idx: ri, el: r, date: d, start: t[0], end: t[3], title: t[2], allDay: false)) }',
      ],
      [104, "let targets = rows.filter { $0.date >= fromDate && $0.date < toDate }"],
    ],
    lede: 'The list is a table. A one-text row that parses as <code>EEEE, MMMM d, yyyy</code> is a day header and sets the current date; a row shaped <b>start, "-", title, end</b> is a meeting. <code>All day</code> rows are noted but never opened. Row indexes shift when the list is rebuilt, so <code>scan()</code> can be re-run to find a row again.',
  },
  {
    t: "OPEN ONE ROW, WAIT FOR THE RIGHT PANEL",
    on: ["webex", "wx"],
    fence: true,
    code: [
      [179, "    for attempt in 1...2 where !done {"],
      [
        155,
        "        AXUIElementSetAttributeValue(bar, kAXValueAttribute as CFString, NSNumber(value: frac))",
      ],
      [184, "        click(CGPoint(x: r.minX + min(160, r.width / 2), y: r.midY))"],
      [186, "        let ok = waitFor(5000) {"],
    ],
    lede: "A row off screen is brought into view by setting the list's scroll bar to a computed fraction, then clicked. Clicking is not enough: it <b>waits up to 5 seconds for the side panel to show the same title and time</b> it clicked on, so a slow render can't be read as the previous meeting. Two attempts per row; a row that fails twice goes into <code>errors</code>.",
  },
  {
    t: "READ A FIXED SET OF FIELDS",
    on: ["webex", "wx"],
    fence: true,
    code: [
      [117, '    d["link"] = head.first { $0.hasPrefix("http") } ?? ""'],
      [
        120,
        '    if let inv = (head + body).first(where: { $0.hasSuffix(" has invited you") }) { d["organizer"] = String(inv.dropLast(" has invited you".count)) }',
      ],
      [
        122,
        '    if let i = body.firstIndex(where: { $0.hasPrefix("Invitees (") }) { d["inviteeCount"] = Int(body[i].filter { $0.isNumber }) ?? 0 }',
      ],
      [
        198,
        String.raw`        if let desc = d["description"] as? String { d["description"] = desc.hasPrefix("No description has been provided") ? "" : desc.replacingOccurrences(of: "pwd=[^&\\s]+", with: "pwd=REDACTED", options: .regularExpression) }`,
      ],
    ],
    lede: "<code>readPanel()</code> picks named fields out of the panel's text: title, link, organizer, invitee count, rooms, description. It never goes looking for the password, host key, meeting number or dial-in blocks. <b>Anything that looks like <code>pwd=</code> is replaced with <code>pwd=REDACTED</code></b> in the link and the description before the extract is written.",
  },
  {
    t: "WRITE THE EXTRACT, THEN GATE IT",
    on: ["json", "brain"],
    fence: false,
    code: [
      [
        206,
        'let result: [String: Any] = ["extractedAt": iso.string(from: Date()), "listEnd": dayFmt.string(from: rows.last?.date ?? fromDate), "range": ["from": dayFmt.string(from: fromDate), "days": days], "events": events, "errors": errors]',
      ],
      [
        207,
        'try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: outDir + "/week.json"))',
      ],
      [
        "§1",
        "Done when `errors` is empty and `events` is non-empty. Otherwise stop with no Google writes:",
      ],
      ["§1", "a partial read would delete live mirrors."],
    ],
    lede: "One file, <code>~/.local/share/webex-calendar/out/week.json</code>, including <code>listEnd</code>: the date of the last row Webex showed. Then the agent applies the gate. <b>An error row or an empty list means no Google writes at all</b>, because from here on a hole in the data looks exactly like a cancelled meeting.",
  },
  {
    t: "READ THE SAME WINDOW FROM GOOGLE",
    on: ["brain", "google"],
    fence: false,
    code: [
      ["§2", "Fetch the same window (orderBy: startTime, pageSize: 250, page to the end)."],
      ["§2", "The result is large (about 300 KB for a month) and lands in a file:"],
      ["§2", "read it with python or jq, not into chat."],
      ["§2", "Mirrors = events whose description starts with MIRRORED-FROM-WEBEX;"],
      ["§2", "those are the only events this skill may update or delete."],
    ],
    lede: "The agent loads <code>list_events</code> through ToolSearch and pages to the end. The result goes to a file and is read with a script, never pasted into the conversation. From it the agent splits Google into <b>mirrors</b> (ours, may be changed) and <b>everything else</b> (not ours, never touched).",
  },
  {
    t: "CLASSIFY EVERY EVENT, THEN EVERY MIRROR",
    on: ["brain"],
    fence: false,
    code: [
      ["§3", "native      non-mirror event, same start/end, same title or link      -> skip"],
      ["§3", "unchanged   mirror matches on (link, start), nothing differs         -> skip"],
      ["§3", "update      mirror matches on (link, start), title/end/organizer differ"],
      [
        "§3",
        "moved       unmatched mirror + unmatched Webex event share link/title -> update times",
      ],
      ["§3", "create      Webex event matches nothing                              -> create"],
      ["§3", "delete      mirror before listEnd matches no Webex event             -> delete"],
    ],
    lede: "This step is judgement, not code, which is why it lives in <code>SKILL.md</code> and not in <code>wx.swift</code>: the matching is fuzzy at the edges. The next section walks the cases. The result is <b>one table</b>: action, title, start, reason.",
  },
  {
    t: "APPLY ONLY AFTER YOU SAY SO",
    on: ["brain", "google"],
    fence: false,
    approve: true,
    code: [
      ["§4", "summary:       <titlePrefix> <title>"],
      ["§4", "location:      the join link"],
      ["§4", "description:   MIRRORED-FROM-WEBEX | <link> | <start ISO>"],
      ["§4", "               Organizer: ...   Rooms: ...   (empty ones omitted)"],
      ["§4", "availability:  AVAILABILITY_BUSY    notificationLevel: NONE    no attendees"],
    ],
    lede: "The plan is shown and <b>nothing is written until approved</b>. Each write is a mirror in this exact shape, with <code>notificationLevel: NONE</code>. The first description line is the mirror's ownership tag and its identity key at once, which is what the next run will match against.",
  },
];

const stage = $("#flow")!;
const code = $("#code")!;
const lede = $("#lede")!;
const pos = $("#pos")!;

const EDGES: [Id, Id, string][] = [
  ["webex", "wx", "ah"],
  ["wx", "json", "ah"],
  ["json", "brain", "ah"],
  ["brain", "google", "ah-accent"],
];

const draw = (i: number): void => {
  const s = S[i]!;
  const on = new Set<Id>(s.on);
  const nodes = IDS.map((id) => {
    const n: Node = N[id];
    const [h, sub] = LABEL[id];
    const lit = on.has(id);
    const tone = id === "google" ? "var(--mirror)" : "var(--accent)";
    return (
      `<g data-viz-id="pipe-${id}" data-label="${esc(h)} ${esc(sub)}">` +
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${lit ? `color-mix(in srgb, ${tone} 22%, #080b18)` : "#0d1126"}" stroke="${lit ? tone : "var(--border)"}" stroke-width="${lit ? 2 : 1.2}"/>` +
      labelBox(
        n,
        `<div><b style="color:${lit ? "#fff" : "var(--text)"};font-size:13px">${esc(h)}</b><br><span style="font-family:var(--mono);font-size:10.5px;color:var(--muted)">${esc(sub)}</span></div>`,
      ) +
      `</g>`
    );
  }).join("");
  const edges = EDGES.map(
    ([a, b, m]) =>
      `<path d="${connect(N[a], N[b])}" stroke="var(--muted)" stroke-width="1.5" fill="none" marker-end="url(#${m})"/>`,
  ).join("");
  const fenceOn = s.fence;
  const fence =
    `<g data-viz-id="pipe-fence" data-label="run.sh: Webex has the focus, and it is restored on exit">` +
    `<rect x="0" y="52" width="332" height="150" rx="14" fill="none" stroke="${fenceOn ? "var(--accent)" : "var(--faint)"}" stroke-width="${fenceOn ? 2.2 : 1}" stroke-dasharray="6 5"/>` +
    `<text x="12" y="72" font-family="var(--mono)" font-size="10" letter-spacing=".6" fill="${fenceOn ? "var(--accent)" : "var(--faint)"}">run.sh · Webex has focus · previous app restored</text></g>`;
  const cap = (id: Id, text: string): string =>
    `<text x="${N[id].x + N[id].w / 2}" y="${N[id].y + N[id].h + 22}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--faint)">${esc(text)}</text>`;
  const approve = s.approve
    ? `<g data-viz-id="pipe-approve" data-label="you approve the plan before any write"><rect x="598" y="30" width="146" height="26" rx="13" fill="var(--warn)"/><text x="671" y="47.5" text-anchor="middle" font-family="var(--mono)" font-size="11" font-weight="700" fill="#080b18" letter-spacing=".6">YOU APPROVE</text><path d="M671 56 V96" stroke="var(--warn)" stroke-width="1.6" stroke-dasharray="4 3"/></g>`
    : "";
  stage.innerHTML =
    arrowMarkers() +
    fence +
    edges +
    nodes +
    cap("webex", "Cisco-Systems.Spark") +
    cap("json", "events[] · errors[] · listEnd") +
    cap("brain", "SKILL.md §1 to §4") +
    approve;
};

const render = (i: number): void => {
  const s = S[i]!;
  draw(i);
  code.innerHTML = s.code
    .map(
      ([n, t]) =>
        `<div${typeof n === "string" ? ' class="cm"' : ""}><i>${n ?? ""}</i>${esc(t)}</div>`,
    )
    .join("");
  lede.innerHTML = `<span style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--mirror)">${i + 1} · ${s.t}</span><br>${s.lede}`;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 4600, hashKey: "pipe" });
$("#next")!.addEventListener("click", () => st.next());
$("#prev")!.addEventListener("click", () => st.prev());
const play = $("#play")!;
let playing = false;
play.addEventListener("click", () => {
  playing = !playing;
  if (playing) st.play();
  else st.pause();
  play.textContent = playing ? "❚❚ pause" : "▶ play";
});
const stopPlay = (): void => {
  playing = false;
  play.textContent = "▶ play";
};
for (const el of [$("#next")!, $("#prev")!]) el.addEventListener("click", stopPlay);

// ── the classifier cases (SKILL.md §1 gate and §3 table, restated as examples) ──
type Tone = "skip" | "update" | "create" | "delete" | "stop";
interface Case {
  name: string;
  verb: string;
  tone: Tone;
  webex: string;
  google: string;
  why: string;
}
const CASES: Case[] = [
  {
    name: "native",
    verb: "SKIP",
    tone: "skip",
    webex: "Design sync · 09:30–10:00\nlink: join-link-A",
    google: "Design sync · 09:30–10:00 (not a mirror)\nsame title or same join link",
    why: "It is already on the calendar, put there by you or by Google's own invite. Mirroring it would double it. If an event is both native and mirrored, the plan proposes deleting the mirror: the native one wins.",
  },
  {
    name: "unchanged",
    verb: "SKIP",
    tone: "skip",
    webex: "Sprint planning · 11:00–11:30\nlink: join-link-B",
    google: "[Webex] Sprint planning · 11:00–11:30\nMIRRORED-FROM-WEBEX | link-B | 11:00",
    why: "The mirror matches on (link, start) and its title, end and location are the same. Nothing to do.",
  },
  {
    name: "update",
    verb: "UPDATE",
    tone: "update",
    webex: "Sprint planning (retitled) · 11:00–11:45\nlink: join-link-B",
    google: "[Webex] Sprint planning · 11:00–11:30\nMIRRORED-FROM-WEBEX | link-B | 11:00",
    why: "Same identity, (link, start), but the title, end or organizer differs. The mirror is edited in place.",
  },
  {
    name: "moved",
    verb: "UPDATE TIMES",
    tone: "update",
    webex: "Vendor demo · 15:30 (was 14:00)\nlink: join-link-C",
    google: "[Webex] Vendor demo · 14:00\nMIRRORED-FROM-WEBEX | link-C | 14:00",
    why: "A new start time breaks the (link, start) identity: neither side finds its partner. So an unmatched mirror and an unmatched Webex event that share a link, or a title, on the same date are paired, and the mirror's times are updated.",
  },
  {
    name: "create",
    verb: "CREATE",
    tone: "create",
    webex: "Retro · 16:00–16:30\nlink: join-link-D",
    google: "nothing matches",
    why: "A Webex event that matches no event and no mirror on Google is new. A mirror is created in the standard shape, with no attendees and no notification.",
  },
  {
    name: "cancelled",
    verb: "DELETE",
    tone: "delete",
    webex: "nothing matches",
    google: "[Webex] Offsite · 10:00 (before listEnd)\nMIRRORED-FROM-WEBEX | link-E | 10:00",
    why: "The mirror is dated inside the range Webex actually showed, and Webex no longer has it. That is the one situation where absence means cancelled. Only events starting with the marker can be deleted.",
  },
  {
    name: "past the edge",
    verb: "KEEP",
    tone: "skip",
    webex: "nothing matches (the list ended before this day)",
    google: "[Webex] Planning day · on or after listEnd",
    why: "Webex's list reaches about a month ahead and stops. A mirror dated on or after listEnd matches nothing only because the list ran out, so it stays. This is the rule that stops the end of a window from deleting the future.",
  },
  {
    name: "partial read",
    verb: "NO WRITES",
    tone: "stop",
    webex: "errors[] is non-empty, or events[] is empty",
    google: "(never looked at)",
    why: "If a row could not be read, a meeting that exists looks like one that does not. The skill stops before touching Google at all, because every other rule above would be reasoning from a hole.",
  },
];

const TONE: Record<Tone, string> = {
  skip: "var(--muted)",
  update: "var(--warn)",
  create: "var(--mirror)",
  delete: "var(--danger)",
  stop: "var(--danger)",
};

const cases = $("#cases")!;
const verdict = $("#verdict")!;
const whybox = $("#whybox")!;
const nl = (t: string): string => esc(t).replaceAll("\n", "<br>");
const pick = (i: number): void => {
  const c = CASES[i]!;
  verdict.innerHTML =
    `<div class="side"><div class="l">WEBEX SAYS</div>${nl(c.webex)}</div>` +
    `<div class="side"><div class="l">GOOGLE HAS</div>${nl(c.google)}</div>`;
  whybox.style.borderLeftColor = TONE[c.tone];
  whybox.innerHTML = `<b style="color:${TONE[c.tone]};font-family:var(--mono);letter-spacing:.08em">${esc(c.verb)}</b> &nbsp;${esc(c.why)}`;
  cases
    .querySelectorAll("button")
    .forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
};
cases.innerHTML = CASES.map(
  (c, i) =>
    `<button data-viz-id="case-${i}" data-label="classifier case: ${esc(c.name)}"><span>${esc(c.name)}</span><span class="v" style="color:${TONE[c.tone]}">${esc(c.verb)}</span></button>`,
).join("");
cases.querySelectorAll("button").forEach((b, i) => b.addEventListener("click", () => pick(i)));
pick(3);
