#!/bin/sh
# Builds throwaway skills and checks what agent-skill-to-gemini-skill makes of them.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "✗ $1"; exit 1; }

s="$t/demo-skill"; mkdir -p "$s/references/deep" "$s/assets" "$s/scripts"
printf -- '---\nname: demo-skill\ndescription: Demo. Use when testing.\n---\n\n# Demo\n\nRead `references/a.md`.\n' > "$s/SKILL.md"
printf 'alpha\n```js\nx()\n```\n' > "$s/references/a.md"
echo 'beta = 1' > "$s/references/deep/b.toml"
echo 'echo hi' > "$s/scripts/run.sh"
printf '\211PNG\r\n' > "$s/assets/logo.png"
printf 'wOF2\000\001\377' > "$s/assets/font.woff2"
touch "$s/.DS_Store"

python3 "$here/agent-skill-to-gemini-skill.py" "$s" --out "$t/out" >/dev/null 2>"$t/err" || fail "a clean skill should pass: $(cat "$t/err")"
out="$t/out/demo-skill"
[ "$(cd "$out" && /usr/bin/find . -type f | LC_ALL=C sort | tr '\n' ' ')" = "./SKILL.md ./assets/logo.png " ] || fail "only SKILL.md and the image should be left: $(cd "$out" && /usr/bin/find . -type f)"
grep -q '^## FILE: references/deep/b.toml$' "$out/SKILL.md" || fail ".toml is inlined, not refused"
grep -q '^## FILE: scripts/run.sh$' "$out/SKILL.md" || fail "scripts are inlined"
grep -q '^````$' "$out/SKILL.md" || fail "a file holding a code fence gets a longer fence"
grep -q 'font.woff2' "$t/err" || fail "a dropped binary is reported"
python3 -c "import zipfile,sys; n=sorted(zipfile.ZipFile(sys.argv[1]).namelist()); sys.exit(n!=['demo-skill/SKILL.md','demo-skill/assets/logo.png'])" "$t/out/demo-skill.zip" || fail "zip holds the folder at the top"
cp "$t/out/demo-skill.zip" "$t/first.zip"
python3 "$here/agent-skill-to-gemini-skill.py" "$s" --out "$t/out" >/dev/null 2>&1
cmp -s "$t/first.zip" "$t/out/demo-skill.zip" || fail "same input gives a byte-identical zip"

i=0; while [ $i -lt 100 ]; do printf '\211PNG' > "$s/assets/i$i.png"; i=$((i+1)); done
python3 "$here/agent-skill-to-gemini-skill.py" "$s" --out "$t/out" >/dev/null 2>"$t/err" && fail "102 files must fail"
grep -q 'over Gemini' "$t/err" || fail "the file-count failure says why"
python3 "$here/agent-skill-to-gemini-skill.py" "$s" --out "$t/out" --exclude 'assets/i*' >/dev/null 2>&1 || fail "--exclude brings it back under the limit"
python3 "$here/agent-skill-to-gemini-skill.py" "$s" --out "$t/out" --exclude 'assets/' >/dev/null 2>&1 || fail "a folder pattern (assets/) excludes everything under it"

printf '# comment\nassets/*\n!assets/logo.png\n' > "$s/.geminiignore"
python3 "$here/agent-skill-to-gemini-skill.py" "$s" --out "$t/out" >/dev/null 2>&1 || fail ".geminiignore brings it back under the limit"
[ -f "$out/assets/logo.png" ] && [ ! -f "$out/assets/i0.png" ] && [ ! -f "$out/.geminiignore" ] || fail ".geminiignore: last match wins, and the file itself isn't shipped"

g="$t/repo/git-skill"; mkdir -p "$g/node_modules/x"
printf -- '---\nname: git-skill\ndescription: Demo.\n---\n\nHi\n' > "$g/SKILL.md"
echo 'module' > "$g/node_modules/x/index.js"
git -C "$t/repo" init -q && git -C "$t/repo" add git-skill/SKILL.md
python3 "$here/agent-skill-to-gemini-skill.py" "$g" --out "$t/out" >/dev/null 2>&1 || fail "git skill converts"
grep -q 'node_modules' "$t/out/git-skill/SKILL.md" && fail "in a git repo, untracked files are left out"

sed -i.bak 's/^name: demo-skill/name: Demo_Skill/' "$s/SKILL.md"
python3 "$here/agent-skill-to-gemini-skill.py" "$s" --out "$t/out" --exclude 'assets/i*' >/dev/null 2>"$t/err" && fail "a bad name must fail"
echo "✓ agent-skill-to-gemini-skill"
