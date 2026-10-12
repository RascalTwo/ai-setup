import { arrowMarkers, connect, stepper, $, $$, esc } from "@viz/kit";

interface Style {
  id: string;
  name: string;
  family: string;
  medium: string;
  nearest: string;
  hero: string;
  drawFilm: string;
  askEx: string;
}
interface Music {
  id: string;
  style: string;
  mood: string;
  master: string;
  lufs: number;
  tp: number;
  onsets: number;
  centroid: number;
}
interface MusicStyle {
  id: string;
  lo: number;
  hi: number;
  note: string;
  master: string;
}
interface PipeStep {
  name: string;
  sub: string;
  detail: string;
  gate?: boolean;
}
interface KindMedia {
  type: string;
  src: string;
  cap: string;
  html: string;
  muted?: boolean;
}
interface IntakeState {
  kind: string;
  style: string;
  shape: string;
  secs: number;
  music: string;
  mood: string;
  fps: number;
  chars: string;
  subject: string;
}
interface Kind {
  id: string;
  name: string;
  typS: number;
  len: string;
  gates: number;
  gateNames: string;
  motion: number;
  sound: number;
  interactive: number;
  workflow: string;
  what: string;
  steps: string[];
  media: KindMedia | null;
  askEx: string;
  askT: string;
  ask: (st: IntakeState, snd: string, fmt: (s: number) => string) => string;
}
interface Character {
  name: string;
  type: string;
  src: string;
  module: string;
  what: string;
}
interface Interactive {
  name: string;
  src: string;
  what: string;
  try: string;
  embed: string;
}
interface Tool {
  id: string;
  short: string;
  row: number;
  col?: number;
  to?: string[];
  what: string;
  usage: string;
}
interface GateRun {
  name: string;
  checks: [number, string][];
  note: string;
}
interface Data {
  styles: Style[];
  music: Music[];
  musicStyles: MusicStyle[];
  moods: string[];
  refusedBlends: [string, string][];
  pipeline: PipeStep[];
  kinds: Kind[];
  characters: Character[];
  charChecks: string[];
  interactive: Interactive[];
  inputs: string[];
  tools: Tool[];
  gateRuns: GateRun[];
  cheat: [string, string][];
}

const dataRes = await fetch("data.json");
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- data.json is our own file shipped with the page; this is the one place its shape is declared
const data = (await dataRes.json()) as Data;

let audio: HTMLAudioElement | null = null,
  playingId: string | null = null;
function stopAudio() {
  if (audio) {
    audio.pause();
    audio = null;
  }
  playingId = null;
  $$(".pt").forEach((p) => p.classList.remove("playing"));
}

// ───────────────── chapter stepper
const chs = $$("section.ch");
const seen = new Set();
$("#chaps")!.innerHTML = chs
  .map(
    (c, i) =>
      `<button class="chap" data-i="${i}"><b>${i + 1}</b>${esc(c.dataset["title"])}</button>`,
  )
  .join("");
const onStep = (i: number) => {
  chs.forEach((c, j) => {
    c.classList.toggle("on", j === i);
  });
  seen.add(i);
  $$(".chap").forEach((b, j) => {
    b.classList.toggle("on", j === i);
    b.classList.toggle("seen", seen.has(j));
  });
  $("#pos")!.textContent = `${i + 1} / ${chs.length}`;
  $("#bar")!.style.width = `${((i + 1) / chs.length) * 100}%`;
  $$("video").forEach((v) => {
    if (!chs[i]!.contains(v) && !v.muted) v.pause();
  });
  if (i !== 5) stopAudio();
  window.scrollTo({ top: 0 });
  if (i === 6 && !$<HTMLIFrameElement>("#intFrame")!.src) pickInt(0);
};
const nav = stepper({ n: chs.length, onStep, autoplayMs: 45000 });
nav.pause();
$("#prev")!.addEventListener("click", () => nav.prev());
$("#next")!.addEventListener("click", () => nav.next());
$$(".chap").forEach((b) => {
  b.addEventListener("click", () => nav.go(+b.dataset["i"]!));
});
let touring = false;
$("#tour")!.addEventListener("click", () => {
  touring = !touring;
  if (touring) nav.play();
  else nav.pause();
  $("#tour")!.textContent = touring ? "❚❚ Pause tour" : "▶ Tour";
});
onStep(nav.current);

