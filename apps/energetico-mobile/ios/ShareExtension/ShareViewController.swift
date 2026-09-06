import MSAL
import UniformTypeIdentifiers
import UIKit

final class ShareViewController: UIViewController {
    private static let clientID = "94018e25-f756-4aa6-974e-27b8b43d7fe9"
    private static let tenantID = "0c10f511-7ede-4702-a2d9-bedb26937e0e"
    private static let redirectURI = "msauth.br.com.energetica.energetico://auth"
    private static let apiURL = URL(string: "https://163-176-171-217.sslip.io/api/portal-upload")!
    private let confirmationFileName = "confirmed-response.json"

    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let statusLabel = UILabel()
    private let addButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private var inboxStore: SharedInboxStore?
    private var stagedItems: [SharedInboxMetadata] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        configureInterface()
        Task { await stageInputItems() }
    }

    private func configureInterface() {
        view.backgroundColor = UIColor.systemBackground

        let icon = UIImageView(image: UIImage(named: "Mascote"))
        icon.contentMode = .scaleAspectFit
        icon.layer.cornerRadius = 24
        icon.clipsToBounds = true
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 72).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 72).isActive = true

        titleLabel.text = "Enviar ao Energético"
        titleLabel.font = .preferredFont(forTextStyle: .title2)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textAlignment = .center

        detailLabel.text = "Preparando arquivo…"
        detailLabel.numberOfLines = 3
        detailLabel.textAlignment = .center
        detailLabel.textColor = .secondaryLabel

        statusLabel.numberOfLines = 3
        statusLabel.textAlignment = .center
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.textColor = .secondaryLabel

        addButton.setTitle("Adicionar ao Energético", for: .normal)
        addButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        addButton.backgroundColor = UIColor(red: 0.03, green: 0.33, blue: 0.42, alpha: 1)
        addButton.setTitleColor(.white, for: .normal)
        addButton.layer.cornerRadius = 12
        addButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 50).isActive = true
        addButton.isEnabled = false
        addButton.addTarget(self, action: #selector(addItems), for: .touchUpInside)

        cancelButton.setTitle("Cancelar", for: .normal)
        cancelButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [
            icon, titleLabel, detailLabel, statusLabel, addButton, cancelButton
        ])
        stack.axis = .vertical
        stack.spacing = 16
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor)
        ])
    }

    private func stageInputItems() async {
        do {
            let store = try SharedInboxStore()
            inboxStore = store
            let providers = extensionContext?.inputItems
                .compactMap { $0 as? NSExtensionItem }
                .flatMap { $0.attachments ?? [] } ?? []
            var staged: [SharedInboxMetadata] = []
            for provider in providers {
                if let metadata = await stage(provider: provider, store: store) {
                    staged.append(metadata)
                }
            }
            stagedItems = staged
            if staged.isEmpty {
                detailLabel.text = "Nenhum arquivo compatível foi encontrado."
                statusLabel.text = "Envie fotos, PDFs ou outros documentos."
                return
            }
            let totalSize = staged.reduce(Int64(0)) { $0 + $1.size }
            detailLabel.text = staged.count == 1
                ? "\(staged[0].name) · \(format(bytes: totalSize))"
                : "\(staged.count) arquivos · \(format(bytes: totalSize))"
            statusLabel.text = "Os arquivos já estão protegidos na caixa do aplicativo."
            addButton.isEnabled = true
        } catch {
            detailLabel.text = "Não foi possível preparar os arquivos."
            statusLabel.text = "Tente compartilhar novamente."
        }
    }

    private func stage(provider: NSItemProvider, store: SharedInboxStore) async -> SharedInboxMetadata? {
        guard let identifier = provider.registeredTypeIdentifiers.first(where: { identifier in
            UTType(identifier)?.conforms(to: .data) == true
        }) else { return nil }

        return await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                let mimeType = UTType(identifier)?.preferredMIMEType
                continuation.resume(returning: try? store.stage(url: url, type: mimeType))
            }
        }
    }

    @objc private func addItems() {
        addButton.isEnabled = false
        cancelButton.isEnabled = false
        statusLabel.text = "Conectando com segurança à VM…"
        Task {
            let token = await acquireTokenSilently()
            guard let token else {
                for item in stagedItems {
                    try? inboxStore?.updateState(id: item.id, state: "needsAuthentication")
                }
                await finish(message: "Abra o Energético para entrar e concluir o envio.")
                return
            }

            var uploaded = 0
            for item in stagedItems {
                do {
                    try inboxStore?.updateState(id: item.id, state: "uploading")
                    let response = try await upload(item: item, token: token)
                    try inboxStore?.saveConfirmedResponse(id: item.id, data: response)
                    try inboxStore?.updateState(id: item.id, state: "uploaded")
                    uploaded += 1
                } catch {
                    try? inboxStore?.updateState(
                        id: item.id,
                        state: "failed",
                        error: "A VM não confirmou o envio."
                    )
                }
            }
            let message = uploaded == stagedItems.count
                ? "Arquivos adicionados ao Energético."
                : "\(uploaded) de \(stagedItems.count) arquivos foram confirmados. Abra o aplicativo para tentar novamente."
            await finish(message: message)
        }
    }

    @objc private func cancel() {
        for item in stagedItems {
            try? inboxStore?.remove(id: item.id)
        }
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    private func acquireTokenSilently() async -> String? {
        do {
            let authorityURL = URL(string: "https://login.microsoftonline.com/\(Self.tenantID)")!
            let authority = try MSALAADAuthority(url: authorityURL)
            let configuration = MSALPublicClientApplicationConfig(
                clientId: Self.clientID,
                redirectUri: Self.redirectURI,
                authority: authority
            )
            configuration.cacheConfig.keychainSharingGroup = "com.microsoft.adalcache"
            let application = try MSALPublicClientApplication(configuration: configuration)
            let account = await currentAccount(application)
            guard let account else { return nil }

            return await withCheckedContinuation { continuation in
                let parameters = MSALSilentTokenParameters(scopes: ["User.Read"], account: account)
                application.acquireTokenSilent(with: parameters) { result, _ in
                    continuation.resume(returning: result?.accessToken)
                }
            }
        } catch {
            return nil
        }
    }

    private func currentAccount(_ application: MSALPublicClientApplication) async -> MSALAccount? {
        await withCheckedContinuation { continuation in
            let parameters = MSALParameters()
            application.getCurrentAccount(with: parameters) { current, _, _ in
                continuation.resume(returning: current)
            }
        }
    }

    private func upload(item: SharedInboxMetadata, token: String) async throws -> Data {
        guard let fileURL = try inboxStore?.payloadURL(id: item.id) else {
            throw SharedInboxStoreError.missingItem
        }
        var request = URLRequest(url: Self.apiURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(item.type, forHTTPHeaderField: "Content-Type")
        request.setValue(percentEncoded(item.name), forHTTPHeaderField: "X-Portal-File-Name")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Portal-Message-Id")
        let (data, urlResponse) = try await URLSession.shared.upload(for: request, fromFile: fileURL)
        guard let response = urlResponse as? HTTPURLResponse, (200..<300).contains(response.statusCode),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["status"] as? String == "processed",
              json["messages"] is [[String: Any]] else {
            throw URLError(.badServerResponse)
        }
        return data
    }

    private func percentEncoded(_ value: String) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "arquivo"
    }

    private func format(bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }

    @MainActor
    private func finish(message: String) async {
        statusLabel.text = message
        try? await Task.sleep(for: .milliseconds(700))
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
