import UIKit
import WebKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate, WKScriptMessageHandler {
    var window: UIWindow?
    let status = UILabel()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let config = WKWebViewConfiguration()
        let arguments = ProcessInfo.processInfo.arguments
        let mode = arguments.firstIndex(of: "--mode").flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil } ?? "default"
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        config.userContentController.add(self, name: "status")
        let web = WKWebView(frame: .zero, configuration: config)
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = mode == "previews" // Default matches Capacitor configuration.
        web.accessibilityIdentifier = "pdf-webview"
        let controller = UIViewController()
        controller.view.backgroundColor = .white
        status.accessibilityIdentifier = "pdf-status"
        status.text = "loading"
        status.frame = CGRect(x: 0, y: 0, width: 390, height: 30)
        controller.view.addSubview(status)
        controller.view.addSubview(web)
        web.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor),
            web.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor, constant: 30),
            web.bottomAnchor.constraint(equalTo: controller.view.bottomAnchor)
        ])
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = controller
        window?.makeKeyAndVisible()
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:4179/tests/fixtures/pdf-native-selection.html?mode=\(mode)")!))
        return true
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let data = try? JSONSerialization.data(withJSONObject: message.body, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) {
            let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("pdf-status.json")
            try? data.write(to: output, options: .atomic)
            status.accessibilityValue = json
            status.text = "PDF status"
            print("PDF_SELECTION_STATUS \(json)")
        }
    }
}
