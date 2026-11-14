# Run elevated on the PC. Exposes the WSL server to Tailscale only and registers it to start at logon.
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 [-NoTask]
# WSL2 NAT forwards 127.0.0.1:8893 on Windows into WSL by itself; the portproxy re-exposes it on 8894 for the tailnet
# (a second port, because wslhost already holds 127.0.0.1:8893). The firewall rule admits only 100.64.0.0/10.
param([switch]$NoTask)
$ErrorActionPreference = 'Stop'
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8894 connectaddress=127.0.0.1 connectport=8893 | Out-Null
if (-not (Get-NetFirewallRule -DisplayName 'ming-tts-tailscale' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'ming-tts-tailscale' -Direction Inbound -Protocol TCP -LocalPort 8894 `
    -RemoteAddress 100.64.0.0/10 -Action Allow | Out-Null
}
if (-not $NoTask) {
  # run-server.sh sits beside this script; WSL sees C:\a\b as /mnt/c/a/b. The task runs as whoever installs it.
  $wslDir = '/mnt/' + $PSScriptRoot.Substring(0, 1).ToLower() + ($PSScriptRoot.Substring(2) -replace '\\', '/')
  $action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d Ubuntu-24.04 -u root -e bash $wslDir/run-server.sh"
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest
  Register-ScheduledTask -TaskName 'ming-tts-server' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}
