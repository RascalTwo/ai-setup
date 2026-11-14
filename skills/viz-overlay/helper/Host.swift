// The overlay itself: a transparent, click-through, never-activating panel over one display, a web
// view showing the page, and the loop that follows targets and decides when it shows.
// Panel recipe (screenSaver level, non-activating, click-through, manual event pump), the covered
// check and the owner watch come from bigarrow (MIT, see THIRD_PARTY_NOTICES.md); the herdr pane
// rule and message delivery from app-panel.
import AppKit
import WebKit

final class Panel: NSPanel {
  /// Key only while a text field in the page has focus, so clicks never take the keyboard otherwise.
  var wantsKey = false
  override var canBecomeKey: Bool { wantsKey }
  override var canBecomeMain: Bool { false }
  var onMouseDown: (() -> Void)?
  override func sendEvent(_ e: NSEvent) {
    if e.type == .leftMouseDown { onMouseDown?() }
    super.sendEvent(e)
  }
}

final class Web: WKWebView {
  // The panel is rarely key, so without this the first click would only "activate" the view.
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

struct HostConfig {
  let url: URL
  let title: String
  let rule: Rule
  let target: Spec?
  let duration: Double
  let snapshot: String?
  let owner: Owner
  /// The host-drawn ✕; off only for a page that brings its own way out (--no-close).
  var closeButton = true
}

/// One JSON line per event in ~/.agents/state/viz-overlay/logs/<pid>.jsonl (and on stdout when run in the foreground).
final class Log {
  let url: URL
  private let handle: FileHandle?

  init(pid: Int32) {
    let dir = Paths.logs
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    url = dir.appendingPathComponent("\(pid).jsonl")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    handle = try? FileHandle(forWritingTo: url)
  }

  func write(_ event: String, _ fields: [String: Any] = [:]) {
    var o = fields
    o["event"] = event
    o["t"] = ISO8601DateFormatter().string(from: Date())
    guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), var line = String(data: d, encoding: .utf8) else { return }
    line += "\n"
    handle?.write(Data(line.utf8))
    FileHandle.standardOutput.write(Data(line.utf8))
  }
}

