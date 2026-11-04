import XCTest

final class SelectionTests: XCTestCase {
    func testLongPressSelectsPDFText() throws {
        let app = XCUIApplication()
        app.launch()
        let status = app.staticTexts["pdf-status"]
        let ready = NSPredicate { _, _ in self.state(status)["ready"] as? Bool == true }
        expectation(for: ready, evaluatedWith: status)
        waitForExpectations(timeout: 60)
        let rect = try XCTUnwrap(state(status)["rect"] as? [String: Double])
        let web = app.webViews.firstMatch
        let point = web.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: rect["x"]! + rect["width"]! * 0.4, dy: rect["y"]! + rect["height"]! / 2))
        point.press(forDuration: 1.3)
        let selected = NSPredicate { _, _ in
            let result = self.state(status)
            return result["inside"] as? Bool == true && !(result["selected"] as? String ?? "").isEmpty
        }
        expectation(for: selected, evaluatedWith: status)
        waitForExpectations(timeout: 10)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)
        print("PDF_SELECTION_RESULT \(state(status))")
        XCTAssertTrue(state(status)["inside"] as? Bool == true)
        XCTAssertFalse((state(status)["selected"] as? String ?? "").isEmpty)
    }

    private func state(_ status: XCUIElement) -> [String: Any] {
        guard let value = status.value as? String, let data = value.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }
}
