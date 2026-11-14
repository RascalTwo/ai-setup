# Run elevated on the PC. Removes everything install.ps1 added.
Unregister-ScheduledTask -TaskName 'ming-tts-server' -Confirm:$false -ErrorAction SilentlyContinue
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=8894 | Out-Null
Remove-NetFirewallRule -DisplayName 'ming-tts-tailscale' -ErrorAction SilentlyContinue
