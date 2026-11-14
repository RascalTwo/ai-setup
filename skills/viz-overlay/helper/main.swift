// viz-overlay: show a web page (a viz) as a transparent, click-through layer over the real screen,
// aligned to app windows and elements. Usage: see `usage` below and ../SKILL.md.
import AppKit

let usage = """
usage:
  viz-overlay show <viz id | URL | file.html> [--target "App[:window title]"] [--element LABEL | --web LABEL] [--role ROLE]
                   [--rect x,y,w,h] [--when target|pane|always] [--duration SECONDS] [--no-raise] [--no-close] [--title TEXT]
                   [--save-snapshot FILE] [--json]
  viz-overlay update <id> <json | ->
  viz-overlay list [--json]
  viz-overlay stop <id>... | --session | --all
  viz-overlay elements --app APP [--match TEXT] [--role ROLE] [--web] [--json]
  viz-overlay doctor
exit codes: 0 ok, 1 failed, 2 bad input, 3 target not found, 4 permission missing

"""

func out(_ s: String) { FileHandle.standardOutput.write(Data((s + "\n").utf8)) }
func die(_ code: Exit, _ msg: String) -> Never {
  FileHandle.standardError.write(Data("viz-overlay: \(msg)\n".utf8))
  exit(code.rawValue)
}
func json(_ o: Any) -> String {
  String(data: (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? "{}"
}

let showValued: Set<String> = ["--target", "--element", "--web", "--role", "--rect", "--when", "--duration", "--title", "--save-snapshot"]

/// `show`'s arguments, checked; shared by the parent (`show`) and the detached child (`_host`).
func showConfig(_ args: [String]) throws -> (HostConfig, raise: Bool, json: Bool) {
  let o = try Parse.options(args, flags: ["--no-raise", "--no-close", "--json"], valued: showValued)
  guard o.positional.count == 1 else { throw BadInput(description: "show takes one page: a viz id, a URL or an HTML file") }
  let fm = FileManager.default
  let url = try Parse.source(o.positional[0], home: fm.homeDirectoryForCurrentUser.path,
                             isDir: { var d: ObjCBool = false; return fm.fileExists(atPath: $0, isDirectory: &d) && d.boolValue },
                             isFile: { var d: ObjCBool = false; return fm.fileExists(atPath: $0, isDirectory: &d) && !d.boolValue })
  var spec: Spec?
  if let t = o.values["--target"] {
    let (app, window) = try Parse.target(t)
    spec = Spec(app: app, window: window)
    let role = o.values["--role"]
    if o.values["--element"] != nil && o.values["--web"] != nil { throw BadInput(description: "use --element or --web, not both") }
    spec?.element = o.values["--element"].map { Spec.Element(label: $0, role: role) }
    spec?.web = o.values["--web"].map { Spec.Element(label: $0, role: role) }
    spec?.rect = try o.values["--rect"].map { Box(try Parse.rect($0)) }
    if spec?.rect != nil && (spec?.element != nil || spec?.web != nil) { throw BadInput(description: "--rect replaces --element/--web; pass one") }
  } else if let k = ["--element", "--web", "--role", "--rect"].first(where: { o.values[$0] != nil }) {
    throw BadInput(description: "\(k) needs --target, the app it is in")
  }
  let ruleName = o.values["--when"] ?? (spec == nil ? "pane" : "target")
  guard let rule = Rule(rawValue: ruleName) else { throw BadInput(description: "--when is one of target, pane, always") }
  if rule == .target && spec == nil { throw BadInput(description: "--when target needs --target") }
  let duration = try o.values["--duration"].map { s -> Double in
    guard let d = Double(s), d >= 0 else { throw BadInput(description: "--duration wants seconds (0 = no limit)") }
    return d
  } ?? 0
  let title = o.values["--title"] ?? (url.isFileURL ? url.deletingPathExtension().lastPathComponent : url.lastPathComponent.isEmpty ? (url.host ?? "overlay") : url.lastPathComponent)
  let snapshot = o.values["--save-snapshot"].map { URL(fileURLWithPath: $0).standardizedFileURL.path }
  var c = HostConfig(url: url, title: title, rule: rule, target: spec, duration: duration, snapshot: snapshot, owner: Owner.from(ProcessInfo.processInfo.environment))
  c.closeButton = !o.flags.contains("--no-close")
  return (c, !o.flags.contains("--no-raise"), o.flags.contains("--json"))
}

func show(_ args: [String]) throws {
  let (c, raise, asJSON) = try showConfig(args)
  if let t = c.target {
    if t.element != nil || t.web != nil { try System.requireAccessibility("Targeting an element") }
    if raise { try System.raise(t.app, window: t.window) }
    // Fail fast with the reason, rather than an overlay that never shows.
    let tracker = Tracker(t, raw: [:]), displays = System.displays().map(\.frame)
    var s = tracker.tick(apps: System.apps(), windows: System.windows(), displays: displays)
    // An element walk runs in the background; wait for its answer (AX.walk gives up after 6 s).
    let deadline = Date().addingTimeInterval(8)
    while s.gone, s.error?.hasPrefix("looking for") == true, Date() < deadline {
      usleep(100_000)
      s = tracker.tick(apps: System.apps(), windows: System.windows(), displays: displays)
    }
    if s.gone { throw Failure(code: .notFound, description: s.error ?? "target not found") }
  }
  let childArgs = ["_host"] + args.filter { $0 != "--json" } + ["--no-raise"]
  let pid = try spawnDetached(childArgs)
  let deadline = Date().addingTimeInterval(20)
  while Date() < deadline {
    if let r = Registry.read(pid) {
      if asJSON {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.sortedKeys]
        out(String(data: (try? enc.encode(r)) ?? Data(), encoding: .utf8) ?? "")
      } else {
        out("viz-overlay \(pid): showing '\(r.title)' (\(r.url)), when \(r.when.rawValue). Log: \(r.log). Stop: viz-overlay stop \(pid)")
      }
      return
    }
    var status: Int32 = 0
    if waitpid(pid, &status, WNOHANG) == pid {
      let lines = (try? String(contentsOf: Paths.logs.appendingPathComponent("\(pid).jsonl"), encoding: .utf8))?.split(separator: "\n") ?? []
      let error = lines.last { $0.contains("\"error\"") }.map(String.init) ?? "exited with code \((status >> 8) & 0xFF) before showing"
      throw Failure(code: .failed, description: error)
    }
    usleep(20_000)
  }
  kill(pid, SIGTERM)
  throw Failure(code: .failed, description: "the overlay (pid \(pid)) did not get ready within 20 s; log: \(Paths.logs.path)/\(pid).jsonl")
}

/// Re-runs this binary in a new session with /dev/null stdio, so the agent's shell call returns
/// and is never held open by the child's pipes (bigarrow's Detacher).
func spawnDetached(_ args: [String]) throws -> Int32 {
  let exe = Paths.helper.appendingPathComponent("viz-overlay").path
  var actions: posix_spawn_file_actions_t?, attrs: posix_spawnattr_t?
  posix_spawn_file_actions_init(&actions)
  posix_spawnattr_init(&attrs)
  defer { posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attrs) }
  posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
  posix_spawn_file_actions_addopen(&actions, 1, "/dev/null", O_WRONLY, 0)
  posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0)
  posix_spawnattr_setflags(&attrs, Int16(POSIX_SPAWN_SETSID))
  let argv = ([exe] + args).map { strdup($0) } + [nil]
  defer { argv.forEach { free($0) } }
  var pid: pid_t = 0
  let status = posix_spawn(&pid, exe, &actions, &attrs, argv, environ)
  guard status == 0 else { throw Failure(code: .failed, description: "could not start the overlay: \(String(cString: strerror(status)))") }
  return pid
}

