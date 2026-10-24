// A 3D diff tour (tour "view": "3d", film only): the same hunk panels — highlighting, pointer
// boxes and all — stand in space, laid out by where the code lives. x = the module (first path
// segment under modules/, packages/, …), z = tour order, so the camera walks the change the way
// the narration does. Code that's the same in several modules gets a panel in each. An entry with
// "hunks": [] is an overview: the camera pulls up over everything. Drawn from t on viz-frame.
//
// pr-viz.ts calls tour3d() once the film's scenes are on the stage. The stages below each take
// the `Rig` — the renderers, the scene graph and the panels placed so far — and add one thing.

import { $, $$, esc } from "@viz/kit";
import type { FrameDetail, Hunk, SceneOf } from "./types.js";

type Vec3 = [number, number, number];
type View = { pos: Vec3; look: Vec3 };
type Panel = { x: number; z: number; h: number; w: number; xs?: number[] | null };
type Piece = { files: string[]; same?: boolean; els: Element[]; used?: boolean };

async function loadThree() {
  const THREE = await import("https://esm.sh/three@0.160.0");
  const { CSS3DRenderer, CSS3DObject } =
    await import("https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS3DRenderer.js");
  const { CSS2DRenderer, CSS2DObject } =
    await import("https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js");
  return { THREE, CSS3DRenderer, CSS3DObject, CSS2DRenderer, CSS2DObject };
}
type Three = Awaited<ReturnType<typeof loadThree>>;

type Spot = {
  x: number;
  z: number;
  h: number;
  i: number;
  el: HTMLElement;
  o: InstanceType<Three["CSS3DObject"]>;
};

const W = 1760,
  H = 820,
  COL = 2000,
  ROW = 1300,
  fov = 40,
  FLOOR = -1150;

const modOf = (f: string) => {
  const p = f.split("/");
  return /^(modules|packages|apps|services|libs)$/u.test(p[0]!) ? p[1]! : p[0]!;
};
const div = (cls: string, html = "", css = "") =>
  Object.assign(document.createElement("div"), { className: cls, innerHTML: html, style: css });
const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** What the stages share: the renderers and scene graph, plus the panels placed so far. */
interface Rig {
  three: Three;
  tour: HTMLElement;
  s: SceneOf<"tour">;
  hunkOrder: Map<string, number>;
  entries: Hunk[][];
  mods: string[];
  colX: (m: string) => number;
  renderer: InstanceType<Three["CSS3DRenderer"]>;
  labels: InstanceType<Three["CSS2DRenderer"]>;
  world: InstanceType<Three["THREE"]["Scene"]>;
  cam: InstanceType<Three["THREE"]["PerspectiveCamera"]>;
  panels: (Panel | null)[]; // per entry, what the camera frames: { x, z, h, w }; null for an overview
  spots: Spot[]; // every panel standing, copies included: [{ x, z, h, i }]
  add: (el: HTMLElement, x: number, y: number, z: number, rx?: number) => Spot["o"];
}

/** What tour3d needs from pr-viz.ts: the tour scene, its entries' hunks, and the hunks' file order. */
export interface TourInput {
  s: SceneOf<"tour">;
  entries: Hunk[][];
  hunkOrder: Map<string, number>;
}

function makeRig(three: Three, tour: HTMLElement, input: TourInput): Rig {
  const { THREE, CSS3DRenderer, CSS3DObject, CSS2DRenderer } = three;
  const { entries } = input;
  const mods = [...new Set(entries.flat().map((h) => modOf(h.file)))];
  const renderer = new CSS3DRenderer();
  renderer.setSize(W, H);
  const labels = new CSS2DRenderer(); // screen-size text pinned to 3D points: readable at any distance
  labels.setSize(W, H);
  labels.domElement.className = "t3d-labels";
  tour.append(renderer.domElement, labels.domElement);
  const world = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(fov, W / H, 1, 60000);
  const add = (el: HTMLElement, x: number, y: number, z: number, rx = 0) => {
    const o = new CSS3DObject(el);
    o.position.set(x, y, z);
    o.rotation.x = rx;
    world.add(o);
    return o;
  };
  return {
    three,
    tour,
    ...input,
    mods,
    colX: (m) => (mods.indexOf(m) - (mods.length - 1) / 2) * COL,
    renderer,
    labels,
    world,
    cam,
    panels: [],
    spots: [],
    add,
  };
}

