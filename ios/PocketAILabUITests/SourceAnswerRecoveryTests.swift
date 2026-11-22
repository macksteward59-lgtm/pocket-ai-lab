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
        func reveal(_ control: XCUIElement, up: Bool, action: Bool = true) {
            for _ in 0..<6 {
                if control.exists && (!action || control.isHittable) { return }
                if up { app.swipeUp() } else { app.swipeDown() }
            }
            XCTAssertTrue(control.exists && (!action || control.isHittable), "Could not reveal " + control.description)
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
        // Wait for the vault write before killing the process. The recovered content is checked after relaunch.
        XCTAssertTrue(app.staticTexts["review-saved"].waitForExistence(timeout: 12))
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
        app.launch()
        openAnswers()
        let records = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "source-record-"))
        // The list starts empty while the relaunched view loads the vault.
        XCTAssertTrue(records.firstMatch.waitForExistence(timeout: 12),
                      "No saved source answer appeared after relaunch with no query")
        let query = app.textFields["source-question"]
        let question = "At what time does the daily free neuron allocation reset?"
        query.tap()
        query.typeText(question + "\n")
        XCTAssertEqual(query.value as? String, question, "The Search field did not receive the complete question")
        let recall = app.buttons["Read saved answer"]
        XCTAssertTrue(recall.waitForExistence(timeout: 10),
                      "The saved record was visible before search, but the exact-question shortcut did not appear")
        XCTAssertTrue(records.firstMatch.waitForExistence(timeout: 10),
                      "The exact-question shortcut is available, but the saved answer row did not appear")
        XCTAssertEqual(records.count, 1)
        let savedID = records.firstMatch.identifier
        recall.tap()
        XCTAssertEqual(app.staticTexts["review-current"].label, expected)
        XCTAssertEqual(app.staticTexts["review-citation"].label, "CF-QUOTA")
        let original = app.staticTexts["review-original"]
        reveal(original, up: true, action: false)
        XCTAssertTrue(original.label.contains("10,000 neurons"))
        app.buttons["Done"].tap()
        openExample()
        XCTAssertEqual(app.staticTexts["review-current"].label, expected)
        let export = app.buttons["Save review in Files"]
        reveal(export, up: true)
        export.tap()
        let digest = app.staticTexts["source-review-digest"]
        reveal(digest, up: true, action: false)
        let hash = digest.label
        XCTAssertEqual(hash.count, 64)
        print("POCKET_SOURCE_UI_DIGEST " + hash)
        app.buttons["Done"].tap()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.firstMatch.identifier, savedID)
        print("POCKET_SOURCE_REVIEW_RELAUNCH corrected=1 preservedOriginal=1 preservedCitation=1 fullTermination=1 retryRecords=1")
    }
}