// ───────────────── 1. pipeline
{
  const P = data.pipeline,
    w = 116,
    h = 62,
    gap = 20,
    y = 30;
  const nodes = P.map((p, i) => ({ ...p, x: 10 + i * (w + gap), y, w, h }));
  const W = nodes.at(-1)!.x + w + 10;
  let s = `<svg viewBox="0 0 ${W} 130" role="img" aria-label="anidoodle production pipeline">${arrowMarkers()}`;
  nodes.forEach((n, i) => {
    if (i)
      s += `<path d="${connect(nodes[i - 1]!, n)}" stroke="var(--muted)" fill="none" marker-end="url(#ah)"/>`;
  });
  nodes.forEach((n, i) => {
    s += `<g class="pnode ${n.gate ? "gatey" : ""}" data-i="${i}" data-viz-id="pipe-${i}" data-label="${esc(n.name)}"><rect x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="8"/>
      <text x="${n.x + w / 2}" y="${n.y + 26}" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="600">${esc(n.name)}</text>
      <text x="${n.x + w / 2}" y="${n.y + 45}" text-anchor="middle" fill="var(--faint)" font-size="10.5">${esc(n.sub)}</text>
      ${n.gate ? `<text x="${n.x + w / 2}" y="${n.y - 8}" text-anchor="middle" fill="var(--accent)" font-size="11" font-weight="700">✋ approval</text>` : ""}</g>`;
  });
  s += `<text x="10" y="122" fill="var(--faint)" font-size="11">stills stop after “Look still” · loops add a seam check · films run the whole line · mechanical checks run continuously while building</text></svg>`;
  $("#pipe")!.innerHTML = s;
  const pick = (i: number) => {
    $$(".pnode").forEach((g, j) => {
      g.classList.toggle("sel", j === i);
    });
    const n = P[i]!;
    $("#pipeDetail")!.innerHTML =
      `<b>${esc(n.name)}</b>${n.gate ? '<span class="gate">APPROVAL</span>' : ""}<p style="margin:6px 0 0;color:var(--muted)">${n.detail}</p>`;
  };
  $$(".pnode").forEach((g) => {
    g.addEventListener("click", () => pick(+g.dataset["i"]!));
  });
  pick(0);
}

