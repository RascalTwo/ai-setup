// Follows one target: its app by name, its window by id once found, its element by a cached AX
// reference (one walk, then cheap frame reads). Rects come out in global top-left points.
import AppKit
import ApplicationServices

final class Tracker {
  let spec: Spec
  /// The spec exactly as the page sent it, for snapshots.
  let raw: Any
  private var windowID: UInt32?
  private var element: AXUIElement?
  private var rectOffset: CGPoint?
  private var lastWalk = Date.distantPast
  /// A walk runs in the background (a substring label scans the whole app, seconds in Finder),
  /// so one slow target never stalls the others; its result lands here.
  private let lock = NSLock()
  private var walking = false
  private var walked: (AXUIElement?, CGRect?, String?)?
  private(set) var state = TargetState()

  init(_ spec: Spec, raw: Any) {
    self.spec = spec
    self.raw = raw
  }

  /// Off the main thread is fine; `displays` comes from the main thread.
  func tick(apps: [RunningApp], windows: [WindowInfo], displays: [CGRect]) -> TargetState {
    state = resolve(apps: apps, windows: windows, displays: displays)
    return state
  }

  private func gone(_ why: String) -> TargetState { TargetState(gone: true, error: why) }

  private func resolve(apps: [RunningApp], windows: [WindowInfo], displays: [CGRect]) -> TargetState {
    let matched = Match.apps(spec.app, in: apps)
    guard !matched.isEmpty else { return gone("no running app matches '\(spec.app)'") }
    let pids = Set(matched.map(\.pid))
    var win = windowID.flatMap { id in windows.first { $0.id == id && $0.isAppWindow } }
    if win == nil {
      element = nil
      rectOffset = nil
      win = findWindow(pids, windows, displays)
      windowID = win?.id
    }
    let name = matched[0].name ?? spec.app
    guard let win else { return gone(spec.window.map { "\(name) has no window titled '*\($0)*' on screen" } ?? "\(name) has no window on screen") }

    var rect = win.bounds
    if let q = spec.element ?? spec.web {
      if let e = element, let f = AX.frame(e), f.width > 0, f.height > 0 {
        rect = f
      } else {
        // The element went away (or was never found): walk again in the background, at most once a second.
        lock.lock()
        let result = walked, busy = walking
        walked = nil
        lock.unlock()
        if let (e, f, error) = result {
          guard let e, let f else { return gone(error ?? "not found") }
          element = e
          rect = f
        } else {
          if !busy, Date().timeIntervalSince(lastWalk) > 1 { walk(q, window: win, name: name, displays: displays) }
          return state.gone && state.error != nil ? state : gone("looking for '\(q.label)'")
        }
      }
    } else if let r = spec.rect {
      // A rect rides along with its window, at the offset it had when first seen.
      let o = rectOffset ?? CGPoint(x: r.x - win.bounds.minX, y: r.y - win.bounds.minY)
      rectOffset = o
      rect = CGRect(x: win.bounds.minX + o.x, y: win.bounds.minY + o.y, width: r.width, height: r.height)
    }
    let center = CGPoint(x: rect.midX, y: rect.midY)
    // Scrolled out of its own window counts as covered too.
    let covered = !win.bounds.insetBy(dx: -1, dy: -1).contains(center) || Match.isCovered(center, owners: pids, windows: windows)
    return TargetState(rect: Box(rect), window: Box(win.bounds), shown: !covered, covered: covered, gone: false)
  }

  private func walk(_ q: Spec.Element, window win: WindowInfo, name: String, displays: [CGRect]) {
    lastWalk = Date()
    guard System.accessibility else { return set((nil, nil, "targeting an element needs Accessibility (run viz-overlay doctor)")) }
    lock.lock()
    walking = true
    lock.unlock()
    let web = spec.web != nil
    DispatchQueue.global().async {
      let roots = AX.window(win.ownerPID, bounds: win.bounds).map { [$0] } ?? AX.roots(win.ownerPID)
      let nodes = AX.walk(roots) { n in
        (!web || n.inWeb) && Match.score(n, label: q.label, role: q.role) == 3 && Match.isVisible(n.frame, displays)
      }
      if let i = Match.element(nodes.map(\.0), label: q.label, role: q.role, web: web, displays: displays), let f = nodes[i].0.frame {
        return self.set((nodes[i].1, f, nil))
      }
      if web && !nodes.contains(where: { $0.0.inWeb && $0.0.role != "AXWebArea" }) {
        return self.set((nil, nil, "\(name) exposes no web page content to Accessibility; Chrome does only for some tabs (or when started with --force-renderer-accessibility, or while VoiceOver runs). Measure the element in the page and pass a rect instead"))
      }
      self.set((nil, nil, "no visible element labelled '\(q.label)'\(q.role.map { " with role \($0)" } ?? "") in \(name) (searched \(nodes.count) elements)"))
    }
  }

  private func set(_ r: (AXUIElement?, CGRect?, String?)) {
    lock.lock()
    walked = r
    walking = false
    lock.unlock()
  }

  private func findWindow(_ pids: Set<Int32>, _ windows: [WindowInfo], _ displays: [CGRect]) -> WindowInfo? {
    let mine = Match.windows(of: pids, in: windows, title: nil, displays: displays)
    guard let title = spec.window else { return mine.first }
    // Window titles in CGWindowList need Screen Recording; without it, find the AX window by title and match bounds.
    if mine.contains(where: { $0.title != nil }) { return Match.windows(of: pids, in: windows, title: title, displays: displays).first }
    let needle = title.lowercased()
    for pid in pids {
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, 0.5)
      for w in (AX.get(app, kAXWindowsAttribute) as [AXUIElement]?) ?? [] {
        guard ((AX.get(w, kAXTitleAttribute) as String?) ?? "").lowercased().contains(needle), let f = AX.frame(w) else { continue }
        if let hit = mine.first(where: { abs($0.bounds.minX - f.minX) < 2 && abs($0.bounds.minY - f.minY) < 2 }) { return hit }
      }
    }
    return nil
  }
}
