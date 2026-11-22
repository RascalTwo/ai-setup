type Counters = { s: Record<string, number>; f: Record<string, number>; b: Record<string, number[]> };
export const OUT: string;
export function snapshot(cov?: object): Record<string, Counters>;
export function diff(before: Record<string, Counters>, cov?: object): Record<string, Counters>;
export function add(into: Record<string, Counters>, sparse: Record<string, Counters>): Record<string, Counters>;
export function writeRecord(dir: string, info: { runner: string; name: string; load?: boolean }, sparse: Record<string, Counters>, cov: object, cwd: string): void;
