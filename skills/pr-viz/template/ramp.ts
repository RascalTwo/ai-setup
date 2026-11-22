// Easing helper for drawing.ts: 0 before `a`, 1 after `b` (seconds), a smooth S-curve between.
export const ramp = (t: number, a: number, b: number): number => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
