import Foundation

func checkProgressModel() {
    var single = SharedUploadProgress(items: [(id: "document", size: 100)])
    precondition(single.percent == 0, "Progress starts at zero, without a timer")
    single.begin(id: "document")
    single.recordSentBytes(id: "document", totalBytesSent: 37)
    precondition(single.percent == 37, "The badge uses real transferred bytes")
    single.recordSentBytes(id: "document", totalBytesSent: 10)
    precondition(single.percent == 37, "A delayed callback must not move the badge backwards")
    single.recordSentBytes(id: "document", totalBytesSent: -1)
    single.recordSentBytes(id: "unknown", totalBytesSent: Int64.max)
    precondition(single.percent == 37, "Invalid or unrelated callbacks cannot advance progress")
    single.recordSentBytes(id: "document", totalBytesSent: Int64.max)
    precondition(single.percent == 99, "All bytes sent still waits for the VM receipt")
    single.confirm(id: "unknown")
    precondition(single.percent == 99, "An unrelated receipt cannot complete the operation")
    single.confirm(id: "document")
    precondition(single.percent == 100, "Only the persisted receipt completes the upload")
    single.recordSentBytes(id: "document", totalBytesSent: 1)
    precondition(single.percent == 100, "Late callbacks cannot undo a confirmed receipt")
    print("PASS: native upload byte progress and receipt gating")

    var batch = SharedUploadProgress(items: [(id: "small", size: 100), (id: "large", size: 300)])
    batch.begin(id: "small")
    batch.confirm(id: "small")
    precondition(batch.percent == 25, "Batch progress is weighted by bytes, not by file count")
    batch.begin(id: "large")
    batch.recordSentBytes(id: "small", totalBytesSent: 500)
    precondition(batch.percent == 25, "Callbacks from a previous file are ignored")
    batch.recordSentBytes(id: "large", totalBytesSent: 100)
    precondition(batch.percent == 50, "Known bytes from the current file contribute to the batch")
    batch.end(id: "large")
    batch.recordSentBytes(id: "large", totalBytesSent: 300)
    batch.confirm(id: "large")
    precondition(batch.percent == 50, "A failed upload cannot be completed by late callbacks")
    batch.begin(id: "large")
    batch.confirm(id: "large")
    precondition(batch.percent == 100, "All confirmed files complete the batch")
    print("PASS: weighted batches, stale callbacks and failures")

    var deferred = SharedUploadProgress(items: [(id: "pdf", size: 90), (id: "audio", size: 10)])
    deferred.begin(id: "pdf")
    deferred.confirm(id: "pdf")
    precondition(deferred.percent == 90, "Audio deferred to the app must not appear uploaded")
    deferred.stop()
    deferred.begin(id: "audio")
    deferred.recordSentBytes(id: "audio", totalBytesSent: 10)
    deferred.confirm(id: "audio")
    precondition(deferred.percent == 90, "Closed or cancelled operations ignore further callbacks")
    var partial = SharedUploadProgress(items: [(id: "pdf", size: 100)], hasPreparationFailures: true)
    partial.begin(id: "pdf")
    partial.confirm(id: "pdf")
    precondition(partial.percent == 99, "A rejected input file prevents a false batch completion")
    precondition(SharedUploadProgress(items: []).percent == 0, "Empty input is not a completed upload")
    precondition(SharedUploadProgress(items: [(id: "empty", size: 0)]).percent == 0, "Zero size does not divide by zero")
    print("PASS: pending audio, preparation failures, cancellation and empty input")
}

private final class UploadProgressCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var progress: SharedUploadProgress
    private var callbacks = 0
    private var observedPercentages: [Int] = []

    init(id: String, size: Int64) {
        progress = SharedUploadProgress(items: [(id: id, size: size)])
        progress.begin(id: id)
    }

    func record(id: String, bytes: Int64) {
        lock.lock()
        defer { lock.unlock() }
        callbacks += 1
        progress.recordSentBytes(id: id, totalBytesSent: bytes)
        observedPercentages.append(progress.percent)
        precondition(progress.percent < 100, "Network callbacks alone never complete an upload")
    }

    func snapshot() -> (percent: Int, callbacks: Int, observedPercentages: [Int]) {
        lock.lock()
        defer { lock.unlock() }
        return (progress.percent, callbacks, observedPercentages)
    }

    func confirm(id: String) {
        lock.lock()
        defer { lock.unlock() }
        progress.confirm(id: id)
    }
}

func checkRealUploadProgress(testRoot: URL) async throws {
    guard let address = ProcessInfo.processInfo.environment["NATIVE_SHARE_TEST_UPLOAD_URL"],
          let url = URL(string: address), url.host == "127.0.0.1" else {
        fatalError("Run the native binary with scripts/verify-native-share.mjs (loopback server only)")
    }
    let uploadStore = try SharedInboxStore(containerURL: testRoot.appendingPathComponent("progress-inbox"))
    let item = try uploadStore.stage(data: Data(repeating: 65, count: 8 * 1024 * 1024), name: "progress-fixture.pdf", type: "application/pdf")
    let capture = UploadProgressCapture(id: item.id, size: item.size)
    let delegate = SharedUploadProgressDelegate { capture.record(id: item.id, bytes: $0) }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    let (data, response) = try await URLSession.shared.upload(
        for: request, fromFile: uploadStore.payloadURL(id: item.id), delegate: delegate
    )
    precondition((response as? HTTPURLResponse)?.statusCode == 200)
    let beforeReceipt = capture.snapshot()
    precondition(beforeReceipt.callbacks > 0, "The real URLSession upload must invoke the progress delegate")
    precondition(beforeReceipt.observedPercentages.contains { (1...98).contains($0) }, "The throttled upload must report intermediate progress, not only its final byte count")
    precondition(beforeReceipt.percent == 99, "Even a completed HTTP exchange waits for a durable receipt")
    let receipt = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    precondition(receipt?["status"] as? String == "processed")
    try uploadStore.saveConfirmedResponse(id: item.id, data: data)
    try uploadStore.updateState(id: item.id, state: "uploaded")
    capture.confirm(id: item.id)
    precondition(capture.snapshot().percent == 100)
    print("PASS: real 8 MiB URLSession file upload, \(beforeReceipt.callbacks) byte callbacks, persisted receipt then 100%")
}
