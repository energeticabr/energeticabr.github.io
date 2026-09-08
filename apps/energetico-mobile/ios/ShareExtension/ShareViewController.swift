import MSAL
import UniformTypeIdentifiers
import UIKit

final class ShareViewController: UIViewController {
    private static let clientID = "94018e25-f756-4aa6-974e-27b8b43d7fe9"
    private static let tenantID = "0c10f511-7ede-4702-a2d9-bedb26937e0e"
    private static let redirectURI = "msauth.br.com.energetica.energetico://auth"
    private let confirmationFileName = "confirmed-response.json"

    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let statusLabel = UILabel()
    private let addButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let failuresButton = UIButton(type: .system)
    private var inboxStore: SharedInboxStore?
    private var stagedItems: [SharedInboxMetadata] = []
    private var stagingFailures: [String] = []
    private var isCancelled = false

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

        failuresButton.isHidden = true
        failuresButton.addTarget(self, action: #selector(showStagingFailures), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [
            icon, titleLabel, detailLabel, statusLabel, failuresButton, addButton, cancelButton
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
            for (index, provider) in providers.enumerated() {
                guard !isCancelled else { return }
                statusLabel.text = "Preparando \(index + 1) de \(providers.count)…"
                do {
                    let metadata = try await SharedItemLoader.stage(provider: provider, store: store)
                    guard !isCancelled else {
                        try? store.remove(id: metadata.id)
                        return
                    }
                    stagedItems.append(metadata)
                } catch {
                    guard !isCancelled else { return }
                    let name = provider.suggestedName ?? "Arquivo \(index + 1)"
                    let reason = error is SharedInboxStoreError && (error as? SharedInboxStoreError) == .invalidAttachment
                        ? "Arquivo vazio, maior que 60 MB ou tipo bloqueado por segurança."
                        : "O aplicativo de origem não disponibilizou um arquivo legível. Tente salvá-lo em Arquivos e compartilhar novamente."
                    stagingFailures.append("\(name): \(reason)")
                }
            }
            if !stagingFailures.isEmpty {
                failuresButton.setTitle("Ver \(stagingFailures.count) arquivos não recebidos", for: .normal)
                failuresButton.isHidden = false
            }
            if stagedItems.isEmpty {
                detailLabel.text = "Nenhum arquivo foi recebido."
                statusLabel.text = providers.isEmpty
                    ? "Selecione arquivos no aplicativo de origem e compartilhe novamente."
                    : "Veja abaixo quais arquivos não puderam ser preparados."
                return
            }
            let totalSize = stagedItems.reduce(Int64(0)) { $0 + $1.size }
            detailLabel.text = "\(stagedItems.count) de \(providers.count) arquivos preparados · \(format(bytes: totalSize))"
            statusLabel.text = stagingFailures.isEmpty
                ? "Os arquivos já estão protegidos na caixa do aplicativo."
                : "Os arquivos preparados estão protegidos. Os demais não serão enviados; veja os detalhes abaixo."
            addButton.isEnabled = true
        } catch {
            detailLabel.text = "Não foi possível preparar os arquivos."
            statusLabel.text = "Tente compartilhar novamente."
        }
    }

    @objc private func showStagingFailures() {
        let alert = UIAlertController(title: "Arquivos não recebidos", message: stagingFailures.joined(separator: "\n\n"), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Voltar", style: .default))
        present(alert, animated: true)
    }

    @objc private func addItems() {
        addButton.isEnabled = false
        cancelButton.isEnabled = false
        failuresButton.isEnabled = false
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
        isCancelled = true
        for item in stagedItems {
            try? inboxStore?.remove(id: item.id)
        }
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    private func acquireTokenSilently() async -> String? {
        do {
            MSALGlobalConfig.brokerAvailability = .none
            let authorityURL = URL(string: "https://login.microsoftonline.com/\(Self.tenantID)")!
            let authority = try MSALAADAuthority(url: authorityURL)
            let configuration = MSALPublicClientApplicationConfig(
                clientId: Self.clientID,
                redirectUri: Self.redirectURI,
                authority: authority
            )
            // Silent-only extension shares the containing app's registered URI/cache.
            // MSAL otherwise compares that URI to the different .share bundle and
            // rejects initialization. This public setting skips only local redirect
            // validation; Entra authentication and server authorization remain intact.
            configuration.bypassRedirectURIValidation = true
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
        let request = SharedUploadRequest.make(item: item, token: token)
        let (data, urlResponse) = try await URLSession.shared.upload(for: request, fromFile: fileURL)
        guard let response = urlResponse as? HTTPURLResponse, (200..<300).contains(response.statusCode),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["status"] as? String == "processed",
              json["messages"] is [[String: Any]] else {
            throw URLError(.badServerResponse)
        }
        return data
    }

    private func format(bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }

    @MainActor
    private func finish(message: String) async {
        statusLabel.text = message
        // Do not hide a failed/pending upload after a fraction of a second.
        // Closing acknowledges the result, never discards the durable inbox.
        let alert = UIAlertController(title: "Envio ao Energético", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Concluir", style: .default) { [weak self] _ in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        })
        present(alert, animated: true)
    }
}
