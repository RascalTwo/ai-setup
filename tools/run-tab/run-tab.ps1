# prefix+c / prefix+shift+c in herdr (Windows port of ai-setup/tools/run-tab/run-tab, a zsh script).
# Ask for a command, open a new tab running it. Empty input = a plain new tab; Esc = cancel.
# -Close (prefix+shift+c): the tab closes as soon as the command exits and you return to the tab you
# came from. -Back <tab> is the internal callback that does the returning.
param([switch]$Close, [string]$Back)
$ErrorActionPreference = "Stop"

function Get-FocusedTab {
    ((herdr tab list | ConvertFrom-Json).result.tabs | Where-Object { $_.focused } | Select-Object -First 1).tab_id
}

if ($Back) {
    # Only jump back if you are still looking at the tab the command ran in: a long command
    # shouldn't yank you from elsewhere.
    $me = if ($env:HERDR_TAB_ID) { $env:HERDR_TAB_ID } else { $env:HERDR_ACTIVE_TAB_ID }
    if ((Get-FocusedTab) -eq $me) { herdr tab focus $Back | Out-Null }
    exit 0
}

$label = if ($Close) { "[close on exit] run> " } else { "run> " }
$cmd = ""
Clear-Host
while ($true) {
    [Console]::SetCursorPosition(0, 0)
    $w = [Console]::WindowWidth - 1
    $shown = $label + $cmd
    if ($shown.Length -gt $w) { $shown = $shown.Substring($shown.Length - $w) }
    Write-Host ($shown.PadRight($w)) -NoNewline
    [Console]::SetCursorPosition([Math]::Min($shown.Length, $w), 0)
    $k = [Console]::ReadKey($true)
    if ($k.Key -eq "Enter") { break }
    elseif ($k.Key -eq "Escape") { exit 0 }
    elseif ($k.Key -eq "Backspace") { if ($cmd.Length) { $cmd = $cmd.Substring(0, $cmd.Length - 1) } }
    elseif ($k.KeyChar -and -not [char]::IsControl($k.KeyChar)) { $cmd += $k.KeyChar }
}

$origin = Get-FocusedTab
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
if (-not $cmd) { exit 0 }
if ($Close) {
    $self = $MyInvocation.MyCommand.Path
    $cmd = "$cmd; & powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$self' -Back $origin; exit"
}
herdr pane run $pane $cmd | Out-Null
