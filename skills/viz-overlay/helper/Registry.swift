// Where things live, the registry of live overlays (one JSON file per host pid, like bigarrow's
// PidRegistry), and the element listing `elements` and `overlay.elements()` share.
import AppKit

enum Paths {
  static let state = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".agents/state/viz-overlay")
  static let logs = state.appendingPathComponent("logs")
  static let registry = FileManager.default.temporaryDirectory.appendingPathComponent("viz-overlay")
  /// The directory holding the binary (and bridge.js), symlinks resolved.
  /// argv[0] is a bare name when run from PATH, so ask the OS for the executable instead.
  static let helper = URL(fileURLWithPath: Bundle.main.executablePath ?? CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
}

struct Record: Codable {
  let id: Int32
  let title: String
  let url: String
  let when: Rule
  let target: Spec?
  let owner: Owner
  let started: Date
  let log: String
}

enum Registry {
  static func file(_ pid: Int32) -> URL { Paths.registry.appendingPathComponent("\(pid).json") }

  /// Written once the overlay is up: it is also the "ready" signal `show` waits for.
  static func write(_ c: HostConfig, log: URL) {
    let r = Record(id: getpid(), title: c.title, url: c.url.absoluteString, when: c.rule, target: c.target, owner: c.owner, started: Date(), log: log.path)
    try? FileManager.default.createDirectory(at: Paths.registry, withIntermediateDirectories: true)
    let enc = JSONEncoder()
    enc.dateEncodingStrategy = .iso8601
    try? enc.encode(r).write(to: file(r.id), options: .atomic)
  }

  /// What `viz-overlay update` sends a live overlay: one JSON value per line, read by the host on SIGUSR1.
  static func inbox(_ pid: Int32) -> URL { Paths.registry.appendingPathComponent("\(pid).inbox.jsonl") }

  static func remove(_ pid: Int32) { for f in [file(pid), inbox(pid)] { try? FileManager.default.removeItem(at: f) } }

  static func read(_ pid: Int32) -> Record? {
    let dec = JSONDecoder()
    dec.dateDecodingStrategy = .iso8601
    return (try? Data(contentsOf: file(pid))).flatMap { try? dec.decode(Record.self, from: $0) }
  }

  /// Live overlays, oldest first; files of dead (or reused) pids are deleted.
  static func live() -> [Record] {
    let files = (try? FileManager.default.contentsOfDirectory(at: Paths.registry, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.pathExtension == "json" }.compactMap { f -> Record? in
      guard let pid = Int32(f.deletingPathExtension().lastPathComponent), isOverlay(pid), let r = read(pid) else {
        try? FileManager.default.removeItem(at: f)
        return nil
      }
      return r
    }.sorted { $0.started < $1.started }
  }

  static func processExists(_ pid: Int32) -> Bool { pid > 0 && (kill(pid, 0) == 0 || errno == EPERM) }

  /// Alive and still running viz-overlay (pids get reused).
  static func isOverlay(_ pid: Int32) -> Bool {
    guard processExists(pid) else { return false }
    var buf = [UInt8](repeating: 0, count: 256)
    let n = proc_name(pid, &buf, UInt32(buf.count))
    return n > 0 && String(bytes: buf.prefix(Int(n)), encoding: .utf8) == "viz-overlay"
  }
}

struct Element {
  let node: Node
  func json(origin o: CGPoint) -> [String: Any] {
    var j: [String: Any] = ["role": node.role ?? "", "label": node.name ?? "", "web": node.inWeb]
    if let f = node.frame { let b = Geometry.css(f, origin: o); j["rect"] = ["x": b.x, "y": b.y, "width": b.width, "height": b.height] }
    return j
  }
}

enum Elements {
  /// The visible, labelled elements of an app, in tree order; `match` filters labels, `role` roles, `web` page content.
  static func list(_ app: String, match: String?, role: String?, web: Bool, displays: [CGRect]) throws -> [Element] {
    try System.requireAccessibility("Listing elements")
    let a = try System.app(app)
    return AX.walk(AX.roots(a.pid)).map(\.0).filter { n in
      guard Match.isVisible(n.frame, displays), let name = n.name, !name.isEmpty else { return false }
      if web && !n.inWeb { return false }
      if let role, Match.role(n.role ?? "") != Match.role(role) { return false }
      if let match, !n.texts.contains(where: { $0.contains(match.lowercased()) }) { return false }
      return true
    }.map(Element.init)
  }
}
