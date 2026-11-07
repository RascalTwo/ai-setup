// Apple Vision OCR on a screenshot: one line per text box, centre in image pixels (origin top-left).
// Usage: swiftc -O -o /tmp/vdi-ocr ocr.swift && /tmp/vdi-ocr shot.jpg
// Screenshots saved by Claude in Chrome are in its coordinate frame, so the centres are click targets.
// The first run after idle loads the model (~40 s); later runs take well under a second.
import AppKit
import Foundation
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let img = NSImage(contentsOf: url) else { fatalError("cannot read \(url.path)") }
var rect = CGRect(origin: .zero, size: img.size)
let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let t0 = Date()
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([req])
let obs = req.results ?? []
print(String(format: "%d boxes in %.2fs (image %dx%d)", obs.count, Date().timeIntervalSince(t0), cg.width, cg.height))
for o in obs {
  let b = o.boundingBox, s = o.topCandidates(1)[0]
  print(String(format: "(%4.0f,%4.0f) %.2f %@", b.midX * Double(cg.width), (1 - b.midY) * Double(cg.height), s.confidence, s.string))
}
