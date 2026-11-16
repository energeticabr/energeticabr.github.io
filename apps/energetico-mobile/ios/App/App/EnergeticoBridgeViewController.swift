import Capacitor
import UIKit

final class EnergeticoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        let composerBackgroundColor = UIColor { traits in
            UIColor(
                red: CGFloat(traits.userInterfaceStyle == .dark ? 23 : 228) / 255,
                green: CGFloat(traits.userInterfaceStyle == .dark ? 56 : 240) / 255,
                blue: CGFloat(traits.userInterfaceStyle == .dark ? 68 : 243) / 255,
                alpha: 1
            )
        }
        view.backgroundColor = composerBackgroundColor
        if let webView = bridge?.webView {
            webView.backgroundColor = composerBackgroundColor
            webView.scrollView.backgroundColor = composerBackgroundColor
        }

        bridge?.registerPluginInstance(DocumentPickerPlugin())
        bridge?.registerPluginInstance(DocumentScannerPlugin())
        bridge?.registerPluginInstance(MicrosoftAuthPlugin())
        bridge?.registerPluginInstance(ShareInboxPlugin())
    }
}
