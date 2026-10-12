## Contents
- Phase 3: Skills Audit
  - The hard invariant (check first)
  - Upstream freshness (run second)
  - Per-skill review (owned + third-party)

## Phase 3: Skills Audit

### The hard invariant (check first)

**Every entry in `~/.agents/skills` is EITHER a symlink into one of the repos (owned) OR listed in `external-skills.json` (third-party). Any real dir not in the manifest is an orphan.** This is the single most important skills check — run it every audit:

`external-skills.json` is the **single, manually-maintained source of truth** for third-party skills. (There is an `npx`-managed lock file on disk, but it silently fails to update, so do NOT trust it for provenance — the manifest is authoritative.) A real dir is accounted for **only** if its name is explicitly listed in the manifest. This means a repo entry of `"*"` (whole-catalog wildcard) defeats the check — its individual skill names aren't in the manifest, so they can't be verified by name. **Prefer enumerating a repo's skills explicitly over `"*"`**; that's the whole point of maintaining the manifest by hand, and it makes this check exact.

An overlay can carry its own `external-skills.json` (same shape) for third-party skills that
must not be named publicly — `install.ts --externals` reads every one. So "the manifest" is the
public file **merged with every overlay's**; checking the public file alone reports an
overlay-declared skill as an orphan.

```bash
DOC=$(mktemp)   # the public manifest merged with every overlay's
{ cat "$HOME/Desktop/Desktop/Code/ai-setup/external-skills.json"
  for o in $(jq -r '.overlays[]' ~/.agents/overlays.json); do
    f="${o/#\~/$HOME}/external-skills.json"; [ -f "$f" ] && cat "$f"
  done; } | jq -s '{repos: (map(.repos) | add)}' > "$DOC"

# Repos documented with a "*" wildcard — their skills can't be name-verified.
wildcard_repos=$(jq -r '.repos | to_entries[] | select(.value | index("*")) | .key' "$DOC")

echo "--- Unaccounted: real dirs whose name is not explicitly in the manifest ---"
for d in ~/.agents/skills/*; do
  name=$(basename "$d")
  [ -L "$d" ] && continue                        # symlink into a repo = owned, fine
  # The Claude desktop app mirrors claude.ai skills (anthropic-skills:*) into `synced/`.
  # The app owns and rewrites it; it is not ours to manifest or remove.
  [ "$name" = synced ] && continue
  jq -e --arg n "$name" '[.repos[][]] | index($n)' "$DOC" >/dev/null && continue
  echo "UNACCOUNTED: $name"
done
[ -n "$wildcard_repos" ] && echo "(note: these repos use \"*\" — their skills appear above until enumerated: $wildcard_repos)"

echo "--- Documented but not installed (manifest names it, disk doesn't have it) ---"
jq -r '.repos | to_entries[] | .value[]' "$DOC" | grep -v '^\*$' | sort -u | while read s; do
  [ -e ~/.agents/skills/"$s" ] || echo "MISSING on disk: $s"
done

echo "--- Broken owned symlinks (target repo dir moved/deleted) ---"
for d in ~/.agents/skills/*; do
  [ -L "$d" ] && [ ! -e "$d" ] && echo "BROKEN: $(basename "$d") -> $(readlink "$d")"
done
```

For each finding:
- **UNACCOUNTED** — a real dir whose name isn't in the manifest. Two cases: (a) it belongs to a `"*"` wildcard repo listed in the note — the real fix is to replace that repo's `"*"` with its explicit skill list so the check goes quiet and precise; or (b) it's a genuine orphan — either promote it to an owned skill (move into `ai-setup/skills/` or an overlay so `install.ts` symlinks it) or document it (`owner/repo: ["skill"]` under `repos`). Ask the user which.
- **MISSING on disk** — the manifest promises it but it isn't installed. Re-install via `install.ts --externals` (or `npx skills add <repo> -s <skill> -g -a claude-code -a codex --yes`), or drop the manifest entry.
- **BROKEN** — an owned symlink whose repo target vanished. Re-point or re-run `install.ts`.

