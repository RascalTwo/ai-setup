// lib/publish/base-url.ts — the base-url.sh contract: ask a container where it deploys.
//
// Moved out of the self-portrait's api.ts so `viz urls` and the "deployed url" button
// read ONE definition — including which vizzes get a card-public share link, which the
// page used to derive on its own.
//
// Runs <container>/base-url.sh. Fails CLOSED: exit 0 is not enough, stdout must actually
// look like a URL. A script that prints a diagnostic where a URL belongs would otherwise
// render a link to nowhere — and these links can carry the lobby key.

import { run } from "../proc.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildSlugMap } from "../../discovery.ts";
import { grabMeta } from "./meta.ts";
import { cardPublicOf } from "./approval.ts";
import { LOBBY_MARKER } from "./lobby.ts";

export type BaseUrl = { ok: true; url: string } | { ok: false; err: string; absent?: true };

export async function deployedBaseUrl(container: string): Promise<BaseUrl> {
  const script = path.join(container, "base-url.sh");
  // Absent is a normal answer ("this container doesn't deploy"), not an error.
  if (!existsSync(script))
    return {
      ok: false,
      absent: true,
      err: "no base-url.sh — this container declares no deployed URL",
    };

  // A derivation may hit the network (one queries CloudFormation), so cap it rather than
  // letting one unreachable API wedge the caller.
  let ran;
  try {
    ran = await run([script], { cwd: container, timeout: 60_000 });
  } catch {
    return { ok: false, err: "base-url.sh is not executable — chmod +x it" };
  }
  const { code, stdout: rawOut, stderr: rawErr } = ran;

  const out = rawOut.trim().split("\n")[0]?.trim() ?? "";
  if (code !== 0)
    return { ok: false, err: rawErr.trim() || `base-url.sh exited ${code} — no deployed URL` };
  if (!/^https?:\/\//iu.test(out))
    return {
      ok: false,
      err: `base-url.sh exited 0 but printed no URL: ${out.slice(0, 120) || "<empty>"}`,
    };
  return { ok: true, url: out.replace(/\/+$/u, "") };
}

/**
 * Card-public share pages (ADR 0018) — the one URL of a gated public viz that unfurls.
 * Only native, public-posture vizzes whose card is reviewed public get one; a
 * _private-lobby container emits none, because its lobby shims carry the card instead.
 */
export function shareLinks(container: string, base: string): string[] {
  if (existsSync(path.join(container, LOBBY_MARKER))) return [];
  const root = base.replace(/\/+$/u, "");
  return [...buildSlugMap([container]).values()]
    .filter((s) => existsSync(path.join(s.dir, "index.html")))
    .filter(
      (s) =>
        !existsSync(path.join(s.dir, ".mirror.json")) &&
        !existsSync(path.join(s.dir, ".vendored.json")),
    )
    .filter(
      (s) =>
        grabMeta(
          readFileSync(path.join(s.dir, "index.html"), "utf8"),
          "viz:posture",
        ).toLowerCase() === "public",
    )
    .filter((s) => cardPublicOf(s.dir).state === "public")
    .map((s) => `${root}/share/${path.basename(s.dir)}/`)
    .toSorted();
}
