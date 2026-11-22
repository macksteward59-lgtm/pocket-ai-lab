import XCTest

final class SourceAnswerRecoveryTests: XCTestCase {
    @MainActor
    func testCorrectSearchAndRetryAfterFullAppTermination() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        func openAnswers() {
            let memory = app.tabBars.buttons["Memory"]
            XCTAssertTrue(memory.waitForExistence(timeout: 12))
            memory.tap()
            app.buttons["Source answers"].tap()
            XCTAssertTrue(app.textFields["source-question"].waitForExistence(timeout: 12))
        }
        func reveal(_ control: XCUIElement, up: Bool) {
            for _ in 0..<6 {
                if control.exists && control.isHittable { return }
                if up { app.swipeUp() } else { app.swipeDown() }
            }
            XCTAssertTrue(control.exists && control.isHittable)
        }
        func openExample() {
            let open = app.buttons["Open example server answer"]
            reveal(open, up: true)
            open.tap()
            XCTAssertTrue(app.staticTexts["review-current"].waitForExistence(timeout: 12))
        }
        app.launch()
        openAnswers()
        openExample()
        let expected = app.staticTexts["review-current"].label == "00:00 UTC" ? "resetting at 00:00 UTC" : "00:00 UTC"
        let field = app.textFields["review-correction"]
        reveal(field, up: true)
        field.tap()
        field.typeText(expected + "\n")
        let save = app.buttons["Save correction"]
        reveal(save, up: true)
        save.tap()
        reveal(app.staticTexts["review-current"], up: false)
        XCTAssertEqual(app.staticTexts["review-current"].label, expected)
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
        app.launch()
        openAnswers()
        let query = app.textFields["source-question"]
        query.tap()
        query.typeText("allocation\n")
        let records = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "source-record-"))
        XCTAssertEqual(records.count, 1)
        let savedID = records.firstMatch.identifier
        records.firstMatch.tap()
        XCTAssertEqual(app.staticTexts["review-current"].label, expected)
        XCTAssertEqual(app.staticTexts["review-citation"].label, "CF-QUOTA")
        let original = app.staticTexts["review-original"]
        reveal(original, up: true)
        XCTAssertTrue(original.label.contains("10,000 neurons"))
        app.buttons["Done"].tap()
        openExample()
        XCTAssertEqual(app.staticTexts["review-current"].label, expected)
        app.buttons["Done"].tap()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.firstMatch.identifier, savedID)
        print("POCKET_SOURCE_REVIEW_RELAUNCH corrected=1 preservedOriginal=1 preservedCitation=1 fullTermination=1 retryRecords=1")
    }
}
