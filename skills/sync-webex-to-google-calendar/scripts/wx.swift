// Webex desktop calendar (LIST view) -> JSON. READ-ONLY. Native accessibility API.
// Clicks only an event row. Reads the side panel: no window is ever opened.
// Never reads password, host key, meeting number, dial-in. Output stays in ../out/.
import Cocoa
import ApplicationServices

// MARK: AX helpers
func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: CFTypeRef?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil }
func kids(_ e: AXUIElement) -> [AXUIElement] { (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func role(_ e: AXUIElement) -> String { (attr(e, kAXRoleAttribute) as? String) ?? "" }
func sub(_ e: AXUIElement) -> String { (attr(e, kAXSubroleAttribute) as? String) ?? "" }
func txt(_ e: AXUIElement) -> String { (attr(e, kAXValueAttribute) as? String) ?? (attr(e, kAXTitleAttribute) as? String) ?? (attr(e, kAXDescriptionAttribute) as? String) ?? "" }
func rt(_ e: AXUIElement) -> (String, String) {
    var out: CFArray?
    let names = [kAXRoleAttribute, kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] as CFArray
    guard AXUIElementCopyMultipleAttributeValues(e, names, AXCopyMultipleAttributeOptions(rawValue: 0), &out) == .success, let a = out as? [AnyObject], a.count == 4 else { return (role(e), txt(e)) }
    let s = a.map { $0 as? String }
    return (s[0] ?? "", s[1] ?? s[2] ?? s[3] ?? "")
}
func rect(_ e: AXUIElement) -> CGRect? { var p = CGPoint.zero, s = CGSize.zero; guard let pv = attr(e, kAXPositionAttribute), let sv = attr(e, kAXSizeAttribute), AXValueGetValue(pv as! AXValue, .cgPoint, &p), AXValueGetValue(sv as! AXValue, .cgSize, &s) else { return nil }; return CGRect(origin: p, size: s) }
func allTexts(_ e: AXUIElement, _ depth: Int = 0) -> [String] { if depth > 8 { return [] }; var out: [String] = []; for k in kids(e) { let (r, t) = rt(k); if r == "AXStaticText" { if !t.isEmpty { out.append(t) } } else if r != "AXButton" { out += allTexts(k, depth + 1) } }; return out }
func find(_ e: AXUIElement, _ depth: Int, skipTable: Bool = true, _ pred: (AXUIElement) -> Bool) -> AXUIElement? {
    if depth > 14 { return nil }
    for k in kids(e) {
        if pred(k) { return k }
        let r = role(k)
        if r == "AXTable" && skipTable { continue }
        if r == "AXStaticText" { continue }
        if let f = find(k, depth + 1, skipTable: skipTable, pred) { return f }
    }
    return nil
}
func click(_ p: CGPoint) {
    for t: CGEventType in [.mouseMoved, .leftMouseDown, .leftMouseUp] {
        CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: t, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap)
        usleep(40_000)
    }
}
func waitFor(_ ms: Int, _ cond: () -> Bool) -> Bool { var w = 0; while w < ms { if cond() { return true }; usleep(40_000); w += 40 }; return cond() }
let outDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/webex-calendar/out").path
let t0 = Date()
func log(_ m: String) {
    let line = String(format: "%6.1fs ", Date().timeIntervalSince(t0)) + m + "\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
    if let fh = FileHandle(forWritingAtPath: outDir + "/progress.log") { fh.seekToEndOfFile(); fh.write(line.data(using: .utf8)!); fh.closeFile() }
}

// MARK: args
var fromStr: String? = nil, days = 7
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty { let a = args.removeFirst(); if a == "--from", !args.isEmpty { fromStr = args.removeFirst() } else if a == "--days", !args.isEmpty { days = Int(args.removeFirst()) ?? 7 } }
let cal = Calendar.current
let dayFmt = DateFormatter(); dayFmt.locale = Locale(identifier: "en_US_POSIX"); dayFmt.dateFormat = "yyyy-MM-dd"
let headFmt = DateFormatter(); headFmt.locale = Locale(identifier: "en_US_POSIX"); headFmt.dateFormat = "EEEE, MMMM d, yyyy"
let fromDate = fromStr.flatMap { dayFmt.date(from: $0) } ?? cal.startOfDay(for: Date())
let toDate = cal.date(byAdding: .day, value: days, to: fromDate)!
FileManager.default.createFile(atPath: outDir + "/progress.log", contents: nil)
log("run start; range \(dayFmt.string(from: fromDate)) +\(days)d")

// MARK: locate
guard AXIsProcessTrusted() else { log("ERROR not trusted for accessibility"); exit(2) }
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "Cisco-Systems.Spark").first else { log("ERROR Webex not running"); exit(2) }
let axApp = AXUIElementCreateApplication(app.processIdentifier)
func mainWin() -> AXUIElement? { (attr(axApp, kAXWindowsAttribute) as? [AXUIElement] ?? []).first { (attr($0, kAXTitleAttribute) as? String) == "Webex" } }
guard let win = mainWin() else { log("ERROR no main Webex window"); exit(2) }
// MARK: baseline: Messaging -> Meetings -> Calendar tab -> List view -> side panel closed (the list is scrolled per row later)
func ctl(_ roleName: String, _ pred: @escaping (AXUIElement) -> Bool) -> AXUIElement? { find(win, 0) { role($0) == roleName && pred($0) } }
func hub(_ id: String) -> AXUIElement? { ctl("AXRadioButton") { (attr($0, kAXIdentifierAttribute) as? String) == id } }
func press(_ e: AXUIElement?) { if let e = e { AXUIElementPerformAction(e, kAXPressAction as CFString) } }
press(hub("WTMessagingHubButton")); _ = waitFor(3000) { (attr(hub("WTMessagingHubButton")!, kAXValueAttribute) as? Int) == 1 }
press(hub("WTMeetingHubButton"));   _ = waitFor(3000) { (attr(hub("WTMeetingHubButton")!, kAXValueAttribute) as? Int) == 1 }
if !waitFor(5000, { ctl("AXRadioButton") { txt($0) == "Calendar" } != nil }) { log("ERROR Meetings hub did not open"); exit(3) }
if let c = ctl("AXRadioButton", { txt($0) == "Calendar" }), (attr(c, kAXValueAttribute) as? Int) != 1 { press(c); _ = waitFor(3000) { (attr(c, kAXValueAttribute) as? Int) == 1 } }
func viewPopup() -> AXUIElement? { ctl("AXPopUpButton") { txt($0).hasPrefix("Meetings view") } }
func setView(_ name: String) {   // the view menu is an AXPopover: a table whose cells read "List, Checked" / "Day" / "Work Week" / "Week"
    guard let pb = viewPopup(), !txt(pb).hasSuffix(", " + name) else { return }
    press(pb)
    func item() -> AXUIElement? { viewPopup().flatMap { find($0, 0, skipTable: false) { role($0) == "AXUnknown" && txt($0).hasPrefix(name) } } }
    if waitFor(3000, { item() != nil }), let r = item().flatMap({ rect($0) }) { click(CGPoint(x: r.midX, y: r.midY)) }
    _ = waitFor(3000) { viewPopup().map { txt($0).hasSuffix(", " + name) } ?? false }
}
setView("List")
guard viewPopup().map({ txt($0).hasSuffix(", List") }) ?? false else { log("ERROR could not switch to List view"); exit(3) }
if let x = ctl("AXButton", { txt($0) == "Close" && ((rect($0)?.minX ?? 0) > 1000) }) { press(x); _ = waitFor(3000) { ctl("AXButton") { txt($0) == "View all" } == nil } }
log("baseline ok: Meetings > Calendar > List")

