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

enum SharedInboxStoreError: Error, Equatable {
    case containerUnavailable
    case invalidIdentifier
    case missingItem
    case invalidAttachment
    case representationUnavailable
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

    func stage(url sourceURL: URL, type: String? = nil, name: String? = nil) throws -> SharedInboxMetadata {
        guard sourceURL.isFileURL else { throw SharedInboxStoreError.invalidAttachment }
        let itemID = UUID().uuidString
        let itemDirectory = rootURL.appendingPathComponent(itemID, isDirectory: true)
        let payloadURL = itemDirectory.appendingPathComponent("payload")
        var committed = false
        defer {
            // This UUID directory belongs only to this staging attempt.
            if !committed { try? fileManager.removeItem(at: itemDirectory) }
        }
        var operationError: Error?
        var coordinationError: NSError?
        let coordinator = NSFileCoordinator(filePresenter: nil)
        let hasSecurityAccess = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityAccess { sourceURL.stopAccessingSecurityScopedResource() }
        }
        let sourceAttributes = try fileManager.attributesOfItem(atPath: sourceURL.path)
        guard sourceAttributes[.type] as? FileAttributeType == .typeRegular else {
            throw SharedInboxStoreError.invalidAttachment
        }
        let sourceSize = (sourceAttributes[.size] as? NSNumber)?.int64Value ?? 0
        let fileName = name ?? sourceURL.lastPathComponent
        let detectedType = type
            ?? UTType(filenameExtension: URL(fileURLWithPath: fileName).pathExtension)?.preferredMIMEType
            ?? UTType(filenameExtension: sourceURL.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
        try validateAttachment(name: sourceURL.lastPathComponent, size: sourceSize, type: detectedType)
        try validateAttachment(name: fileName, size: sourceSize, type: detectedType)

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
        let copiedAttributes = try fileManager.attributesOfItem(atPath: payloadURL.path)
        let copiedSize = (copiedAttributes[.size] as? NSNumber)?.int64Value ?? 0
        try validateAttachment(name: fileName, size: copiedSize, type: detectedType)

        let metadata = SharedInboxMetadata(
            id: itemID,
            name: sanitizedName(fileName),
            size: copiedSize,
            type: detectedType,
            createdAt: Date(),
            state: "staged",
            error: nil
        )
        try writeMetadata(metadata)
        committed = true
        return metadata
    }

    func stage(data: Data, name: String, type: String?) throws -> SharedInboxMetadata {
        try validateAttachment(name: name, size: Int64(data.count), type: type ?? "application/octet-stream")
        let temporaryDirectory = fileManager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: temporaryDirectory) }
        let temporaryFile = temporaryDirectory.appendingPathComponent("payload")
        try data.write(to: temporaryFile, options: .atomic)
        return try stage(url: temporaryFile, type: type, name: name)
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
        guard size > 0, size <= 60_000_000,
              name.count <= 180,
              !name.contains("\n"),
              !name.contains("\r"),
              !blockedExtensions.contains(fileExtension),
              !blockedTypes.contains(type.lowercased()) else {
            throw SharedInboxStoreError.invalidAttachment
        }
    }
}

enum SharedUploadRequest {
    static func make(item: SharedInboxMetadata, token: String) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://163-176-171-217.sslip.io/api/portal-upload")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("capacitor://localhost", forHTTPHeaderField: "Origin")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(item.type, forHTTPHeaderField: "Content-Type")
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        request.setValue(item.name.addingPercentEncoding(withAllowedCharacters: allowed) ?? "arquivo", forHTTPHeaderField: "X-Portal-File-Name")
        request.setValue(item.id, forHTTPHeaderField: "X-Portal-Message-Id")
        return request
    }
}

