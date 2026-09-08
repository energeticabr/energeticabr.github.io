import Foundation
import UniformTypeIdentifiers
import Darwin

// Evaluate the shipped plist with Apple's real predicate/UTI implementation.
// Also accepts the compiled extension's binary plist to verify packaging.
let plistPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ios/ShareExtension/Info.plist"
let plistData = try Data(contentsOf: URL(fileURLWithPath: plistPath))
let plist = try PropertyListSerialization.propertyList(from: plistData, format: nil) as! [String: Any]
let ext = plist["NSExtension"] as! [String: Any]
precondition(ext["NSExtensionPointIdentifier"] as? String == "com.apple.share-services")
let attributes = ext["NSExtensionAttributes"] as! [String: Any]
let predicate = NSPredicate(format: attributes["NSExtensionActivationRule"] as! String)

struct ActivationCase {
    let name: String
    let items: [[[String]]]
    let expected: Bool
}

let cases: [ActivationCase] = [
    .init(name: "PDF document", items: [[["com.adobe.pdf"]]], expected: true),
    .init(name: "JPEG photo", items: [[["public.jpeg"]]], expected: true),
    .init(name: "HEIC photo", items: [[["public.heic"]]], expected: true),
    .init(name: "video", items: [[["public.mpeg-4"]]], expected: true),
    .init(name: "audio", items: [[["public.mp3"]]], expected: true),
    .init(name: "ZIP", items: [[["public.zip-archive"]]], expected: true),
    .init(name: "unknown extension with file URL", items: [[["com.example.unknown-file", "public.file-url"]]], expected: true),
    .init(name: "generic file item", items: [[["public.item"]]], expected: true),
    .init(name: "multiple photos", items: [[["public.jpeg"], ["public.heic"]]], expected: true),
    .init(name: "mixed PDF plus unrelated metadata", items: [[["com.adobe.pdf"], ["com.example.private-metadata"]]], expected: true),
    .init(name: "multiple extension items", items: [[["public.jpeg"]], [["com.adobe.pdf"]]], expected: true),
    .init(name: "alternate representations", items: [[["com.example.private-metadata", "public.jpeg"]]], expected: true),
    .init(name: "unsupported only", items: [[["com.example.private-metadata"]]], expected: false),
    .init(name: "no items", items: [], expected: false),
    .init(name: "no attachments", items: [[]], expected: false),
    .init(name: "no representations", items: [[[]]], expected: false),
]

var failures = 0
for fixture in cases {
    let input: [String: Any] = ["extensionItems": fixture.items.map { attachments in
        ["attachments": attachments.map { ["registeredTypeIdentifiers": $0] }]
    }]
    let actual = predicate.evaluate(with: input)
    if actual != fixture.expected {
        failures += 1
        print("FAIL: \(fixture.name): expected \(fixture.expected), got \(actual)")
    } else {
        print("PASS: \(fixture.name)")
    }
}
print("Activation policy: \(cases.count - failures)/\(cases.count) passed (\(plistPath))")
exit(failures == 0 ? 0 : 1)
