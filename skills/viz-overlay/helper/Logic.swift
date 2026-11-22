// The host's pure parts: matching apps, windows and elements, the covered check, the show/hide
// rules, display geometry and argument parsing. No AppKit, so LogicTests.swift runs them on fixtures.
// Matching, covered and preferred-app rules are ported from bigarrow (MIT, see THIRD_PARTY_NOTICES.md).
import CoreGraphics
import Foundation

// MARK: - What the system reports

struct RunningApp: Codable, Equatable {
  let pid: Int32
  let name: String?
  let bundleID: String?
}

/// One on-screen window from CGWindowList, front to back. Bounds are global top-left points.
struct WindowInfo: Codable, Equatable {
  let id: UInt32
  let ownerPID: Int32
  let layer: Int
  let bounds: CGRect
  let alpha: Double
  /// Only present with Screen Recording.
  let title: String?

  /// A normal app window a human can see.
  var isAppWindow: Bool { layer == 0 && alpha > 0 && bounds.width >= 40 && bounds.height >= 40 }
}

/// One Accessibility element. `inWeb` is true below an AXWebArea (web page content).
struct Node: Codable, Equatable {
  let role: String?
  let title: String?
  let label: String?
  let value: String?
  let identifier: String?
  let frame: CGRect?
  let enabled: Bool?
  var inWeb = false

  var texts: [String] { [title, label, value, identifier].compactMap { $0?.lowercased() } }
  var name: String? { [title, label, value].compactMap { $0 }.first { !$0.isEmpty } }
}

// MARK: - Matching

enum Match {
  /// Exact name or bundle id first, then prefix, then substring. Case-insensitive.
  static func apps(_ query: String, in apps: [RunningApp]) -> [RunningApp] {
    let needle = query.lowercased()
    let keys = { (a: RunningApp) in [a.name, a.bundleID].compactMap { $0?.lowercased() } }
    for tier in [{ $0 == needle }, { $0.hasPrefix(needle) }, { $0.contains(needle) }] as [(String) -> Bool] {
      let found = apps.filter { keys($0).contains(where: tier) }
      if !found.isEmpty { return found }
    }
    return []
  }

  /// Two running apps share a name: the active one, else the one owning the frontmost window, else the first.
  static func preferred(_ matches: [RunningApp], activePID: Int32?, windows: [WindowInfo]) -> RunningApp? {
    if let active = matches.first(where: { $0.pid == activePID }) { return active }
    let pids = Set(matches.map(\.pid))
    let front = windows.first { pids.contains($0.ownerPID) && $0.isAppWindow }
    return front.flatMap { w in matches.first { $0.pid == w.ownerPID } } ?? matches.first
  }

  /// `AXButton`, `button` and `Button` are the same role.
  static func role(_ r: String) -> String {
    let l = r.lowercased()
    return l.hasPrefix("ax") ? String(l.dropFirst(2)) : l
  }

  /// 3 exact, 2 prefix, 1 substring, 0 no match.
  static func score(_ node: Node, label: String, role wanted: String?) -> Int {
    if let wanted, role(node.role ?? "") != role(wanted) { return 0 }
    let needle = label.lowercased(), texts = node.texts
    if texts.contains(needle) { return 3 }
    if texts.contains(where: { $0.hasPrefix(needle) }) { return 2 }
    if texts.contains(where: { $0.contains(needle) }) { return 1 }
    return 0
  }

  /// The element to target: visible first, then best text match, then enabled, then tree order.
  /// `web` limits the search to web page content (below an AXWebArea).
  static func element(_ nodes: [Node], label: String, role: String?, web: Bool, displays: [CGRect]) -> Int? {
    let ranked = nodes.indices.compactMap { i -> (Int, Int, Bool)? in
      guard !web || nodes[i].inWeb else { return nil }
      let s = score(nodes[i], label: label, role: role)
      return s > 0 ? (i, s, isVisible(nodes[i].frame, displays)) : nil
    }
    let best = ranked.min { a, b in
      if a.2 != b.2 { return a.2 }
      if a.1 != b.1 { return a.1 > b.1 }
      let ae = nodes[a.0].enabled ?? true, be = nodes[b.0].enabled ?? true
      if ae != be { return ae }
      return a.0 < b.0
    }
    return best.flatMap { $0.2 ? $0.0 : nil }
  }

