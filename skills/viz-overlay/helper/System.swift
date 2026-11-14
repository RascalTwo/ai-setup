// Reading the live system: apps, windows, displays, the Accessibility tree, permissions, herdr.
// AX walking, app raising, tab selection and the responsible-app lookup are ported from bigarrow
// (MIT, see THIRD_PARTY_NOTICES.md).
import AppKit
import ApplicationServices

enum Exit: Int32 { case ok = 0, failed = 1, badInput = 2, notFound = 3, permission = 4 }

struct Failure: Error, CustomStringConvertible {
  let code: Exit
  let description: String
}

enum System {
  static func apps() -> [RunningApp] {
    NSWorkspace.shared.runningApplications.map { RunningApp(pid: $0.processIdentifier, name: $0.localizedName, bundleID: $0.bundleIdentifier) }
  }

  static func windows() -> [WindowInfo] {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return list.compactMap { e in
      guard let pid = e[kCGWindowOwnerPID as String] as? Int32, let id = e[kCGWindowNumber as String] as? UInt32,
            let b = e[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b) else { return nil }
      return WindowInfo(id: id, ownerPID: pid, layer: e[kCGWindowLayer as String] as? Int ?? 0, bounds: r,
                        alpha: e[kCGWindowAlpha as String] as? Double ?? 1, title: e[kCGWindowName as String] as? String)
    }
  }

  /// Display frames and visible frames (no menu bar or Dock) in global top-left points. Main thread only.
  static func displays() -> [(frame: CGRect, visible: CGRect)] {
    let h = NSScreen.screens.first?.frame.height ?? 0
    let flip = { (r: CGRect) in CGRect(x: r.minX, y: h - r.maxY, width: r.width, height: r.height) }
    return NSScreen.screens.map { (flip($0.frame), flip($0.visibleFrame)) }
  }

  // MARK: Permissions

  static var accessibility: Bool { AXIsProcessTrusted() }
  static var screenRecording: Bool { CGPreflightScreenCaptureAccess() }

  static func requireAccessibility(_ feature: String) throws {
    guard accessibility else {
      throw Failure(code: .permission, description: "\(feature) needs Accessibility for \(responsibleApp() ?? "the app running this shell"), not for viz-overlay: turn it on in System Settings > Privacy & Security > Accessibility, then restart that app")
    }
  }

  /// The outermost .app in the parent chain: the app macOS grants this process's permissions to.
  static func responsibleApp() -> String? {
    var pid = getpid(), seen = Set<Int32>()
    while pid > 1, !seen.contains(pid) {
      seen.insert(pid)
      var buf = [UInt8](repeating: 0, count: 4 * Int(MAXPATHLEN))
      let n = proc_pidpath(pid, &buf, UInt32(buf.count))
      if n > 0, let path = String(bytes: buf.prefix(Int(n)), encoding: .utf8), let r = path.range(of: ".app/") {
        return URL(fileURLWithPath: String(path[..<r.lowerBound])).lastPathComponent + ".app"
      }
      var info = kinfo_proc(), size = MemoryLayout<kinfo_proc>.stride
      var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
      guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
      pid = info.kp_eproc.e_ppid
    }
    return nil
  }

  // MARK: Apps

  static func app(_ query: String) throws -> RunningApp {
    let all = apps(), wins = windows()
    let found = Match.apps(query, in: all)
    guard let app = Match.preferred(found, activePID: NSWorkspace.shared.frontmostApplication?.processIdentifier, windows: wins) else {
      let pids = Set(wins.filter(\.isAppWindow).map(\.ownerPID))
      let names = Set(all.filter { pids.contains($0.pid) }.compactMap(\.name)).sorted().joined(separator: ", ")
      throw Failure(code: .notFound, description: "no running app matches '\(query)'; apps with windows: \(names)")
    }
    return app
  }