// ───────────────── 2. intake builder
{
  const st: IntakeState = {
    kind: "film",
    style: "woodcut",
    shape: "16x9",
    secs: 45,
    music: "nocturne",
    mood: "wistful",
    fps: 30,
    chars: "none",
    subject: "a lighthouse keeper's last night",
  };
  const shapes: Record<string, [number, number]> = {
    "1x1": [1080, 1080],
    "9x16": [1080, 1920],
    "16x9": [1920, 1080],
    "4x5": [1080, 1350],
  };
  const opt = (arr: [string, string][], v: string) =>
    arr
      .map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(l)}</option>`)
      .join("");
  const K = data.kinds;
  $("#intake")!.innerHTML = `
    <dt>1 · What?</dt><dd><select id="iKind">${opt(
      K.map((k) => [k.id, k.name]),
      st.kind,
    )}</select></dd>
    <dt>Subject</dt><dd><input id="iSubj" value="${esc(st.subject)}" style="width:100%"></dd>
    <dt>2 · Style</dt><dd><select id="iStyle">${opt(
      data.styles.map((s) => [s.id, `${s.name} (${s.family})`]),
      st.style,
    )}</select></dd>
    <dt>3 · Shape</dt><dd class="chipset" id="iShape">${Object.keys(shapes)
      .map((k) => `<button class="chipbtn" data-v="${k}">${k}</button>`)
      .join("")}</dd>
    <dt>4 · Length</dt><dd><input id="iLen" type="range" min="0" max="100" style="width:70%"> <span id="iLenV" class="mono"></span></dd>
    <dt>5 · Sound</dt><dd><select id="iMusic"><option value="">silent</option>${opt(
      data.musicStyles.map((m) => [m.id, m.id]),
      st.music,
    )}</select> mood <select id="iMood">${opt(
      data.moods.map((m) => [m, m]),
      st.mood,
    )}</select></dd>
    <dt>fps</dt><dd class="chipset" id="iFps">${[30, 24, 12].map((f) => `<button class="chipbtn" data-v="${f}">${f}</button>`).join("")}</dd>
    <dt>6 · Characters</dt><dd><select id="iChar">${opt(
      [
        ["none", "none"],
        ["mira", "Mira (existing module)"],
        ["theo", "Theo (existing module)"],
        ["new", "a new one, built once"],
        ["image", "one from my image"],
      ],
      st.chars,
    )}</select></dd>`;
  const toS = (v: number) =>
      Math.round(Math.exp(Math.log(1) + (v / 100) * (Math.log(1200) - Math.log(1)))),
    fromS = (s: number) => Math.round((Math.log(s) / Math.log(1200)) * 100);
  const fmt = (s: number) =>
    s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60 ? (s % 60) + " s" : ""}`;
  $<HTMLInputElement>("#iLen")!.value = String(fromS(st.secs));
  const render = () => {
    const k = K.find((x) => x.id === st.kind)!,
      sty = data.styles.find((s) => s.id === st.style)!;
    const still = k.id === "still" || k.id === "character" || k.id === "adapt";
    const secs = still ? 0 : st.secs,
      [W, H] = shapes[st.shape]!;
    $$("#iShape .chipbtn").forEach((b) => {
      b.classList.toggle("on", b.dataset["v"] === st.shape);
    });
    $$("#iFps .chipbtn").forEach((b) => {
      b.classList.toggle("on", Number(b.dataset["v"]) === st.fps);
    });
    $("#iLenV")!.textContent = still ? "one frame" : fmt(st.secs);
    $<HTMLInputElement>("#iLen")!.disabled = still;
    const bpm = st.fps === 24 ? 120 : st.fps === 12 ? 120 : 120,
      beat = (60 * st.fps) / bpm,
      frames = Math.max(1, Math.round(secs * st.fps));
    const sc = 170 / Math.max(W, H),
      rw = W * sc,
      rh = H * sc;
    $("#shapePreview")!.innerHTML = `<div style="display:flex;gap:16px;align-items:center">
      <svg width="190" height="190" viewBox="0 0 190 190" data-viz-id="shape-frame" data-label="Frame at ${W}x${H}"><rect x="${(190 - rw) / 2}" y="${(190 - rh) / 2}" width="${rw}" height="${rh}" fill="#0b0907" stroke="var(--accent)" stroke-width="1.5"/>
      <image href="media/styles/${sty.id}.jpg" x="${(190 - rw) / 2}" y="${(190 - rh) / 2}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid slice"/></svg>
      <dl class="kv"><dt>Canvas</dt><dd class="mono">${W} × ${H}</dd><dt>Frames</dt><dd class="mono">${frames.toLocaleString()} @ ${st.fps} fps</dd>${still ? "" : `<dt>Beat</dt><dd class="mono">${beat} frames (120 bpm) · ${Math.round(frames / beat)} beats</dd><dt>Cuts</dt><dd>on multiples of ${beat}; events on multiples of 5</dd>`}<dt>Hand</dt><dd>${esc(sty.name)}: <span class="hint">${esc(sty.medium.slice(0, 90))}…</span></dd></dl></div>`;
    const flag = still
      ? `--still ${camel(st.subject)}`
      : `--film ${camel(st.subject)} --duration ${secs} --fps ${st.fps}`;
    const snd = st.music ? `${st.music}, ${st.mood}` : "silent";
    $("#intakeOut")!.innerHTML = `
      <div class="say">“/anidoodle ${esc(k.ask(st, snd, fmt))}”</div>
      <h3>The brief it writes</h3>
      <div class="cmd">kind:   ${k.name}
idea:   ${st.subject}
style:  ${sty.name} (${sty.id}), because it fits the subject  ← agent's pick, veto in one line
shape:  ${st.shape} (${W}x${H})
length: ${still ? "one frame" : fmt(secs)}
sound:  ${snd}
chars:  ${st.chars}</div>
      <h3>Then</h3>
      <dl class="kv"><dt>Reads</dt><dd><code>${k.workflow}</code></dd><dt>Approvals</dt><dd>${k.gates} ${k.gates ? `(${k.gateNames})` : ""}</dd></dl>
      <div class="cmd" style="margin-top:8px">node &lt;skill&gt;/engine/tools/scaffold.mjs ~/art ${flag} --format ${st.shape}
node tools/still.mjs ${camel(st.subject)} --out out/look.png --scale 2
${still ? "" : `node tools/render.mjs ${camel(st.subject)}          # MP4${st.music ? " with the score" : ""}\nnode tools/gate.mjs ${camel(st.subject)}            # determinism · contract · dead air`}</div>`;
  };
  const camel = (s: string) =>
    s
      .toLowerCase()
      .replaceAll(/[^a-z0-9 ]/gu, "")
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 3)
      .map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join("") || "piece";
  data.kinds.forEach((k) => {
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-type-assertion -- askT is a JS template literal from our own data.json; replacing it with a parser is a rewrite
    k.ask = new Function("st", "snd", "fmt", `return \`${k.askT}\`;`) as Kind["ask"];
  });
  const bind = (sel: string, ev: "change" | "input", set: (v: string) => void) => {
    const el = $<HTMLInputElement | HTMLSelectElement>(sel)!;
    el.addEventListener(ev, () => {
      set(el.value);
      render();
    });
  };
  bind("#iKind", "change", (v) => {
    st.kind = v;
  });
  bind("#iSubj", "input", (v) => {
    st.subject = v;
  });
  bind("#iStyle", "change", (v) => {
    st.style = v;
  });
  bind("#iMusic", "change", (v) => {
    st.music = v;
  });
  bind("#iMood", "change", (v) => {
    st.mood = v;
  });
  bind("#iChar", "change", (v) => {
    st.chars = v;
  });
  bind("#iLen", "input", (v) => {
    st.secs = toS(+v);
  });
  $$("#iShape .chipbtn").forEach((b) => {
    b.addEventListener("click", () => {
      st.shape = b.dataset["v"]!;
      render();
    });
  });
  $$("#iFps .chipbtn").forEach((b) => {
    b.addEventListener("click", () => {
      st.fps = +b.dataset["v"]!;
      render();
    });
  });
  render();
}

