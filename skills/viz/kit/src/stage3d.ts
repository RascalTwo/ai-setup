// stage3d.ts — a three.js scene inside a film() chapter (reference/timeline.md, "Canvas / WebGL").
//
//   await stage3d(el, { b0, mode, stops, build, frame });   // b0 = the chapter's first beat
//   stops: [{ at: 0, pos: [x,y,z], look: [x,y,z], dur? }, …] — the camera eases to each stop as
//          narration line `at` (0-based, within the chapter) starts
//   build(THREE, world): add meshes once;  frame(t, k): move them — k(i, dur = 0.8) is 0→1 as line i starts
//
// Film: drawn synchronously on every "viz-frame" from t alone, so `viz render` can seek it.
// Review: the final state, and the reviewer drives it — drag to orbit, scroll to zoom, and a
// button per camera stop replays the scene as it stood on that line. Poster: the final state.
import * as THREE from "https://esm.sh/three@0.160.0";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";
export { THREE };

type Vec3 = [number, number, number];
/** A camera stop: eases to `pos` looking at `look` as narration line `at` starts, over `dur` s. */
export interface Stop {
  at: number;
  pos: Vec3;
  look: Vec3;
  dur?: number;
}
/** One line of text on a plate(). */
export interface PlateLine {
  text: string;
  size?: number;
  color?: string;
  font?: string;
  align?: CanvasTextAlign;
}
export interface PlateOptions {
  w?: number;
  h?: number;
  lines?: PlateLine[];
  bg?: string;
  edge?: string;
  edgeW?: number;
  px?: number;
}
/** k(i, dur) is 0→1 as narration line i starts. */
export type LineEase = (i: number, dur?: number) => number;
export interface Stage3dOptions {
  b0?: number;
  stops: Stop[];
  mode?: "film" | "review" | "poster";
  fov?: number;
  height?: number;
  build: (three: typeof THREE, world: THREE.Scene) => void | Promise<void>;
  frame?: (t: number, k: LineEase) => void;
}
/** What a "viz-frame" event from film() carries (kit/film.ts). */
interface FrameDetail {
  t: number;
  start: (beat: number) => number;
}

export const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

// A flat card with text on it — the readable unit of every 3D scene. lines: [{ text, size, color, font }].
export function plate({
  w = 6,
  h = 3,
  lines = [],
  bg = "#161b22",
  edge = "#30363d",
  edgeW = 10,
  px = 340,
}: PlateOptions): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = Math.round(w * px);
  c.height = Math.round(h * px);
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  if (edgeW) {
    g.strokeStyle = edge;
    g.lineWidth = edgeW;
    g.strokeRect(0, 0, c.width, c.height);
  }
  const total = lines.reduce((a, l) => a + (l.size ?? 90) * 1.3, 0);
  let y = (c.height - total) / 2;
  for (const l of lines) {
    const size = l.size ?? 90;
    g.font = l.font ?? `600 ${size}px Inter, system-ui, sans-serif`;
    g.fillStyle = l.color ?? "#e6edf3";
    g.textAlign = l.align ?? "center";
    y += size * 1.3;
    g.fillText(
      l.text,
      l.align === "left" ? size * 0.8 : c.width / 2,
      y - size * 0.3,
      c.width - size,
    );
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

export async function stage3d(
  el: HTMLElement,
  { b0 = 1, stops, build, frame = () => {}, mode = "film", fov = 38, height = 880 }: Stage3dOptions,
): Promise<{ draw: (t: number) => void }> {
  // Line i's start time: the film's beat clock once viz-frame brings it; elsewhere a stand-in, 5 s a line.
  let at = (i: number): number => i * 5;
  const box = document.createElement("div");
  box.className = "s3d";
  box.style.cssText = `position:relative;height:${height}px`;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  box.append(canvas);
  el.append(box);
  const W = 1760,
    H = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const world = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 500);
  world.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(8, 20, 10);
  world.add(sun);
  await build(THREE, world);

  // Camera for time t: ease from stop to stop, each move over the first `dur` s of its line.
  function camAt(t: number): { pos: Vec3; look: Vec3 } {
    let pos = stops[0]!.pos,
      look = stops[0]!.look;
    for (const s of stops.slice(1)) {
      const k = ease((t - at(s.at)) / (s.dur ?? 1.6));
      if (k <= 0) break;
      pos = lerp3(pos, s.pos, k);
      look = lerp3(look, s.look, k);
    }
    return { pos, look };
  }
  const k =
    (t: number): LineEase =>
    (i, dur = 0.8) =>
      ease((t - at(i)) / dur);
  function draw(t: number, view = camAt(t)): void {
    cam.position.set(...view.pos);
    cam.lookAt(...view.look);
    frame(t, k(t));
    renderer.render(world, cam);
  }

  if (mode === "film") {
    el.closest("#stage")!.addEventListener("viz-frame", (e) => {
      const d = (e as CustomEvent<FrameDetail>).detail;
      at = (i) => d.start(b0 + i);
      draw(d.t);
    });
    return { draw };
  }
  const end = at(stops.at(-1)!.at) + 30; // well past the last move: everything in place
  draw(end);
  if (mode !== "review") return { draw };

  const orbit = new OrbitControls(cam, canvas);
  const show = (t: number): void => {
    const v = camAt(t);
    orbit.target.set(...v.look);
    draw(t, v);
    orbit.update();
  };
  orbit.addEventListener("change", () => renderer.render(world, cam));
  show(end);
  const bar = document.createElement("div");
  bar.className = "s3d-stops";
  bar.style.cssText = "display:flex;gap:10px;margin-top:12px"; // under the canvas: over it, it hides axis labels
  bar.innerHTML =
    stops
      .map(
        (_s, i) =>
          `<button data-i="${i}" style="font:600 26px var(--mono);padding:8px 16px;border-radius:10px;border:1px solid var(--border);background:var(--panel-2);color:var(--text);cursor:pointer">${i + 1}</button>`,
      )
      .join("") +
    `<span style="font:24px var(--mono);color:var(--muted);align-self:center">drag to orbit · scroll to zoom</span>`;
  bar.onclick = (e) => {
    const b = (e.target as Element).closest("button");
    const s = b && stops[Number(b.dataset["i"])];
    if (s) show(at(s.at) + (s.dur ?? 1.6) + 1);
  };
  box.after(bar);
  return { draw };
}
