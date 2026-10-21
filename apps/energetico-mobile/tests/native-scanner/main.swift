import Foundation

let root = FileManager.default.temporaryDirectory.appendingPathComponent("scanner-tests-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
let cache = ScanCache(root: root.appendingPathComponent("owned"), maxBytes: 12)
let jpeg = Data([255,216,255,217])
let session = try cache.write(pageCount: 2) { _ in jpeg }
assert(session.pages.count == 2)
let saved = try Data(contentsOf: session.pages[0].url)
assert(saved == jpeg)
assert(session.pages[0].size == 4 && session.pages[1].name == "documento-2.jpg")
let sentinel = root.appendingPathComponent("keep.txt")
try Data([1]).write(to: sentinel)
cache.release(id: "../keep.txt")
assert(FileManager.default.fileExists(atPath: sentinel.path))
cache.release(id: session.id)
assert(!FileManager.default.fileExists(atPath: session.pages[0].url.path))
assert(FileManager.default.fileExists(atPath: sentinel.path))
for count in [0,21,4] {
  var rejected = false
  do { _ = try cache.write(pageCount: count) { _ in jpeg } } catch { rejected = true }
  assert(rejected, "invalid count/aggregate bytes must fail")
}
var partialFailed = false
do { _ = try cache.write(pageCount: 2) { index in
  if index == 1 { throw NSError(domain: "synthetic", code: 1) }; return jpeg
} } catch { partialFailed = true }
assert(partialFailed)
let remaining = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("owned").path)
assert(remaining.isEmpty)
print("PASS: native scanner ordered pages, byte/page limits, atomic rollback and scoped cleanup")