func host(_ args: [String]) throws -> Never {
  let (c, _, _) = try showConfig(args)
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)  // no Dock icon, never the active app
  let h = Host(c)
  h.start()
  // NSApplication.run() activates a terminal-less process and steals the focus (bigarrow's finding), so pump events by hand.
  while true {
    guard let e = app.nextEvent(matching: .any, until: .distantFuture, inMode: .default, dequeue: true) else { continue }
    app.sendEvent(e)
  }
}

func list(_ args: [String]) throws {
  let o = try Parse.options(args, flags: ["--json"], valued: [])
  let live = Registry.live()
  if o.flags.contains("--json") {
    let enc = JSONEncoder()
    enc.dateEncodingStrategy = .iso8601
    enc.outputFormatting = [.sortedKeys]
    return out(String(data: try enc.encode(live), encoding: .utf8) ?? "[]")
  }
  if live.isEmpty { return out("no overlays") }
  for r in live {
    let target = r.target.map { " on \($0.app)\($0.window.map { ":" + $0 } ?? "")" } ?? ""
    out("\(r.id)  \(r.title)\(target)  when \(r.when.rawValue)  session \(r.owner.session ?? "-")  \(r.url)")
  }
}

func stop(_ args: [String]) throws {
  let o = try Parse.options(args, flags: ["--session", "--all"], valued: [])
  let live = Registry.live()
  let picked: [Record]
  if o.flags.contains("--all") {
    picked = live
  } else if o.flags.contains("--session") {
    guard let s = Owner.from(ProcessInfo.processInfo.environment).session else { throw BadInput(description: "--session: no CLAUDE_CODE_SESSION_ID or VIZ_OVERLAY_SESSION in the environment") }
    picked = live.filter { $0.owner.session == s }
  } else {
    guard !o.positional.isEmpty else { throw BadInput(description: "stop takes ids (from viz-overlay list), --session or --all") }
    let ids = try o.positional.map { s -> Int32 in
      guard let id = Int32(s) else { throw BadInput(description: "'\(s)' is not an overlay id") }
      return id
    }
    if let missing = ids.first(where: { id in !live.contains { $0.id == id } }) { throw Failure(code: .notFound, description: "no live overlay \(missing)") }
    picked = live.filter { ids.contains($0.id) }
  }
  for r in picked { kill(r.id, SIGTERM) }
  let deadline = Date().addingTimeInterval(3)
  while Date() < deadline, picked.contains(where: { Registry.isOverlay($0.id) }) { usleep(20_000) }
  out(picked.isEmpty ? "nothing to stop" : "stopped \(picked.map { String($0.id) }.joined(separator: " "))")
}

