/* treemap.js — squarified treemap layout.
 *
 * Area encodes the value. Squarified (Bruls/Huizing/van Wijk) rather than
 * naive slice-and-dice because slice-and-dice degenerates into slivers the
 * moment values are skewed, and this skill's own file sizes are very skewed
 * (lib/publish/ is 57× vendor-runtime.ts). A sliver can't be hovered or read.
 *
 * Pure layout — it returns rects and draws nothing, so the caller keeps its
 * own styling and its own data-viz-id/data-label stamping.
 */

export interface Rect<T> {
  x: number;
  y: number;
  w: number;
  h: number;
  item: T;
}

export function squarify<T extends { value: number }>(
  items: T[],
  x: number,
  y: number,
  w: number,
  h: number,
): Rect<T>[] {
  const out: Rect<T>[] = [];
  const list = items.filter((i) => i.value > 0).toSorted((a, b) => b.value - a.value);
  const total = list.reduce((s, i) => s + i.value, 0);

  // work in value-units scaled to the pixel area, so a row's thickness is
  // just (row sum / side length)
  const scale = (w * h) / total;
  let rest = list.map((i) => ({ item: i, a: i.value * scale }));
  let rx = x,
    ry = y,
    rw = w,
    rh = h;

  type Cell = { item: T; a: number };
  const worst = (row: Cell[], side: number) => {
    const s = row.reduce((t, r) => t + r.a, 0);
    const mx = Math.max(...row.map((r) => r.a));
    const mn = Math.min(...row.map((r) => r.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };

  while (rest.length > 0) {
    const side = Math.min(rw, rh);
    const row = [rest[0]!];
    let i = 1;
    while (i < rest.length && worst(row.concat(rest[i]!), side) <= worst(row, side)) {
      row.push(rest[i]!);
      i++;
    }
    const sum = row.reduce((t, r) => t + r.a, 0);
    const thick = sum / side;

    if (rw >= rh) {
      let cy = ry;
      for (const r of row) {
        const rhh = r.a / thick;
        out.push({ x: rx, y: cy, w: thick, h: rhh, item: r.item });
        cy += rhh;
      }
      rx += thick;
      rw -= thick;
    } else {
      let cx = rx;
      for (const r of row) {
        const rww = r.a / thick;
        out.push({ x: cx, y: ry, w: rww, h: thick, item: r.item });
        cx += rww;
      }
      ry += thick;
      rh -= thick;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

export const fmtKB = (n: number): string =>
  n >= 1024 * 10
    ? Math.round(n / 1024) + " KB"
    : n >= 1024
      ? (n / 1024).toFixed(1) + " KB"
      : n + " B";