guard let table = find(win, 0, skipTable: false, { role($0) == "AXTable" }) else { log("ERROR no list table: switch Webex to the List view"); exit(3) }
guard let scroll = attr(table, kAXParentAttribute) as! AXUIElement? else { log("ERROR no scroll area"); exit(3) }

struct Row { var idx: Int; var el: AXUIElement; var date: Date; var start: String?; var end: String?; var title: String; var allDay: Bool }
func scan() -> [Row] {   // the whole list as rows; re-run when the list was rebuilt under us (row indexes shift)
    var out: [Row] = []; var curDate: Date? = nil
    for (ri, r) in kids(curTable() ?? table).enumerated() where role(r) == "AXRow" {
        guard let cell = kids(r).first else { continue }
        let t = allTexts(cell)
        if t.count == 1, let d = headFmt.date(from: t[0]) { curDate = d; continue }
        guard let d = curDate else { continue }
        if t.first == "All day", t.count >= 2 { out.append(Row(idx: ri, el: r, date: d, start: nil, end: nil, title: t[1], allDay: true)) }
        else if t.count >= 4, t[1] == "-" { out.append(Row(idx: ri, el: r, date: d, start: t[0], end: t[3], title: t[2], allDay: false)) }
    }
    return out
}
let rows = scan()
let targets = rows.filter { $0.date >= fromDate && $0.date < toDate }
log("table: \(rows.count) rows total, \(targets.count) in range (\(targets.filter { $0.allDay }.count) all-day)")

