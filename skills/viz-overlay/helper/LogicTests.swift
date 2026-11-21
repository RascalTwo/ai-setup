// Logic.swift on fixtures. Run: helper/test (also run by test/viz-overlay.test.ts).
import CoreGraphics
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) {
  if !ok { failures += 1; print("✗ line \(line): \(what)") }
}

@main enum LogicTests {
  static func main() {
    let apps = [
      RunningApp(pid: 1, name: "Google Chrome", bundleID: "com.google.Chrome"),
      RunningApp(pid: 2, name: "Google Chrome Helper", bundleID: "com.google.Chrome.helper"),
      RunningApp(pid: 3, name: "Finder", bundleID: "com.apple.finder"),
      RunningApp(pid: 4, name: "Ghostty", bundleID: "com.mitchellh.ghostty"),
    ]
    let main = CGRect(x: 0, y: 0, width: 1728, height: 1117)
    let right = CGRect(x: 1728, y: 0, width: 2560, height: 1440)
    let left = CGRect(x: -1920, y: -200, width: 1920, height: 1080)
    let ghostty = WindowInfo(id: 10, ownerPID: 4, layer: 0, bounds: CGRect(x: 600, y: 100, width: 800, height: 600), alpha: 1, title: nil)
    let finder = WindowInfo(id: 11, ownerPID: 3, layer: 0, bounds: CGRect(x: 260, y: 140, width: 740, height: 500), alpha: 1, title: "Downloads")
    let menuBar = WindowInfo(id: 12, ownerPID: 99, layer: 25, bounds: CGRect(x: 0, y: 0, width: 1728, height: 33), alpha: 1, title: nil)
    let offscreen = WindowInfo(id: 13, ownerPID: 3, layer: 0, bounds: CGRect(x: -5000, y: 0, width: 500, height: 500), alpha: 1, title: "helper")
    let wins = [menuBar, ghostty, offscreen, finder]

    // Apps: exact beats prefix beats substring; bundle ids count.
    check(Match.apps("google chrome", in: apps).map(\.pid) == [1], "exact name wins over prefix")
    check(Match.apps("Google", in: apps).map(\.pid) == [1, 2], "prefix matches both")
    check(Match.apps("com.apple.finder", in: apps).map(\.pid) == [3], "bundle id")
    check(Match.apps("hrome", in: apps).map(\.pid) == [1, 2], "substring last")
    check(Match.apps("nope", in: apps).isEmpty, "no match")
    check(Match.preferred(Match.apps("Google", in: apps), activePID: 2, windows: wins)?.pid == 2, "active app preferred")
    check(Match.preferred(Match.apps("Google", in: apps), activePID: nil, windows: wins)?.pid == 1, "else first")

    // Windows: off-screen helpers and non-zero layers don't count; titles filter.
    check(Match.windows(of: [3], in: wins, title: nil, displays: [main]).map(\.id) == [11], "off-screen window skipped")
    check(Match.windows(of: [3], in: wins, title: "down", displays: [main]).map(\.id) == [11], "title substring, any case")
    check(Match.windows(of: [3], in: wins, title: "Desktop", displays: [main]).isEmpty, "title mismatch")

    // Covered: the frontmost normal window under the point decides; menu bar and empty desktop don't cover.
    check(Match.isCovered(CGPoint(x: 700, y: 300), owners: [3], windows: wins), "Ghostty over Finder covers")
    check(!Match.isCovered(CGPoint(x: 300, y: 300), owners: [3], windows: wins), "Finder's own area is not covered")
    check(!Match.isCovered(CGPoint(x: 300, y: 10), owners: [3], windows: wins), "menu bar (layer 25) does not cover")
    check(!Match.isCovered(CGPoint(x: 1600, y: 1000), owners: [3], windows: wins), "empty desktop does not cover")

    // Elements: visible first, then score, then enabled, then order; role filter; web only below an AXWebArea.
    let n = { (role: String, title: String, frame: CGRect?, enabled: Bool?, web: Bool) in
      Node(role: role, title: title, label: nil, value: nil, identifier: nil, frame: frame, enabled: enabled, inWeb: web)
    }
    let r = CGRect(x: 10, y: 10, width: 20, height: 20)
    let nodes = [
      n("AXButton", "Save as", r, true, false),          // 0 prefix
      n("AXButton", "Save", nil, true, false),           // 1 exact, invisible
      n("AXButton", "Save", r, false, false),            // 2 exact, disabled
      n("AXButton", "Save", r, true, false),             // 3 exact, enabled
      n("AXLink", "Save", r, true, true),                // 4 exact, web
      n("AXStaticText", "Autosave", r, true, true),      // 5 substring, web
    ]
    check(Match.element(nodes, label: "save", role: nil, web: false, displays: [main]) == 3, "exact, visible, enabled wins")
    check(Match.element(nodes, label: "save", role: "link", web: false, displays: [main]) == 4, "role filter, AX prefix ignored")
    check(Match.element(nodes, label: "save", role: nil, web: true, displays: [main]) == 4, "web limits to page content")
    check(Match.element(Array(nodes[5...]), label: "save", role: nil, web: true, displays: [main]) == 0, "substring as last resort")
    check(Match.element([nodes[1]], label: "save", role: nil, web: false, displays: [main]) == nil, "only invisible: no match")
    check(Match.score(nodes[0], label: "SAVE", role: "AXButton") == 2, "case-insensitive prefix")

    // Rules.
    let seen = TargetState(rect: Box(r), window: Box(r), shown: true, covered: false, gone: false)
    var covered = seen
    covered.covered = true
    check(Rule.target.decide(target: seen, ghosttyFront: false, paneFocused: false).0, "target visible shows")
    check(!Rule.target.decide(target: covered, ghosttyFront: true, paneFocused: true).0, "target covered hides")
    check(!Rule.target.decide(target: TargetState(), ghosttyFront: true, paneFocused: true).0, "target gone hides")
    check(Rule.pane.decide(target: nil, ghosttyFront: true, paneFocused: true).0, "pane focused shows")
    check(!Rule.pane.decide(target: nil, ghosttyFront: true, paneFocused: false).0, "other pane hides")
    check(!Rule.pane.decide(target: nil, ghosttyFront: false, paneFocused: true).0, "terminal behind hides")
    check(Rule.always.decide(target: TargetState(), ghosttyFront: false, paneFocused: false).0, "always shows")

    // Geometry: CSS px = global points except left of/above the main display.
    let displays = [main, right, left]
    check(Geometry.display(for: CGRect(x: 2000, y: 100, width: 50, height: 50), in: displays) == 1, "display holding the rect")
    check(Geometry.display(for: CGRect(x: 1700, y: 100, width: 100, height: 50), in: displays) == 1, "most of the rect wins")
    check(Geometry.display(for: CGRect(x: 9000, y: 0, width: 5, height: 5), in: displays) == 0, "nowhere: main")
    check(Geometry.origin(of: right) == .zero, "right display keeps global coordinates")
    check(Geometry.webFrame(display: right) == CGRect(x: -1728, y: 0, width: 4288, height: 1440), "web view shifted left by the display's x")
    check(Geometry.origin(of: left) == CGPoint(x: -1920, y: -200), "left display: origin is its corner")
    check(Geometry.webFrame(display: left) == CGRect(x: 0, y: 0, width: 1920, height: 1080), "left display: view = display")
    check(Geometry.css(CGRect(x: -1000, y: 0, width: 10, height: 10), origin: Geometry.origin(of: left)) == Box(CGRect(x: 920, y: 200, width: 10, height: 10)), "global to CSS on the left display")
    check(Geometry.topLeft(CGPoint(x: 5, y: 1117), mainHeight: 1117) == CGPoint(x: 5, y: 0), "AppKit to top-left")

    // Parsing.
    check((try? Parse.target("Google Chrome:Inbox - Gmail"))! == ("Google Chrome", "Inbox - Gmail"), "app:title")
    check((try? Parse.target(" Finder "))! == ("Finder", nil), "app only, trimmed")
    check((try? Parse.target(":x")) == nil, "empty app rejected")
    check((try? Parse.rect("1, 2,3,4")) == CGRect(x: 1, y: 2, width: 3, height: 4), "rect")
    check((try? Parse.rect("1,2,0,4")) == nil, "zero width rejected")
    let home = "/Users/u"
    let dirs: Set = ["/Users/u/.agents/state/viz/tour", "/Users/u/work/viz-a"]
    let src = { (s: String) in try? Parse.source(s, home: home, isDir: { dirs.contains($0) }, isFile: { $0 == "x.html" }) }
    check(src("http://h/p")?.absoluteString == "http://h/p", "URL as is")
    check(src("x.html")?.isFileURL == true, "file")
    check(src("tour")?.absoluteString == "http://127.0.0.1:5180/.agents/state/viz/tour/", "bare slug")
    check(src(".agents/state/viz/tour")?.absoluteString == "http://127.0.0.1:5180/.agents/state/viz/tour/", "viz id")
    check(src("/Users/u/work/viz-a")?.absoluteString == "http://127.0.0.1:5180/work/viz-a/", "absolute path under home")
    check(src("missing") == nil, "unknown rejected")
    let o = try? Parse.options(["page", "--when", "always", "--no-raise"], flags: ["--no-raise"], valued: ["--when"])
    check(o?.positional == ["page"] && o?.values["--when"] == "always" && o?.flags == ["--no-raise"], "options")
    check((try? Parse.options(["--bogus"], flags: [], valued: [])) == nil, "unknown option rejected")
    check((try? Parse.options(["--when"], flags: [], valued: ["--when"])) == nil, "missing value rejected")

    // Owner.
    check(Owner.from(["CLAUDE_PID": "42", "CLAUDE_CODE_SESSION_ID": "s", "HERDR_PANE_ID": "w:p"]) == Owner(pid: 42, session: "s", pane: "w:p"), "Claude Code env")
    check(Owner.from(["VIZ_OVERLAY_OWNER_PID": "7", "CLAUDE_PID": "42"]).pid == 7, "explicit owner wins")
    check(Owner.from(["CLAUDE_PID": "-3"]).pid == nil, "bad pid ignored")

    print(failures == 0 ? "logic: all passed" : "logic: \(failures) failed")
    exit(failures == 0 ? 0 : 1)
  }
}
