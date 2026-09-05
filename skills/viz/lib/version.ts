// lib/version.ts — the one place the version is written down.
//
// It was already in two: program.ts and mcp.ts each hardcoded "1.0.0", and package.json
// had none at all. Adding the .mcpb manifest would have made three copies of a number
// that must agree, which is the same shape as every other drift in this codebase.
//
// package.json is the source. Everything else reads THIS.

import pkg from "../package.json" with { type: "json" };

export const VERSION: string = (pkg as { version: string }).version;

/** semver, strictly — the .mcpb manifest requires it and installers compare on it. */
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