// ───────────────── 3. styles gallery
{
  const fams = [...new Set(data.styles.map((s) => s.family))].toSorted(
    (a, b) =>
      data.styles.filter((s) => s.family === b).length -
        data.styles.filter((s) => s.family === a).length || a.localeCompare(b),
  );
  const pal = [
    "#e5a55a",
    "#6cb6ff",
    "#8ddb8c",
    "#d2a8ff",
    "#56d4dd",
    "#ff9bce",
    "#f2cc60",
    "#a5b4fc",
    "#ff938a",
    "#b3e6a0",
    "#c9b39a",
    "#7ee0c3",
    "#f0a8d0",
    "#9fc3ff",
    "#e8c07a",
    "#c7a0ff",
    "#86d0a6",
    "#ffb86b",
    "#b0b0ff",
  ];
  const col = Object.fromEntries(fams.map((f, i) => [f, pal[i % pal.length]]));
  const on = new Set(fams);
  const max = Math.max(...fams.map((f) => data.styles.filter((s) => s.family === f).length));
  $("#fams")!.innerHTML =
    fams
      .map((f) => {
        const n = data.styles.filter((s) => s.family === f).length;
        return `<div class="fam" data-f="${esc(f)}" title="${esc(f)}: ${n}" data-viz-id="fam-${esc(f)}" data-label="${esc(f)}: ${n} styles"><i style="height:${(n / max) * 56}px;background:${col[f]}"></i></div>`;
      })
      .join("") +
    `<div class="hint" style="margin-left:10px;align-self:center">bar height = styles in that family (tallest = ${max})</div>`;
  $("#famlegend")!.innerHTML =
    fams
      .map(
        (f) =>
          `<label data-f="${esc(f)}"><span class="sw" style="background:${col[f]}"></span>${esc(f)} (${data.styles.filter((s) => s.family === f).length})</label>`,
      )
      .join("") + `<label data-f="*" style="color:var(--accent)">show all</label>`;
  const applyF = () => {
    $$(".tile").forEach((t) => {
      t.classList.toggle("dim", !on.has(t.dataset["f"]!));
    });
    $$("#famlegend label").forEach((l) => {
      l.classList.toggle("off", l.dataset["f"] !== "*" && !on.has(l.dataset["f"]!));
    });
  };
  const solo = (f: string) => {
    if (f === "*" || (on.size === 1 && on.has(f)))
      fams.forEach((x) => {
        on.add(x);
      });
    else {
      on.clear();
      on.add(f);
    }
    applyF();
  };
  $$(".fam, #famlegend label").forEach((el) => {
    el.addEventListener("click", () => solo(el.dataset["f"]!));
  });
  const ordered = data.styles.toSorted(
    (a, b) => fams.indexOf(a.family) - fams.indexOf(b.family) || a.name.localeCompare(b.name),
  );
  $("#tiles")!.innerHTML = ordered
    .map(
      (
        s,
      ) => `<div class="tile" data-id="${s.id}" data-f="${esc(s.family)}" data-viz-id="style-${s.id}" data-label="${esc(s.name)}">
    <span class="band" style="background:${col[s.family]}"></span>
    <div class="img" style="background-image:url(media/styles/${s.id}.jpg)"><video muted loop playsinline preload="none" data-src="media/styles/${s.id}.webm"></video></div>
    <div class="nm">${esc(s.name)}<small>${esc(s.family)}</small></div></div>`,
    )
    .join("");
  $$(".tile").forEach((t) => {
    const v = $("video", t)!;
    t.addEventListener("mouseenter", () => {
      if (!v.src) v.src = v.dataset["src"]!;
      v.currentTime = 0;
      v.play().catch(() => {
        /* autoplay refused: the still stays */
      });
    });
    t.addEventListener("mouseleave", () => v.pause());
    t.addEventListener("click", () => pickStyle(t.dataset["id"]!));
  });
  const pickStyle = (id: string) => {
    const s = data.styles.find((x) => x.id === id)!;
    $$(".tile").forEach((t) => {
      t.classList.toggle("sel", t.dataset["id"] === id);
    });
    const near = data.styles.find(
      (x) => s.nearest.startsWith(x.id) || s.nearest.startsWith(x.name.toLowerCase()),
    );
    $("#styleDetail")!.innerHTML = `
      <h3 style="margin-top:0"><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${col[s.family]}"></span> ${esc(s.name)} <span class="hint mono">${s.id}</span></h3>
      <video class="media" id="bigDraw" src="media/styles/${s.id}.webm" muted playsinline autoplay></video>
      <input id="scrubber" type="range" min="0" max="1000" value="0" aria-label="Scrub the timelapse">
      <div class="hint">▶ the plate drawing itself · drag to scrub from bare ground (frame 0) to the finished still (last frame, pixel for pixel)</div>
      <dl class="kv" style="margin-top:10px">
        <dt>Medium</dt><dd>${esc(s.medium)}</dd>
        <dt>Hero plate</dt><dd>${esc(s.hero)}</dd>
        <dt>Family</dt><dd>${esc(s.family)}</dd>
        <dt>Nearest hand</dt><dd>${near ? `<a href="#" id="nearLink">${esc(near.name)}</a>` : esc(s.nearest)}</dd>
        <dt>Draw film</dt><dd><code>${s.drawFilm}</code></dd>
      </dl>
      <div class="say" style="margin-top:10px">“/anidoodle ${esc(s.askEx)}”</div>`;
    const v = $<HTMLVideoElement>("#bigDraw")!,
      sc = $<HTMLInputElement>("#scrubber")!;
    v.addEventListener("timeupdate", () => {
      if (!sc.matches(":active") && v.duration)
        sc.value = String((v.currentTime / v.duration) * 1000);
    });
    sc.addEventListener("input", () => {
      v.pause();
      if (v.duration) v.currentTime = (Number(sc.value) / 1000) * v.duration;
    });
    if (near)
      $("#nearLink")!.addEventListener("click", (e) => {
        e.preventDefault();
        pickStyle(near.id);
      });
  };
  applyF();
  pickStyle("woodcut");
}

