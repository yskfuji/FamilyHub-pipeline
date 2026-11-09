import XCTest

/// 見本のモードで、主な画面を通して動かす（docs/acceptance/walkthrough.md の一部。段階ごとに足す）。
@MainActor
final class FamilyHubUITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  func launch(_ arguments: [String] = ["-FHResetPreferences", "-FHSampleMode"]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = arguments
    app.launch()
    return app
  }

  func testWelcomeStartsTheSampleHousehold() {
    let app = launch(["-FHResetPreferences"])
    let sample = app.buttons["welcome.sample"]
    XCTAssertTrue(sample.waitForExistence(timeout: 10))
    sample.tap()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
  }

  func testTodayShowsTheSampleDay() {
    let app = launch()
    XCTAssertTrue(app.staticTexts["今日 · 9月30日"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["おはよう、碧さん"].exists)
    XCTAssertTrue(app.staticTexts["次にすること"].exists)
    app.swipeUp()
    XCTAssertTrue(app.staticTexts["時刻順に確認"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["学校公開"].exists)
  }

  func testTabsOpenEveryArea() {
    let app = launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    if UIDevice.current.userInterfaceIdiom == .phone {
      app.tabBars.buttons["予定"].tap()
      XCTAssertTrue(app.staticTexts["家族の予定"].waitForExistence(timeout: 5))
      app.tabBars.buttons["その他"].tap()
      XCTAssertTrue(app.buttons["アルバム"].waitForExistence(timeout: 5))
      app.buttons["設定"].tap()
      XCTAssertTrue(app.buttons["接続先を選び直す"].waitForExistence(timeout: 5))
      // 今日の画面から、その他の中の画面（家計）へ移る。
      app.tabBars.buttons["今日"].tap()
      let budget = app.buttons["内訳と精算を確認"]
      for _ in 0..<6 where !budget.isHittable { app.swipeUp() }
      budget.tap()
      XCTAssertTrue(app.staticTexts["家計の画面は、これから作ります"].waitForExistence(timeout: 5))
    } else {
      // iPad は横の一覧（またはタブの帯）にすべての機能を並べる。
      let calendar = app.buttons["予定"].firstMatch
      XCTAssertTrue(calendar.waitForExistence(timeout: 5))
      calendar.tap()
      XCTAssertTrue(app.staticTexts["家族の予定"].waitForExistence(timeout: 5))
    }
  }

  func testTodayPassesTheAccessibilityAudit() throws {
    let app = launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    try audit(app)
  }

  func testNightThemeKeepsTheAudit() throws {
    let app = launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    XCTAssertTrue(app.buttons["明るいテーマに切り替え"].firstMatch.waitForExistence(timeout: 5))
    try audit(app)
  }

  func testScreenshots() {
    let app = launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "today"
    shot.lifetime = .keepAlways
    add(shot)
  }

  /// 手元のサーバーにつないで、サインイン → 今日の画面 → サインアウト。
  /// TEST_RUNNER_FH_LIVE=1 で動かす（アプリは FH_DEV_SERVER_URL=http://127.0.0.1:8799 で作る。server/dev.ts の見本の家族）。
  func testLiveServerSignInAndOut() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["FH_LIVE"] == "1", "サーバーにつなぐ試験は FH_LIVE=1 のときだけ")
    let app = launch(["-FHResetPreferences"])
    // パスワードの保存を勧める表示が出たら閉じる。
    addUIInterruptionMonitor(withDescription: "パスワードの保存") { alert in
      for label in ["今はしない", "Not Now"] where alert.buttons[label].exists { alert.buttons[label].tap(); return true }
      return false
    }
    let server = app.buttons["welcome.server"]
    XCTAssertTrue(server.waitForExistence(timeout: 10))
    server.tap()
    let email = app.textFields["auth.email"]
    XCTAssertTrue(email.waitForExistence(timeout: 10))
    email.tap()
    email.typeText("aoi@example.test")
    let password = app.secureTextFields["auth.password"]
    password.tap()
    password.typeText("current-password-long-enough")
    app.buttons["auth.sign-in"].tap()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "碧さん")).firstMatch.exists)
    if UIDevice.current.userInterfaceIdiom == .phone {
      app.tabBars.buttons["その他"].tap()
      app.buttons["設定"].tap()
    } else {
      app.buttons["設定"].firstMatch.tap()
    }
    let signOut = app.buttons["サインアウト"]
    XCTAssertTrue(signOut.waitForExistence(timeout: 5))
    signOut.tap()
    XCTAssertTrue(app.textFields["auth.email"].waitForExistence(timeout: 10))
  }
}
