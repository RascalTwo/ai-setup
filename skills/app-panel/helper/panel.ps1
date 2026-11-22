# app-panel <url> [width]: the Windows panel, a chromeless Edge/Chrome window placed beside the terminal.
# The counterpart of Panel.swift. Lives as long as the window does, which is how host.ts knows the panel is open.
# The browser's own frame (title bar, borders) is cropped off with a window region, so only the page shows; the page
# (page/host.html with ?win=1) draws the grip and fold button, and resizes and moves the window itself.
# shortcut: placed once at launch, then a plain window; it doesn't follow the terminal or hide with it.
param([string]$Url, [int]$Width = 480)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EP cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr r, bool redraw);
  // The browser's page area: the one child of the window that is not frame.
  public static IntPtr Page(IntPtr w) { IntPtr f = IntPtr.Zero; EnumChildWindows(w, (h, l) => { var s = new System.Text.StringBuilder(256); GetClassName(h, s, 256); if (s.ToString() == "Chrome_RenderWidgetHostHWND") { f = h; return false; } return true; }, IntPtr.Zero); return f; }
  // Show only the page area (or, folded, a pill off its top); everything else of the window is cut away.
  public static void Crop(IntPtr w, IntPtr page, int pill) {
    R a, b; GetWindowRect(w, out a); GetWindowRect(page, out b);
    int l = b.L - a.L, t = b.T - a.T, r = b.Rt - a.L, bt = b.B - a.T;
    SetWindowRgn(w, pill > 0 ? CreateRoundRectRgn(l, t, r + 1, t + pill + 1, pill, pill) : CreateRoundRectRgn(l, t, r + 1, bt + 1, 0, 0), true);
  }
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
'@
[void][W]::SetProcessDPIAware() # real pixels for every number below

# The terminal: the nearest ancestor of this process with a window (host.ts -> claude -> shell -> terminal), else whatever is in front.
$term = [IntPtr]::Zero
for ($id = $PID; $id -and -not $term; ) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  if (-not $p -or -not $p.ParentProcessId) { break }
  $id = $p.ParentProcessId
  $h = (Get-Process -Id $id -ErrorAction SilentlyContinue).MainWindowHandle
  if ($h -and $h -ne [IntPtr]::Zero -and [W]::IsWindowVisible($h)) { $term = $h }
}
if ($term -eq [IntPtr]::Zero) { $term = [W]::GetForegroundWindow() }

$t = New-Object W+R
$have = [W]::GetWindowRect($term, [ref]$t)
$screen = if ($have) { [Windows.Forms.Screen]::FromHandle($term) } else { [Windows.Forms.Screen]::PrimaryScreen }
$wa = $screen.WorkingArea
$g = [Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $scale = $g.DpiX / 96; $g.Dispose()
$w = [int]($Width * $scale)
# Right beside the terminal when there is room, else flush to the screen's right edge; as tall as the terminal.
$x = if ($have) { [Math]::Min($t.Rt, $wa.Right - $w) } else { $wa.Right - $w }
$y = if ($have) { [Math]::Max($t.T, $wa.Top) } else { $wa.Top }

$exe = @("$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
         "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { Start-Process $Url; exit } # no Chromium: the default browser, as on Linux

# Its own profile, so this is a new browser process (one we can wait on and place), never a window handed to a running Edge.
$profile = Join-Path $env:TEMP "app-panel-$PID"
$edge = Start-Process $exe -PassThru -ArgumentList "--app=$Url", "--user-data-dir=`"$profile`"", '--no-first-run', '--no-default-browser-check', '--inprivate', '--disable-sync', "--window-size=$Width,600"
try {
  for ($i = 0; $i -lt 100 -and -not $edge.HasExited; $i++) {
    $edge.Refresh()
    if ($edge.MainWindowHandle -ne [IntPtr]::Zero -and [W]::Page($edge.MainWindowHandle) -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 100
  }
  $hw = $edge.MainWindowHandle
  if ($hw -ne [IntPtr]::Zero) {
    # Aim the visible page, not the window: its frame is cropped away, so offset by how far the page sits inside it.
    $a = New-Object W+R; $b = New-Object W+R; $pg = [W]::Page($hw)
    [void][W]::GetWindowRect($hw, [ref]$a); [void][W]::GetWindowRect($pg, [ref]$b)
    $ww = $w + ($a.Rt - $a.L) - ($b.Rt - $b.L)
    [void][W]::SetWindowPos($hw, [IntPtr](-1), $x - ($b.L - $a.L), $y - ($b.T - $a.T), $ww, [int](300 * $scale), 0x0010) # HWND_TOPMOST, no activate; the page sets its height
    # Edge took focus on launch; give it back, as the Mac panel never takes it. (An Alt tap lets a background process do that.)
    if ($have) { [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); [void][W]::SetForegroundWindow($term) }
  }
  # The page resizes the window as its content changes, and the crop goes with the size: keep it right, and a title starting ◉ means folded.
  $last = ''
  while (-not $edge.HasExited) {
    $edge.Refresh()
    if ($hw -ne [IntPtr]::Zero) {
      $r = New-Object W+R; [void][W]::GetWindowRect($hw, [ref]$r)
      $pill = if ($edge.MainWindowTitle.StartsWith([string][char]0x25C9)) { [int](32 * $scale) } else { 0 }
      $key = "$($r.L),$($r.T),$($r.Rt),$($r.B),$pill"
      if ($key -ne $last) { [W]::Crop($hw, [W]::Page($hw), $pill); $last = $key }
    }
    Start-Sleep -Milliseconds 100
  }
} finally {
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}
