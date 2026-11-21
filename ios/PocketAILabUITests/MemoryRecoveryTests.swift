import XCTest

final class MemoryRecoveryTests: XCTestCase {
    @MainActor
    func testSavedNoteRetainsBothReferencesAfterInterruptedEdit() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let original = "Record " + String(Int.random(in: 100_000...999_999))
        let sources = ["Review, Appendix A", "Sheet 4"]
        app.launch()

        func openMemory() {
            let tab = app.tabBars.buttons["Memory"]
            XCTAssertTrue(tab.waitForExistence(timeout: 10))
            tab.tap()
        }

        let content = app.textViews["Information to remember"]
        var noteButtonID: String?
        func openEditor(for expected: String) {
            let edit: XCUIElement
            if let noteButtonID {
                edit = app.buttons[noteButtonID]
            } else {
                // The newly saved memory is the first row. Verify its contents before any edit.
                edit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "edit-memory-")).firstMatch
            }
            XCTAssertTrue(edit.waitForExistence(timeout: 12),
                          "Edit control missing. Editor visible: \(content.exists), storage alert: \(app.alerts.firstMatch.exists)")
            noteButtonID = edit.identifier
            edit.tap()
            XCTAssertTrue(content.waitForExistence(timeout: 8))
            XCTAssertEqual(content.value as? String, expected)
        }

        let fields = app.textFields.matching(identifier: "memory-reference")
        func checkReferences() {
            XCTAssertTrue(fields.firstMatch.waitForExistence(timeout: 5))
            XCTAssertEqual(fields.count, sources.count)
            for (index, source) in sources.enumerated() {
                XCTAssertEqual(fields.element(boundBy: index).value as? String, source)
            }
        }

        openMemory()
        app.buttons["Add memory"].tap()
        app.buttons["Add reference"].tap()
        // Enter content first, then scroll the form as needed above the keyboard.
        content.tap()
        content.typeText(original)
        XCTAssertEqual(content.value as? String, original)
        for (index, source) in sources.enumerated() {
            let field = fields.element(boundBy: index)
            if !field.isHittable { app.swipeUp() }
            field.tap()
            field.typeText(source)
        }
        app.buttons["Save"].tap()

        openEditor(for: original)
        checkReferences()
        content.tap()
        content.typeText(" revised")
        let revised = try XCTUnwrap(content.value as? String)
        XCTAssertTrue(revised.contains("revised"))
        app.buttons["Save"].tap()

        openEditor(for: revised)
        checkReferences()
        content.tap()
        content.typeText(" unsaved")
        XCTAssertNotEqual(content.value as? String, revised)
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
        app.launch()

        openMemory()
        openEditor(for: revised)
        XCTAssertEqual(content.value as? String, revised)
        checkReferences()
    }
}