final class Host: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
  let c: HostConfig
  let log: Log
  let panel: Panel
  let web: Web
  let content = NSView()
  var display = CGRect.zero, visible = CGRect.zero, origin = CGPoint.zero
  var primary: Tracker?
  var tracks: [String: Tracker] = [:]
  var pushed: [String: TargetState] = [:]
  var hits: [CGRect] = []
  /// Iframes in hit regions: a click there takes the keyboard (the page can't see focus inside them).
  var keyRects: [CGRect] = []
  var loaded = false, ready = false, shown: Bool?
  var frontBundle: String?, paneFocused = true
  var busy = false
  let queue = DispatchQueue(label: "viz-overlay.follow")
  var keep: [Any] = []
  /// overlay.elements() answers, for snapshots.
  var elementsSeen: [[String: Any]] = []
  var snapshotSaved = false
  var lastSnapshot: Data?
  /// The latest `viz-overlay update` value, for a page that loads later and for snapshots.
  var data: Any?
  var inbox: FileHandle?
  var inboxRest = ""

  init(_ c: HostConfig) {
    self.c = c
    log = Log(pid: getpid())
    panel = Panel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let config = WKWebViewConfiguration()
    web = Web(frame: .zero, configuration: config)
    super.init()
    config.userContentController.add(self, name: "overlay")
    primary = c.target.map { Tracker($0, raw: (try? JSONSerialization.jsonObject(with: JSONEncoder().encode($0))) ?? [:]) }
  }

  func start() {
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.ignoresMouseEvents = true
    panel.level = .screenSaver
    panel.collectionBehavior = [.canJoinAllSpaces, .canJoinAllApplications, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.delegate = self
    panel.onMouseDown = { [weak self] in
      guard let self, !self.panel.isKeyWindow, self.keyRects.contains(where: { $0.contains(self.pointer()) }) else { return }
      self.panel.wantsKey = true
      self.panel.makeKey()
      self.log.write("key", ["on": true, "isKey": self.panel.isKeyWindow, "by": "iframe click"])
    }
    panel.contentView = content
    web.setValue(false, forKey: "drawsBackground")
    web.navigationDelegate = self
    content.addSubview(web)
    // The first display decision needs the target, so resolve it once before placing.
    let ds = System.displays()
    let first = primary?.tick(apps: System.apps(), windows: System.windows(), displays: ds.map(\.frame))
    place(Geometry.display(for: first?.rect?.cg, in: ds.map(\.frame)), ds)
    installScripts()
    if c.url.isFileURL { web.loadFileURL(c.url, allowingReadAccessTo: c.url.deletingLastPathComponent()) } else { web.load(URLRequest(url: c.url)) }
    log.write("started", ["url": c.url.absoluteString, "title": c.title, "when": c.rule.rawValue, "owner": ["pid": c.owner.pid as Any, "session": c.owner.session as Any, "pane": c.owner.pane as Any]])

    Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.follow() }
    Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.trackPointer() }
    if c.rule == .pane, let pane = c.owner.pane {
      // shortcut: spawns the herdr CLI 5x/s like app-panel; subscribe to herdr's socket API if that ever shows in CPU.
      Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
        DispatchQueue.global().async {
          guard let f = System.paneFocused(pane) else { return }
          DispatchQueue.main.async { self?.paneFocused = f }
        }
      }
    }
    for s in [SIGTERM, SIGINT, SIGHUP] {
      signal(s, SIG_IGN)
      let src = DispatchSource.makeSignalSource(signal: s, queue: .main)
      src.setEventHandler { [weak self] in self?.finish("stopped") }
      src.resume()
      keep.append(src)
    }
    if let pid = c.owner.pid {
      guard Registry.processExists(pid) else { return finish("owner gone") }
      let src = DispatchSource.makeProcessSource(identifier: pid_t(pid), eventMask: .exit, queue: .main)
      src.setEventHandler { [weak self] in self?.finish("owner exited") }
      src.resume()
      keep.append(src)
    }
    watchInbox()
    watchEscape()
    if c.duration > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + c.duration) { [weak self] in self?.finish("duration") } }
  }

  // MARK: Placement

  func place(_ index: Int, _ ds: [(frame: CGRect, visible: CGRect)]) {
    let i = ds.indices.contains(index) ? index : 0
    display = ds[i].frame
    visible = ds[i].visible
    origin = Geometry.origin(of: display)
    let mainH = NSScreen.screens.first?.frame.height ?? display.height
    panel.setFrame(NSRect(x: display.minX, y: mainH - display.maxY, width: display.width, height: display.height), display: false)
    content.frame = NSRect(origin: .zero, size: display.size)
    web.frame = Geometry.webFrame(display: display)
  }

  var displayInfo: [String: Any] {
    ["origin": ["x": origin.x, "y": origin.y], "display": box(display), "visible": box(visible)]
  }

  func box(_ r: CGRect) -> [String: Any] {
    let b = Geometry.css(r, origin: origin)
    return ["x": b.x, "y": b.y, "width": b.width, "height": b.height]
  }

  /// The page gets its starting state before any of its own scripts run; reloads get the current one.
  func installScripts() {
    let ucc = web.configuration.userContentController
    ucc.removeAllUserScripts()
    var initial = displayInfo
    initial["title"] = c.title
    initial["close"] = c.closeButton
    let json = String(data: (try? JSONSerialization.data(withJSONObject: initial)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
    let bridge = (try? String(contentsOf: Paths.helper.appendingPathComponent("bridge.js"), encoding: .utf8)) ?? ""
    if bridge.isEmpty { log.write("error", ["message": "bridge.js missing next to the binary"]) }
    ucc.addUserScript(WKUserScript(source: "window.__overlayInit = \(json);\n" + bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  }

  // MARK: Following

  func follow() {
    frontBundle = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    guard !busy else { return }
    busy = true
    let ds = System.displays()
    var all: [(String, Tracker)] = tracks.map { ($0.key, $0.value) }
    if let primary { all.append(("target", primary)) }
    queue.async {
      let apps = System.apps(), wins = System.windows()
      var states: [String: TargetState] = [:]
      for (id, t) in all { states[id] = t.tick(apps: apps, windows: wins, displays: ds.map(\.frame)) }
      DispatchQueue.main.async { self.busy = false; self.apply(states, ds) }
    }
  }

  func apply(_ states: [String: TargetState], _ ds: [(frame: CGRect, visible: CGRect)]) {
    // Follow the primary target to another display (or a display change under it).
    if let t = states["target"], !t.gone, let r = t.rect?.cg {
      let i = Geometry.display(for: r, in: ds.map(\.frame))
      if ds.indices.contains(i), ds[i].frame != display || ds[i].visible != visible {
        place(i, ds)
        installScripts()
        pushed = [:]
        push(["kind": "display"].merging(displayInfo) { a, _ in a })
        log.write("display", ["frame": box(display)])
      }
    }
    guard loaded else { return }
    var changed = false
    for (id, s) in states {
      var css = s
      css.rect = s.rect.map { Geometry.css($0.cg, origin: origin) }
      css.window = s.window.map { Geometry.css($0.cg, origin: origin) }
      guard pushed[id] != css else { continue }
      changed = true
      if id == "target", pushed[id]?.gone != css.gone || pushed[id]?.covered != css.covered {
        log.write("target", ["gone": css.gone, "covered": css.covered, "error": css.error as Any])
      }
      pushed[id] = css
      if let d = try? JSONEncoder().encode(css), let o = try? JSONSerialization.jsonObject(with: d) { push(["kind": "state", "id": id, "state": o]) }
    }
    // Keep the snapshot current: a slow target can resolve after the first save.
    if changed, snapshotSaved, let path = c.snapshot { saveSnapshot(path) }
    let (on, why) = c.rule.decide(target: primary?.state, ghosttyFront: frontBundle == "com.mitchellh.ghostty", paneFocused: paneFocused)
    setShown(on, why)
    if !ready {
      ready = true
      Registry.write(c, log: log.url)
      log.write("ready")
      if let path = c.snapshot { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.saveSnapshot(path) } }
    }
  }

  func setShown(_ on: Bool, _ why: String) {
    guard on != shown else { return }
    shown = on
    if on { panel.orderFrontRegardless() } else { panel.orderOut(nil) }  // orderFront* never takes key focus
    push(["kind": "visibility", "visible": on, "reason": why])
    log.write(on ? "shown" : "hidden", ["reason": why])
  }

  /// The pointer in the page's CSS px.
  func pointer() -> CGPoint {
    let g = Geometry.topLeft(NSEvent.mouseLocation, mainHeight: NSScreen.screens.first?.frame.height ?? 0)
    return CGPoint(x: g.x - origin.x, y: g.y - origin.y)
  }

  /// Clickable only while the pointer is over a hit region (bigarrow's ClickTracker idea).
  func trackPointer() {
    let p = pointer()
    let over = shown == true && hits.contains { $0.contains(p) }
    if panel.ignoresMouseEvents == over { panel.ignoresMouseEvents = !over }
  }

  func push(_ m: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: m), let s = String(data: d, encoding: .utf8) else { return }
    web.evaluateJavaScript("window.overlay && window.overlay._recv(\(s))", completionHandler: nil)
  }

  // MARK: Page messages

  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let m = message.body as? [String: Any], let kind = m["kind"] as? String else { return }
    switch kind {
    case "hello":
      // A (re)loaded page: it tracks afresh, and gets the current state.
      tracks = [:]
      pushed = [:]
      if let s = shown { push(["kind": "visibility", "visible": s, "reason": "current"]) }
      if let d = data { push(["kind": "data", "value": d]) }
    case "hits":
      hits = (m["rects"] as? [[Double]] ?? []).compactMap { $0.count == 4 ? CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) : nil }
      keyRects = (m["keys"] as? [[Double]] ?? []).compactMap { $0.count == 4 ? CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) : nil }
    case "send":
      let text = m["text"] as? String ?? ""
      log.write("send", ["text": text])
      guard let pane = c.owner.pane else { return log.write("deliver", ["result": "no herdr pane; the message is only in this log"]) }
      let line = "[viz-overlay · \(c.title)] \(text)"
      DispatchQueue.global().async { System.deliver(pane, line) { r in DispatchQueue.main.async { self.log.write("deliver", ["result": r]) } } }
    case "close":
      finish("page")
    case "pageError":
      log.write("page-error", ["message": m["message"] as? String ?? ""])
    case "track":
      guard let id = m["id"] as? String, let raw = m["spec"] else { return }
      do {
        let spec = try JSONDecoder().decode(Spec.self, from: JSONSerialization.data(withJSONObject: raw))
        tracks[id] = Tracker(spec, raw: raw)
      } catch {
        push(["kind": "state", "id": id, "state": ["gone": true, "shown": false, "covered": false, "error": "bad track spec: \(error)"]])
      }
    case "untrack":
      if let id = m["id"] as? String { tracks[id] = nil; pushed[id] = nil }
    case "elements":
      guard let id = m["id"] as? String, let app = m["app"] as? String else { return }
      let ds = System.displays().map(\.frame), o = origin
      // Not the follow queue: a full walk can take seconds and would freeze tracking.
      DispatchQueue.global().async {
        let reply: [String: Any]
        do {
          reply = ["kind": "elements", "id": id, "result": try Elements.list(app, match: m["match"] as? String, role: m["role"] as? String, web: m["web"] as? Bool ?? false, displays: ds).map { $0.json(origin: o) }]
        } catch {
          reply = ["kind": "elements", "id": id, "error": "\(error)"]
        }
        DispatchQueue.main.async {
          if let result = reply["result"] {
            self.elementsSeen.append(["app": app, "match": m["match"] ?? NSNull(), "role": m["role"] ?? NSNull(), "web": m["web"] ?? false, "result": result])
            // A slow walk can answer after the snapshot was saved: save it again.
            if self.snapshotSaved, let path = self.c.snapshot { self.saveSnapshot(path) }
          }
          self.push(reply)
        }
      }
    case "key":
      let on = m["on"] as? Bool ?? false
      panel.wantsKey = on
      if on { panel.makeKey() } else { giveKeyBack() }
      log.write("key", ["on": on, "isKey": panel.isKeyWindow])
    default: break
    }
  }

  /// Esc never reaches a non-activating panel's window (verified: other keys do), so a listen-only
  /// event tap notices it while the panel holds the keyboard. Needs Accessibility; without it, clicking elsewhere still works.
  func watchEscape() {
    let cb: CGEventTapCallBack = { _, type, event, ctx in
      if type == .keyDown, event.getIntegerValueField(.keyboardEventKeycode) == 53, let ctx {
        let host = Unmanaged<Host>.fromOpaque(ctx).takeUnretainedValue()
        DispatchQueue.main.async { if host.panel.isKeyWindow { host.escape() } }
      }
      return Unmanaged.passUnretained(event)
    }
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                      eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue), callback: cb,
                                      userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return log.write("note", ["message": "no Esc watch (needs Accessibility)"]) }
    CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
    keep.append(tap)
  }

  /// `viz-overlay update` appends a JSON line to this overlay's inbox and sends SIGUSR1; each new value goes to the page.
  func watchInbox() {
    let url = Registry.inbox(getpid())
    try? FileManager.default.createDirectory(at: Paths.registry, withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: url.path, contents: nil)
    inbox = try? FileHandle(forReadingFrom: url)
    signal(SIGUSR1, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    src.setEventHandler { [weak self] in self?.readInbox() }
    src.resume()
    keep.append(src)
  }

  func readInbox() {
    guard let d = inbox?.availableData, !d.isEmpty else { return }
    inboxRest += String(decoding: d, as: UTF8.self)
    var lines = inboxRest.components(separatedBy: "\n")
    inboxRest = lines.removeLast()  // a line still being written waits for the next signal
    for line in lines where !line.isEmpty {
      guard let v = try? JSONSerialization.jsonObject(with: Data(line.utf8), options: [.fragmentsAllowed]) else {
        log.write("error", ["message": "update: not JSON: \(line.prefix(200))"])
        continue
      }
      data = v
      log.write("update", ["value": v])
      push(["kind": "data", "value": v])
    }
    if snapshotSaved, let path = c.snapshot { saveSnapshot(path) }
  }

  /// Esc while typing: leave the field and give the keyboard back.
  func escape() {
    web.evaluateJavaScript("document.activeElement && document.activeElement.blur()", completionHandler: nil)
    giveKeyBack()
    log.write("key", ["on": false, "isKey": panel.isKeyWindow, "by": "esc"])
  }

  /// Hands the keyboard back to the app the user was in.
  func giveKeyBack() {
    panel.wantsKey = false
    guard panel.isKeyWindow else { return }
    panel.resignKey()
    NSWorkspace.shared.frontmostApplication?.activate()
  }

  func windowDidResignKey(_ n: Notification) {
    panel.wantsKey = false
    web.evaluateJavaScript("document.activeElement && document.activeElement.blur()", completionHandler: nil)
  }

  func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
    loaded = true
    log.write("loaded")
  }

  func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError e: Error) { fail(e) }
  func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) { fail(e) }
  func fail(_ e: Error) {
    log.write("error", ["message": "page failed to load: \(e.localizedDescription)"])
    exit(Exit.failed.rawValue)
  }

  // MARK: Ending

  func finish(_ by: String) {
    log.write("closed", ["by": by])
    Registry.remove(getpid())
    exit(0)
  }

  /// Everything the page was given, so it can render the same picture standalone (reference/contract.md).
  func saveSnapshot(_ path: String) {
    var snap = displayInfo
    snap["title"] = c.title
    let enc = { (s: TargetState?) -> Any in s.flatMap { try? JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull() }
    snap["target"] = enc(pushed["target"])
    snap["tracks"] = tracks.map { id, t in ["spec": t.raw, "state": enc(pushed[id])] }
    snap["elements"] = elementsSeen
    snap["data"] = data ?? NSNull()
    do {
      // Same content, no write: a snapshot inside a live-reloading viz folder would otherwise reload the page forever.
      let same = try JSONSerialization.data(withJSONObject: snap, options: [.sortedKeys])
      guard same != lastSnapshot else { return }
      lastSnapshot = same
      snap["savedAt"] = ISO8601DateFormatter().string(from: Date())
      let d = try JSONSerialization.data(withJSONObject: snap, options: [.prettyPrinted, .sortedKeys])
      try d.write(to: URL(fileURLWithPath: path))
      snapshotSaved = true
      log.write("snapshot", ["path": path])
    } catch {
      log.write("error", ["message": "snapshot not saved: \(error.localizedDescription)"])
    }
  }
}
