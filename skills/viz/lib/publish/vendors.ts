// lib/publish/vendors.ts — Vendor push — full standalone copies into declared sinks (ADR 0010).
//
// Extracted from build.ts, which was 1993 lines.

// ---- vendor push (ADR 0010) ----
// A vendored copy is SOURCE, not an artifact: no build, no inline, no seal. So this is a
// verbatim recursive copy plus a receipt — the same bytes `manage.ts vendor` writes, now
// driven from the origin's manifest so copies refresh instead of silently going stale.
import { MIRROR_SIDECAR } from "./constants.ts";
import { readPosture } from "./meta.ts";
import { VendorTarget } from "./mirrors.ts";
import { vizzesIn } from "./publish-one.ts";
import { seal } from "./seal.ts";
import { HOME, idFor } from "../../discovery.ts";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export const VENDOR_RECEIPT = ".vendored.json";
// Local-only files must never ride along into a sink. Dotdirs are included because
// cpSync copies them and vendor-check's walk skips dotfiles — so a stray .runtime/ would
// land in someone else's repo and be invisible to the drift check.
export const VENDOR_STRIP = ["comments.json", VENDOR_RECEIPT, MIRROR_SIDECAR, ".DS_Store", ".runtime", ".verify"];

export async function pushVendors(container: string, vendors: VendorTarget[]): Promise<void> {
  const containerId = idFor(container);
  for (const vt of vendors) {
    const sink = path.resolve(container, vt.path);
    console.log(`\nVendor → ${sink}`);
    if (path.basename(sink) !== "viz-pages" && path.basename(sink) !== ".viz-pages") {
      console.log(`  ⚠️  skipped — not a viz-pages container`);
      continue;
    }
    if (!existsSync(sink)) {
      // Unlike a mirror we do NOT mkdir: a vendor sink is another repo's working tree,
      // and conjuring it is far more likely to be a typo than an intent.
      console.log(`  ⚠️  skipped — sink container does not exist (create it, or fix the path)`);
      continue;
    }

    // `declared` (not `written`) scopes the prune: a copy whose push FAILED must not be
    // deleted. A vendored copy is source living in someone else's repo — losing one to a
    // transient failure is worse than leaving it stale, which vendor-check already reports.
    const declared = new Set(vt.vizzes.map((v) => v.slug));
    let failed = 0;
    for (const entry of vt.vizzes) {
      const vizDir = path.join(container, entry.slug);
      const dest = path.join(sink, entry.slug);
      const posture = readPosture(vizDir);
      if (entry.access !== posture) {
        failed++;
        console.log(`  • ${entry.slug} — FAILED: declared access "${entry.access}" but the origin's viz:posture is "${posture ?? "undeclared"}"`);
        continue;
      }
      if (existsSync(dest) && !existsSync(path.join(dest, VENDOR_RECEIPT))) {
        failed++;
        console.log(`  • ${entry.slug} — FAILED: ${dest} exists and is NOT a vendored copy — refusing to clobber a real viz`);
        continue;
      }
      rmSync(dest, { recursive: true, force: true });
      cpSync(vizDir, dest, { recursive: true });
      for (const junk of VENDOR_STRIP) rmSync(path.join(dest, junk), { recursive: true, force: true });
      await Bun.write(
        path.join(dest, VENDOR_RECEIPT),
        JSON.stringify({ origin: idFor(vizDir) ?? entry.slug, access: entry.access, vendoredAt: new Date().toISOString() }, null, 2) + "\n",
      );
      console.log(`  • ${entry.slug} — ${entry.access}, source copy`);
    }

    // Origin-scoped prune. Ownership is read straight off the receipt: `origin` is the
    // $HOME-relative id of the ORIGIN VIZ, so its dirname is the origin container's id.
    // No hash needed (unlike mirrors) because the receipt is meant to stay human-readable
    // and is what vendor-sync resolves the origin from.
    if (!containerId) continue; // container outside $HOME — can't prove ownership, so never prune
    // Never reconcile against a manifest we could not fully apply. A rename moves the
    // declaration to a new slug, so the old copy is "undeclared" and due for prune — if
    // the replacement write also failed, pruning would delete the sink's ONLY copy and
    // leave nothing behind. Stale beats absent when the artifact is someone else's source.
    if (failed) {
      console.log(`  ⏭️  prune skipped — ${failed} edge${failed === 1 ? "" : "s"} failed above; fix ${failed === 1 ? "it" : "them"} and re-run`);
      continue;
    }
    for (const dir of vizzesIn(sink)) {
      const rp = path.join(dir, VENDOR_RECEIPT);
      if (!existsSync(rp)) continue;
      let origin = "";
      try { origin = JSON.parse(readFileSync(rp, "utf8")).origin ?? ""; } catch { continue; }
      if (!origin || path.dirname(origin) !== containerId) continue; // not ours
      if (declared.has(path.basename(dir))) continue;
      console.log(`  ✂️  pruning ${path.basename(dir)} (dropped from manifest)`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
