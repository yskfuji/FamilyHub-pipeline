import XCTest

/// メモの画面（段階 S3）。見本の家族で、検索、添付（PDF・写真・動画）の表示、文字認識の修正、追加・編集・削除と復元を通す。
/// 写真を選ぶ操作は UI の試験では動かしにくいので、送る流れは Gateway と見本の試験で確かめる。
@MainActor
final class NotesUITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  private func openNotes() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"]
    app.launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    if isPhone { app.tabBars.buttons["メモ"].tap() } else { app.buttons["メモ"].firstMatch.tap() }
    XCTAssertTrue(app.staticTexts["家族のメモ"].waitForExistence(timeout: 5))
    return app
  }

  private func shoot(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<8 where !element.isHittable { app.swipeUp() }
  }

  func testSearchFindsTheReceipt() {
    let app = openNotes()
    shoot(app, "notes-list")
    let search = app.textFields["memo.search"]
    search.tap()
    search.typeText("2,860")
    XCTAssertTrue(app.buttons["memo.row.memo-receipt"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["memo.row.memo-school"].exists)
    search.typeText("ないもの")
    XCTAssertTrue(app.staticTexts["条件に合うメモはありません"].waitForExistence(timeout: 5))
  }

  func testAttachmentsOpenInTheApp() {
    let app = openNotes()
    app.buttons["memo.row.memo-school"].tap()
    let pdf = app.buttons["PDF「学校公開」を開く"]
    reveal(pdf, in: app)
    pdf.tap()
    XCTAssertTrue(app.navigationBars["学校公開.pdf"].waitForExistence(timeout: 5))
    sleep(1)
    XCTAssertFalse(app.staticTexts["このPDFを表示できませんでした。端末に保存してから開いてください。"].exists)
    shoot(app, "notes-pdf")
    app.buttons["閉じる"].firstMatch.tap()
    if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap() }
    let receipt = app.buttons["memo.row.memo-receipt"]
    XCTAssertTrue(receipt.waitForExistence(timeout: 5))
    receipt.tap()
    // 確認中の添付は開けない。
    XCTAssertTrue(app.staticTexts["receipt.jpg"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["写真「receipt」を開く"].exists)
    let photo = app.buttons["写真「教材の写真」を開く"]
    reveal(photo, in: app)
    photo.tap()
    XCTAssertTrue(app.images["写真「教材の写真」"].waitForExistence(timeout: 5))
    app.buttons["閉じる"].firstMatch.tap()
    let clip = app.buttons["動画「教材の使い方」を開く"]
    reveal(clip, in: app)
    clip.tap()
    XCTAssertTrue(app.navigationBars["教材の使い方.mp4"].waitForExistence(timeout: 5))
    sleep(2)
    XCTAssertFalse(app.staticTexts["この動画はこの端末では再生できません。端末に保存してから開いてください。"].exists)
    shoot(app, "notes-video")
    app.buttons["閉じる"].firstMatch.tap()
  }

  func testCorrectTheRecognizedText() {
    let app = openNotes()
    app.buttons["memo.row.memo-school"].tap()
    let edit = app.buttons["memo.ocr.edit"]
    reveal(edit, in: app)
    edit.tap()
    let text = app.textViews["memo.ocr.text"]
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    text.tap()
    text.typeText(" 受付9:15")
    app.buttons["memo.ocr.save"].tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "受付9:15")).firstMatch.waitForExistence(timeout: 5))
  }

  func testAddEditDeleteAndRestore() {
    let app = openNotes()
    app.buttons["メモを追加"].firstMatch.tap()
    let title = app.textFields["memo.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    app.buttons["memo.form.save"].tap()
    XCTAssertTrue(app.staticTexts["タイトルを入力してください。"].waitForExistence(timeout: 5))
    title.tap()
    title.typeText("持ち物")
    let body = app.textFields["memo.form.body"]
    body.tap()
    body.typeText("体操服と水筒")
    app.buttons["memo.form.save"].tap()
    let edit = app.buttons["memo.detail.edit"]
    XCTAssertTrue(edit.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["体操服と水筒"].exists)
    reveal(edit, in: app)
    edit.tap()
    let field = app.textFields["memo.form.title"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("（金曜）")
    app.buttons["memo.form.save"].tap()
    XCTAssertTrue(app.staticTexts["持ち物（金曜）"].firstMatch.waitForExistence(timeout: 5))
    let delete = app.buttons["メモを削除"]
    reveal(delete, in: app)
    delete.tap()
    app.buttons["削除する"].tap()
    let undo = app.buttons["元に戻す"]
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    undo.tap()
    XCTAssertTrue(app.staticTexts["持ち物（金曜）"].firstMatch.waitForExistence(timeout: 5))
  }

  func testNotesPassTheAccessibilityAudit() throws {
    let app = openNotes()
    sleep(1)
    try audit(app, "一覧")
    // 昼と夜の切り替えは一覧で行う（詳細から戻る途中に切り替えると、移り変わりの途中の色を測ってしまう）。
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    sleep(2)
    shoot(app, "audit-memo-list-night")
    try audit(app, "一覧・夜")
    app.buttons["memo.row.memo-receipt"].tap()
    XCTAssertTrue(app.buttons["memo.detail.edit"].waitForExistence(timeout: 5))
    sleep(2)
    shoot(app, "audit-memo-detail-night")
    try audit(app, "詳細・夜")
  }

  func testMemoDetailPassesTheAccessibilityAudit() throws {
    let app = openNotes()
    app.buttons["memo.row.memo-school"].tap()
    XCTAssertTrue(app.buttons["memo.detail.edit"].waitForExistence(timeout: 5))
    sleep(2)
    shoot(app, "audit-memo-detail")
    try audit(app, "詳細")
  }
}