// ───────────────── 4. kinds
{
  const K = data.kinds,
    maxLog = Math.log10(3600);
  const lenW = (s: number) => (s <= 0 ? 4 : 4 + (Math.log10(s + 1) / maxLog) * 96);
  $("#kinds")!.innerHTML =
    `<tr><th>Kind</th><th>Approvals</th><th>Typical length</th><th title="moves">Mov</th><th title="has sound">Snd</th><th title="interactive">Int</th></tr>` +
    K.map(
      (
        k,
        i,
      ) => `<tr class="row" data-i="${i}" data-viz-id="kind-${k.id}" data-label="${esc(k.name)}"><td><b>${esc(k.name)}</b></td>
      <td><span class="gbar">${[0, 1, 2].map((g) => `<i class="${g < k.gates ? "f" : ""}"></i>`).join("")}</span></td>
      <td><div class="lenbar" style="width:${lenW(k.typS)}px"></div><span class="hint">${esc(k.len)}</span></td>
      <td>${k.motion ? '<span class="dot" style="background:var(--c5)"></span>' : ""}</td><td>${k.sound ? '<span class="dot" style="background:var(--c4)"></span>' : ""}</td><td>${k.interactive ? '<span class="dot" style="background:var(--c8)"></span>' : ""}</td></tr>`,
    ).join("");
  const pick = (i: number) => {
    const k = K[i]!;
    $$("#kinds tr.row").forEach((r, j) => {
      r.classList.toggle("sel", j === i);
    });
    const m = k.media;
    const med = !m
      ? ""
      : m.type === "video"
        ? `<video class="media" src="${m.src}" controls ${m.muted === false ? "" : "muted"} autoplay loop playsinline></video>`
        : m.type === "iframe"
          ? `<iframe class="live" style="height:420px" src="${m.src}"></iframe>`
          : m.type === "timeline"
            ? m.html
            : m.type === "audio"
              ? `<audio controls src="${m.src}" style="width:100%"></audio>`
              : `<img class="media" src="${m.src}" alt="${esc(k.name)} example">`;
    $("#kindDetail")!.innerHTML =
      `<h3 style="margin-top:0">${esc(k.name)}</h3><p style="color:var(--muted);margin:0 0 10px">${k.what}</p>${med}<div class="cap">${m ? m.cap : ""}</div>
      <ol class="steps">${k.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      <dl class="kv" style="margin-top:8px"><dt>Workflow</dt><dd><code>${k.workflow}</code></dd><dt>Approvals</dt><dd>${k.gates} ${k.gates ? `(${k.gateNames})` : ""}</dd></dl>
      <div class="say" style="margin-top:10px">“/anidoodle ${esc(k.askEx)}”</div>`;
  };
  $$("#kinds tr.row").forEach((r) => {
    r.addEventListener("click", () => pick(+r.dataset["i"]!));
  });
  pick(0);
}

