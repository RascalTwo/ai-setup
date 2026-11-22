// Types ASCII text into Omnissa Horizon as real key codes.
// Horizon forwards key codes, not the Unicode text that computer-use `type` sends, so `type` arrives as "aaaa".
// Usage: swift vdi-type.swift "text"   |   swift vdi-type.swift --selftest
import AppKit
import CoreGraphics

// Human-like rhythm: fixed machine timing stands out to endpoint monitoring. Horizon drops whole runs at 0 ms,
// so every delay stays at 20 ms or more, well above the 10 ms that landed in testing (2026-11-01).
func ms(_ lo: Int, _ hi: Int) -> useconds_t { useconds_t((Int.random(in: lo...hi) + Int.random(in: lo...hi)) / 2 * 1000) }

// shortcut: US keyboard layout on both ends, upgrade if a guest uses another layout.
let plain = Array("asdfhgzxcvbqweryt123465=97-80]ou[ip\nlj'k;\\,/nm.\t `")
let shifted = Array("ASDFHGZXCVBQWERYT!@#$^%+(&_*)}OU{IP\nLJ\"K:|<?NM>\t ~")
let codes: [CGKeyCode] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]
precondition(plain.count == codes.count && shifted.count == codes.count, "key tables out of step")

func key(for ch: Character) -> (CGKeyCode, Bool)? {
    if let i = plain.firstIndex(of: ch) { return (codes[i], false) }
    if let i = shifted.firstIndex(of: ch) { return (codes[i], true) }
    return nil
}

let args = CommandLine.arguments.dropFirst()
guard let text = args.first else { print("usage: vdi-type.swift \"text\" | --selftest"); exit(2) }

if text == "--selftest" {
    let printable = (32...126).map { Character(UnicodeScalar($0)) } + ["\n", "\t"]
    let missing = printable.filter { key(for: $0) == nil }
    precondition(missing.isEmpty, "unmapped: \(missing)")
    precondition(key(for: "A")! == (0, true) && key(for: "?")! == (44, true) && key(for: "\n")! == (36, false))
    print("selftest ok: all \(printable.count) printable ASCII characters map")
    exit(0)
}

let unmapped = text.filter { key(for: $0) == nil }
guard unmapped.isEmpty else { print("REFUSED: not typeable, paste it instead: \(String(Set(unmapped)))"); exit(3) }
guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier?.hasPrefix("com.omnissa.horizon") == true else {
    print("REFUSED: Horizon is not frontmost"); exit(4)
}

let src = CGEventSource(stateID: .hidSystemState)
func post(_ code: CGKeyCode, down: Bool, shift: Bool, then wait: useconds_t) {
    let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
    if shift { e.flags = .maskShift }
    e.post(tap: .cghidEventTap)
    usleep(wait)
}
// Pace: about 95 WPM on plain text (a fast typist), slower on digits, symbols and Shift, with a short
// pause every 20-45 keys. Keep in step with type() in web-client.js.
var sincePause = 0, nextPause = Int.random(in: 20...45)
for ch in text {
    let (code, shift) = key(for: ch)!
    if shift { post(56, down: true, shift: true, then: ms(20, 50)) }
    post(code, down: true, shift: shift, then: ms(30, 70)) // key held
    post(code, down: false, shift: shift, then: shift ? ms(20, 40) : 0)
    if shift { post(56, down: false, shift: false, then: 0) }
    sincePause += 1
    if sincePause >= nextPause { sincePause = 0; nextPause = Int.random(in: 20...45); usleep(ms(150, 400)); continue }
    let hard = shift || ch.isNumber || ("!@#$%^&*()_+{}|:\"<>?=[]\\;'`~".contains(ch))
    usleep(" .,/-\n\t".contains(ch) ? ms(50, 150) : hard ? ms(60, 160) : ms(25, 85)) // gap to next key
}
print("typed \(text.count) characters")
