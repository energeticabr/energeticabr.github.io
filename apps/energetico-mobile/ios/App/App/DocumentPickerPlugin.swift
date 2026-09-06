import Capacitor
import Foundation
import UniformTypeIdentifiers
import UIKit

@objc(DocumentPickerPlugin)
final class DocumentPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "DocumentPickerPlugin"
    let jsName = "DocumentPicker"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pendingCall == nil else {
                call.reject("Já existe uma seleção de arquivos em andamento.", "PICK_IN_PROGRESS")
                return
            }

            self.pendingCall = call
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.item],
                asCopy: true
            )
            picker.delegate = self
            picker.allowsMultipleSelection = true
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(with: [])
    }

    func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        do {
            let items = try urls.map(copyToAppCache)
            finish(with: items)
        } catch {
            pendingCall?.reject(
                "Não foi possível preparar o arquivo selecionado.",
                "DOCUMENT_COPY_FAILED",
                error
            )
            pendingCall = nil
        }
    }

    private func copyToAppCache(_ sourceURL: URL) throws -> JSObject {
        let hasSecurityAccess = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityAccess {
                sourceURL.stopAccessingSecurityScopedResource()
            }
        }

        let values = try sourceURL.resourceValues(forKeys: [
            .contentTypeKey,
            .fileSizeKey,
            .nameKey
        ])
        let itemID = UUID().uuidString
        let itemDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("energetico-picker", isDirectory: true)
            .appendingPathComponent(itemID, isDirectory: true)
        try FileManager.default.createDirectory(
            at: itemDirectory,
            withIntermediateDirectories: true
        )

        let fileName = values.name ?? sourceURL.lastPathComponent
        let destinationURL = itemDirectory.appendingPathComponent(fileName)
        try FileManager.default.copyItem(at: sourceURL, to: destinationURL)

        return [
            "id": itemID,
            "uri": destinationURL.absoluteString,
            "name": fileName,
            "size": values.fileSize ?? 0,
            "type": values.contentType?.preferredMIMEType ?? "application/octet-stream"
        ]
    }

    private func finish(with items: [JSObject]) {
        pendingCall?.resolve(["items": items])
        pendingCall = nil
    }
}
