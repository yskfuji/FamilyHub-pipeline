import XCTest

/// 段階 S6。場所・ヒント・検索・通知・すぐに追加を、見本の家族（碧さん）で通す。
/// 外部の場所検索（OpenPOI API）は試験からは呼ばない（手入力で場所を付ける）。
@MainActor
final class S6UITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"]
    app.launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    return app
  }

  /// iPhone は「その他」から、iPad は検索の「画面を開く」から開く（iPad の上の帯では、後ろのタブが隠れている）。
  private func openArea(_ app: XCUIApplication, _ name: String) {
    if isPhone {
      app.tabBars.buttons["その他"].tap()
      app.buttons[name].firstMatch.tap()
    } else {
      app.buttons["検索"].firstMatch.tap()
      let command = app.buttons["\(name)を開く"].firstMatch
      XCTAssertTrue(command.waitForExistence(timeout: 5))
      command.tap()
    }
  }

  private func shoot(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  func testPlacesListTheSampleRecords() {
    let app = launch()
    openArea(app, "場所")
    XCTAssertTrue(app.staticTexts["記録した場所"].waitForExistence(timeout: 5))
    let books = app.buttons["places.open.550c29b2"]
    XCTAssertTrue(books.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["places.open.7bd6da79"].exists)
    shoot(app, "places-list")
    books.tap()
    XCTAssertTrue(app.staticTexts["この場所の記録（1件）"].waitForExistence(timeout: 5))
    app.staticTexts["学校教材"].tap()
    XCTAssertTrue(app.buttons["budget.expense.edit.expense-books"].waitForExistence(timeout: 5))
  }

  func testMemoGetsAManualPlace() {
    let app = launch()
    if isPhone { app.tabBars.buttons["メモ"].tap() } else { app.buttons["メモ"].firstMatch.tap() }
    app.buttons["メモを追加"].firstMatch.tap()
    let title = app.textFields["memo.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("運動会の持ち物")
    let body = app.textFields["memo.form.body"]
    body.tap()
    body.typeText("水筒")
    let add = app.buttons["place.add"]
    for _ in 0..<6 where !add.isHittable { app.swipeUp() }
    add.tap()
    app.segmentedControls.buttons["手入力"].tap()
    let name = app.textFields["place.manual.name"]
    XCTAssertTrue(name.waitForExistence(timeout: 5))
    name.tap()
    name.typeText("青葉小学校 校庭")
    app.buttons["place.manual.apply"].tap()
    XCTAssertTrue(app.staticTexts["青葉小学校 校庭"].waitForExistence(timeout: 5))
    app.buttons["memo.form.save"].tap()
    let link = app.buttons["この場所の記録を見る"]
    for _ in 0..<6 where !link.isHittable { app.swipeUp() }
    link.tap()
    XCTAssertTrue(app.staticTexts["この場所の記録（1件）"].waitForExistence(timeout: 5))
  }

  func testInsightsOpenTheirTargets() {
    let app = launch()
    openArea(app, "ヒント")
    XCTAssertTrue(app.staticTexts["確認しておきたいこと"].waitForExistence(timeout: 5))
    let unsettled = app.buttons["insights.open.insight-unsettled"]
    XCTAssertTrue(unsettled.waitForExistence(timeout: 5))
    shoot(app, "insights")
    unsettled.tap()
    XCTAssertTrue(app.staticTexts["家計と割り勘"].waitForExistence(timeout: 5))
  }

  func testSearchOpensAMemo() {
    let app = launch()
    app.buttons["検索"].firstMatch.tap()
    let field = app.searchFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("学校")
    let memo = app.buttons["メモ「学校公開のお知らせ」を開く"]
    XCTAssertTrue(memo.waitForExistence(timeout: 5))
    shoot(app, "search")
    memo.tap()
    XCTAssertTrue(app.buttons["memo.detail.edit"].waitForExistence(timeout: 5))
  }

  func testNotificationsSnoozeStopAndResume() {
    let app = launch()
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "通知を確認")).firstMatch.tap()
    let snooze = app.buttons["30分後に通知"].firstMatch
    XCTAssertTrue(snooze.waitForExistence(timeout: 5))
    snooze.tap()
    XCTAssertTrue(app.staticTexts["延期済み"].firstMatch.waitForExistence(timeout: 5))
    app.buttons["通知を停止"].firstMatch.tap()
    let resume = app.buttons["通知を再開"].firstMatch
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    resume.tap()
    XCTAssertFalse(app.buttons["通知を再開"].waitForExistence(timeout: 2))
    app.buttons["閉じる"].firstMatch.tap()
  }

  func testQuickAddATask() {
    let app = launch()
    app.buttons["すぐに追加"].firstMatch.tap()
    app.buttons["タスクを追加"].firstMatch.tap()
    let title = app.textFields["task.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("連絡帳に記入")
    app.buttons["task.form.save"].tap()
    XCTAssertTrue(app.staticTexts["連絡帳に記入"].firstMatch.waitForExistence(timeout: 5))
  }

  func testS6PassesTheAccessibilityAudit() throws {
    let app = launch()
    openArea(app, "場所")
    XCTAssertTrue(app.staticTexts["記録した場所"].waitForExistence(timeout: 5))
    sleep(2)
    try audit(app, "場所")
    if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["ヒント"].firstMatch.tap() } else { openArea(app, "ヒント") }
    XCTAssertTrue(app.staticTexts["確認しておきたいこと"].waitForExistence(timeout: 5))
    sleep(2)
    try audit(app, "ヒント")
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    sleep(2)
    try audit(app, "ヒント・夜")
  }
}
