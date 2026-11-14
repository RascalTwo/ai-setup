# Install the Agent view "agents in this Space" over herdr's named pipe (agent.view.set).
# Run by herdr as this plugin's startup hook; also safe to run by hand. The view is one transient
# projection, so setting it replaces whatever view was active. Windows port of ./space-view (python,
# AF_UNIX): Windows herdr listens on a named pipe, and HERDR_SOCKET_PATH is that pipe's path.
$ErrorActionPreference = "Stop"
$path = $env:HERDR_SOCKET_PATH
if (-not $path) { throw "HERDR_SOCKET_PATH is not set" }
# herdr's pipe is named "\\.\pipe\" + the socket path verbatim (src/platform/windows.rs), backslashes and all.
$name = $path -replace '^\\\\\.\\pipe\\', ''
$req = @{
    id = "space-view"; method = "agent.view.set"
    params = @{
        source = "plugin:rascaltwo.space-agents"; label = "this space"
        filter = @{ op = "eq"; field = "workspace_id"; value = @{ context = "current_workspace_id" } }
    }
} | ConvertTo-Json -Depth 8 -Compress
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", $name, [System.IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(5000)
$enc = New-Object System.Text.UTF8Encoding($false)
$w = New-Object System.IO.StreamWriter($pipe, $enc); $w.NewLine = "`n"; $w.AutoFlush = $true
$r = New-Object System.IO.StreamReader($pipe, $enc)
$w.WriteLine($req)
$reply = $r.ReadLine()
Write-Output $reply
$pipe.Dispose()
if (($reply | ConvertFrom-Json).result.active) { exit 0 } else { exit 1 }
