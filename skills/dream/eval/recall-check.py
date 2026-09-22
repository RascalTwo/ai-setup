#!/usr/bin/env python3
"""Regression test for the 2026-08 recall audit. Re-derives the audit's own checks.

The audit read 96 sessions in full and measured the old capture layer at 20-64%
recall. Its extracted turns live at `/tmp/dream-recall/<session-id>.json` and the
slice manifests carry the OLD candidates as `armA_candidates`. This script runs
the current pipeline over the same sessions and reports:

  * candidate count, old vs new, and the assistant share (the old one was 0)
  * capture rate by user-turn length -- the PRIMARY regression test for defect 2
  * keep rate by MOMENT length -- the same test at the unit the judge sees
  * self-ingestion count, three independent ways
  * the four specific moments the auditors named as missed

Usage:
    scripts/scan.py  (into a scratch state dir)  ->  scripts/score.py  ->  this.
    RECALL / STATE below are the two paths to point at your run.

Needs `/tmp/dream-recall/` to exist. It is an audit artifact, not a build output;
if it has been cleaned up this script cannot run and that is expected.
"""
import json, glob, os, re, sys, collections
_SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts')
sys.path.insert(0, _SCRIPTS)
import prefilter

RECALL = '/tmp/dream-recall'
# The scored run to grade. Override with DREAM_STATE_DIR so a candidate change
# can be graded without overwriting the reference run.
STATE = os.environ.get('DREAM_STATE_DIR') or '/tmp/dream-verify'

def norm(s):
    return re.sub(r'\s+', ' ', s or '').strip().lower()

# ---------------------------------------------------------------- inputs
turnfiles = {os.path.basename(f)[:-5]: f for f in glob.glob(RECALL + '/*.json')
             if 'slice-' not in os.path.basename(f)}
paths = {os.path.basename(f)[:-6]: f
         for f in glob.glob(os.path.expanduser('~/.claude/projects/*/*.jsonl'))}

# old candidates, deduped per session
old = collections.defaultdict(list)
for f in glob.glob(RECALL + '/slice-*.json'):
    for s in json.load(open(f))['sessions']:
        for c in s['armA_candidates']:
            if c not in old[s['session_id']]:
                old[s['session_id']].append(c)
old_total = sum(len(v) for v in old.values())

# which sessions the new stage 1 rejects wholesale (machine-driven)
machine = set()
stage1 = collections.defaultdict(list)
for sid in turnfiles:
    p = STATE + '/stage1/%s.jsonl' % sid
    if os.path.exists(p):
        for line in open(p):
            if line.strip():
                stage1[sid].append(json.loads(line))
    else:
        machine.add(sid)

new = collections.defaultdict(list)
for p in glob.glob(STATE + '/candidates/*.jsonl'):
    sid = os.path.basename(p)[:-6]
    for line in open(p):
        if line.strip():
            new[sid].append(json.loads(line))
new_total = sum(len(v) for v in new.values())

print('=' * 72)
print('SESSIONS  audited=%d  transcripts found=%d  dropped as machine-driven=%d'
      % (len(turnfiles), sum(1 for s in turnfiles if s in paths), len(machine)))
print('CANDIDATES  old(armA, deduped)=%d   new=%d   stage-1 funnel=%d'
      % (old_total, new_total, sum(len(v) for v in stage1.values())))

roles = collections.Counter(r.get('role') for v in new.values() for r in v)
kinds = collections.Counter(r.get('kind') for v in new.values() for r in v)
print('  by role: %s' % dict(roles))
print('  by kind: %s' % dict(kinds))
print('  assistant candidates: %d (%.1f%%)  -- was 0'
      % (roles['assistant'], 100.0 * roles['assistant'] / max(new_total, 1)))

# ---------------------------------------------------------------- defect 2
BUCKETS = [(0, 19, '<20'), (20, 49, '20-49'), (50, 99, '50-99'),
           (100, 199, '100-199'), (200, 10 ** 9, '200+')]

def bucket(n):
    for lo, hi, name in BUCKETS:
        if lo <= n <= hi:
            return name
    return '?'

tot = collections.Counter(); hit_new = collections.Counter(); hit_old = collections.Counter()
for sid, f in turnfiles.items():
    if sid in machine:          # not human turns at all
        continue
    turns = json.load(open(f))['turns']
    caught = {r['uuid'] for r in new.get(sid, [])}
    # Old candidates carried no uuid, so match by text. The old prefilter emitted
    # WHOLE user turns (the 300-char cut is downstream), so a real capture is a
    # prefix match; tool_error/rejection rows are not user turns at all.
    oldtexts = [norm(c['text']) for c in old.get(sid, [])
                if c['kind'] not in ('tool_error', 'rejection')]
    for t in turns:
        if t['role'] != 'user':
            continue
        n = len(t['text'].split())
        if n < 3:
            continue
        b = bucket(n)
        tot[b] += 1
        if t['uuid'] in caught:
            hit_new[b] += 1
        nt = norm(t['text'])
        if any(len(o) > 20 and nt.startswith(o[:200]) for o in oldtexts):
            hit_old[b] += 1

