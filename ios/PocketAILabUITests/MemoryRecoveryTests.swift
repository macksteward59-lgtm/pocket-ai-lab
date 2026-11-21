import XCTest

final class MemoryRecoveryTests: XCTestCase {
    @MainActor
    func testSavedNoteRetainsBothReferencesAfterInterruptedEdit() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let original = "Record " + String(UUID().uuidString.prefix(8))
        let sources = ["Review, Appendix A", "Sheet 4"]
        app.launch()

        func openMemory() {
            let tab = app.tabBars.buttons["Memory"]
            XCTAssertTrue(tab.waitForExistence(timeout: 10))
            tab.tap()
        }

        func openEditor(for content: String) {
            let note = app.staticTexts[content]
            XCTAssertTrue(note.waitForExistence(timeout: 10))
            let row = app.cells.containing(.staticText, identifier: content).firstMatch
            XCTAssertTrue(row.exists)
            // A partial swipe reveals Edit without invoking the destructive full swipe.
            let start = row.coordinate(withNormalizedOffset: CGVector(dx: 0.86, dy: 0.5))
            let end = row.coordinate(withNormalizedOffset: CGVector(dx: 0.36, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: end)
            let edit = app.buttons["Edit"].firstMatch
            XCTAssertTrue(edit.waitForExistence(timeout: 5))
            edit.tap()
        }

        let content = app.textViews["Information to remember"]
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
