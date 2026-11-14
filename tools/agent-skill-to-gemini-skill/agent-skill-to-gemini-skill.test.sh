#!/bin/sh
# Builds throwaway skills and checks what agent-skill-to-gemini-skill makes of them. Needs ImageMagick (magick).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "✗ $1"; exit 1; }
conv() { python3 "$here/agent-skill-to-gemini-skill.py" "$@"; }

s="$t/demo-skill"; mkdir -p "$s/references/deep" "$s/assets" "$s/scripts"
printf -- '---\nname: demo-skill\ndescription: Demo. Use when testing.\n---\n\n# Demo\n\nRead `references/a.md`. Logo: `assets/logo.png`.\n' > "$s/SKILL.md"
printf 'alpha\n```js\nx()\n```\nlogo again: assets/logo.png\n' > "$s/references/a.md"
echo 'beta = 1' > "$s/references/deep/b.toml"
echo 'echo hi' > "$s/scripts/run.sh"
magick -size 16x16 xc:red "$s/assets/logo.png"
magick -size 8x8 xc:blue "$s/assets/unnamed.png"
magick -size 200x200 xc: +noise Random "$s/assets/big.png"
printf 'wOF2\000\001\377' > "$s/assets/font.woff2"
touch "$s/.DS_Store"

conv "$s" --out "$t/out" >/dev/null 2>"$t/err" || fail "a clean skill should pass: $(cat "$t/err")"
out="$t/out/demo-skill"
[ "$(cd "$out" && /usr/bin/find . -type f | LC_ALL=C sort | tr '\n' ' ')" = "./SKILL.md " ] || fail "only SKILL.md should be left, pictures go inside it: $(cd "$out" && /usr/bin/find . -type f)"
grep -q '^## FILE: references/deep/b.toml$' "$out/SKILL.md" || fail ".toml is inlined, not refused"
grep -q '^## FILE: scripts/run.sh$' "$out/SKILL.md" || fail "scripts are inlined"
grep -q '^````$' "$out/SKILL.md" || fail "a file holding a code fence gets a longer fence"
grep -q 'font.woff2' "$t/err" || fail "a dropped binary is reported"
grep -q 'WARNING: as of .* Gemini skills garble pictures' "$t/err" && grep -q 'Use demo-skill.megaprompt.md instead' "$t/err" || fail "a skill with pictures prints the big warning pointing to the megaprompt"
grep -q 'assets/logo.png' "$out/SKILL.md" && fail "a picture's path is replaced by its data URI everywhere"
[ "$(grep -c 'data:image/png;base64,iVBOR' "$out/SKILL.md")" = 3 ] || fail "logo written in SKILL.md and the inlined file, unnamed.png gets a catalog row: $(grep -c 'data:image/png;base64,iVBOR' "$out/SKILL.md")"
grep -q '^- `assets/unnamed.png`: data:image/png;base64,' "$out/SKILL.md" || fail "a picture no text names gets a catalog row"
grep -q 'big.png' "$t/err" && ! grep -q 'big.png' "$out/SKILL.md" || fail "a picture over the cap after shrinking is left out with a warning naming it"
python3 -c "import zipfile,sys; n=sorted(zipfile.ZipFile(sys.argv[1]).namelist()); sys.exit(n!=['demo-skill/SKILL.md'])" "$t/out/demo-skill.zip" || fail "zip holds the folder at the top and no image files"

echo '{"assets/logo.png": "https://lh3.example/d/LOGO", "assets/big.png": "https://lh3.example/d/BIG"}' > "$t/map.json"
conv "$s" --out "$t/out" --image-urls "$t/map.json" >/dev/null 2>"$t/err" || fail "a map of real pictures passes: $(cat "$t/err")"
mega="$t/out/demo-skill.megaprompt.md"
[ "$(head -1 "$mega")" = "---" ] || fail "without .gemini-preamble.md the megaprompt starts with the frontmatter"
grep -q '^# IMAGE CATALOG' "$mega" && grep -q '^- `assets/big.png`: https://lh3.example/d/BIG$' "$mega" || fail "the megaprompt's catalog holds the mapped URLs"
grep -q 'Logo: `https://lh3.example/d/LOGO`' "$mega" && grep -q 'logo again: https://lh3.example/d/LOGO' "$mega" || fail "the megaprompt rewrites mapped paths in SKILL.md and inlined files"
grep -q 'unnamed.png (no --image-urls entry)' "$t/err" && ! grep -q 'data:image' "$mega" || fail "an unmapped picture is warned about and left out of the megaprompt"
grep -q 'lh3.example' "$out/SKILL.md" && fail "the map feeds the megaprompt only, never the skill"
cp "$t/out/demo-skill.zip" "$t/first.zip"; cp "$mega" "$t/first.md"
conv "$s" --out "$t/out" --image-urls "$t/map.json" >/dev/null 2>&1
cmp -s "$t/first.zip" "$t/out/demo-skill.zip" && cmp -s "$t/first.md" "$mega" || fail "same input gives a byte-identical zip and megaprompt"
echo '{"assets/nope.png": "https://x"}' > "$t/bad.json"
conv "$s" --out "$t/out" --image-urls "$t/bad.json" >/dev/null 2>"$t/err" && fail "an unknown map key must fail"
grep -q 'assets/nope.png' "$t/err" || fail "the unknown-key failure names it"

