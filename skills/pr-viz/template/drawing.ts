// The one file you write per PR: the picture of the change's idea, drawn in #area (1760×770 CSS px
// on the 1920×1080 stage). Replace everything below; keep the default export's shape.
//
//   mount(area) runs once: build the SVG/HTML and keep the nodes you will move.
//   It returns draw(t): t is seconds into the build, 0…4 (the page clamps it, so t = 4 is the
//   finished picture, which is also the still and the GIF's last frame). draw must be a pure
//   function of t: seeking to any t, in any order, must give the same picture. No timers, no CSS
//   transitions, no rAF: set attributes/styles from t with ramp(t, from, to).
import { ramp } from "./ramp.js";

export default function mount(area: HTMLElement): (t: number) => void {
  area.innerHTML = `<svg viewBox="0 0 1760 770" width="1760" height="770">
    <rect id="bar" x="0" y="300" height="120" rx="12" fill="var(--accent)" />
    <text id="cap" x="0" y="480" font-size="30" fill="var(--muted)">replace me with this PR's idea</text>
  </svg>`;
  const bar = area.querySelector("#bar");
  const cap = area.querySelector("#cap");
  return (t) => {
    bar?.setAttribute("width", String(1760 * ramp(t, 0.3, 3)));
    cap?.setAttribute("opacity", String(ramp(t, 2.5, 3.5)));
  };
}