/// Different source apps expose different representations. Copy while each provider
/// callback still owns its temporary URL; never return that ephemeral URL to the caller.
enum SharedItemLoader {
    static func stage(provider: NSItemProvider, store: SharedInboxStore) async throws -> SharedInboxMetadata {
        let eligible = provider.registeredTypeIdentifiers.filter { identifier in
            guard let type = UTType(identifier) else { return true }
            // Some hosts advertise a file only as public.item. Actual bytes/URLs
            // still pass the store's regular-file, size and blocked-type checks.
            return type.conforms(to: .item) && !type.conforms(to: .url) && !type.conforms(to: .directory)
        }
        let originalType = provider.suggestedName.flatMap {
            UTType(filenameExtension: URL(fileURLWithPath: $0).pathExtension)
        }
        let preferred = eligible.filter { identifier in
            guard let originalType, let type = UTType(identifier) else { return false }
            return type.conforms(to: originalType)
        }
        // An advertised original must not silently become its thumbnail/conversion
        // when the source app fails to provide that original.
        let groups = preferred.isEmpty ? [eligible] : [preferred]
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
           let item = try await attempt({ try await loadItem(provider, identifier: UTType.fileURL.identifier, store: store) }) {
            return item
        }
        // If an original type is advertised, only representations of it are eligible.
        // Within each group prefer streamed file copies before allocating Data.
        for identifiers in groups {
            for identifier in identifiers {
                if let item = try await attempt({ try await loadFile(provider, identifier: identifier, store: store) }) {
                    return item
                }
            }
            for identifier in identifiers {
                if let item = try await attempt({ try await loadData(provider, identifier: identifier, store: store) }) {
                    return item
                }
                if let item = try await attempt({ try await loadItem(provider, identifier: identifier, store: store) }) {
                    return item
                }
            }
        }
        throw SharedInboxStoreError.representationUnavailable
    }

    private static func attempt(_ operation: () async throws -> SharedInboxMetadata?) async throws -> SharedInboxMetadata? {
        do { return try await operation() }
        catch SharedInboxStoreError.invalidAttachment { throw SharedInboxStoreError.invalidAttachment }
        catch { return nil }
    }

    private static func name(for provider: NSItemProvider, identifier: String, url: URL? = nil) -> String {
        let suggested = provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = suggested.flatMap { $0.isEmpty ? nil : $0 } ?? url?.lastPathComponent ?? "arquivo"
        if !URL(fileURLWithPath: base).pathExtension.isEmpty { return base }
        let fileExtension = UTType(identifier)?.preferredFilenameExtension
            ?? (url?.pathExtension.isEmpty == false ? url?.pathExtension : nil)
        return fileExtension.map { "\(base).\($0)" } ?? base
    }

    private static func loadFile(_ provider: NSItemProvider, identifier: String, store: SharedInboxStore) async throws -> SharedInboxMetadata? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, _ in
                continuation.resume(with: Result {
                    guard let url else { return nil }
                    return try store.stage(url: url, type: UTType(identifier)?.preferredMIMEType,
                                           name: name(for: provider, identifier: identifier, url: url))
                })
            }
        }
    }

    private static func loadData(_ provider: NSItemProvider, identifier: String, store: SharedInboxStore) async throws -> SharedInboxMetadata? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: identifier) { data, _ in
                continuation.resume(with: Result {
                    guard let data else { return nil }
                    return try store.stage(data: data, name: name(for: provider, identifier: identifier),
                                           type: UTType(identifier)?.preferredMIMEType)
                })
            }
        }
    }

    private static func loadItem(_ provider: NSItemProvider, identifier: String, store: SharedInboxStore) async throws -> SharedInboxMetadata? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: identifier, options: nil) { item, _ in
                continuation.resume(with: Result {
                    if let url = item as? URL, url.isFileURL {
                        return try store.stage(url: url, name: name(for: provider, identifier: identifier, url: url))
                    }
                    if let data = item as? Data {
                        if identifier == UTType.fileURL.identifier {
                            guard let url = URL(dataRepresentation: data, relativeTo: nil), url.isFileURL else { return nil }
                            return try store.stage(url: url, name: name(for: provider, identifier: identifier, url: url))
                        }
                        return try store.stage(data: data, name: name(for: provider, identifier: identifier),
                                               type: UTType(identifier)?.preferredMIMEType)
                    }
                    return nil
                })
            }
        }
    }
}
