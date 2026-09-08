import Capacitor
import Foundation
import MSAL
import UIKit

@objc(MicrosoftAuthPlugin)
final class MicrosoftAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "MicrosoftAuthPlugin"
    let jsName = "MicrosoftAuth"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise)
    ]

    private var applicationContext: MSALPublicClientApplication?
    private var currentAccount: MSALAccount?
    private let iso8601 = ISO8601DateFormatter()

    @objc func initialize(_ call: CAPPluginCall) {
        guard
            let clientID = call.getString("clientId"),
            let tenantID = call.getString("tenantId"),
            let redirectURI = call.getString("redirectUri"),
            call.getString("authenticationMode") == "systemBrowser",
            let authorityURL = URL(string: "https://login.microsoftonline.com/\(tenantID)")
        else {
            call.reject("Configuração de login inválida.", "AUTH_CONFIG_INVALID")
            return
        }

        do {
            // Use the supported system authentication session instead of automatically
            // handing interactive requests to an installed Authenticator broker.
            // Microsoft still enforces MFA and Conditional Access on this request.
            MSALGlobalConfig.brokerAvailability = .none
            let authority = try MSALAADAuthority(url: authorityURL)
            let configuration = MSALPublicClientApplicationConfig(
                clientId: clientID,
                redirectUri: redirectURI,
                authority: authority
            )
            configuration.cacheConfig.keychainSharingGroup = "com.microsoft.adalcache"
            let application = try MSALPublicClientApplication(configuration: configuration)
            applicationContext = application

            let parameters = MSALParameters()
            parameters.completionBlockQueue = DispatchQueue.main
            application.getCurrentAccount(with: parameters) { [weak self] account, _, error in
                guard let self else { return }
                if let error {
                    self.reject(call, error: error)
                    return
                }
                self.currentAccount = account
                self.resolve(call, account: account)
            }
        } catch {
            reject(call, error: error)
        }
    }

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.beginSignIn(call)
        }
    }

    private func beginSignIn(_ call: CAPPluginCall) {
        guard let application = applicationContext else {
            call.reject("Inicialize o login antes de entrar.", "AUTH_NOT_INITIALIZED")
            return
        }
        guard let viewController = bridge?.viewController else {
            call.reject("A tela de login não está disponível.", "AUTH_UI_UNAVAILABLE")
            return
        }

        let webParameters = MSALWebviewParameters(authPresentationViewController: viewController)
        webParameters.webviewType = .authenticationSession
        let parameters = MSALInteractiveTokenParameters(
            scopes: scopes(from: call),
            webviewParameters: webParameters
        )
        parameters.promptType = .selectAccount
        application.acquireToken(with: parameters) { [weak self] result, error in
            guard let self else { return }
            if let error {
                self.reject(call, error: error)
                return
            }
            guard let result else {
                call.reject("O login não devolveu uma conta.", "AUTH_EMPTY_RESULT")
                return
            }
            self.currentAccount = result.account
            self.resolve(call, account: result.account)
        }
    }

    @objc func getToken(_ call: CAPPluginCall) {
        guard let application = applicationContext, let account = currentAccount else {
            call.reject("É necessário entrar novamente.", "MSALErrorInteractionRequired")
            return
        }
        guard call.getString("homeAccountId") == account.identifier else {
            call.reject("A conta selecionada não está mais disponível.", "MSALErrorInteractionRequired")
            return
        }

        let parameters = MSALSilentTokenParameters(scopes: scopes(from: call), account: account)
        application.acquireTokenSilent(with: parameters) { [weak self] result, error in
            guard let self else { return }
            if let error {
                self.reject(call, error: error)
                return
            }
            guard let result, !result.accessToken.isEmpty else {
                call.reject("É necessário entrar novamente.", "MSALErrorInteractionRequired")
                return
            }
            call.resolve([
                "accessToken": result.accessToken,
                "expiresOn": result.expiresOn.map { self.iso8601.string(from: $0) } ?? ""
            ])
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        guard let application = applicationContext, let account = currentAccount else {
            call.resolve()
            return
        }
        guard call.getString("homeAccountId") == account.identifier else {
            call.reject("A conta selecionada não está mais disponível.", "AUTH_ACCOUNT_MISMATCH")
            return
        }
        guard let viewController = bridge?.viewController else {
            call.reject("A tela de login não está disponível.", "AUTH_UI_UNAVAILABLE")
            return
        }

        let webParameters = MSALWebviewParameters(authPresentationViewController: viewController)
        let parameters = MSALSignoutParameters(webviewParameters: webParameters)
        parameters.signoutFromBrowser = false
        application.signout(with: account, signoutParameters: parameters) { [weak self] success, error in
            guard let self else { return }
            if let error {
                self.reject(call, error: error)
                return
            }
            guard success else {
                call.reject("Não foi possível sair da conta.", "AUTH_SIGNOUT_FAILED")
                return
            }
            self.currentAccount = nil
            call.resolve()
        }
    }

    private func scopes(from call: CAPPluginCall) -> [String] {
        let values = call.getArray("scopes", String.self) ?? []
        return Array(Set(values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }))
    }

    private func resolve(_ call: CAPPluginCall, account: MSALAccount?) {
        guard let account, let identifier = account.identifier else {
            call.resolve(["account": NSNull()])
            return
        }
        let displayName = account.accountClaims?["name"] as? String ?? account.username ?? ""
        call.resolve([
            "account": [
                "homeAccountId": identifier,
                "username": account.username ?? "",
                "name": displayName
            ]
        ])
    }

    private func reject(_ call: CAPPluginCall, error: Error) {
        let nativeError = error as NSError
        if nativeError.domain == MSALErrorDomain {
            if nativeError.code == MSALError.interactionRequired.rawValue {
                call.reject("É necessário entrar novamente.", "MSALErrorInteractionRequired")
                return
            }
            if nativeError.code == MSALError.userCanceled.rawValue {
                call.reject("Login cancelado.", "MSALErrorUserCanceled")
                return
            }
        }
        if nativeError.domain == NSURLErrorDomain {
            call.reject("Não foi possível acessar o login Microsoft.", "AUTH_NETWORK")
            return
        }
        call.reject("O login Microsoft não pôde ser concluído.", "AUTH_FAILED")
    }
}