// ───────────────── 5. characters
{
  const C = data.characters;
  $("#charPick")!.innerHTML = C.map(
    (c, i) => `<button class="chipbtn" data-i="${i}">${esc(c.name)}</button>`,
  ).join("");
  const pick = (i: number) => {
    const c = C[i]!;
    $$("#charPick .chipbtn").forEach((b, j) => {
      b.classList.toggle("on", j === i);
    });
    $("#charMedia")!.innerHTML =
      c.type === "video"
        ? `<video class="media" src="${c.src}" autoplay loop muted playsinline></video>`
        : `<a href="${c.src}" target="_blank"><img class="media" src="${c.src}" alt="${esc(c.name)}" style="background:var(--paper)"></a>`;
    $("#charInfo")!.innerHTML =
      `<h3 style="margin-top:0">${esc(c.name)}</h3><p style="color:var(--muted);margin-top:0">${c.what}</p><div class="hint">module: <code>${c.module}</code> · click the image to open it full size</div>`;
  };
  $$("#charPick .chipbtn").forEach((b) => {
    b.addEventListener("click", () => pick(+b.dataset["i"]!));
  });
  pick(0);
  $("#charChecks")!.innerHTML = data.charChecks
    .map((c) => `<span class="chipbtn" style="cursor:default">✓ ${esc(c)}</span>`)
    .join("");
}

// ───────────────── 6. music
{
  const M = data.music,
    W = 560,
    H = 360,
    L = 50,
    R = 20,
    T = 16,
    B = 46;
  const xMax = 4.5,
    yMin = 300,
    yMax = 5000;
  const X = (v: number) => L + (v / xMax) * (W - L - R),
    Y = (v: number) =>
      T + (1 - (Math.log(v) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin))) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Music pieces by busyness and brightness">`;
  [0, 1, 2, 3, 4].forEach((v) => {
    s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="var(--border)"/><text x="${X(v)}" y="${H - B + 16}" fill="var(--faint)" font-size="11" text-anchor="middle">${v}</text>`;
  });
  [300, 500, 1000, 2000, 4000].forEach((v) => {
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)"/><text x="${L - 6}" y="${Y(v) + 4}" fill="var(--faint)" font-size="11" text-anchor="end">${v >= 1000 ? v / 1000 + "k" : v}</text>`;
  });
  s += `<text x="${(L + W - R) / 2}" y="${H - 8}" fill="var(--muted)" font-size="12" text-anchor="middle">note onsets per second → busier</text><text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" fill="var(--muted)" font-size="12" text-anchor="middle">spectral centroid, Hz (log) → brighter</text>`;
  M.forEach((m) => {
    const c =
      m.id === "ghostFixture" ? "var(--danger)" : m.master === "dense" ? "var(--c8)" : "var(--c5)";
    const r = 7 + (m.lufs + 17) * 2.2,
      [dx, dy, anchor] = (
        {
          bellsHopeful: [-1, -12, "end"],
          guitarWistful: [1, 14, "start"],
          harpTender: [1, 8, "start"],
          folkCalm: [1, -8, "start"],
          chiptunePlayful: [-1, -12, "end"],
          driveElectronic: [-1, 22, "end"],
          minorPianoMelancholy: [-1, 4, "end"],
        } as Record<string, [number, number, string]>
      )[m.id] ?? [1, 4, "start"];
    s += `<g class="pt" data-id="${m.id}" data-viz-id="music-${m.id}" data-label="${esc(m.id)}"><circle cx="${X(m.onsets)}" cy="${Y(m.centroid)}" r="${r}" fill="${c}" fill-opacity=".75"/><text x="${X(m.onsets) + dx * (r + 4)}" y="${Y(m.centroid) + dy}" text-anchor="${anchor}" fill="var(--text)" font-size="11.5">${esc(m.id)}</text></g>`;
  });
  s += `<g transform="translate(${W - 180} ${H - B - 62})"><circle cx="6" cy="6" r="6" fill="var(--c5)"/><text x="16" y="10" fill="var(--muted)" font-size="11">gentle master (−16 LUFS)</text><circle cx="6" cy="24" r="8" fill="var(--c8)"/><text x="18" y="28" fill="var(--muted)" font-size="11">dense master (−14 LUFS)</text><text x="0" y="46" fill="var(--faint)" font-size="10.5">dot size = measured loudness</text></g></svg>`;
  $("#scatter")!.innerHTML = s;
  $$(".pt").forEach((p) => {
    p.addEventListener("click", () => {
      const id = p.dataset["id"]!,
        was = playingId === id;
      stopAudio();
      if (was) return;
      const m = M.find((x) => x.id === id)!;
      audio = new Audio(`media/music/${id}.m4a`);
      audio.play().catch((e: unknown) => {
        console.error(e);
      });
      playingId = id;
      p.classList.add("playing");
      audio.addEventListener("ended", () => stopAudio());
      $("#nowPlaying")!.innerHTML =
        `▶ <b>${esc(id)}</b> (${esc(m.style)}, ${esc(m.mood)}) · measured ${m.lufs} LUFS · true peak ${m.tp} dBTP · ${m.onsets} onsets/s · centroid ${m.centroid} Hz · click again to stop`;
    });
  });

  // tempo ranges
  const S = data.musicStyles,
    tw = 560,
    rowH = 24,
    tL = 96,
    tMin = 40,
    tMax = 190;
  const TX = (v: number) => tL + ((v - tMin) / (tMax - tMin)) * (tw - tL - 96);
  let t = `<svg viewBox="0 0 ${tw} ${S.length * rowH + 30}" role="img" aria-label="Tempo range per music style">`;
  [60, 90, 120, 150, 180].forEach((v) => {
    t += `<line x1="${TX(v)}" x2="${TX(v)}" y1="0" y2="${S.length * rowH}" stroke="var(--border)"/><text x="${TX(v)}" y="${S.length * rowH + 16}" fill="var(--faint)" font-size="11" text-anchor="middle">${v}</text>`;
  });
  S.forEach((m, i) => {
    const y = i * rowH + 5,
      c = m.master === "dense" ? "var(--c8)" : "var(--c5)";
    t += `<g data-viz-id="tempo-${m.id}" data-label="${esc(m.id)} ${m.lo}-${m.hi} bpm"><text x="${tL - 8}" y="${y + 12}" fill="var(--text)" font-size="12" text-anchor="end">${esc(m.id)}</text><rect x="${TX(m.lo)}" y="${y}" width="${TX(m.hi) - TX(m.lo)}" height="15" rx="4" fill="${c}" fill-opacity=".8"/><text x="${TX(m.hi) + 5}" y="${y + 12}" fill="var(--faint)" font-size="10.5">${esc(m.note || "")}</text></g>`;
  });
  t += `<text x="${tL}" y="${S.length * rowH + 28}" fill="var(--muted)" font-size="11">bpm · colour = master type (teal gentle, magenta dense)</text></svg>`;
  $("#tempo")!.innerHTML = t;

  // mood wheel
  const MO = data.moods,
    cx = 200,
    cy = 170,
    rr = 128;
  const pos = Object.fromEntries(
    MO.map((m, i): [string, [number, number]] => {
      const a = (i / MO.length) * Math.PI * 2 - Math.PI / 2;
      return [m, [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]];
    }),
  );
  let w = `<svg viewBox="0 0 400 340" role="img" aria-label="Moods and refused blends">`;
  data.refusedBlends.forEach(([a, b]) => {
    if (pos[a] && pos[b])
      w += `<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" stroke="var(--danger)" stroke-width="2" stroke-dasharray="5 4"/>`;
  });
  MO.forEach((m) => {
    const [x, y] = pos[m]!;
    w += `<g data-viz-id="mood-${m}" data-label="${m}"><circle cx="${x}" cy="${y}" r="5" fill="var(--accent)"/><text x="${x + (x > cx ? 9 : -9)}" y="${y + 4}" fill="var(--text)" font-size="12" text-anchor="${x > cx ? "start" : "end"}">${m}</text></g>`;
  });
  w += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--muted)" font-size="12">a section's mood</text><text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="var(--faint)" font-size="11">or a blend [a, b, weight]</text></svg>`;
  $("#moods")!.innerHTML = w;
}

