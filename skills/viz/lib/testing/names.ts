// lib/testing/names.ts — what a test is called, in the two places that must agree: the failure list verify prints
// (and the spec) and the file a failed test's video is kept under.
import { createHash } from "node:crypto";

/** "describe > nested > it", the way verify and the spec name a test. */
export const fullName = (ancestors: readonly string[], title: string): string =>
  [...ancestors, title].join(" > ");

/** Which test, in the two places that must agree on it: the id a step is recorded under (scope.ts) and the id the spec
 *  gives the same test from vitest's results file. A loop's iterations share a line, so the title is part of it. */
export const testKey = (
  file: string,
  ancestors: readonly string[],
  title: string,
  line: number | undefined,
): string => `${file}:${line ?? 0} ${fullName(ancestors, title)}`;

/** The start of the file names a test's videos get; the video's own number follows after `--`. */
export const videoStem = (name: string): string =>
  name.replaceAll(/\W+/gu, "_").slice(0, 80) +
  "_" +
  createHash("sha1").update(name).digest("hex").slice(0, 8);
