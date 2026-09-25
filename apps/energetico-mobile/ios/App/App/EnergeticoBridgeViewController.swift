import Capacitor
import UIKit

final class EnergeticoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DocumentPickerPlugin())
        bridge?.registerPluginInstance(MicrosoftAuthPlugin())
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(PowerBiZoomPlugin())
    }
}

@objc(PowerBiZoomPlugin)
final class PowerBiZoomPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PowerBiZoomPlugin"
    let jsName = "PowerBiZoom"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise)
    ]

    private weak var previousScrollViewDelegate: UIScrollViewDelegate?
    private var hasSavedScrollViewDelegate = false
    private var previousPinchRecognizerEnabled = false

    @objc func setEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Informe se o zoom do Power BI deve ser habilitado.", "POWERBI_ZOOM_INVALID_ARGUMENT")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard
                let self,
                let bridge = self.bridge as? CapacitorBridge,
                let webView = bridge.webView
            else {
                call.reject("A tela do Power BI não está disponível.", "POWERBI_ZOOM_WEBVIEW_UNAVAILABLE")
                return
            }

            let scrollView = webView.scrollView
            if enabled {
                if !self.hasSavedScrollViewDelegate {
                    self.previousScrollViewDelegate = scrollView.delegate
                    self.previousPinchRecognizerEnabled = scrollView.pinchGestureRecognizer?.isEnabled ?? false
                    self.hasSavedScrollViewDelegate = true
                }
                // Capacitor's default delegate disables this recognizer when
                // a pinch starts; suspend that callback for the report only.
                scrollView.delegate = nil
                scrollView.pinchGestureRecognizer?.isEnabled = true
            } else {
                if self.hasSavedScrollViewDelegate {
                    scrollView.pinchGestureRecognizer?.isEnabled = self.previousPinchRecognizerEnabled
                    scrollView.delegate = self.previousScrollViewDelegate
                    self.previousScrollViewDelegate = nil
                    self.hasSavedScrollViewDelegate = false
                } else {
                    scrollView.pinchGestureRecognizer?.isEnabled = false
                    scrollView.delegate = bridge.webViewDelegationHandler
                }
            }
            call.resolve()
        }
    }
}