/** Stand each tour entry's hunk panel in its module's lane, and record where the camera frames it. */
function placePanels(rig: Rig) {
  const { tour, s, hunkOrder, entries, colX, panels, spots, add } = rig;
  const lane = (m: string) => rig.mods.indexOf(m);
  const put = (el: HTMLElement, m: string, i: number) => {
    const h = el.offsetHeight,
      w = div("t3d-panel");
    w.append(el);
    spots.push({ x: colX(m), z: -i * ROW, h, i, el: w, o: add(w, colX(m), -h / 2, -i * ROW) });
    return h;
  };
  $$(":scope > .hunk", tour).forEach((hk, i) => {
    const hs = entries[i];
    if (!hs?.length) {
      hk.style.display = "none";
      panels.push(null);
      return;
    }
    const z = -i * ROW;
    // Pieces: each file header and what follows it. Same code in several files goes to every lane
    // that has it; anything else to its own file's lane.
    const pieces: Piece[] = [];
    for (const c of hk.children) {
      const files =
        c.matches(".hfile") &&
        $(".file", c)
          ?.innerHTML.replace(/^only in /u, "")
          .split("<br>");
      if (files)
        pieces.push({ files, same: !!$(".same", c)?.textContent.startsWith("same code"), els: [] });
      (pieces.at(-1) ?? (pieces[0] = { files: [hs[0]!.file], els: [] })).els.push(c);
    }
    // In a lane, pieces stack top to bottom in file order — the imports sit above the code using them.
    const order = (m: string, pc: Piece) =>
      Math.min(
        ...hs
          .filter((h) => modOf(h.file) === m && pc.files.includes(h.file))
          .map((h) => hunkOrder.get(h.id)!),
      );
    const lanes = new Map<string, { pc: Piece; at: number }[]>();
    for (const pc of pieces)
      for (const m of new Set(pc.files.map(modOf))) {
        if (!lanes.has(m)) lanes.set(m, []);
        lanes.get(m)!.push({ pc, at: order(m, pc) });
      }
    const ms = [...lanes.keys()].toSorted((a, b) => lane(a) - lane(b));
    const heights = new Map(
      ms.map((m): [string, number] => {
        const shell = document.createElement("div"); // same attributes, so the same data-b: every lane's pieces arrive together
        for (const { name, value } of hk.attributes) shell.setAttribute(name, value);
        for (const { pc } of lanes.get(m)!.toSorted((a, b) => a.at - b.at)) {
          for (const el of pc.els) shell.append(pc.used ? el.cloneNode(true) : el); // copies: highlights play on each
          pc.used = true;
        }
        tour.append(shell);
        return [m, put(shell, m, i)];
      }),
    );
    hk.remove();
    const x0 = colX(ms[0]!),
      x1 = colX(ms.at(-1)!),
      hmax = Math.max(...heights.values());
    const sameLanes =
      pieces.find((pc) => pc.same) &&
      [...new Set(pieces.find((pc) => pc.same)!.files.map(modOf))].toSorted(
        (a, b) => lane(a) - lane(b),
      );
    if (sameLanes && sameLanes.length > 2) {
      // A helper copied into three or more modules: read the middle copy, the others peeking in either side.
      const mid = sameLanes[Math.floor(sameLanes.length / 2)]!;
      panels.push({ x: colX(mid), z, h: heights.get(mid)!, w: 1480 * 1.3 });
    } else {
      // "order" on the entry reads the lanes in the order the narration names them.
      const seq = (s.entries![i]!.order ?? ms).filter((m) => heights.has(m));
      panels.push({
        x: (x0 + x1) / 2,
        z,
        h: hmax,
        w: x1 - x0 + 1480,
        xs: ms.length > 1 ? seq.map(colX) : null,
      });
    }
  });
}

/** The ground: a lane per module, and each module's own code path painted down its lane from
 * panel to panel, numbered by tour step — lines follow the code, not the camera. */
function paintGround(rig: Rig) {
  const { three, world, entries, mods, colX, spots, add } = rig;
  const depth = entries.length * ROW;
  for (const m of mods) {
    add(
      div("t3d-strip", "", `width:${COL - 120}px;height:${depth + ROW}px`),
      colX(m),
      FLOOR,
      -depth / 2 + ROW / 2,
      -Math.PI / 2,
    );
    const name = new three.CSS2DObject(div("t3d-lane", esc(m).replaceAll("-", "-<br>"))); // broken at hyphens: narrow enough for the lane
    name.position.set(colX(m), FLOOR, ROW * 0.6); // the near end, where the lanes are widest
    world.add(name);
    const path = spots.filter((p) => p.x === colX(m)).toSorted((a, b) => a.i - b.i);
    path.forEach((r, j) => {
      add(div("t3d-stop", String(r.i + 1)), r.x, FLOOR + 2, r.z + 260, -Math.PI / 2);
      const q = path[j + 1];
      if (q)
        add(
          div("t3d-route", "", `width:${r.z - q.z}px`),
          r.x,
          FLOOR + 1,
          (r.z + q.z) / 2 + 260,
          -Math.PI / 2,
        ).rotation.z = Math.PI / 2;
    });
  }
}