`external-skills.json` shape, for reference:
```json
{
  "repos": { "owner/repo": ["skill-a", "skill-b"], "other/repo": ["*"] }
}
```

### Upstream freshness (run second)

The invariant above answers *is it installed?*. It says nothing about *is it current?* or *what did upstream add?* — so third-party skills rot silently and new ones never surface. This check closes both gaps in one pass per repo.

It works by **content hash**: a skill is fresh when its installed `SKILL.md` matches some blob in its source repo's tree. That sidesteps mapping local names to upstream paths, which is fragile — upstream reorganises (mattpocock moved every skill into `engineering/`, `productivity/`, `misc/` category dirs without renaming one).

```bash
DOC=$HOME/Desktop/Desktop/Code/ai-setup/external-skills.json
SEEN=$HOME/Desktop/Desktop/Code/ai-setup/external-skills-reviewed.json   # verdicts on skills not taken

for repo in $(jq -r '.repos | keys[]' "$DOC"); do
  tree=$(gh api "repos/$repo/git/trees/HEAD?recursive=1" \
           --jq '.tree[] | select(.path | test("(^|/)SKILL\\.md$"; "i")) | "\(.sha) \(.path)"') \
    || { echo "UNREACHABLE  $repo — API call failed (renamed, private, or rate-limited)"; continue; }

  if [ -z "$tree" ]; then
    echo "NO-SKILL-MD  $repo — no committed SKILL.md; its own installer stages one. Check releases by hand."
    continue
  fi

  # STALE — installed SKILL.md matches no upstream blob: behind, or edited locally.
  for s in $(jq -r --arg r "$repo" '.repos[$r][]' "$DOC"); do
    [ "$s" = "*" ] && continue
    f=$HOME/.agents/skills/"$s"/SKILL.md
    [ -f "$f" ] || { echo "GONE         $s ($repo) — in manifest, absent on disk"; continue; }
    echo "$tree" | cut -d' ' -f1 | grep -qx "$(git hash-object "$f")" || echo "STALE        $s ($repo)"
  done

  # NEW — upstream skill neither installed nor reviewed. CHANGED — reviewed, but upstream has
  # edited it since the verdict (some current SKILL.md hash isn't in the recorded ones).
  known=$(jq -r --arg r "$repo" '.repos[$r] // [] | .[]' "$DOC")
  echo "$tree" | awk '{print $2}' | sed 's|/[^/]*$||; s|.*/||' | sort -u | while read -r n; do
    [ "$n" = "SKILL.md" ] && continue
    echo "$known" | grep -qx "$n" && continue
    seen=$(jq -r --arg k "$repo/$n" '.reviewed[$k] | select(.) | .shas[]' "$SEEN")
    if [ -z "$seen" ]; then echo "NEW          $repo/$n"; continue; fi
    now=$(echo "$tree" | awk -v n="$n" '$2 ~ ("(^|/)" n "/[^/]*$") {print $1}')
    for h in $now; do
      echo "$seen" | grep -qx "$h" || { echo "CHANGED      $repo/$n — $(jq -r --arg k "$repo/$n" '.reviewed[$k] | "\(.verdict) \(.date): \(.why)"' "$SEEN")"; break; }
    done
  done
done
```

⚠️ **Write `for s in $(jq ...)`, not `while IFS=$'\t' read`.** The `IFS` prefix leaks past `read` in this shell, so a tab-delimited line never word-splits and the whole skill list arrives as one `$s` — every skill in the repo then reports `GONE` at once. A run where an entire repo's skills are `GONE` on one line is this bug, not a real finding.