// ───────────────── 7. interactive
function pickInt(i: number) {
  const I = data.interactive[i]!;
  $$("#intPick .chipbtn").forEach((b, j) => {
    b.classList.toggle("on", j === i);
  });
  $<HTMLIFrameElement>("#intFrame")!.src = I.src;
  $("#intInfo")!.innerHTML =
    `<h3 style="margin-top:0">${esc(I.name)}</h3><p style="color:var(--muted);margin-top:0">${I.what}</p><div class="say">Try: ${I.try}</div>
    <h3>How it goes on your page</h3><div class="cmd">${esc(I.embed)}</div>
    <h3>What the art can see</h3><div class="chipset">${data.inputs.map((x) => `<span class="chipbtn" style="cursor:default">${esc(x)}</span>`).join("")}</div>
    <p class="cap">Gated with <code>replay.mjs</code>: scripted desktop and touch sessions at DPR 2, replayed reversed, forward and cold with identical hashes; an empty log equals the rest state; reduced motion is honoured. <code>record-interactive.mjs</code> turns a scripted choreography (glide, click, type, scroll) into a frame-exact demo MP4.</p>`;
}
$("#intPick")!.innerHTML = data.interactive
  .map((x, i) => `<button class="chipbtn" data-i="${i}">${esc(x.name)}</button>`)
  .join("");
$$("#intPick .chipbtn").forEach((b) => {
  b.addEventListener("click", () => pickInt(+b.dataset["i"]!));
});