print()
print('CAPTURE RATE BY USER-TURN LENGTH (denominator: every human turn >=3 words')
print('in the 80 human sessions; the audit measured the OLD column)')
print('  %-9s %6s   %-16s %-16s' % ('bucket', 'turns', 'OLD (re-derived)', 'NEW'))
for _, _, name in BUCKETS:
    t = tot[name]
    if not t:
        continue
    print('  %-9s %6d   %5.1f%% (%3d)      %5.1f%% (%3d)'
          % (name, t, 100.0 * hit_old[name] / t, hit_old[name],
             100.0 * hit_new[name] / t, hit_new[name]))
seq_new = [100.0 * hit_new[n] / tot[n] for _, _, n in BUCKETS if tot[n]]
seq_old = [100.0 * hit_old[n] / tot[n] for _, _, n in BUCKETS if tot[n]]
mono = lambda s: all(b >= a for a, b in zip(s, s[1:]))
print('  monotonic increasing?  OLD=%s   NEW=%s' % (mono(seq_old), mono(seq_new)))

med = lambda xs: sorted(xs)[len(xs) // 2] if xs else 0
cap, miss = [], []
for sid, f in turnfiles.items():
    if sid in machine:
        continue
    caught = {r['uuid'] for r in new.get(sid, [])}
    for t in json.load(open(f))['turns']:
        if t['role'] != 'user' or len(t['text'].split()) < 3:
            continue
        (cap if t['uuid'] in caught else miss).append(len(t['text'].split()))
print('  median words: captured=%d  missed=%d   (audit measured 159 vs 51)'
      % (med(cap), med(miss)))

# Per-MOMENT keep rate. This is the length-neutrality test that matches the unit
# the judge actually sees. The per-turn curve above cannot be flat any more: a
# long turn now yields k moments and counts as captured if ANY is kept, so
# P(capture) = 1-(1-p)^k rises with k by construction -- that is defect 6's fix
# showing up in defect 2's metric, not selection bias.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util as _il
_spec = _il.spec_from_file_location('score',
    os.path.join(_SCRIPTS, 'score.py'))
_score = _il.module_from_spec(_spec); _spec.loader.exec_module(_score)
_cache = _score.load_cache(STATE)
_mom = _score.load_moments(STATE)
print()
print('PER-MOMENT KEEP RATE BY MOMENT LENGTH (the unit the judge sees)')
for role in ('user', 'assistant'):
    t2 = collections.Counter(); k2 = collections.Counter()
    for r in _mom:
        if r.get('role') != role:
            continue
        v = _cache.get(_score.moment_hash(r))
        if not v:
            continue
        bb = bucket(len(r['text'].split()))
        t2[bb] += 1
        if v.get('keep'):
            k2[bb] += 1
    seq = []
    row = []
    for _, _, nm in BUCKETS:
        if t2[nm] < 20:
            continue
        rate = 100.0 * k2[nm] / t2[nm]
        seq.append(rate)
        row.append('%s %.1f%% (n=%d)' % (nm, rate, t2[nm]))
    print('  %-10s %s' % (role, '  |  '.join(row)))
    print('  %-10s monotonic=%s  spread=%.2fx'
          % ('', mono(seq), (max(seq) / min(seq)) if seq and min(seq) else 0))

# ---------------------------------------------------------------- defect 3
bad = [r for v in new.values() for r in v if prefilter.is_pipeline_text(r['text'])]
# Independent of the detector: the two prompt openings the audit found ingested,
# plus any candidate coming from a session stage 1 classified as machine-driven.
LITERAL = ['below are candidate friction moments mined from',
           "you maintain an engineer's ai-agent setup"]
lit = [r for v in new.values() for r in v
       if any(x in norm(r['text']) or x in norm(r.get('context')) for x in LITERAL)]
from_machine = [sid for sid in new if sid in machine]
print()
print('PIPELINE-OWN-PROMPT CANDIDATES: %d  (literal-match check: %d, '
      'candidates from machine-driven sessions: %d)'
      % (len(bad), len(lit), len(from_machine)))
for r in bad[:5]:
    print('   !! %s' % r['text'][:120].replace('\n', ' '))

# ---------------------------------------------------------------- spot checks
SPOT = [
    "It visually didn't come out good. try again",
    "Are you sure? Because I could have sworn the home PC can SSH into the Mac",
    "I've been guessing and I was wrong four times",
    "hmm the pitch is a bit high level. i guess im not sold",
]
print()
print('SPOT CHECKS (previously missed)')
allrows = [r for v in new.values() for r in v]
for q in SPOT:
    nq = norm(q)
    got = [r for r in allrows if nq[:45] in norm(r['text'])]
    in1 = [r for v in stage1.values() for r in v if nq[:45] in norm(r['text'])]
    print('  [%s] %s' % ('CAUGHT' if got else ('stage1 only' if in1 else ' MISS '), q))
    for r in got[:1]:
        print('           role=%s kind=%s why=%s' % (r['role'], r['kind'], r.get('why', '')))