/// Sends the page a JSON value (`overlay.on("data")`): appended to the overlay's inbox, then SIGUSR1 tells the host to read it.
func update(_ args: [String]) throws {
  let o = try Parse.options(args, flags: [], valued: [])
  guard o.positional.count == 2, let id = Int32(o.positional[0]) else { throw BadInput(description: "update takes an overlay id and a JSON value (or - to read it from stdin)") }
  let text = o.positional[1] == "-" ? String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self) : o.positional[1]
  guard let v = try? JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed]) else { throw BadInput(description: "update: not JSON: \(text.prefix(200))") }
  guard Registry.live().contains(where: { $0.id == id }) else { throw Failure(code: .notFound, description: "no live overlay \(id)") }
  // One line per value, written in one append so concurrent updates never interleave.
  let line = String(decoding: try JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]), as: UTF8.self) + "\n"
  guard let h = FileHandle(forWritingAtPath: Registry.inbox(id).path) else { throw Failure(code: .failed, description: "overlay \(id) has no inbox (started before update existed?)") }
  h.seekToEndOfFile()
  h.write(Data(line.utf8))
  h.closeFile()
  kill(id, SIGUSR1)
}

func elements(_ args: [String]) throws {
  let o = try Parse.options(args, flags: ["--web", "--json"], valued: ["--app", "--match", "--role"])
  guard let app = o.values["--app"] else { throw BadInput(description: "elements needs --app") }
  let found = try Elements.list(app, match: o.values["--match"], role: o.values["--role"], web: o.flags.contains("--web"), displays: System.displays().map(\.frame))
  // Global points here (origin zero), the same space --rect takes.
  if o.flags.contains("--json") { return out(json(found.map { $0.json(origin: .zero) })) }
  for e in found {
    let f = e.node.frame ?? .zero
    out("\(Int(f.minX)),\(Int(f.minY)),\(Int(f.width)),\(Int(f.height))  \(e.node.role ?? "?")  \(e.node.name ?? "")\(e.node.inWeb ? "  [web]" : "")")
  }
  if found.isEmpty { out("no visible labelled elements\(o.flags.contains("--web") ? " in web content (Chrome exposes it only with --force-renderer-accessibility or while VoiceOver runs)" : "")") }
}

func doctor() {
  let env = ProcessInfo.processInfo.environment
  let owner = Owner.from(env)
  var vizUp = false
  let sem = DispatchSemaphore(value: 0)
  var req = URLRequest(url: URL(string: "http://127.0.0.1:5180/")!)
  req.timeoutInterval = 1
  URLSession.shared.dataTask(with: req) { _, r, _ in vizUp = r != nil; sem.signal() }.resume()
  _ = sem.wait(timeout: .now() + 2)
  let herdr = System.run(["which", "herdr"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  let rows: [(Bool, String)] = [
    (System.accessibility, "Accessibility (element targets, window titles, raising) for \(System.responsibleApp() ?? "the app running this shell")"),
    (System.screenRecording, "Screen Recording (window titles without Accessibility); optional"),
    (FileManager.default.fileExists(atPath: Paths.helper.appendingPathComponent("bridge.js").path), "bridge.js next to the binary (\(Paths.helper.path))"),
    (!herdr.isEmpty, "herdr on PATH (messages reach the session)"),
    (owner.pane != nil, "HERDR_PANE_ID set (\(owner.pane ?? "none")): messages are typed there; --when pane follows it"),
    (owner.pid != nil, "owner pid (\(owner.pid.map(String.init) ?? "none")): overlays end with this session"),
    (vizUp, "viz server on 127.0.0.1:5180 (for viz ids)"),
  ]
  for (ok, what) in rows { out("\(ok ? "✓" : "✗") \(what)") }
  out("live overlays: \(Registry.live().count)")
}

var argv = Array(CommandLine.arguments.dropFirst())
let command = argv.isEmpty ? "" : argv.removeFirst()
do {
  switch command {
  case "show": try show(argv)
  case "_host": try host(argv)
  case "list": try list(argv)
  case "stop": try stop(argv)
  case "update": try update(argv)
  case "elements": try elements(argv)
  case "doctor": doctor()
  case "-h", "--help", "help": out(usage)
  default: die(.badInput, "unknown command '\(command)'\n\(usage)")
  }
} catch let e as BadInput {
  die(.badInput, e.description)
} catch let e as Failure {
  die(e.code, e.description)
} catch {
  die(.failed, "\(error)")
}
