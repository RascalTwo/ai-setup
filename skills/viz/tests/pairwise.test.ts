import { item, idOf, pairKeyOf, migrateId, createEngine, budgetFor, tierVerdict, SEP } from "../kit/pairwise.js";
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`); };

// 1. A known total order must be recovered exactly.
const items = ["e","c","a","d","b"].map(t => item(t, "u" + t));
const eng = createEngine({ items });
const order = await eng.run(async (a, b) => items[a].title < items[b].title ? -1 : 1);
ok("sorts to a correct total order", eng.ranking(order).map(i => i.title).join("") === "abcde",
   eng.ranking(order).map(i => i.title).join(""));

// 2. Replaying costs ZERO new questions — the log must be authoritative.
let asked = 0;
const eng2 = createEngine({ items, log: eng.state.log });
await eng2.run(async () => { asked++; return -1; });
ok("replay asks nothing (log is authoritative)", asked === 0, `asked=${asked}`);

// 3. migrateId flips the sign when the rename swaps which id sorts first.
//    Build a pair where renaming inverts sort order, and check the verdict inverts too.
const A = idOf(item("a","")), B = idOf(item("b",""));
const log: [string, number][] = [[pairKeyOf(A, B), A < B ? -1 : 1]];  // "a beats b"
const before = log[0];
migrateId(log as any, new Set(), A, idOf(item("z","")));              // a -> z, now sorts AFTER b
const Z = idOf(item("z",""));
const [k, v] = log[0];
const [x] = k.split(SEP);
// "a beats b" must still mean "z beats b" after the rename
const stillZWins = (x === Z && v === -1) || (x === B && v === 1);
ok("migrateId preserves the verdict across a sort-order swap", stillZWins,
   `before=${JSON.stringify(before)} after=${JSON.stringify(log[0])}`);

// 4. Tiers synthesise cross-tier verdicts and stay out of the log.
const tItems = [item("hi","1",[],"",["good"]), item("lo","2",[],"",["bad"])];
const eng3 = createEngine({ items: tItems, priority: ["good","bad"] });
let tierAsked = 0;
const o3 = await eng3.run(async () => { tierAsked++; return 1; });
ok("tiers answer cross-tier pairs without asking", tierAsked === 0 && eng3.ranking(o3)[0].title === "hi");
ok("tier verdicts are never logged", eng3.state.log.length === 0, `log=${eng3.state.log.length}`);

// 5. A direct answer must BEAT the tier order (the documented escape hatch).
const eng4 = createEngine({ items: tItems, priority: ["good","bad"] });
const ia = idOf(tItems[0]), ib = idOf(tItems[1]);
eng4.state.log.push([pairKeyOf(ia, ib), ia < ib ? 1 : -1]);   // assert lo beats hi
const eng4b = createEngine({ items: tItems, priority: ["good","bad"], log: eng4.state.log });
const o4 = await eng4b.run(async () => { throw new Error("should not ask"); });
ok("a logged answer overrides the tier order", eng4b.ranking(o4)[0].title === "lo",
   eng4b.ranking(o4).map(i => i.title).join(","));

// 6. Budget matches the page's worst-case formula.
ok("budget(5) is the binary-insertion worst case", budgetFor(5) === 8, `got ${budgetFor(5)}`);

// 7. An explicit `key` pins identity: a retitle must NOT orphan the answer.
const k1 = item("Old Title", "viz://v-abc", [], "", [], "viz://v-abc");
const k2 = item("Other", "viz://v-def", [], "", [], "viz://v-def");
const engK = createEngine({ items: [k1, k2] });
await engK.run(async () => -1);
const logged = engK.state.log.length;
const renamed = item("A Completely New Title", "viz://v-abc", [], "", [], "viz://v-abc");
const engK2 = createEngine({ items: [renamed, k2], log: engK.state.log });
let askedAfterRename = 0;
await engK2.run(async () => { askedAfterRename++; return 1; });
ok("an explicit key survives a retitle", logged === 1 && askedAfterRename === 0,
   `logged=${logged} askedAfterRename=${askedAfterRename}`);

// 8. Without a key, a retitle DOES orphan — the documented default, asserted so a
//    future change to idOf cannot quietly alter it.
const n1 = item("Old", "u1"), n2 = item("Other", "u2");
const engN = createEngine({ items: [n1, n2] });
await engN.run(async () => -1);
const engN2 = createEngine({ items: [item("New", "u1"), n2], log: engN.state.log });
let askedN = 0;
await engN2.run(async () => { askedN++; return 1; });
ok("without a key, a retitle orphans the answer (documented default)", askedN === 1, `asked=${askedN}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