// ───────────────── 8. engine
{
  const T = data.tools,
    cols = 6,
    bw = 176,
    bh = 44,
    gx = 14,
    gy = 26;
  const nodes = T.map((t, i) => ({
    ...t,
    x: 10 + (t.col ?? i % cols) * (bw + gx),
    y: 22 + (t.row ?? Math.floor(i / cols)) * (bh + gy),
    w: bw,
    h: bh,
  }));
  const W = 10 + cols * (bw + gx),
    H = 22 + (Math.max(...nodes.map((n) => n.row)) + 1) * (bh + gy);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="anidoodle engine tools">${arrowMarkers()}`;
  ["build", "check", "ship", "study"].forEach((lane, r) => {
    s += `<text x="10" y="${16 + r * (bh + gy)}" fill="var(--faint)" font-size="10.5" letter-spacing=".08em">${lane.toUpperCase()}</text>`;
  });
  nodes.forEach((n) =>
    (n.to ?? []).forEach((t) => {
      s += `<path d="${connect(n, byId[t]!)}" stroke="var(--muted)" fill="none" marker-end="url(#ah)" opacity=".7"/>`;
    }),
  );
  nodes.forEach((n, i) => {
    s += `<g class="pnode" data-i="${i}" data-viz-id="tool-${n.id}" data-label="${esc(n.id)}"><rect x="${n.x}" y="${n.y}" width="${bw}" height="${bh}" rx="7"/><text x="${n.x + bw / 2}" y="${n.y + 19}" text-anchor="middle" fill="var(--text)" font-size="11.5" font-family="var(--mono)">${esc(n.id)}</text><text x="${n.x + bw / 2}" y="${n.y + 34}" text-anchor="middle" fill="var(--faint)" font-size="10.5">${esc(n.short)}</text></g>`;
  });
  s += `</svg>`;
  $("#tools")!.innerHTML = s;
  const pick = (i: number) => {
    $$("#tools .pnode").forEach((g, j) => {
      g.classList.toggle("sel", j === i);
    });
    const n = T[i]!;
    $("#toolDetail")!.innerHTML =
      `<b class="mono">${esc(n.id)}</b> <span style="color:var(--muted)">· ${n.what}</span><div class="cmd" style="margin-top:8px">${esc(n.usage)}</div>`;
  };
  $$("#tools .pnode").forEach((g) => {
    g.addEventListener("click", () => pick(+g.dataset["i"]!));
  });
  pick(0);

  // shapes to scale
  const F: [string, number, number, string][] = [
    ["1x1", 1080, 1080, "social"],
    ["4x5", 1080, 1350, "feed portrait"],
    ["9x16", 1080, 1920, "Reels · Shorts · TikTok"],
    ["16x9", 1920, 1080, "web hero · YouTube"],
    ["1200x630", 1200, 630, "social card"],
    ["2550x3300", 2550, 3300, "letter @ 300 dpi"],
  ];
  const k = 0.045;
  let x = 8,
    sh = `<svg viewBox="0 0 640 200" role="img" aria-label="Formats drawn to scale">`;
  F.forEach(([n, w, h, u]) => {
    const rw = w * k,
      rh = h * k;
    sh += `<g data-viz-id="fmt-${n}" data-label="${n} ${w}x${h}"><rect x="${x}" y="${178 - rh}" width="${rw}" height="${rh}" fill="none" stroke="var(--accent)" stroke-width="1.3"/><text x="${x + rw / 2}" y="192" text-anchor="middle" fill="var(--text)" font-size="11">${n}</text><text x="${x + rw / 2}" y="${178 - rh - 5}" text-anchor="middle" fill="var(--faint)" font-size="9.5">${u}</text></g>`;
    x += rw + 12;
  });
  $("#shapes")!.innerHTML =
    sh +
    `</svg><div class="hint">all rectangles share one scale (pixels) · <code>--scale</code> multiplies at render time: 0.5 thumbnail, 3 print</div>`;

  // gate runs
  const runs = data.gateRuns;
  $("#gateRun")!.innerHTML = runs
    .map((r, i) => `<button class="chipbtn" data-i="${i}">${esc(r.name)}</button>`)
    .join("");
  const pr = (i: number) => {
    $$("#gateRun .chipbtn").forEach((b, j) => {
      b.classList.toggle("on", j === i);
    });
    const r = runs[i]!;
    $("#gateList")!.innerHTML = r.checks
      .map(
        ([ok, t]) =>
          `<span class="${ok ? "p" : "x"}">${ok ? "PASS" : "FAIL"}</span><span>${esc(t)}</span>`,
      )
      .join("");
    $("#gateNote")!.innerHTML = r.note;
  };
  $$("#gateRun .chipbtn").forEach((b) => {
    b.addEventListener("click", () => pr(+b.dataset["i"]!));
  });
  pr(0);
}

// ───────────────── 9. cheat sheet
$("#cheat")!.innerHTML =
  `<tr><th>Say</th><th>You get</th></tr>` +
  data.cheat.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("");
