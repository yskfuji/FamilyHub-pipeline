import XCTest

/// 予定の画面（段階 S2）。見本の家族で、月・週・日・一覧、予定の追加と編集、繰り返しの1回の削除と復元、シフトの読み取りを通す。
@MainActor
final class CalendarUITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  private func openCalendar(_ extra: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"] + extra
    app.launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    if isPhone { app.tabBars.buttons["予定"].tap() } else { app.buttons["予定"].firstMatch.tap() }
    XCTAssertTrue(app.staticTexts["家族の予定"].waitForExistence(timeout: 5))
    return app
  }

  private func show(_ app: XCUIApplication, _ view: String) {
    app.segmentedControls.buttons[view].tap()
  }

  private func shoot(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<10 where !element.isHittable { app.swipeUp() }
  }

  func testEveryViewShowsTheSampleWeek() {
    let app = openCalendar()
    XCTAssertTrue(app.buttons["2026年9月、表示する年月を選ぶ"].exists)
    shoot(app, "calendar-month")
    // 日を選ぶと、その日の予定が出る（iPhone は下から、iPad は右に）。
    let day = app.buttons["calendar.day.2026-10-01"].firstMatch
    scrollTo(day, in: app)
    day.tap()
    XCTAssertTrue(app.buttons["資源回収を開く"].firstMatch.waitForExistence(timeout: 5))
    shoot(app, "calendar-day-list")
    if isPhone { app.buttons["閉じる"].firstMatch.tap() }
    show(app, "週")
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "08:00資源回収を開く")).firstMatch.waitForExistence(timeout: 5))
    shoot(app, "calendar-week")
    show(app, "日")
    XCTAssertTrue(app.buttons["2026年10月1日(木)、表示する年月を選ぶ"].waitForExistence(timeout: 5))
    show(app, "一覧")
    // 一覧は、選んだ日の月（10月）の初めから読む。
    XCTAssertTrue(app.staticTexts["資源回収"].firstMatch.waitForExistence(timeout: 5))
    shoot(app, "calendar-list")
    // 次月へ進むと、繰り返しの予定が毎週出る。
    app.buttons["次月"].tap()
    XCTAssertTrue(app.buttons["2026年11月、表示する年月を選ぶ"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["11月5日(木)"].waitForExistence(timeout: 5))
  }

  func testAddAndEditAnEvent() {
    let app = openCalendar()
    app.buttons["予定を追加"].firstMatch.tap()
    let title = app.textFields["calendar.event.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    // 名前がなければ送らずに知らせる。
    app.buttons["calendar.event.save"].tap()
    XCTAssertTrue(app.staticTexts["予定名を入力してください。"].waitForExistence(timeout: 5))
    title.tap()
    title.typeText("歯医者")
    app.buttons["calendar.event.save"].tap()
    XCTAssertFalse(title.waitForExistence(timeout: 2) && title.isHittable)
    show(app, "一覧")
    let open = app.buttons["歯医者を開く"].firstMatch
    XCTAssertTrue(open.waitForExistence(timeout: 5))
    open.tap()
    let edit = app.buttons["calendar.event.edit"]
    XCTAssertTrue(edit.waitForExistence(timeout: 5))
    edit.tap()
    let field = app.textFields["calendar.event.title"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("（検診）")
    app.buttons["calendar.event.save"].tap()
    XCTAssertTrue(app.navigationBars["歯医者"].waitForExistence(timeout: 5) || app.staticTexts["歯医者（検診）"].waitForExistence(timeout: 5))
    app.buttons["閉じる"].firstMatch.tap()
    XCTAssertTrue(app.buttons["歯医者（検診）を開く"].firstMatch.waitForExistence(timeout: 5))
  }

  func testUnsavedChangesAskBeforeClosing() {
    let app = openCalendar()
    app.buttons["予定を追加"].firstMatch.tap()
    let title = app.textFields["calendar.event.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("書きかけ")
    app.buttons["キャンセル"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["入力中の内容を破棄しますか"].waitForExistence(timeout: 5))
    app.buttons["編集に戻る"].tap()
    XCTAssertTrue(title.exists)
    app.buttons["キャンセル"].firstMatch.tap()
    app.buttons["破棄する"].tap()
    XCTAssertTrue(app.staticTexts["家族の予定"].waitForExistence(timeout: 5))
  }

  func testDeleteOneOccurrenceAndRestoreIt() {
    let app = openCalendar()
    show(app, "一覧")
    // 一覧は今月（9月）から。資源回収は10月なので、次月へ進む。
    app.buttons["次月"].tap()
    let open = app.buttons["資源回収を開く"].firstMatch
    XCTAssertTrue(open.waitForExistence(timeout: 5))
    open.tap()
    XCTAssertTrue(app.staticTexts["毎週木曜"].waitForExistence(timeout: 5))
    app.buttons["予定を削除"].tap()
    let confirm = app.buttons["削除する"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
    let undo = app.buttons["元に戻す"]
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    undo.tap()
    XCTAssertFalse(undo.waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["資源回収を開く"].firstMatch.exists)
  }

  func testShiftReaderSavesTheCheckedRows() {
    let app = openCalendar()
    app.buttons["シフトを読み取る"].firstMatch.tap()
    let text = app.textViews["calendar.shift.text"]
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    text.tap()
    text.typeText("10/6 早番\n10/7 休み\n10/8 Z")
    XCTAssertTrue(app.buttons["2件を保存"].waitForExistence(timeout: 5))
    shoot(app, "calendar-shift")
    app.buttons["calendar.shift.save"].tap()
    XCTAssertTrue(app.staticTexts["家族の予定"].waitForExistence(timeout: 10))
    show(app, "一覧")
    app.buttons["次月"].tap()
    XCTAssertTrue(app.buttons["早番を開く"].firstMatch.waitForExistence(timeout: 5))
  }

  func testCalendarPassesTheAccessibilityAudit() throws {
    let app = openCalendar()
    // 画面の切り替わりの途中（重なって薄く見える間）を測らないように、落ち着くのを待つ。
    sleep(1)
    shoot(app, "audit-month")
    try audit(app, "月")
    show(app, "週")
    sleep(1)
    try audit(app, "週")
    show(app, "一覧")
    sleep(1)
    shoot(app, "audit-list")
    try audit(app, "一覧")
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    sleep(1)
    try audit(app, "一覧・夜")
  }
}

/// 文字を最大にしたときの見た目（確かめるための撮影。合否は監査の試験で見る）。
@MainActor
final class CalendarLargeTextShots: XCTestCase {
  func testLargeTextMonth() throws {
    try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "撮影は iPhone だけ")
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["予定"].waitForExistence(timeout: 10))
    app.tabBars.buttons["予定"].tap()
    sleep(2)
    for name in ["large-month-1", "large-month-2"] {
      let shot = XCTAttachment(screenshot: app.screenshot())
      shot.name = name
      shot.lifetime = .keepAlways
      add(shot)
      app.swipeUp()
    }
  }
}