  static func isVisible(_ frame: CGRect?, _ displays: [CGRect]) -> Bool {
    guard let f = frame, f.width > 0, f.height > 0 else { return false }
    return displays.contains { $0.intersects(f) }
  }

  /// Visible windows of these pids, front to back, title substring if given. Off-screen helper windows don't count.
  static func windows(of pids: Set<Int32>, in windows: [WindowInfo], title: String?, displays: [CGRect]) -> [WindowInfo] {
    windows.filter { w in
      guard pids.contains(w.ownerPID), w.isAppWindow,
            displays.contains(where: { let v = $0.intersection(w.bounds); return !v.isNull && v.width >= 40 && v.height >= 40 })
      else { return false }
      guard let title else { return true }
      return w.title?.lowercased().contains(title.lowercased()) ?? false
    }
  }

  /// True when the frontmost normal window under `point` belongs to another app.
  /// Nothing under the point (menu bar, Dock, desktop) is not covered.
  static func isCovered(_ point: CGPoint, owners: Set<Int32>, windows: [WindowInfo]) -> Bool {
    guard let top = windows.first(where: { $0.isAppWindow && $0.bounds.contains(point) }) else { return false }
    return !owners.contains(top.ownerPID)
  }
}

// MARK: - Targets and their state

/// What the page (or the CLI) asks to follow. Same JSON shape as `overlay.track(spec)`.
struct Spec: Codable, Equatable {
  struct Element: Codable, Equatable { let label: String; var role: String? }
  var app: String
  var window: String?
  var element: Element?
  var web: Element?
  /// Global top-left points; moves with the window once resolved.
  var rect: Box?
}

/// A rect as the page sees it: `{x, y, width, height}`.
struct Box: Codable, Equatable {
  var x, y, width, height: Double
  init(_ r: CGRect) { x = r.minX; y = r.minY; width = r.width; height = r.height }
  var cg: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

/// What a tracked target looks like right now. Rects are in the page's CSS px (see `Geometry`).
struct TargetState: Codable, Equatable {
  var rect: Box?
  var window: Box?
  var shown = false
  var covered = false
  var gone = true
  var error: String?
}

// MARK: - When the overlay shows

enum Rule: String, Codable, CaseIterable {
  case target, pane, always

  /// Shown or hidden, and why.
  func decide(target: TargetState?, ghosttyFront: Bool, paneFocused: Bool) -> (Bool, String) {
    switch self {
    case .always: return (true, "always")
    case .pane:
      if !ghosttyFront { return (false, "terminal not frontmost") }
      return paneFocused ? (true, "pane focused") : (false, "another pane focused")
    case .target:
      guard let t = target else { return (true, "no target") }
      if t.gone { return (false, "target gone") }
      if t.covered { return (false, "target covered") }
      return (true, "target visible")
    }
  }
}

// MARK: - Geometry

enum Geometry {
  /// The display holding most of `rect` (or the main one, index 0).
  static func display(for rect: CGRect?, in displays: [CGRect]) -> Int {
    guard let rect else { return 0 }
    let areas = displays.map { d -> CGFloat in let i = d.intersection(rect); return i.isNull ? 0 : i.width * i.height }
    guard let best = areas.indices.max(by: { areas[$0] < areas[$1] }), areas[best] > 0 else { return 0 }
    return best
  }

  /// The global point at CSS (0, 0). The web view is shifted so CSS px are global points on any display
  /// right of or below the main one; it can't reach negative coordinates, so on a display left of or
  /// above the main one the origin is that display's corner and rects arrive shifted by it.
  static func origin(of display: CGRect) -> CGPoint { CGPoint(x: min(0, display.minX), y: min(0, display.minY)) }

