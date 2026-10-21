import UIKit

// A test-only app renders the production header with no account, VM or documents.
final class PreviewController: UIViewController {
    let header = SharedUploadProgressHeader()
    let titleLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        header.update(percent: 37)
        titleLabel.text = "📤 Adicionando ao Energético"
        titleLabel.font = .preferredFont(forTextStyle: .title2)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 0
        titleLabel.textAlignment = .center
        let detail = UILabel()
        detail.text = "1 de 1 arquivos preparados · 10,8 MB"
        detail.numberOfLines = 0
        detail.textAlignment = .center
        detail.textColor = .secondaryLabel
        let status = UILabel()
        status.text = "Adicionando ao Energético…"
        status.font = .preferredFont(forTextStyle: .footnote)
        status.textColor = .secondaryLabel
        status.textAlignment = .center
        let stack = UIStackView(arrangedSubviews: [header, titleLabel, detail, status])
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
}

final class PreviewApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = PreviewController()
        window.makeKeyAndVisible()
        self.window = window
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.verifyAndRender() }
        return true
    }

    private func verifyAndRender() {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        var verified: [String] = []
        for width in [320, 390, 768] {
            for style in [UIUserInterfaceStyle.light, .dark] {
                for percent in [0, 37, 100] {
                    let traits = UITraitCollection(userInterfaceStyle: style)
                    traits.performAsCurrent {
                        let controller = PreviewController()
                        controller.loadViewIfNeeded()
                        controller.overrideUserInterfaceStyle = style
                        controller.view.frame = CGRect(x: 0, y: 0, width: CGFloat(width), height: 844)
                        // Dynamic UIKit colors resolve when the real view is hosted,
                        // not when a detached layer is rendered in isolation.
                        self.window?.overrideUserInterfaceStyle = style
                        self.window?.frame = controller.view.frame
                        self.window?.rootViewController = controller
                        controller.header.update(percent: percent)
                        self.window?.layoutIfNeeded()
                        controller.view.layoutIfNeeded()
                        let header = controller.header
                        let icon = header.arrangedSubviews[0]
                        let badge = header.arrangedSubviews[1]
                        let iconFrame = icon.convert(icon.bounds, to: controller.view)
                        let badgeFrame = badge.convert(badge.bounds, to: controller.view)
                        let titleFrame = controller.titleLabel.convert(controller.titleLabel.bounds, to: controller.view)
                        precondition(!header.hasAmbiguousLayout && !badge.hasAmbiguousLayout)
                        precondition(controller.view.traitCollection.userInterfaceStyle == style)
                        precondition(badge.traitCollection.userInterfaceStyle == style)
                        precondition(badgeFrame.minY >= iconFrame.maxY + 7, "The percentage must be below the mascot")
                        precondition(titleFrame.minY >= badgeFrame.maxY + 15, "The percentage must precede the title")
                        precondition(abs(badgeFrame.midX - iconFrame.midX) < 1, "Badge and mascot must be centered")
                        precondition(badgeFrame.width >= 58 && badgeFrame.width < CGFloat(width) - 48)
                        precondition(badge.accessibilityValue == "\(percent)%", "VoiceOver must expose the same percentage")
                        let label = badge.subviews.compactMap { $0 as? UILabel }.first!
                        precondition(label.bounds.width >= label.intrinsicContentSize.width - 0.5, "No clipped percentage")
                        let name = "native-share-\(width)-\(style == .dark ? "dark" : "light")-\(percent).png"
                        let image = UIGraphicsImageRenderer(bounds: controller.view.bounds).image { context in
                            precondition(controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true))
                        }
                        try! image.pngData()!.write(to: directory.appendingPathComponent(name))
                        verified.append(name)
                    }
                }
            }
        }
        self.window?.overrideUserInterfaceStyle = .light
        self.window?.frame = UIScreen.main.bounds
        self.window?.rootViewController = PreviewController()
        let report: [String: Any] = ["cases": verified.count, "images": verified, "component": "SharedUploadProgressHeader"]
        try! JSONSerialization.data(withJSONObject: report, options: .prettyPrinted)
            .write(to: directory.appendingPathComponent("verification.json"))
    }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(PreviewApp.self))
