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
    static let processOwner = UUID().uuidString
    private static let markerPrefix = "ENERGETICO_SCAN_V1\n"
    private let root: URL
    private let maxBytes: Int
    private let owner: String
    private let lock = NSLock()
    private var sessions: [String: URL] = [:]
    init(root: URL = FileManager.default.temporaryDirectory.appendingPathComponent("energetico-scanner"), maxBytes: Int = 60_000_000, owner: String = ScanCache.processOwner) {
        self.root = root.resolvingSymlinksInPath()
        self.maxBytes = maxBytes
        self.owner = owner
        reclaimAbandonedSessions()
    }
    func write(pageCount: Int, pageData: (Int) throws -> Data) throws -> ScanCacheSession {
        lock.lock(); defer { lock.unlock() }
        guard pageCount > 0 && pageCount <= 20 else { throw failure("Escaneie de 1 a 20 páginas por vez.") }
        let id = UUID().uuidString
        let directory = root.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var committed = false
        defer { if !committed { try? FileManager.default.removeItem(at: directory) } }
        try Data((Self.markerPrefix + owner).utf8).write(to: directory.appendingPathComponent(".scanner-owner"), options: .atomic)
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
    private func reclaimAbandonedSessions() {
        let entries = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey])) ?? []
        for entry in entries {
            guard UUID(uuidString: entry.lastPathComponent) != nil,
                  let info = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
                  info.isDirectory == true, info.isSymbolicLink != true else { continue }
            let marker = entry.appendingPathComponent(".scanner-owner")
            guard let markerInfo = try? marker.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
                  markerInfo.isRegularFile == true, markerInfo.isSymbolicLink != true, (markerInfo.fileSize ?? 1000) < 128,
                  let data = try? Data(contentsOf: marker), let value = String(data: data, encoding: .utf8),
                  value.hasPrefix(Self.markerPrefix) else { continue }
            let previousOwner = String(value.dropFirst(Self.markerPrefix.count))
            guard UUID(uuidString: previousOwner) != nil, previousOwner != owner else { continue }
            try? FileManager.default.removeItem(at: entry)
        }
    }
    private func failure(_ message: String) -> NSError {
        NSError(domain: "EnergeticoScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
