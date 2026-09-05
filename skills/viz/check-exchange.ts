// Structural check for an exchange's content.js.
//
//   bun ~/.claude/skills/viz/check-exchange.ts <viz-dir>
//   bun ~/.claude/skills/viz/check-exchange.ts .          (from inside the viz folder)
//
// Also the REGRESSION GATE for `/_kit/exchange.js` itself: every exchange in the
// corpus shares that runtime, so any change to it must keep this green on all of
// them. `bootstrap.ts --exchange` prints the command for a new one.
//
// Catches the mistakes that otherwise show up as a blank page or a stranded
// arrow: a wire pointing at a node that does not exist, a step animating along
// a wire that was never declared, a step filling a panel id nobody defined,
// overlapping panels, boxes escaping the stage. Run it before you open a browser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.argv[2] || '.');
const exchange = (await import('file://' + resolve(dir, 'content.js'))).default;
const problems = [], warnings = [];
const P = m => problems.push(m), W = m => warnings.push(m);

const nodes = exchange.nodes || {}, boxes = exchange.boxes || {};
const geo = new Set([...Object.keys(nodes), ...Object.keys(boxes)]);
const panelIds = new Set((exchange.panels || []).map(p => p.id));
const laneIds = new Set((exchange.lanes || []).map(l => l.id));

for (const f of ['title', 'lanes', 'nodes', 'wires', 'steps']) {
  if (!exchange[f]) P(`exchange.${f} is missing`);
}

// wires must connect things that exist
const wireKeys = new Set();
for (const [a, b, o = {}] of exchange.wires || []) {
  if (!geo.has(a)) P(`wire ${a}->${b}: "${a}" is not a node or box`);
  if (!geo.has(b)) P(`wire ${a}->${b}: "${b}" is not a node or box`);
  wireKeys.add(a + '>' + b);
  const kinds = ['up', 'dip', 'back', 'hand'].filter(k => o[k]);
  if (kinds.length > 1) P(`wire ${a}->${b}: pick one of ${kinds.join(', ')}`);
}

// every animated step needs a wire in one direction or the other
for (const [i, s] of (exchange.steps || []).entries()) {
  const at = `step ${i + 1} ("${(s.t || '').slice(0, 40)}")`;
  if (!s.t) P(`${at}: no title`);
  if (s.p != null && !laneIds.has(s.p)) P(`${at}: lane ${s.p} does not exist`);
  if (s.from) {
    if (!geo.has(s.from)) P(`${at}: from "${s.from}" is not a node or box`);
    if (!geo.has(s.to)) P(`${at}: to "${s.to}" is not a node or box`);
    if (!wireKeys.has(s.from + '>' + s.to) && !wireKeys.has(s.to + '>' + s.from))
      P(`${at}: no wire between ${s.from} and ${s.to} — nothing will animate`);
  }
  // parallel packets get the same treatment as the main one — a step that flies
  // a log packet along a wire nobody declared animates nothing, silently
  for (const [k, a] of (s.also || []).entries()) {
    const w = `${at}: also[${k}] ${a.from}->${a.to}`;
    if (!geo.has(a.from)) P(`${w}: "${a.from}" is not a node or box`);
    else if (!geo.has(a.to)) P(`${w}: "${a.to}" is not a node or box`);
    else if (!wireKeys.has(a.from + '>' + a.to) && !wireKeys.has(a.to + '>' + a.from))
      P(`${w}: no wire between them — nothing will animate`);
    if (a.from === s.from && a.to === s.to) P(`${w}: duplicates the step's own packet`);
  }
  for (const id of Object.keys(s.set || {}))
    if (!panelIds.has(id)) P(`${at}: fills panel "${id}", which is not declared`);
  for (const id of s.lit || [])
    if (!nodes[id]) P(`${at}: lights "${id}", which is not a node`);
  if (s.browser && !nodes[s.browser.at]) P(`${at}: browser parks at "${s.browser.at}", not a node`);
  if (s.browser && !exchange.browser) P(`${at}: sets browser content, but exchange.browser is not enabled`);
}

// panels that are never filled are usually a forgotten step
for (const id of panelIds)
  if (!(exchange.steps || []).some(s => s.set && s.set[id]))
    W(`panel "${id}" is never filled by any step`);

// geometry sanity
const SW = (exchange.stage && exchange.stage.w) || 1780, SH = (exchange.stage && exchange.stage.h) || 1630;
for (const [id, n] of Object.entries({ ...nodes, ...boxes })) {
  if (n.x + n.w > SW) P(`"${id}" runs ${n.x + n.w - SW}px past the stage width`);
  if (n.y + n.h > SH) P(`"${id}" runs ${n.y + n.h - SH}px past the stage height`);
}
const rects = [...Object.entries(nodes)].map(([id, n]) => [id, n]);
for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
  const [ia, a] = rects[i], [ib, b] = rects[j];
  const ov = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (ov) W(`nodes "${ia}" and "${ib}" overlap`);
}

const name = dir.split('/').pop();
if (warnings.length) console.log(warnings.map(w => `  ⚠ ${w}`).join('\n'));
if (problems.length) {
  console.log(problems.map(p => `  ✗ ${p}`).join('\n'));
  console.log(`✗ ${name}: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`✓ ${name}: ${(exchange.steps || []).length} steps, ${Object.keys(nodes).length} nodes, `
  + `${(exchange.wires || []).length} wires, ${panelIds.size} panels`
  + (warnings.length ? ` (${warnings.length} warning(s))` : ''));
