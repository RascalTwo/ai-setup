// click x y [text]: posts a left click, then types text (no Return: if the overlay misses the keys, nothing gets submitted) at global top-left points (needs Accessibility for the shell's app).
import CoreGraphics
import Foundation
let a = CommandLine.arguments
let p = CGPoint(x: Double(a[1])!, y: Double(a[2])!)
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap)
usleep(150_000)  // the host checks the pointer at 60 Hz before it starts taking clicks
for t in [CGEventType.leftMouseDown, .leftMouseUp] {
  CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap)
  usleep(30_000)
}
if a.count > 3 {
  usleep(200_000)
  let src = CGEventSource(stateID: .hidSystemState)
  for ch in a[3].utf16 {
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)!
      e.keyboardSetUnicodeString(stringLength: 1, unicodeString: [ch])
      e.post(tap: .cghidEventTap)
      usleep(10_000)
    }
  }
}