  /// Unhides and activates the app; with a title, raises that window (or selects that browser tab) first.
  static func raise(_ query: String, window title: String?) throws {
    let match = try app(query)
    guard let running = NSRunningApplication(processIdentifier: match.pid) else { return }
    running.unhide()
    if let title {
      try requireAccessibility("Raising a window by title")
      let ax = AXUIElementCreateApplication(match.pid)
      AXUIElementSetMessagingTimeout(ax, 1)
      let wins: [AXUIElement] = AX.get(ax, kAXWindowsAttribute) ?? []
      let needle = title.lowercased()
      guard let w = wins.first(where: { ((AX.get($0, kAXTitleAttribute) as String?) ?? "").lowercased().contains(needle) })
        ?? AX.selectTab(in: wins, title: needle) else {
        throw Failure(code: .notFound, description: "no window or tab of \(match.name ?? query) has a title containing '\(title)'")
      }
      AXUIElementSetAttributeValue(w, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
      AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
      AXUIElementPerformAction(w, kAXRaiseAction as CFString)
    }
    running.activate()
    // Spin until it's frontmost so the first follow tick sees it on top.
    let deadline = Date().addingTimeInterval(1.5)
    while Date() < deadline, NSWorkspace.shared.frontmostApplication?.processIdentifier != match.pid {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
  }

  // MARK: herdr

  /// Whether the herdr pane is the one the user is looking at (`focused` is herdr-wide). nil when herdr can't say.
  static func paneFocused(_ pane: String) -> Bool? {
    guard let out = run(["herdr", "pane", "get", pane]),
          let json = try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any],
          let info = (json["result"] as? [String: Any])?["pane"] as? [String: Any] else { return nil }
    return info["focused"] as? Bool
  }

  /// Types text into the pane as if the user had. While a permission prompt is open herdr refuses
  /// ("agent_blocked"), so this retries every 2 s for up to 10 minutes. Call off the main thread.
  static func deliver(_ pane: String, _ text: String, log: (String) -> Void) {
    for _ in 0..<300 {
      let out = run(["herdr", "agent", "prompt", pane, text]) ?? ""
      if !out.contains("agent_blocked") { return log(out.trimmingCharacters(in: .whitespacesAndNewlines)) }
      Thread.sleep(forTimeInterval: 2)
    }
    log("gave up after 10 minutes blocked")
  }

  /// Runs a command found on PATH; stdout and stderr together, nil if it couldn't start.
  static func run(_ args: [String]) -> String? {
    let p = Process(), out = Pipe()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = args
    p.standardOutput = out
    p.standardError = out
    guard (try? p.run()) != nil else { return nil }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(data: data, encoding: .utf8)
  }
}

// MARK: - Accessibility

enum AX {
  static func get<T>(_ e: AXUIElement, _ attr: String) -> T? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, attr as CFString, &v) == .success else { return nil }
    return v as? T
  }

  static func frame(_ e: AXUIElement) -> CGRect? {
    var pos: CFTypeRef?, size: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, kAXPositionAttribute as CFString, &pos) == .success,
          AXUIElementCopyAttributeValue(e, kAXSizeAttribute as CFString, &size) == .success,
          let pos, let size, CFGetTypeID(pos) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var p = CGPoint.zero, s = CGSize.zero
    // swiftlint:disable:next force_cast
    guard AXValueGetValue(pos as! AXValue, .cgPoint, &p), AXValueGetValue(size as! AXValue, .cgSize, &s) else { return nil }
    return CGRect(origin: p, size: s)
  }

  static let attributes = [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute,
                           kAXIdentifierAttribute, kAXPositionAttribute, kAXSizeAttribute, kAXEnabledAttribute, kAXChildrenAttribute]

  /// Breadth first under `roots`, within bigarrow's limits (web pages nest deep and Chromium answers slowly).
  /// Stops at the first node `stop` accepts.
  static func walk(_ roots: [AXUIElement], budget: TimeInterval = 6, stop: (Node) -> Bool = { _ in false }) -> [(Node, AXUIElement)] {
    var queue: [(AXUIElement, Int, Bool)] = roots.map { ($0, 0, false) }
    var out: [(Node, AXUIElement)] = []
    let deadline = Date().addingTimeInterval(budget)
    var i = 0
    while i < queue.count, out.count < 30_000, Date() < deadline {
      let (e, depth, inWeb) = queue[i]
      i += 1
      AXUIElementSetMessagingTimeout(e, 0.5)
      var values: CFArray?
      AXUIElementCopyMultipleAttributeValues(e, attributes as CFArray, [], &values)
      let list = (values as? [Any]) ?? []
      func value(_ k: Int) -> Any? {
        guard k < list.count else { return nil }
        let item = list[k] as CFTypeRef
        // swiftlint:disable:next force_cast
        if CFGetTypeID(item) == AXValueGetTypeID(), AXValueGetType(item as! AXValue) == .axError { return nil }
        return list[k]
      }
      var rect: CGRect?
      if let p = value(5), let s = value(6) {
        var pt = CGPoint.zero, sz = CGSize.zero
        // swiftlint:disable:next force_cast
        if AXValueGetValue(p as! AXValue, .cgPoint, &pt), AXValueGetValue(s as! AXValue, .cgSize, &sz) { rect = CGRect(origin: pt, size: sz) }
      }
      let role = value(0) as? String
      let node = Node(role: role, title: value(1) as? String, label: value(2) as? String, value: value(3) as? String,
                      identifier: value(4) as? String, frame: rect, enabled: value(7) as? Bool, inWeb: inWeb)
      out.append((node, e))
      if stop(node) { break }
      if depth < 45 { queue += ((value(8) as? [AXUIElement]) ?? []).map { ($0, depth + 1, inWeb || role == "AXWebArea") } }
    }
    return out
  }

  /// Focused window first, then the other windows, then the menu bar.
  static func roots(_ pid: Int32) -> [AXUIElement] {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)
    var roots: [AXUIElement] = (get(app, kAXFocusedWindowAttribute) as AXUIElement?).map { [$0] } ?? []
    for w in (get(app, kAXWindowsAttribute) as [AXUIElement]?) ?? [] where !roots.contains(where: { CFEqual($0, w) }) { roots.append(w) }
    if let bar: AXUIElement = get(app, kAXMenuBarAttribute) { roots.append(bar) }
    return roots
  }

  /// The AX window whose frame is this CG window's bounds.
  static func window(_ pid: Int32, bounds: CGRect) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)
    let wins: [AXUIElement] = get(app, kAXWindowsAttribute) ?? []
    return wins.first { frame($0).map { abs($0.minX - bounds.minX) < 2 && abs($0.minY - bounds.minY) < 2 && abs($0.width - bounds.width) < 2 } ?? false }
  }

  /// Presses the first tab (Chrome, Safari: AXRadioButton/AXTab near the top) whose title contains `needle`; returns its window.
  static func selectTab(in windows: [AXUIElement], title needle: String) -> AXUIElement? {
    for w in windows {
      let tab = walk([w], budget: 3) { n in
        ["AXRadioButton", "AXTab"].contains(n.role ?? "") && ((n.title ?? n.label)?.lowercased().contains(needle) ?? false)
      }.last
      if let (n, e) = tab, ["AXRadioButton", "AXTab"].contains(n.role ?? ""), (n.title ?? n.label)?.lowercased().contains(needle) ?? false {
        AXUIElementPerformAction(e, kAXPressAction as CFString)
        return w
      }
    }
    return nil
  }
}
