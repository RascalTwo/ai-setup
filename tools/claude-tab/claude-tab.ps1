# prefix+a in herdr (Windows port of ai-setup/tools/claude-tab/claude-tab, a zsh script).
# A small popup: type the first prompt, pick model and effort, Enter. Opens a new tab in the "~" workspace
# running `claude --dangerously-skip-permissions --model ... --effort ...` with that prompt.
# Empty prompt = a bare session. Esc = cancel. Tab cycles the model, Up/Down change the effort.
$ErrorActionPreference = "Stop"
$models  = "opus", "sonnet", "haiku"
$names   = "Opus 5.5", "Sonnet 5.5", "Haiku 5.5"
$efforts = "low", "medium", "high", "xhigh", "max"
$mi = 0; $ei = 1
$prompt = ""

function Show {
    $line = "{0} | {1}   [Tab model, Up/Down effort, Enter launch, Esc cancel]" -f $names[$mi], $efforts[$ei]
    [Console]::SetCursorPosition(0, 0)
    Write-Host ($line.PadRight([Console]::WindowWidth - 1)) -NoNewline -ForegroundColor DarkGray
    [Console]::SetCursorPosition(0, 1)
    $shown = "> " + $prompt
    $w = [Console]::WindowWidth - 1
    if ($shown.Length -gt $w) { $shown = $shown.Substring($shown.Length - $w) }
    Write-Host ($shown.PadRight($w)) -NoNewline
    [Console]::SetCursorPosition([Math]::Min($shown.Length, $w), 1)
}

Clear-Host
while ($true) {
    Show
    $k = [Console]::ReadKey($true)
    switch ($k.Key) {
        "Enter"     { break }
        "Escape"    { exit 0 }
        "Tab"       { $mi = ($mi + 1) % $models.Count; continue }
        "UpArrow"   { if ($ei -lt $efforts.Count - 1) { $ei++ }; continue }
        "DownArrow" { if ($ei -gt 0) { $ei-- }; continue }
        "Backspace" { if ($prompt.Length) { $prompt = $prompt.Substring(0, $prompt.Length - 1) }; continue }
        default     { if ($k.KeyChar -and -not [char]::IsControl($k.KeyChar)) { $prompt += $k.KeyChar }; continue }
    }
    if ($k.Key -eq "Enter") { break }
}

$cmd = "claude --dangerously-skip-permissions --model $($models[$mi]) --effort $($efforts[$ei])"
if ($prompt) {
    $f = Join-Path $env:TEMP ("claude-tab." + [guid]::NewGuid().ToString("N") + ".txt")
    # Windows PowerShell 5.1 drops embedded double quotes when it passes args to a native exe, so the file
    # holds the prompt with each " already backslash-escaped. (The command line below must stay free of
    # double quotes too: herdr.exe, a native exe, would lose them on the way in.)
    [IO.File]::WriteAllText($f, $prompt.Replace('"', '\"'))
    $cmd += " (Get-Content -Raw -LiteralPath '$f')"
}

# Always the "~" workspace (herdr labels a workspace made at the home dir "~"), never whichever one has
# focus. Gone (its last pane closed)? Recreate it; its first tab is the session's tab.
$ws = (herdr workspace list | ConvertFrom-Json).result.workspaces | Where-Object { $_.label -eq "~" } | Select-Object -First 1
if ($ws) {
    $wsId = $ws.workspace_id
    $pane = (herdr tab create --workspace $wsId --cwd $HOME --focus | ConvertFrom-Json).result.root_pane.pane_id
} else {
    $out = herdr workspace create --cwd $HOME --label "~" --focus | ConvertFrom-Json
    $wsId = $out.result.workspace.workspace_id
    $pane = $out.result.root_pane.pane_id
}
herdr workspace focus $wsId | Out-Null
herdr pane run $pane $cmd | Out-Null
