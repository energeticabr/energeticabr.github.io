import Capacitor
import Foundation

@objc(ShareInboxPlugin)
final class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ShareInboxPlugin"
    let jsName = "ShareInbox"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    @objc func list(_ call: CAPPluginCall) {
        do {
            let store = try SharedInboxStore()
            let items: [JSObject] = try store.list().map { metadata in
                var item: JSObject = [
                    "id": metadata.id,
                    "name": metadata.name,
                    "size": Int(metadata.size),
                    "type": metadata.type,
                    "state": metadata.state,
                    "createdAt": ISO8601DateFormatter().string(from: metadata.createdAt)
                ]
                if let responseData = try store.confirmedResponse(id: metadata.id),
                   let response = try JSONSerialization.jsonObject(with: responseData) as? JSObject {
                    item["confirmedResult"] = response
                }
                return item
            }
            call.resolve(["items": items])
        } catch {
            call.reject("Não foi possível ler os itens compartilhados.", "SHARED_INBOX_LIST_FAILED")
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Identificador compartilhado inválido.", "SHARED_INBOX_INVALID_ID")
            return
        }
        do {
            let item = try SharedInboxStore().read(id: id)
            call.resolve([
                "id": item.metadata.id,
                "name": item.metadata.name,
                "size": Int(item.metadata.size),
                "type": item.metadata.type,
                "data": item.data.base64EncodedString()
            ])
        } catch SharedInboxStoreError.invalidIdentifier {
            call.reject("Identificador compartilhado inválido.", "SHARED_INBOX_INVALID_ID")
        } catch {
            call.reject("O item compartilhado não pôde ser lido.", "SHARED_INBOX_READ_FAILED")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Identificador compartilhado inválido.", "SHARED_INBOX_INVALID_ID")
            return
        }
        do {
            try SharedInboxStore().remove(id: id)
            call.resolve()
        } catch SharedInboxStoreError.invalidIdentifier {
            call.reject("Identificador compartilhado inválido.", "SHARED_INBOX_INVALID_ID")
        } catch {
            call.reject("O item compartilhado não pôde ser removido.", "SHARED_INBOX_REMOVE_FAILED")
        }
    }
}