/** The route map, in the heading band: a row per module, the tour's steps left to right, each
 * module's code path along its row, the current stops lit and their modules named. */
function routeMap(rig: Rig) {
  const { tour, entries, mods, colX, spots } = rig;
  const SX = 40,
    RY = 26,
    LW = 250,
    mx = (i: number) => LW + 14 + i * SX,
    my = (x: number) => 14 + (x / COL + (mods.length - 1) / 2) * RY;
  const mini = div(
    "t3d-mini",
    `<svg width="${mx(entries.length - 1) + 16}" height="${mods.length * RY + 6}">
    ${mods.map((m, k) => `<text data-m="${k}" x="${LW}" y="${14 + k * RY + 6}">${esc(m)}</text><line x1="${LW + 8}" x2="${mx(entries.length - 1) + 8}" y1="${14 + k * RY}" y2="${14 + k * RY}"/>`).join("")}
    ${mods
      .map((m) => spots.filter((p) => p.x === colX(m)).toSorted((a, b) => a.i - b.i))
      .map((path) => `<polyline points="${path.map((p) => `${mx(p.i)},${my(p.x)}`).join(" ")}"/>`)
      .join("")}
    ${spots.map((p) => `<circle data-i="${p.i}" data-m="${Math.round(p.x / COL + (mods.length - 1) / 2)}" cx="${mx(p.i)}" cy="${my(p.x)}" r="8"/>`).join("")}</svg>`,
  );
  tour.parentNode!.append(mini);
  return { mini, dots: $$("circle", mini) };
}

/** Camera for an entry: straight in (a touch high and to the side, so it reads as 3D), far enough
 * that its panels fit. */
function fitPanel(p: Panel): View {
  const tan = Math.tan(((fov / 2) * Math.PI) / 180);
  const d = Math.max((p.h * 1.12) / 2 / tan, (p.w * 1.08) / 2 / (tan * (W / H)));
  return { pos: [p.x + d * 0.08, -p.h / 2 + d * 0.1, p.z + d], look: [p.x, -p.h / 2, p.z] };
}

/** An overview: up and in front of everything, backed off until every panel's corners are in
 * frame, lane names included, and above the caption band (y > -0.6). */
function overviewView(rig: Rig): View {
  const { three, cam, mods, colX, spots } = rig;
  const xs = spots.map((p) => p.x),
    zs = spots.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const corners = spots
    .flatMap((p): Vec3[] => [
      [p.x - 740, 0, p.z],
      [p.x + 740, 0, p.z],
      [p.x - 740, -p.h, p.z],
      [p.x + 740, -p.h, p.z],
    ])
    .concat(mods.map((m): Vec3 => [colX(m), FLOOR, ROW * 0.6])); // the lane names too
  const inFrame = ([x, y, z]: Vec3) => {
    const v = new three.THREE.Vector3(x, y, z).project(cam);
    return Math.abs(v.x) < 0.95 && v.y < 0.8 && v.y > -0.6 && v.z < 1;
  };
  let over!: View;
  search: for (let d = 3000; d < 60000; d *= 1.06) {
    for (const aim of [0, 0.1, 0.2, 0.3, 0.4]) {
      // aiming nearer tilts the camera down, lifting everything in frame
      over = { pos: [cx, FLOOR + d * 0.62, cz + d * 0.78], look: [cx, FLOOR + 200, cz + d * aim] };
      cam.position.set(...over.pos);
      cam.lookAt(...over.look);
      cam.updateMatrixWorld();
      if (corners.every(inFrame)) break search;
    }
  }
  return over;
}

/** Where the camera wants to be for entry i at time t. Two panels: one wide shot of both, held.
 * Three or more: too small together, so it holds on each for an equal share of the line and
 * snaps between them. */
function viewOf(rig: Rig, over: View, i: number, t: number, start: FrameDetail["start"]): View {
  const { s, panels } = rig;
  const p = panels[i];
  if (!p) return over;
  if (!p.xs || p.xs.length < 3) return fitPanel(p);
  const t0 = start(s.b0 + i),
    t1 = Number.isFinite(start(s.b0 + i + 1)) ? start(s.b0 + i + 1) : t0 + 8;
  const n = p.xs.length,
    share = (t1 - t0) / n;
  const j = Math.min(n - 1, Math.max(0, Math.floor((t - t0) / share)));
  const snap = j ? ease((t - t0 - j * share) / 0.5) : 1; // 0.5 s from the previous panel to this one
  const x = p.xs[j - (j ? 1 : 0)]! + (p.xs[j]! - p.xs[j - (j ? 1 : 0)]!) * snap;
  return fitPanel({ ...p, x, w: 1480 });
}

