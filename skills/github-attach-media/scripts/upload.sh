#!/bin/sh
# Upload an image or video through a repo's classic wiki editor with browse; print the user-attachments URL.
#   upload.sh <session> <owner/repo> <file> [--dry-run]
# Needs a browse session signed in to GitHub (`browse session new <name>`). The wiki page is never saved.
# --dry-run stops before the file is handed to GitHub's uploader (nothing is published): it proves the
# copy into browse's file root, the classic editor, and the file input.
set -eu
[ $# -ge 3 ] || { sed -n '2,6p' "$0"; exit 2; }
session=$1; repo=$2; file=$3; dry=false
[ "${4:-}" = "--dry-run" ] && dry=true
name=$(basename "$file")
# setInputFiles only accepts files under browse's private file root, so copy there first.
dir=$(browse execute -s "$session" --json 'return files.dir' | jq -r .value)
cp "$file" "$dir/$name"
tmp=$(mktemp)
trap 'rm -f "$tmp" "$dir/$name"' EXIT
{
  printf 'const name = %s, repo = %s, dry = %s;\n' "$(printf '%s' "$name" | jq -Rs .)" "$(printf '%s' "$repo" | jq -Rs .)" "$dry"
  cat <<'JS'
page.on("dialog", (d) => d.accept()); // the wiki's "leave site?" guard
await page.goto(`https://github.com/${repo}/wiki/_new`, { timeout: 30000 });
const classic = await page.evaluate(() => !!document.querySelector("file-attachment") && !!document.querySelector("#gollum-editor-body"));
if (!classic) return { error: `no classic editor at ${page.url()}: wiki disabled or no access; try another repo's wiki` };
const input = page.locator("file-attachment input[type=file]");
const body = page.locator("#gollum-editor-body");
await body.fill("", { timeout: 5000 });
let out;
if (dry) {
  out = { dryRun: true, fileInputs: await input.count(), accept: await input.first().getAttribute("accept", { timeout: 5000 }) };
} else {
  await input.setInputFiles(files.path(name), { timeout: 5000 });
  let v = "";
  for (let i = 0; i < 180 && !out; i++) { // a video takes longer than an image
    v = await body.inputValue({ timeout: 5000 });
    const m = v.match(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+/);
    if (m) out = { url: m[0], imgTag: v.trim() };
    else await page.waitForTimeout(500);
  }
  out ??= { error: "timed out waiting for user-attachments URL", body: v };
}
await body.fill("", { timeout: 5000 });
await page.goto("about:blank", { timeout: 10000 }); // leave unsaved
return out;
JS
} > "$tmp"
browse execute -s "$session" --timeout-ms 150000 --file "$tmp"
