import Foundation

// Only byte callbacks and durable receipts advance this model. In particular,
// finishing the HTTP request body is not confirmation that the VM accepted it.
struct SharedUploadProgress {
    private let sizes: [String: Int64]
    private let hasPreparationFailures: Bool
    private var sent: [String: Int64] = [:]
    private var confirmed: Set<String> = []
    private var activeID: String?
    private var stopped = false

    init(items: [(id: String, size: Int64)], hasPreparationFailures: Bool = false) {
        sizes = Dictionary(uniqueKeysWithValues: items.map { ($0.id, max(0, $0.size)) })
        self.hasPreparationFailures = hasPreparationFailures
    }

    var percent: Int {
        guard !sizes.isEmpty else { return 0 }
        if confirmed.count == sizes.count && !hasPreparationFailures { return 100 }
        let total = sizes.values.reduce(0.0) { $0 + Double($1) }
        guard total > 0 else { return 0 }
        let transferred = sent.values.reduce(0.0) { $0 + Double($1) }
        return min(99, Int((transferred / total * 100).rounded(.down)))
    }

    mutating func begin(id: String) {
        guard !stopped, sizes[id] != nil, !confirmed.contains(id) else { return }
        activeID = id
    }

    mutating func recordSentBytes(id: String, totalBytesSent: Int64) {
        guard !stopped, activeID == id, let size = sizes[id] else { return }
        sent[id] = max(sent[id] ?? 0, min(size, max(0, totalBytesSent)))
    }

    mutating func confirm(id: String) {
        guard !stopped, activeID == id, let size = sizes[id] else { return }
        sent[id] = size
        confirmed.insert(id)
        activeID = nil
    }

    mutating func end(id: String) {
        if activeID == id { activeID = nil }
    }

    mutating func stop() {
        stopped = true
        activeID = nil
    }
}

final class SharedUploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onBytesSent: @Sendable (Int64) -> Void

    init(onBytesSent: @escaping @Sendable (Int64) -> Void) {
        self.onBytesSent = onBytesSent
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        onBytesSent(totalBytesSent)
    }
}

#if canImport(UIKit)
import UIKit

// Shared by the real extension and its native visual verification harness.
final class SharedUploadProgressHeader: UIStackView {
    private let percentageLabel = UILabel()
    private let badge = UIView()

    init(mascot: UIImage? = UIImage(named: "Mascote")) {
        super.init(frame: .zero)
        axis = .vertical
        alignment = .center
        spacing = 8

        let icon = UIImageView(image: mascot)
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 72),
            icon.heightAnchor.constraint(equalToConstant: 72)
        ])
        addArrangedSubview(icon)

        percentageLabel.font = UIFontMetrics(forTextStyle: .subheadline)
            .scaledFont(for: .monospacedDigitSystemFont(ofSize: 15, weight: .semibold))
        percentageLabel.adjustsFontForContentSizeCategory = true
        percentageLabel.textAlignment = .center
        percentageLabel.textColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.55, green: 0.88, blue: 0.89, alpha: 1)
                : UIColor(red: 0.03, green: 0.33, blue: 0.40, alpha: 1)
        }
        percentageLabel.translatesAutoresizingMaskIntoConstraints = false
        badge.addSubview(percentageLabel)
        badge.backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.06, green: 0.23, blue: 0.27, alpha: 1)
                : UIColor(red: 0.90, green: 0.96, blue: 0.97, alpha: 1)
        }
        badge.layer.cornerRadius = 10
        badge.layer.borderWidth = 1
        badge.layer.borderColor = UIColor(red: 0.27, green: 0.59, blue: 0.64, alpha: 1).cgColor
        badge.isAccessibilityElement = true
        badge.accessibilityIdentifier = "share-upload-progress"
        badge.accessibilityLabel = "Envio dos arquivos"
        badge.accessibilityTraits = .updatesFrequently
        NSLayoutConstraint.activate([
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 58),
            percentageLabel.leadingAnchor.constraint(equalTo: badge.leadingAnchor, constant: 10),
            percentageLabel.trailingAnchor.constraint(equalTo: badge.trailingAnchor, constant: -10),
            percentageLabel.topAnchor.constraint(equalTo: badge.topAnchor, constant: 5),
            percentageLabel.bottomAnchor.constraint(equalTo: badge.bottomAnchor, constant: -5)
        ])
        addArrangedSubview(badge)
        update(percent: 0)
    }

    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func update(percent: Int) {
        let text = "\(min(100, max(0, percent)))%"
        percentageLabel.text = text
        badge.accessibilityValue = text
    }
}
#endif