/** The camera's position and look-at at time t: each entry's view eased in from the one before. */
function cameraAt(rig: Rig, over: View, t: number, start: FrameDetail["start"]): View {
  const { s, panels } = rig;
  let { pos, look } = viewOf(rig, over, 0, t, start);
  for (let i = 1; i < panels.length; i++) {
    const k = ease((t - start(s.b0 + i)) / 1.4);
    if (k <= 0) break;
    const to = viewOf(rig, over, i, t, start);
    // Mid-move the camera backs off and rises, so it passes over the panels rather than through them.
    const out = Math.sin(Math.PI * k),
      far = Math.min(1, Math.hypot(to.pos[0] - pos[0], to.pos[2] - pos[2]) / 2000);
    pos = lerp(pos, to.pos, k);
    pos[1] += out * far * 700;
    pos[2] += out * far * 1400;
    look = lerp(look, to.look, k);
  }
  return { pos, look };
}

/** Draw one frame at time t: move the camera, then fade panels, route map and lane names to match. */
function drawFrame(
  rig: Rig,
  over: View,
  map: ReturnType<typeof routeMap>,
  t: number,
  start: FrameDetail["start"],
) {
  const { s, panels, spots, cam, world, renderer, labels } = rig;
  const { mini, dots } = map;
  const { pos, look } = cameraAt(rig, over, t, start);
  cam.position.set(...pos);
  cam.lookAt(...look);
  // CSS has no near plane: a panel the camera has passed would draw huge and mirrored. Hide it.
  // (isCSS3DObject is set by three at runtime; its types don't declare it.)
  for (const o of world.children)
    if ((o as typeof o & { isCSS3DObject?: true }).isCSS3DObject && o.rotation.x === 0)
      o.visible = o.position.z < pos[2] - 400; // lane signs too
  const cur = Math.max(
    0,
    panels.findLastIndex((_, i) => t >= start(s.b0 + i) - 0.01),
  );
  // Panels of earlier steps stand between the camera and this one in the lanes beside it: they
  // fade as the camera moves on, and come back for the overview.
  const gone = panels[cur]
    ? ease((t - start(s.b0 + cur)) / 0.6)
    : 1 - ease((t - start(s.b0 + cur)) / 1.4);
  for (const p of spots) p.el.style.opacity = p.i < cur ? (1 - gone).toFixed(3) : "1";
  for (const d of dots)
    d.setAttribute(
      "class",
      +d.dataset["i"]! === cur || !panels[cur] ? "on" : +d.dataset["i"]! < cur ? "past" : "",
    );
  const here = new Set(dots.filter((d) => +d.dataset["i"]! === cur).map((d) => d.dataset["m"]));
  for (const x of $$("text", mini)) x.setAttribute("class", here.has(x.dataset["m"]) ? "on" : "");
  // Lane names belong to the overview: they fade in as the camera pulls up, and stay off the code.
  const ov = panels.findIndex((p) => !p),
    k = ov < 0 ? 0 : ease((t - start(s.b0 + ov)) / 1.4);
  labels.domElement.style.opacity = k.toFixed(3);
  renderer.render(world, cam);
  labels.render(world, cam);
}

/** Turn the stage's 3D tour (if it has one) into panels standing in space, and play the camera on viz-frame. */
export async function tour3d(
  stage: HTMLElement,
  tourScene: (el: Element) => SceneOf<"tour">,
  hunksOf: (e: { hunks?: string[] | undefined; hunk?: string | undefined }) => Hunk[],
  hunkOrder: Map<string, number>,
): Promise<void> {
  const tour = $(".k-tour.t3d", stage);
  if (!tour) return;
  const three = await loadThree();
  const s = tourScene(tour);
  const rig = makeRig(three, tour, { s, entries: (s.entries ?? []).map(hunksOf), hunkOrder });
  placePanels(rig);
  paintGround(rig);
  const map = routeMap(rig);
  const over = overviewView(rig);
  stage.addEventListener("viz-frame", (ev) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the film dispatches viz-frame as a CustomEvent<FrameDetail>
    const { t, start } = (ev as CustomEvent<FrameDetail>).detail;
    drawFrame(rig, over, map, t, start);
  });
  drawFrame(rig, over, map, 0, () => Infinity); // the renderer only attaches panels on a render — before film rescans for them
}
