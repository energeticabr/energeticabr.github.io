import Foundation
import UniformTypeIdentifiers

// Executed on macOS with the real Foundation file store. Never uses the App Group.
let testRoot = FileManager.default.temporaryDirectory.appendingPathComponent("energetico-share-tests-\(UUID().uuidString)", isDirectory: true)
try FileManager.default.createDirectory(at: testRoot, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: testRoot) }
let store = try SharedInboxStore(containerURL: testRoot.appendingPathComponent("inbox"))
let oversized = testRoot.appendingPathComponent("exceeds-server-limit.pdf")
FileManager.default.createFile(atPath: oversized.path, contents: nil)
let handle = try FileHandle(forWritingTo: oversized)
try handle.truncate(atOffset: 60_000_001)
try handle.close()
var oversizedRejected = false
do {
    _ = try store.stage(url: oversized)
} catch SharedInboxStoreError.invalidAttachment {
    oversizedRejected = true
}
precondition(oversizedRejected, "A file larger than the server's 60,000,000 byte limit must be rejected before staging")
let itemsAfterRejectedFile = try store.list()
precondition(itemsAfterRejectedFile.isEmpty, "A rejected file must not create an inbox item")
print("PASS: native share server-size boundary")