// MARK: panel
func panel() -> AXUIElement? { find(win, 0) { role($0) == "AXStaticText" && txt($0).hasPrefix("Invitees (") }.flatMap { attr($0, kAXParentAttribute) as! AXUIElement? } }
let skipPrefixes = ["Meeting password", "Host key", "Meeting number", "Join by phone", "Join from a video", "Dial ", "Access code"]
func readPanel(_ p: AXUIElement) -> [String: Any] {
    // header lives in the sibling group above the scroll area; read the whole split group parent for title/date/link
    let top = (attr(p, kAXParentAttribute) as! AXUIElement?) ?? p
    let head = allTexts((attr(top, kAXParentAttribute) as! AXUIElement?) ?? top)
    var d: [String: Any] = [:]
    if let t = head.first { d["title"] = t }
    d["when"] = head.dropFirst().first { $0.contains(", 20") && $0.contains(":") } ?? ""
    d["link"] = head.first { $0.hasPrefix("http") } ?? ""
    d["locationLine"] = head.first { $0.contains("; http") || ($0.hasPrefix("~") && $0.contains("|")) } ?? ""
    let body = allTexts(p)
    if let inv = (head + body).first(where: { $0.hasSuffix(" has invited you") }) { d["organizer"] = String(inv.dropLast(" has invited you".count)) }
    if let i = body.firstIndex(of: "Description") { var desc: [String] = []; for s in body[(i + 1)...] { if s.hasPrefix("Invitees (") { break }; desc.append(s) }; d["description"] = desc.joined(separator: "\n") }
    if let i = body.firstIndex(where: { $0.hasPrefix("Invitees (") }) { d["inviteeCount"] = Int(body[i].filter { $0.isNumber }) ?? 0 }
    if let i = body.firstIndex(where: { $0.hasSuffix(" accepted") }) { d["acceptedSummary"] = body[i] }
    if let i = body.firstIndex(where: { $0.hasPrefix("Rooms (") }) {
        var rooms: [String] = []; var s = i + 1
        while s < body.count, body[s] != "Join information" { let t = body[s]; if t != "No room has been added for this meeting." && !["Accepted", "Declined", "Tentative", "Waiting for response"].contains(t) { rooms.append(t) }; s += 1 }
        d["rooms"] = rooms
    }
    if let r = body.first(where: { $0.hasPrefix("http") }), (d["link"] as? String ?? "").isEmpty { d["link"] = r }
    return d
}
if CommandLine.arguments.contains("--buttons") {
    func walk(_ e: AXUIElement, _ d: Int) { if d > 12 { return }; for k in kids(e) { let r = role(k); if ["AXButton", "AXRadioButton", "AXTab", "AXPopUpButton", "AXCheckBox", "AXMenuButton", "AXSegmentedControl", "AXRadioGroup"].contains(r) { print(r, "|", txt(k), "|", (attr(k, kAXIdentifierAttribute) as? String) ?? "", "|", rect(k).map { "\($0)" } ?? "") }; if r != "AXTable" && r != "AXStaticText" { walk(k, d + 1) } } }
    walk(win, 0); exit(0)
}
// debug: --panel prints the open panel, --win prints the non-main window
if CommandLine.arguments.contains("--panel") { print(panel().map { readPanel($0) } ?? [:]); exit(0) }
if CommandLine.arguments.contains("--dump") { for t in allTexts(win) { print(String(t.prefix(60))) }; exit(0) }
if CommandLine.arguments.contains("--win") { for w in (attr(axApp, kAXWindowsAttribute) as? [AXUIElement] ?? []) where (attr(w, kAXTitleAttribute) as? String) != "Webex" { print(allTexts(w)) }; exit(0) }

// MARK: scroll a row into the list's visible area
func curTable() -> AXUIElement? { find(win, 0, skipTable: false, { role($0) == "AXTable" }) }
func freshRow(_ idx: Int, _ title: String) -> (AXUIElement, AXUIElement, AXUIElement)? {   // (row, table, scrollArea), re-fetched: the list is rebuilt when the panel opens
    guard let t = curTable(), let sc = attr(t, kAXParentAttribute) as! AXUIElement? else { return nil }
    let ks = kids(t)
    guard idx < ks.count, allTexts(ks[idx]).contains(title) else { return nil }
    return (ks[idx], t, sc)
}
func ensureVisible(_ idx: Int, _ title: String) -> (AXUIElement, CGRect)? {
    for _ in 0..<8 {
        guard let (row, tbl, sc) = freshRow(idx, title), let view = rect(sc), let t = rect(tbl), let r = rect(row) else { log("  dbg: row \(idx) not found / no rect"); usleep(200_000); continue }
        if r.minY >= view.minY + 6 && r.maxY <= view.maxY - 6 { return (row, r) }
        guard let bar = attr(sc, kAXVerticalScrollBarAttribute) as! AXUIElement? else { log("  dbg: no vertical scroll bar"); return nil }
        let frac = max(0, min(1, ((r.minY - t.minY) - view.height / 2) / max(1, t.height - view.height)))
        AXUIElementSetAttributeValue(bar, kAXValueAttribute as CFString, NSNumber(value: frac))
        usleep(250_000)
    }
    return nil
}

