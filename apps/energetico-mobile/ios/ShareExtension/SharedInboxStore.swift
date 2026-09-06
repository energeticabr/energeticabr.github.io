import Foundation
import UniformTypeIdentifiers

struct SharedInboxMetadata: Codable {
    let id: String
    let name: String
    let size: Int64
    let type: String
    let createdAt: Date
    var state: String
    var error: String?
}

enum SharedInboxStoreError: Error {
    case containerUnavailable
    case invalidIdentifier
    case missingItem
    case invalidAttachment
}

final class SharedInboxStore {
    static let appGroup = "group.br.com.energetica.energetico"
    static let confirmationFileName = "confirmed-response.json"

    private let fileManager: FileManager
    private let rootURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(
        containerURL: URL? = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SharedInboxStore.appGroup
        ),
        fileManager: FileManager = .default
    ) throws {
        guard let containerURL else { throw SharedInboxStoreError.containerUnavailable }
        self.fileManager = fileManager
        rootURL = containerURL.appendingPathComponent("SharedInbox", isDirectory: true)
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
    }

    func stage(url sourceURL: URL, type: String? = nil) throws -> SharedInboxMetadata {
        let itemID = UUID().uuidString
        let itemDirectory = rootURL.appendingPathComponent(itemID, isDirectory: true)
        let payloadURL = itemDirectory.appendingPathComponent("payload")
        var operationError: Error?
        var coordinationError: NSError?
        let coordinator = NSFileCoordinator(filePresenter: nil)
        let hasSecurityAccess = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityAccess { sourceURL.stopAccessingSecurityScopedResource() }
        }
        let sourceAttributes = try fileManager.attributesOfItem(atPath: sourceURL.path)
        let sourceSize = (sourceAttributes[.size] as? NSNumber)?.int64Value ?? 0
        let detectedType = type
            ?? UTType(filenameExtension: sourceURL.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
        try validateAttachment(name: sourceURL.lastPathComponent, size: sourceSize, type: detectedType)

        coordinator.coordinate(
            readingItemAt: sourceURL,
            options: [],
            writingItemAt: itemDirectory,
            options: .forReplacing,
            error: &coordinationError
        ) { readableURL, writableDirectory in
            do {
                try fileManager.createDirectory(at: writableDirectory, withIntermediateDirectories: true)
                try fileManager.copyItem(
                    at: readableURL,
                    to: writableDirectory.appendingPathComponent("payload")
                )
            } catch {
                operationError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let operationError { throw operationError }

        let metadata = SharedInboxMetadata(
            id: itemID,
            name: sanitizedName(sourceURL.lastPathComponent),
            size: sourceSize,
            type: detectedType,
            createdAt: Date(),
            state: "staged",
            error: nil
        )
        try writeMetadata(metadata)
        return metadata
    }

    func list() throws -> [SharedInboxMetadata] {
        var result: Result<[SharedInboxMetadata], Error> = .success([])
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(
            readingItemAt: rootURL,
            options: .withoutChanges,
            error: &coordinationError
        ) { coordinatedRoot in
            do {
                let directories = try fileManager.contentsOfDirectory(
                    at: coordinatedRoot,
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles]
                )
                let items = try directories.compactMap { directory -> SharedInboxMetadata? in
                    guard UUID(uuidString: directory.lastPathComponent) != nil else { return nil }
                    let metadataURL = directory.appendingPathComponent("metadata.json")
                    guard fileManager.fileExists(atPath: metadataURL.path) else { return nil }
                    return try decoder.decode(
                        SharedInboxMetadata.self,
                        from: Data(contentsOf: metadataURL)
                    )
                }
                result = .success(items.sorted { $0.createdAt < $1.createdAt })
            } catch {
                result = .failure(error)
            }
        }
        if let coordinationError { throw coordinationError }
        return try result.get()
    }

    func read(id: String) throws -> (metadata: SharedInboxMetadata, data: Data) {
        let directory = try itemDirectory(id: id)
        let metadata = try readMetadata(from: directory)
        let payloadURL = directory.appendingPathComponent("payload")
        guard fileManager.fileExists(atPath: payloadURL.path) else {
            throw SharedInboxStoreError.missingItem
        }
        return (metadata, try coordinatedRead(payloadURL))
    }

    func payloadURL(id: String) throws -> URL {
        let url = try itemDirectory(id: id).appendingPathComponent("payload")
        guard fileManager.fileExists(atPath: url.path) else {
            throw SharedInboxStoreError.missingItem
        }
        return url
    }

    func updateState(id: String, state: String, error: String? = nil) throws {
        let directory = try itemDirectory(id: id)
        var metadata = try readMetadata(from: directory)
        metadata.state = state
        metadata.error = error
        try writeMetadata(metadata)
    }

    func saveConfirmedResponse(id: String, data: Data) throws {
        let directory = try itemDirectory(id: id)
        let destination = directory.appendingPathComponent(Self.confirmationFileName)
        try coordinatedWrite(data, to: destination)
    }

    func confirmedResponse(id: String) throws -> Data? {
        let url = try itemDirectory(id: id).appendingPathComponent(Self.confirmationFileName)
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        return try coordinatedRead(url)
    }

    func remove(id: String) throws {
        let directory = try itemDirectory(id: id)
        guard fileManager.fileExists(atPath: directory.path) else {
            throw SharedInboxStoreError.missingItem
        }
        var coordinationError: NSError?
        var operationError: Error?
        NSFileCoordinator(filePresenter: nil).coordinate(
            writingItemAt: directory,
            options: .forDeleting,
            error: &coordinationError
        ) { coordinatedURL in
            do {
                try fileManager.removeItem(at: coordinatedURL)
            } catch {
                operationError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let operationError { throw operationError }
    }

    private func itemDirectory(id: String) throws -> URL {
        guard let uuid = UUID(uuidString: id), uuid.uuidString == id.uppercased() else {
            throw SharedInboxStoreError.invalidIdentifier
        }
        return rootURL.appendingPathComponent(uuid.uuidString, isDirectory: true)
    }

    private func readMetadata(from directory: URL) throws -> SharedInboxMetadata {
        let url = directory.appendingPathComponent("metadata.json")
        guard fileManager.fileExists(atPath: url.path) else {
            throw SharedInboxStoreError.missingItem
        }
        return try decoder.decode(SharedInboxMetadata.self, from: coordinatedRead(url))
    }

    private func writeMetadata(_ metadata: SharedInboxMetadata) throws {
        let directory = try itemDirectory(id: metadata.id)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try coordinatedWrite(encoder.encode(metadata), to: directory.appendingPathComponent("metadata.json"))
    }

    private func coordinatedRead(_ url: URL) throws -> Data {
        var result: Result<Data, Error> = .failure(SharedInboxStoreError.missingItem)
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(
            readingItemAt: url,
            options: .withoutChanges,
            error: &coordinationError
        ) { coordinatedURL in
            result = Result { try Data(contentsOf: coordinatedURL) }
        }
        if let coordinationError { throw coordinationError }
        return try result.get()
    }

    private func coordinatedWrite(_ data: Data, to url: URL) throws {
        var operationError: Error?
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(
            writingItemAt: url,
            options: .forReplacing,
            error: &coordinationError
        ) { coordinatedURL in
            do {
                try data.write(to: coordinatedURL, options: .atomic)
            } catch {
                operationError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let operationError { throw operationError }
    }

    private func sanitizedName(_ value: String) -> String {
        let name = value
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String((name.isEmpty ? "arquivo" : name).prefix(180))
    }

    private func validateAttachment(name: String, size: Int64, type: String) throws {
        let blockedExtensions: Set<String> = [
            "app", "bat", "bin", "cmd", "com", "dmg", "exe", "ipa", "js", "msi", "pkg", "ps1", "scr", "sh"
        ]
        let blockedTypes: Set<String> = [
            "application/x-apple-diskimage",
            "application/x-executable",
            "application/x-mach-binary",
            "application/x-msdownload"
        ]
        let fileExtension = URL(fileURLWithPath: name).pathExtension.lowercased()
        guard size > 0, size <= 60 * 1024 * 1024,
              name.count <= 180,
              !name.contains("\n"),
              !name.contains("\r"),
              !blockedExtensions.contains(fileExtension),
              !blockedTypes.contains(type.lowercased()) else {
            throw SharedInboxStoreError.invalidAttachment
        }
    }
}
