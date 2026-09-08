import Foundation
import UniformTypeIdentifiers
import Darwin

setbuf(stdout, nil)

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

func checkProviderReception() async throws {
    let payload = Data("%PDF-1.4\n native share fixture".utf8)
    let provider = NSItemProvider()
    provider.suggestedName = "contrato"
    // First advertised representation cannot be loaded; another valid one must be used.
    provider.registerFileRepresentation(forTypeIdentifier: UTType.png.identifier, fileOptions: [], visibility: .all) { completion in
        completion(nil, false, NSError(domain: "NativeShareFixture", code: 1))
        return nil
    }
    provider.registerDataRepresentation(forTypeIdentifier: UTType.pdf.identifier, visibility: .all) { completion in
        completion(payload, nil)
        return nil
    }
    print("START: failed first representation with PDF data fallback")
    let received = try await SharedItemLoader.stage(provider: provider, store: store)
    let readBack = try store.read(id: received.id)
    precondition(readBack.data == payload, "Failed first representation must not discard another valid representation")
    precondition(received.name == "contrato.pdf", "Data-only providers must preserve the original filename")
    precondition(received.type == "application/pdf", "Successful representation determines MIME type")
    let request = SharedUploadRequest.make(item: received, token: "fixture-token")
    precondition(request.value(forHTTPHeaderField: "Origin") == "capacitor://localhost", "Native URLSession uploads must identify the allowed native origin")
    precondition(request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token", "Origin must not replace bearer authentication")
    precondition(request.value(forHTTPHeaderField: "X-Portal-Message-Id") == received.id, "Retries must preserve the staged item's idempotency key")
    precondition(request.value(forHTTPHeaderField: "X-Portal-File-Name") == "contrato.pdf", "Upload must carry the staged original filename")
    print("PASS: provider representation fallback and original filename")

    let withPreview = NSItemProvider()
    withPreview.suggestedName = "relatorio.pdf"
    let previewURL = testRoot.appendingPathComponent("preview.png")
    try Data("thumbnail only".utf8).write(to: previewURL)
    withPreview.registerFileRepresentation(forTypeIdentifier: UTType.png.identifier, fileOptions: [], visibility: .all) { completion in
        completion(previewURL, false, nil)
        return nil
    }
    withPreview.registerDataRepresentation(forTypeIdentifier: UTType.pdf.identifier, visibility: .all) { completion in
        completion(payload, nil)
        return nil
    }
    print("START: original document versus preview")
    let original = try await SharedItemLoader.stage(provider: withPreview, store: store)
    let originalBytes = try store.read(id: original.id)
    precondition(originalBytes.data == payload, "A preview representation must not replace the original document")
    print("PASS: original document preferred over image preview")

    let missingOriginal = NSItemProvider()
    missingOriginal.suggestedName = "missing-original.pdf"
    missingOriginal.registerFileRepresentation(forTypeIdentifier: UTType.pdf.identifier, fileOptions: [], visibility: .all) { completion in
        completion(nil, false, NSError(domain: "NativeShareFixture", code: 2))
        return nil
    }
    missingOriginal.registerFileRepresentation(forTypeIdentifier: UTType.png.identifier, fileOptions: [], visibility: .all) { completion in
        completion(previewURL, false, nil)
        return nil
    }
    print("START: unavailable original versus readable thumbnail")
    var originalFailureReported = false
    do { _ = try await SharedItemLoader.stage(provider: missingOriginal, store: store) }
    catch SharedInboxStoreError.representationUnavailable { originalFailureReported = true }
    precondition(originalFailureReported, "An unavailable original PDF must report failure instead of silently uploading its PNG thumbnail as a PDF")
    print("PASS: unavailable original cannot be replaced by a thumbnail")

    let fileURL = testRoot.appendingPathComponent("original.customextension")
    try Data([1, 2, 3, 4]).write(to: fileURL)
    let fileProvider = NSItemProvider(contentsOf: fileURL)!
    print("START: unknown extension durable copy")
    let fromFile = try await SharedItemLoader.stage(provider: fileProvider, store: store)
    try FileManager.default.removeItem(at: fileURL)
    let durable = try store.read(id: fromFile.id)
    precondition(durable.data == Data([1, 2, 3, 4]), "Inbox must own the bytes after the provider temporary file disappears")
    precondition(fromFile.name == "original.customextension", "Unknown extensions must be preserved")
    print("PASS: unknown extension and durable file copy")

    let blocked = NSItemProvider()
    blocked.suggestedName = "perigoso.exe"
    blocked.registerDataRepresentation(forTypeIdentifier: UTType.data.identifier, visibility: .all) { completion in
        completion(Data([1, 2, 3]), nil)
        return nil
    }
    print("START: generic type with blocked extension")
    var blockedRejected = false
    do { _ = try await SharedItemLoader.stage(provider: blocked, store: store) }
    catch SharedInboxStoreError.invalidAttachment { blockedRejected = true }
    precondition(blockedRejected, "Generic provider types must not bypass blocked original file extensions")

    let empty = NSItemProvider()
    var failureReported = false
    do { _ = try await SharedItemLoader.stage(provider: empty, store: store) }
    catch { failureReported = true }
    precondition(failureReported, "An unreadable provider must report an error rather than disappear silently")
    let retained = try store.list()
    precondition(retained.count == 3, "Failures must neither lose previous successful files nor create partial inbox entries")
    print("PASS: blocked files, explicit failure, and partial-batch preservation")
}

let completed = DispatchSemaphore(value: 0)
Task.detached {
    do { try await checkProviderReception() }
    catch { fatalError("Native share test failed: \(error)") }
    completed.signal()
}
// Foundation providers may dispatch callbacks onto the main run loop. A blocking
// semaphore here deadlocks those callbacks even though the loading Task is detached.
let deadline = Date().addingTimeInterval(60)
var finished = false
while Date() < deadline {
    if completed.wait(timeout: .now()) == .success {
        finished = true
        break
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.02))
}
precondition(finished, "Provider loading did not finish")
