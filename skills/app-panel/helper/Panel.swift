// app-panel <url> [width] [herdr-pane-id]: a web panel glued to the front Ghostty window.
// Floats above Ghostty only while that herdr pane is the one you're looking at, never takes focus from it, hides when another app comes forward.
import AppKit
import WebKit

let args = CommandLine.arguments
let url: URL = {
  guard args.count > 1, let u = URL(string: args[1]) else {
    FileHandle.standardError.write("usage: app-panel <url> [width] [herdr-pane-id]\n".data(using: .utf8)!)
    exit(2)
  }
  return u
}()
var width = args.count > 2 ? Double(args[2]) ?? 760 : 760  // narrowed later to the page's window.panelWidth
let ghosttyID = "com.mitchellh.ghostty"
let pane = args.count > 3 ? args[3] : nil  // nil = ignore herdr, follow Ghostty alone
let margin = 16.0, titleBar = 44.0

func log(_ s: String) { print(s); fflush(stdout) }

// Panels can take clicks and keys without activating their app: Ghostty stays the frontmost app.
final class Panel: NSPanel { override var canBecomeKey: Bool { true } }
// Without this, the first click on an unfocused panel only focuses it instead of pressing the button.
final class Web: WKWebView { override func acceptsFirstMouse(for e: NSEvent?) -> Bool { true } }
// The strip along the card's top (inside the page's padding): drag it to move the card.
final class Grip: NSView {
  override func acceptsFirstMouse(for e: NSEvent?) -> Bool { true }
  override func mouseDown(with e: NSEvent) { window?.performDrag(with: e) }
  override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
}

