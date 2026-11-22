import XCTest

final class MemoryRecoveryTests: XCTestCase {
    @MainActor
    func testSavedNoteRetainsBothReferencesAfterInterruptedEdit() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let original = String(Int.random(in: 100_000...999_999))
        let sources = ["1,2", "3"]
        app.launch()

        func waitForValue(_ field: XCUIElement, _ predicate: NSPredicate) {
            let change = XCTNSPredicateExpectation(predicate: predicate, object: field)
            XCTAssertEqual(XCTWaiter.wait(for: [change], timeout: 12), .completed,
                           "The field did not finish updating after keyboard input.")
        }

        func enter(_ value: String, in field: XCUIElement) {
            field.tap()
            var prefix = ""
            for character in value {
                let key = String(character)
                field.typeText(key)
                prefix += key
                waitForValue(field, NSPredicate(format: "value == %@", prefix))
            }
        }

        func finishTyping() {
            if app.keyboards.firstMatch.exists {
                let done = app.buttons["Done typing"]
                XCTAssertTrue(done.waitForExistence(timeout: 5))
                done.tap()
            }
        }

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

        func reference(at index: Int) -> XCUIElement {
            let field = app.textFields["memory-reference-\(index + 1)"]
            // Form may create only the visible cells on a small simulator.
            if !field.exists { app.swipeDown() }
            if !field.exists { app.swipeUp() }
            XCTAssertTrue(field.waitForExistence(timeout: 5), "Missing reference \(index + 1)")
            XCTAssertEqual(field.label, "Reference \(index + 1) of \(sources.count)")
            return field
        }

        func checkReferences() {
            for (index, source) in sources.enumerated() {
                let field = reference(at: index)
                XCTAssertEqual(field.value as? String, source)
            }
        }

        openMemory()
        app.buttons["Add memory"].tap()
        app.buttons["Add reference"].tap()
        // Enter content first, then scroll the form as needed above the keyboard.
        enter(original, in: content)
        finishTyping()
        for (index, source) in sources.enumerated() {
            enter(source, in: reference(at: index))
            finishTyping()
        }
        checkReferences()
        app.buttons["Save"].tap()

        openEditor(for: original)
        content.tap()
        content.typeText("7")
        waitForValue(content, NSPredicate(format: "value MATCHES %@", "[0-9]{\(original.count + 1)}"))
        let revised = try XCTUnwrap(content.value as? String)
        app.buttons["Save"].tap()

        openEditor(for: revised)
        content.tap()
        content.typeText("8")
        waitForValue(content, NSPredicate(format: "value MATCHES %@", "[0-9]{\(revised.count + 1)}"))
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
        app.launch()

        openMemory()
        openEditor(for: revised)
        XCTAssertEqual(content.value as? String, revised)
        checkReferences()
    }
}
