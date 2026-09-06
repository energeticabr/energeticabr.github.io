import Capacitor

final class EnergeticoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DocumentPickerPlugin())
        bridge?.registerPluginInstance(MicrosoftAuthPlugin())
        bridge?.registerPluginInstance(ShareInboxPlugin())
    }
}
