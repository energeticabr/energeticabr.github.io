import AVFoundation
import Capacitor
import Foundation
import UIKit
import VisionKit

@objc(DocumentScannerPlugin)
final class DocumentScannerPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    let identifier = "DocumentScannerPlugin"
    let jsName = "DocumentScanner"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise)
    ]
    private var pendingCall: CAPPluginCall?
    private let cache = ScanCache()
    private let worker = DispatchQueue(label: "br.com.energetica.document-scanner")

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pendingCall == nil else { call.reject("Já existe um scanner aberto.", "SCAN_IN_PROGRESS"); return }
            guard VNDocumentCameraViewController.isSupported else { call.reject("Scanner indisponível neste dispositivo.", "SCAN_UNSUPPORTED"); return }
            self.pendingCall = call
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, self.pendingCall === call else { return }
                    guard granted else { self.pendingCall = nil; call.reject("Permita o acesso à câmera para escanear.", "CAMERA_PERMISSION_DENIED"); return }
                    guard let presenter = self.bridge?.viewController,
                          presenter.viewIfLoaded?.window != nil, presenter.presentedViewController == nil else {
                        self.pendingCall = nil; call.reject("A câmera não pode abrir agora. Tente novamente.", "SCAN_PRESENTATION_FAILED"); return
                    }
                    let scanner = VNDocumentCameraViewController()
                    scanner.delegate = self
                    scanner.modalPresentationStyle = .fullScreen
                    presenter.present(scanner, animated: true)
                }
            }
        }
    }
    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true) { [weak self] in
            self?.pendingCall?.resolve(["items": []]); self?.pendingCall = nil
        }
    }
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true) { [weak self] in
            self?.pendingCall?.reject("Não foi possível escanear. Tente novamente.", "SCAN_FAILED", error)
            self?.pendingCall = nil
        }
    }
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        guard let call = pendingCall else { controller.dismiss(animated: true); return }
        controller.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            self.worker.async {
                do {
                    let session = try self.cache.write(pageCount: scan.pageCount) { index in
                        try autoreleasepool {
                            let image = scan.imageOfPage(at: index)
                            let scale = min(1, 2400 / max(image.size.width, image.size.height))
                            let size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
                            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
                            let reduced = UIGraphicsImageRenderer(size: size, format: format).image { context in
                                UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                                image.draw(in: CGRect(origin: .zero, size: size))
                            }
                            guard let data = reduced.jpegData(compressionQuality: 0.9) else {
                                throw NSError(domain: "EnergeticoScanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "Não foi possível preparar a página."])
                            }
                            return data
                        }
                    }
                    DispatchQueue.main.async {
                        guard self.pendingCall === call else { self.cache.release(id: session.id); return }
                        let items: [JSObject] = session.pages.enumerated().map { index, page in
                            ["id": "\(session.id)-\(index + 1)", "uri": page.url.absoluteString,
                             "name": page.name, "size": page.size, "type": "image/jpeg"]
                        }
                        self.pendingCall = nil; call.resolve(["id": session.id, "items": items])
                    }
                } catch {
                    DispatchQueue.main.async { self.pendingCall = nil; call.reject(error.localizedDescription, "SCAN_EXPORT_FAILED", error) }
                }
            }
        }
    }
    @objc func release(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        worker.async { self.cache.release(id: id); call.resolve() }
    }
    deinit { cache.releaseAll() }
}