i=0; while [ $i -lt 100 ]; do printf '%%PDF' > "$s/assets/i$i.pdf"; i=$((i+1)); done
conv "$s" --out "$t/out" >/dev/null 2>"$t/err" && fail "101 files must fail"
grep -q 'over Gemini' "$t/err" || fail "the file-count failure says why"
conv "$s" --out "$t/out" --exclude 'assets/i*' >/dev/null 2>&1 || fail "--exclude brings it back under the limit"
conv "$s" --out "$t/out" --exclude 'assets/' >/dev/null 2>&1 || fail "a folder pattern (assets/) excludes everything under it"

printf '# comment\nassets/*\n!assets/logo.png\n' > "$s/.geminiignore"
conv "$s" --out "$t/out" >/dev/null 2>&1 || fail ".geminiignore brings it back under the limit"
grep -q 'data:image' "$out/SKILL.md" && [ ! -f "$out/assets/i0.pdf" ] && [ ! -f "$out/.geminiignore" ] || fail ".geminiignore: last match wins, and the file itself isn't shipped"

g="$t/repo/git-skill"; mkdir -p "$g/node_modules/x"
printf -- '---\nname: git-skill\ndescription: Demo.\n---\n\nHi\n' > "$g/SKILL.md"
echo 'module' > "$g/node_modules/x/index.js"
git -C "$t/repo" init -q && git -C "$t/repo" add git-skill/SKILL.md
conv "$g" --out "$t/out" >/dev/null 2>&1 || fail "git skill converts"
grep -q 'node_modules' "$t/out/git-skill/SKILL.md" && fail "in a git repo, untracked files are left out"

p="$t/pre-skill"; mkdir -p "$p/references"
printf -- '---\nname: pre-skill\ndescription: Demo.\n---\n\nOriginal\n' > "$p/SKILL.md"
echo 'ref' > "$p/references/r.md"
printf 'GEMINI FIRST\n' > "$p/.gemini-preamble.md"
conv "$p" --out "$t/out" >/dev/null 2>"$t/err" || fail "a skill with .gemini-preamble.md converts"
grep -q 'WARNING' "$t/err" && fail "a skill without pictures gets no picture warning"
[ "$(sed -n 5,6p "$t/out/pre-skill/SKILL.md")" = "$(printf '\nGEMINI FIRST')" ] || fail ".gemini-preamble.md is the first thing in the body: $(sed -n 1,8p "$t/out/pre-skill/SKILL.md")"
[ "$(head -1 "$t/out/pre-skill.megaprompt.md")" = "GEMINI FIRST" ] || fail ".gemini-preamble.md is the first line of the megaprompt"
[ ! -e "$t/out/pre-skill/.gemini-preamble.md" ] && ! grep -q 'FILE: .gemini-preamble' "$t/out/pre-skill/SKILL.md" || fail ".gemini-preamble.md is neither shipped nor inlined"

u="$t/url-skill"; mkdir -p "$u/references"
printf -- '---\nname: url-skill\ndescription: Demo, see https://example.com/front.\n---\n\nIntro\n\nDocs at https://example.com/docs here.\n' > "$u/SKILL.md"
printf 'one\nfonts: http://example.org/f.css\n' > "$u/references/r.md"
conv "$u" --out "$t/out" >/dev/null 2>"$t/err" && fail "a skill holding web addresses must be refused"
grep -q 'SKILL.md:3: https://example.com/front' "$t/err" && grep -q 'SKILL.md:8: https://example.com/docs' "$t/err" && grep -q 'references/r.md:2: http://example.org/f.css' "$t/err" || fail "the refusal lists each web address by file:line: $(cat "$t/err")"
[ ! -e "$t/out/url-skill.zip" ] || fail "a refused skill isn't written"
grep -q 'https://example.com/docs' "$t/out/url-skill.megaprompt.md" || fail "the megaprompt keeps web addresses"
conv "$u" --out "$t/out" --strip-urls >/dev/null 2>"$t/err" || fail "--strip-urls writes the skill: $(cat "$t/err")"
grep -q 'example\.' "$t/out/url-skill/SKILL.md" && fail "--strip-urls leaves no web address in the skill"
grep -q 'references/r.md:2: http://example.org/f.css' "$t/err" || fail "--strip-urls lists what it removed"

sed -i.bak 's/^name: demo-skill/name: Demo_Skill/' "$s/SKILL.md"
conv "$s" --out "$t/out" --exclude 'assets/i*' >/dev/null 2>"$t/err" && fail "a bad name must fail"
echo "✓ agent-skill-to-gemini-skill"