// MARK: main loop
let iso = ISO8601DateFormatter(); iso.timeZone = .current; iso.formatOptions = [.withInternetDateTime]
func at(_ d: Date, _ hm: String?) -> String? {
    guard let hm = hm, hm.count == 5, let h = Int(hm.prefix(2)), let m = Int(hm.suffix(2)) else { return nil }
    return iso.string(from: cal.date(bySettingHour: h, minute: m, second: 0, of: d)!)
}
var events: [[String: Any]] = []; var errors: [[String: Any]] = []
FileManager.default.createFile(atPath: outDir + "/week.ndjson", contents: nil)
func emit(_ ev: [String: Any]) {
    events.append(ev)
    if let data = try? JSONSerialization.data(withJSONObject: ev), let fh = FileHandle(forWritingAtPath: outDir + "/week.ndjson") { fh.seekToEndOfFile(); fh.write(data); fh.write("\n".data(using: .utf8)!); fh.closeFile() }
}
for (i, row) in targets.enumerated() {
    var ev: [String: Any] = ["title": row.title, "date": dayFmt.string(from: row.date), "allDay": row.allDay]
    if let s = at(row.date, row.start) { ev["start"] = s }
    if let e = at(row.date, row.end) { ev["end"] = e }
    if row.allDay { emit(ev); log("[\(i + 1)/\(targets.count)] all-day: \(row.title)"); continue }
    var done = false; var idx = row.idx
    for attempt in 1...2 where !done {
        if freshRow(idx, row.title) == nil, let nr = scan().first(where: { $0.date == row.date && $0.start == row.start && $0.title == row.title }) { log("  row moved \(idx) -> \(nr.idx): \(row.title)"); idx = nr.idx }
        guard let (_, r0) = ensureVisible(idx, row.title) else { log("[\(i + 1)] cannot scroll to \(row.title)"); continue }
        usleep(250_000)
        let r = freshRow(idx, row.title).flatMap { rect($0.0) } ?? r0
        click(CGPoint(x: r.minX + min(160, r.width / 2), y: r.midY))
        let want = "\(row.start!) - \(row.end!)"
        let ok = waitFor(5000) {
            guard let p = panel() else { return false }
            let head = allTexts((attr((attr(p, kAXParentAttribute) as! AXUIElement?) ?? p, kAXParentAttribute) as! AXUIElement?) ?? p)
            return head.first == row.title && head.contains { $0.contains(want) && $0.contains(", 20") && $0.hasPrefix(headFmt.string(from: row.date).split(separator: ",").first!.description) }
        }
        if !ok { let seen = panel().map { allTexts((attr((attr($0, kAXParentAttribute) as! AXUIElement?) ?? $0, kAXParentAttribute) as! AXUIElement?) ?? $0).prefix(2).map { String($0.prefix(40)) } } ?? ["no panel"]; log("[\(i + 1)/\(targets.count)] attempt \(attempt): panel did not show \(row.title) | clicked y=\(Int(r.midY)) seen=\(seen)"); continue }
        let p = panel()!
        var d = readPanel(p)
        // tidy: one `link`, numeric `accepted`, no placeholder description, no `when`/`locationLine`, meeting passwords in URLs redacted
        if (d["link"] as? String ?? "").isEmpty, let loc = d["locationLine"] as? String, let r = loc.range(of: "https?://\\S+", options: .regularExpression) { d["link"] = String(loc[r]) }
        d["locationLine"] = nil; d["when"] = nil
        if let a = d["acceptedSummary"] as? String { d["accepted"] = Int(a.prefix { $0.isNumber }); d["acceptedSummary"] = nil }
        if let desc = d["description"] as? String { d["description"] = desc.hasPrefix("No description has been provided") ? "" : desc.replacingOccurrences(of: "pwd=[^&\\s]+", with: "pwd=REDACTED", options: .regularExpression) }
        if let l = d["link"] as? String { d["link"] = (l.components(separatedBy: ";").first ?? l).trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "pwd=[^&\\s]+", with: "pwd=REDACTED", options: .regularExpression) }
        for (k, v) in d { ev[k] = v }
        emit(ev); done = true
        log("[\(i + 1)/\(targets.count)] ok \(row.start!) \(row.title) (\(ev["inviteeCount"] ?? 0) invitees)")
    }
    if !done { errors.append(["title": row.title, "date": dayFmt.string(from: row.date), "start": row.start ?? ""]) }
}
let result: [String: Any] = ["extractedAt": iso.string(from: Date()), "listEnd": dayFmt.string(from: rows.last?.date ?? fromDate), "range": ["from": dayFmt.string(from: fromDate), "days": days], "events": events, "errors": errors]
try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: outDir + "/week.json"))
log("done: \(events.count) events, \(errors.count) errors")
