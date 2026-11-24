import Capacitor
import UIKit

final class EnergeticoBridgeViewController: CAPBridgeViewController {
    override func setScreenOrientationDefaults() {
        // Reports acquire landscape only while visible. Launching or returning
        // to HOME must not follow the device sensor into a sideways menu.
        supportedOrientations = [UIInterfaceOrientation.portrait.rawValue]
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        // Capacitor ScreenOrientation encodes the "any" lock as .unknown.
        // Translate it to a real UIKit mask so a camera player can follow the
        // sensor; the plugin restores the original portrait mask when closed.
        if supportedOrientations.contains(UIInterfaceOrientation.unknown.rawValue) {
            return .all
        }
        return super.supportedInterfaceOrientations
    }

    override func setNeedsUpdateOfSupportedInterfaceOrientations() {
        // UIKit documents this scope for nonanimated orientation updates.
        // Keep native landscape (and its keyboard) without the spinning window.
        UIView.performWithoutAnimation {
            super.setNeedsUpdateOfSupportedInterfaceOrientations()
        }
    }

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
