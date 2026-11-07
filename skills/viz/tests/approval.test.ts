// tests/approval.test.ts — the version-bound approval hash (ADR 0015).
//
// One viz dir walked through a story, so the tests share it and run in order (bun:test
// runs a file's tests serially): each step edits the viz and checks the state it left.

import { afterAll, expect, test } from "bun:test";
import { vizHash, approvalOf, setApprovalMeta, readApproval } from "../lib/publish/approval.ts";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const d = mkdtempSync(path.join(os.tmpdir(), "viz-appr-"));
const idx = path.join(d, "index.html");
writeFileSync(
  idx,
  `<html><head><meta name="viz:posture" content="public">\n<title>x</title></head><body>hello</body></html>`,
);
writeFileSync(path.join(d, "content.js"), "export default { a: 1 }");
const h1 = vizHash(d);
afterAll(() => rmSync(d, { recursive: true, force: true }));

test("never approved before stamping", () => {
  expect(approvalOf(d).state).toBe("never");
});

test("stamping stores the hash, is approved, and does not change the hash", () => {
  writeFileSync(idx, setApprovalMeta(readFileSync(idx, "utf8"), h1));
  expect(readApproval(d)).toBe(h1);
  expect(approvalOf(d).state).toBe("approved");
  // the meta is excluded from its own input
  expect(vizHash(d)).toBe(h1);
});

test("editing a NON-index file (content.js) invalidates approval", () => {
  writeFileSync(path.join(d, "content.js"), "export default { a: 2 }");
  expect(approvalOf(d).state).toBe("stale");
});

test("regenerated artifacts do NOT invalidate", () => {
  writeFileSync(idx, setApprovalMeta(readFileSync(idx, "utf8"), vizHash(d)));
  expect(approvalOf(d).state).toBe("approved");
  writeFileSync(path.join(d, "og.auto.png"), "fake-png-bytes");
  writeFileSync(path.join(d, "comments.json"), "[]");
  expect(approvalOf(d).state).toBe("approved");
});

test("moving a file invalidates (path is hashed, not just bytes)", () => {
  mkdirSync(path.join(d, "sub"));
  writeFileSync(
    path.join(d, "sub", "content.js"),
    readFileSync(path.join(d, "content.js"), "utf8"),
  );
  rmSync(path.join(d, "content.js"));
  expect(approvalOf(d).state).toBe("stale");
});

test('legacy content="true" reads as never-approved', () => {
  writeFileSync(idx, readFileSync(idx, "utf8").replace(/content="h-[0-9a-f]+"/u, 'content="true"'));
  expect(readApproval(d)).toBe("true");
  expect(approvalOf(d).state).toBe("never");
});