  /// The web view's AppKit frame inside a panel that covers `display` exactly (bottom-left origin).
  static func webFrame(display d: CGRect) -> CGRect {
    let o = origin(of: d)
    return CGRect(x: o.x - d.minX, y: 0, width: d.maxX - o.x, height: d.maxY - o.y)
  }

  /// Global top-left rect to the page's CSS px.
  static func css(_ r: CGRect, origin o: CGPoint) -> Box { Box(r.offsetBy(dx: -o.x, dy: -o.y)) }

  /// AppKit mouse location (bottom-left of the main display) to global top-left points.
  static func topLeft(_ p: CGPoint, mainHeight: CGFloat) -> CGPoint { CGPoint(x: p.x, y: mainHeight - p.y) }
}

// MARK: - Arguments

struct BadInput: Error, CustomStringConvertible { let description: String }

enum Parse {
  /// `"App"` or `"App:window title"`.
  static func target(_ raw: String) throws -> (app: String, window: String?) {
    let parts = raw.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    let app = parts[0].trimmingCharacters(in: .whitespaces)
    guard !app.isEmpty else { throw BadInput(description: "--target needs an app name, example: --target 'Finder' or 'Google Chrome:Inbox'") }
    let title = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespaces) : ""
    return (app, title.isEmpty ? nil : title)
  }

  /// `"x,y,w,h"` in global top-left points.
  static func rect(_ raw: String) throws -> CGRect {
    let n = raw.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard n.count == 4, n[2] > 0, n[3] > 0 else { throw BadInput(description: "--rect wants x,y,width,height in screen points, got '\(raw)'") }
    return CGRect(x: n[0], y: n[1], width: n[2], height: n[3])
  }

  /// A URL as is; an existing file as file://; a viz id (its path under $HOME, or a bare slug in
  /// ~/.agents/state/viz) as its page on the viz server.
  static func source(_ raw: String, home: String, isDir: (String) -> Bool, isFile: (String) -> Bool) throws -> URL {
    if raw.contains("://"), let u = URL(string: raw) { return u }
    if isFile(raw) { return URL(fileURLWithPath: raw).standardizedFileURL }
    let id = raw.hasPrefix(home + "/") ? String(raw.dropFirst(home.count + 1)) : raw
    for path in [id, ".agents/state/viz/" + id] where isDir(home + "/" + path) {
      let trimmed = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      if let u = URL(string: "http://127.0.0.1:5180/" + trimmed + "/") { return u }
    }
    throw BadInput(description: "'\(raw)' is not a URL, an HTML file or a viz id (a viz's path under $HOME, or its slug in ~/.agents/state/viz)")
  }

  /// `--flag value` options and bare flags; the first plain word is the positional argument.
  static func options(_ args: [String], flags: Set<String>, valued: Set<String>) throws -> (positional: [String], values: [String: String], flags: Set<String>) {
    var pos: [String] = [], vals: [String: String] = [:], on: Set<String> = []
    var i = 0
    while i < args.count {
      let a = args[i]
      if valued.contains(a) {
        guard i + 1 < args.count else { throw BadInput(description: "\(a) needs a value") }
        vals[a] = args[i + 1]
        i += 2
        continue
      }
      if flags.contains(a) { on.insert(a) } else if a.hasPrefix("--") { throw BadInput(description: "unknown option \(a)") } else { pos.append(a) }
      i += 1
    }
    return (pos, vals, on)
  }
}

/// The agent session an overlay belongs to: it ends when that process exits, and `stop --session` finds it.
struct Owner: Codable, Equatable {
  let pid: Int32?
  let session: String?
  let pane: String?

  static func from(_ env: [String: String]) -> Owner {
    func first(_ keys: [String]) -> String? { keys.lazy.compactMap { env[$0]?.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty } }
    let pid = first(["VIZ_OVERLAY_OWNER_PID", "CLAUDE_PID"]).flatMap(Int32.init).flatMap { $0 > 0 ? $0 : nil }
    return Owner(pid: pid, session: first(["VIZ_OVERLAY_SESSION", "CLAUDE_CODE_SESSION_ID"]), pane: first(["HERDR_PANE_ID"]))
  }
}
