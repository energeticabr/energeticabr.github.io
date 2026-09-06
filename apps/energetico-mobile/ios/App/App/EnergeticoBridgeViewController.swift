import Capacitor

final class EnergeticoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DocumentPickerPlugin())
    }
}