For each finding:
- **STALE** — offer `npx skills@latest update -g -y <names…>`, then **re-run this check
  to confirm the hashes now match**. Verify in `~/.agents/skills` alone: `~/.claude/skills`
  is a whole-dir symlink to it, so the two paths are one copy and checking both proves nothing.

  ⚠️ **Never trust the updater's success line — diff its report against the names you asked
  for.** On 2026-08-30 it printed `✓ Updated 35 skill(s)` for a list of 37 and said nothing
  about the two it skipped. Both failures were in `~/.agents/.skill-lock.json`, which this
  skill already warns is unreliable for provenance — it is equally unreliable as an update
  index:
  - `graphify` — the lock recorded `skillPath: "graphify/SKILL.md"` but the repo ships
    lowercase `graphify/skill.md`. GitHub's API is case-sensitive, so the fetch 404s and the
    skill is skipped silently. Fixing the lock's path made the updater see it (it then failed
    for a different reason: graphify is a pipx package that self-stages its skill, so the real
    remedy was `pipx upgrade graphifyy && graphify install --platform claude`). ⚠️ `graphify install` also **appends a `# graphify` block to
    `~/.claude/CLAUDE.md`** — which is `ai-setup/AGENTS.md` — duplicating the rules file's own
    graphify section. `git -C ai-setup diff AGENTS.md` after it, and revert the append.
  - `find-skills` — the lock claimed a recent `updatedAt` while the content still predated an
    upstream commit, so the updater considered it current and skipped it. Overwriting the file
    from upstream was the fix.

  So after ANY update run: `grep` the updater's output for each requested name, and re-run the
  hash check. A skill that is still `STALE` was either skipped (check the lock entry's
  `skillPath` case and `updatedAt`) or genuinely edited locally — only after ruling out the
  first should you show the user a diff and ask whether to keep the edit.
- **NEW** — report it with its one-line upstream description so the user can judge. Taken →
  add to `.repos` and install. Not taken → record the verdict in `external-skills-reviewed.json`
  (`shas` = every current upstream SKILL.md hash for it, `verdict` passed | declined | stole,
  `date`, `why`), so it stops being offered. Lead with what the skill *does* and what it would
  duplicate — not a take/decline verdict the user has to argue with.
- **CHANGED** — a skill the user already ruled on, which upstream has edited since. Re-offer it
  with its old verdict and what changed (diff the SKILL.md). Whatever they decide, update its
  `shas` so it goes quiet until the next upstream edit.

  *Why a verdict log after all:* on 2026-08-30 there was deliberately no declined-list, because
  a stale no is worse than a repeat ask. On 2026-09-27 the list was 135 long and the user asked
  for one. Keying each verdict to the upstream hash keeps the 08-30 point — nothing is refused
  forever; any upstream change brings it back — while dropping the unchanged repeats.
- **NO-SKILL-MD / UNREACHABLE** — no automated read is possible. Name the repo and let the user check its releases.
- **GONE** — same remedy as **MISSING on disk** above.

**Done when** every third-party skill is `ok` or has a recorded reason, and every `NEW` and
`CHANGED` has been shown to the user and either installed or recorded in
`external-skills-reviewed.json`.

### Per-skill review (owned + third-party)

For each skill (read its SKILL.md):

1. **Quality** — Is the description clear and specific enough to trigger correctly, on BOTH agents? Is the body well-structured?
2. **Staleness** — Does it reference files, APIs, or workflows that no longer exist?
3. **Dead references** — Does it reference other skills, memory notes, or files that don't exist? Check each.
4. **Cross-references** — Should it reference other skills or memory notes it currently doesn't? Would a "See also" help?
5. **Usage** — From the Phase 0 report, how often is it invoked (subject to the Codex-blind caveat)? Low Claude usage + stale content = removal candidate, but confirm it isn't a Codex-driven or rare-but-critical skill.
6. **Overlay placement** — Does an owned skill contain company/client specifics? If so it belongs in a **private overlay**, not the public core. Flag any such skill sitting in `ai-setup/skills/`.
7. **Vendored?** — A skill can be a symlink into our repo and STILL not be ours to edit: it may
   be a skill-shaped rendering of someone else's document. Check for a `PROVENANCE.md` beside
   `SKILL.md` before proposing any edit, and treat it as binding. `documandments` is one
   (it renders documandments.com). Nothing enforces this — the freshness check in this phase
   only covers skills installed via `npx skills`, so a vendored owned-skill has no upstream
   diff to catch drift. To add a rule, put it in a file we own and point at the vendored one;
   to resolve a conflict between two unowned skills, arbitrate in a third file we own.

Present recommendations one at a time.

