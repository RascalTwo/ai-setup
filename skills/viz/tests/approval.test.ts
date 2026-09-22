import { vizHash, approvalOf, setApprovalMeta, readApproval } from "../lib/publish/approval.ts";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path"; import os from "node:os";
let pass=0, fail=0;
const ok=(n:string,c:boolean,x="")=>{c?pass++:fail++;console.log(`${c?"✓":"✗"} ${n}${x?"  "+x:""}`)};

const d = mkdtempSync(path.join(os.tmpdir(), "viz-appr-"));
const idx = path.join(d, "index.html");
writeFileSync(idx, `<html><head><meta name="viz:posture" content="public">\n<title>x</title></head><body>hello</body></html>`);
writeFileSync(path.join(d, "content.js"), "export default { a: 1 }");

const h1 = vizHash(d);
ok("never approved before stamping", approvalOf(d).state === "never");

// approve it
writeFileSync(idx, setApprovalMeta(readFileSync(idx,"utf8"), h1));
ok("stamping stores the hash", readApproval(d) === h1, readApproval(d));
ok("approved right after stamping", approvalOf(d).state === "approved");
ok("stamping did not change the hash (meta excluded from its own input)", vizHash(d) === h1);

// edit a NON-index file — the exchange-scaffold case
writeFileSync(path.join(d, "content.js"), "export default { a: 2 }");
ok("editing content.js invalidates approval", approvalOf(d).state === "stale", approvalOf(d).state);

// re-approve, then touch a generated artifact
writeFileSync(idx, setApprovalMeta(readFileSync(idx,"utf8"), vizHash(d)));
ok("re-approved", approvalOf(d).state === "approved");
writeFileSync(path.join(d, "og.auto.png"), "fake-png-bytes");
writeFileSync(path.join(d, "comments.json"), "[]");
ok("regenerated artifacts do NOT invalidate", approvalOf(d).state === "approved", approvalOf(d).state);

// a rename with identical bytes is still a change
mkdirSync(path.join(d, "sub"));
writeFileSync(path.join(d, "sub", "content.js"), readFileSync(path.join(d, "content.js"), "utf8"));
rmSync(path.join(d, "content.js"));
ok("moving a file invalidates (path is hashed, not just bytes)", approvalOf(d).state === "stale");

// legacy boolean reads as never
writeFileSync(idx, readFileSync(idx,"utf8").replace(/content="h-[0-9a-f]+"/, 'content="true"'));
ok("legacy content=\"true\" reads as never-approved", approvalOf(d).state === "never", readApproval(d));

rmSync(d, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
