import Foundation

struct ScanCachePage {
    let url: URL
    let name: String
    let size: Int
}
struct ScanCacheSession {
    let id: String
    let pages: [ScanCachePage]
}

// Resolves opaque, in-memory owned tokens only. No bridge-supplied file paths.
final class ScanCache {
    private let root: URL
    private let maxBytes: Int
    private let lock = NSLock()
    private var sessions: [String: URL] = [:]
    init(root: URL = FileManager.default.temporaryDirectory.appendingPathComponent("energetico-scanner"), maxBytes: Int = 60_000_000) {
        self.root = root
        self.maxBytes = maxBytes
    }
    func write(pageCount: Int, pageData: (Int) throws -> Data) throws -> ScanCacheSession {
        lock.lock(); defer { lock.unlock() }
        guard pageCount > 0 && pageCount <= 20 else { throw failure("Escaneie de 1 a 20 páginas por vez.") }
        let id = UUID().uuidString
        let directory = root.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var committed = false
        defer { if !committed { try? FileManager.default.removeItem(at: directory) } }
        var pages: [ScanCachePage] = []
        var total = 0
        for index in 0..<pageCount {
            let data = try pageData(index)
            guard !data.isEmpty && data.count <= maxBytes - total else { throw failure("O documento escaneado ultrapassa o limite de 60 MB.") }
            total += data.count
            let name = "documento-\(index + 1).jpg"
            let url = directory.appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            pages.append(ScanCachePage(url: url, name: name, size: data.count))
        }
        sessions[id] = directory
        committed = true
        return ScanCacheSession(id: id, pages: pages)
    }
    func release(id: String) {
        lock.lock(); defer { lock.unlock() }
        guard let directory = sessions.removeValue(forKey: id) else { return }
        try? FileManager.default.removeItem(at: directory)
    }
    func releaseAll() {
        lock.lock(); defer { lock.unlock() }
        for directory in sessions.values { try? FileManager.default.removeItem(at: directory) }
        sessions.removeAll()
    }
    private func failure(_ message: String) -> NSError {
        NSError(domain: "EnergeticoScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