// Where you last dragged a card, kept for the next one: distance from Ghostty's top-right corner.
let saved = UserDefaults(suiteName: "app-panel")!
var dx = saved.object(forKey: "dx") as? Double ?? margin, dy = saved.object(forKey: "dy") as? Double ?? titleBar

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  let panel = Panel(contentRect: NSRect(x: 0, y: 0, width: width, height: 200),
                    styleMask: [.titled, .closable, .nonactivatingPanel, .fullSizeContentView],
                    backing: .buffered, defer: false)
  lazy var web: Web = {
    let c = WKWebViewConfiguration()
    c.userContentController.add(self, name: "panel")  // the page says "fold" (a view asked to close) or "unfold" (a new view)
    return Web(frame: .zero, configuration: c)
  }()
  var loaded = false, ghosttyFront = false, paneFocused = true, shown: Bool?
  var ghostty: (id: CGWindowID, frame: CGRect)?
  var placing = false, collapsed = false
  let box = NSView(), grip = Grip(), fold = NSButton(title: "–", target: nil, action: nil)
  let pill = NSButton(title: "", target: nil, action: nil)

  func applicationDidFinishLaunching(_ n: Notification) {
    panel.isFloatingPanel = true          // above normal windows...
    panel.hidesOnDeactivate = false       // ...and we manage hiding ourselves, keyed on Ghostty
    panel.titlebarAppearsTransparent = true
    panel.titleVisibility = .hidden
    panel.isMovableByWindowBackground = true
    for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { panel.standardWindowButton(b)?.isHidden = true }  // – folds it; it lives as long as the session
    panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
    panel.delegate = self
    web.navigationDelegate = self
    web.uiDelegate = self
    // The page fills the card; the grip and the collapse button float over its top padding.
    box.addSubview(web)
    web.frame = box.bounds
    web.autoresizingMask = [.width, .height]
    for v in [grip, fold] as [NSView] { box.addSubview(v) }
    fold.isBordered = false
    fold.font = .systemFont(ofSize: 16, weight: .medium)
    fold.contentTintColor = .secondaryLabelColor
    fold.toolTip = "Fold to a pill; click the pill to open it again"
    fold.target = self
    fold.action = #selector(toggle)
    pill.bezelStyle = .rounded
    pill.target = self
    pill.action = #selector(toggle)
    panel.contentView = box
    layoutTop()
    web.load(URLRequest(url: url))
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(activated(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
    // ponytail: polls Ghostty's frame 5x/s; switch to AXObserver move events if this ever shows up in CPU
    // Reparented to launchd: the host that opened us is gone (a /mcp reconnect, a session ending), so the panel goes too.
    Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in if getppid() == 1 { exit(0) }; self.follow() }
  }

  // Front Ghostty window on first call; the same window by id afterwards.
  func ghosttyFrame(_ id: CGWindowID?) -> (CGWindowID, CGRect)? {
    guard let pid = NSRunningApplication.runningApplications(withBundleIdentifier: ghosttyID).first?.processIdentifier,
          let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    else { return nil }
    for w in list where (w[kCGWindowOwnerPID as String] as? pid_t) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
      let wid = w[kCGWindowNumber as String] as! CGWindowID
      if let id, wid != id { continue }
      if let b = w[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b) { return (wid, r) }
    }
    return nil
  }

  // CG window bounds are top-left origin; AppKit frames are bottom-left of the primary screen.
  func place(_ g: CGRect) {
    let h = panel.frame.height, primary = NSScreen.screens[0].frame.height
    move(NSPoint(x: g.maxX - panel.frame.width - dx, y: primary - (g.minY + dy) - h))
  }
  func move(_ p: NSPoint) { placing = true; panel.setFrameOrigin(p); placing = false }

  // A move we didn't make is your drag: remember it relative to Ghostty, for this card and the next.
  func windowDidMove(_ n: Notification) {
    guard !placing, let g = ghostty?.frame else { return }
    let primary = NSScreen.screens[0].frame.height
    dx = g.maxX - panel.frame.maxX
    dy = primary - panel.frame.maxY - g.minY
    saved.set(dx, forKey: "dx")
    saved.set(dy, forKey: "dy")
  }

  func layoutTop() {
    let w = panel.contentView!.bounds.width, h = panel.contentView!.bounds.height
    grip.frame = NSRect(x: 0, y: h - 18, width: w - 30, height: 18)
    fold.frame = NSRect(x: w - 30, y: h - 26, width: 24, height: 24)
  }

  // Collapsed, the card is a pill with its title at the same top-right corner; click it to open again.
  @objc func toggle() {
    if collapsed {
      collapsed = false
      reshape { self.panel.contentView = self.box; self.panel.setContentSize(NSSize(width: width, height: 1)); self.fit(self.lastH) }
      return
    }
    web.evaluateJavaScript("document.title") { t, _ in
      self.showPill("◉ " + String(((t as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "panel").prefix(40)))
    }
  }

  func showPill(_ title: String) {
    collapsed = true
    pill.title = title
    pill.sizeToFit()
    reshape { self.panel.contentView = self.pill; self.panel.setContentSize(NSSize(width: self.pill.frame.width + 16, height: 32)) }
  }

  // Resize while keeping the top-right corner where it is.
  func reshape(_ change: () -> Void) {
    let top = panel.frame.maxY, right = panel.frame.maxX
    change()
    move(NSPoint(x: right - panel.frame.width, y: top - panel.frame.height))
  }

  // Page height, once the page has drawn something: pages like the panel page render after load,
  // so the document at didFinish is an empty body and measuring it then gives a sliver.
  // The body's own height: the document's scrollHeight is never less than the window, so the panel could never shrink.
  let measure = "document.body.innerText.trim() ? Math.ceil(document.body.getBoundingClientRect().height) : 0"

  // Track the page's height, top edge fixed, never taller than the screen.
  var lastH = 200.0
  func fit(_ h: Double) {
    lastH = h
    guard !collapsed else { return }
    let maxH: Double = (panel.screen ?? NSScreen.main).map { Double($0.visibleFrame.height) - 80.0 } ?? h
    let want = min(h, maxH), top = panel.frame.maxY
    guard abs(want - (panel.contentView?.frame.height ?? 0)) > 1 else { return }
    panel.setContentSize(NSSize(width: width, height: want))
    move(NSPoint(x: panel.frame.minX, y: top - panel.frame.height))
    layoutTop()
  }

  // The width the page asks for (an MCP App view's own size), top-right corner fixed.
  func fitWidth(_ w: Double) {
    guard !collapsed, abs(w - width) > 1 else { return }
    width = w
    reshape { self.panel.setContentSize(NSSize(width: width, height: self.panel.contentView?.frame.height ?? CGFloat(self.lastH))) }
    layoutTop()
  }

  func follow() {
    if loaded {
      web.evaluateJavaScript(measure) { h, _ in if let h = h as? Double, h > 0 { self.fit(h) } }
      web.evaluateJavaScript("window.panelWidth ?? 0") { w, _ in if let w = w as? Double, w > 0 { self.fitWidth(w) } }
    }
    if let g = ghostty, let now = ghosttyFrame(g.id), now.1 != g.frame { place(now.1); ghostty = (g.id, now.1) }
    guard let pane else { return }
    // ponytail: spawns the herdr CLI 5x/s (~35ms each, off the main thread); subscribe to herdr's socket API if that ever matters
    DispatchQueue.global().async {
      let p = Process(), out = Pipe()
      p.executableURL = URL(fileURLWithPath: "/usr/bin/env")  // herdr from the PATH the host ran with
      p.arguments = ["herdr", "pane", "get", pane]
      p.standardOutput = out
      p.standardError = FileHandle.nullDevice
      guard (try? p.run()) != nil else { return }
      let data = out.fileHandleForReading.readDataToEndOfFile()
      p.waitUntilExit()
      // `focused` on `pane get` is herdr-wide: true only for the pane you're looking at, not per tab.
      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      let info = (json?["result"] as? [String: Any])?["pane"] as? [String: Any]
      guard let focused = info?["focused"] as? Bool else { return }
      DispatchQueue.main.async { self.paneFocused = focused; self.update("pane focused=\(focused)") }
    }
  }

  func update(_ why: String) {
    let on = loaded && ghosttyFront && paneFocused
    guard on != shown else { return }
    shown = on
    if on { panel.orderFrontRegardless() } else { panel.orderOut(nil) }  // orderFront* never steals key focus
    log(on ? "shown (\(why))" : "hidden (\(why))")
  }

  @objc func activated(_ n: Notification) {
    let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    ghosttyFront = app?.bundleIdentifier == ghosttyID
    update(app?.bundleIdentifier ?? "?")
  }

  func webView(_ w: WKWebView, didFinish nav: WKNavigation!) { firstShow(tries: 40) }

  // Show once the page has drawn (or after 2s regardless), at its real height.
  func firstShow(tries: Int) {
    web.evaluateJavaScript(measure) { h, _ in
      let h = (h as? Double) ?? 0
      if h == 0 && tries > 0 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.firstShow(tries: tries - 1) }
        return
      }
      self.panel.setContentSize(NSSize(width: width, height: 200))
      self.fit(h > 0 ? h : 200)
      if let (id, frame) = self.ghosttyFrame(nil) { self.ghostty = (id, frame); self.place(frame) } else { self.panel.center() }
      self.loaded = true
      let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
      self.ghosttyFront = front == ghosttyID
      self.update("loaded, front=\(front ?? "?")")
    }
  }

  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    if (m.body as? String == "fold") != collapsed { toggle() }
  }

  // The page closes itself when the host goes away (the session ended).
  func webViewDidClose(_ w: WKWebView) { NSApp.terminate(nil) }
  func windowWillClose(_ n: Notification) { NSApp.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)  // no Dock icon, never becomes the active app
let delegate = App()
app.delegate = delegate
app.run()
