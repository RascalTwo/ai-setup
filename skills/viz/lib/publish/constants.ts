// lib/publish/constants.ts — names shared across the publish pipeline.
//
// Extracted from build.ts, where these sat above everything as bare module constants.

/** Marks a mirrored-IN copy so it can be recognised and refused as an edit target. */
export const MIRROR_SIDECAR = ".mirror.json";

/** Stands in for a real host when --base-url wasn't given, so links are obviously unfinished. */
export const PLACEHOLDER_HOST = "https://YOUR-PAGES-HOST/";
