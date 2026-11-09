import XCTest

/// 段階 S8。送れなかった変更（未送信の変更）と、文字を最大にしたときの見た目。
@MainActor
final class S8UITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  private func launch(_ extra: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"] + extra
    app.launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    return app
  }

  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    _ = element.waitForExistence(timeout: 2)
    for _ in 0..<14 where !(element.exists && element.isHittable) { app.swipeUp() }
    XCTAssertTrue(element.waitForExistence(timeout: 3))
  }

  private func shoot(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  /// 通信が切れている間に追加したタスクは、未送信の変更として残り、確かめてから送れる。
  func testOfflineChangeWaitsUntilSent() {
    let app = launch()
    if isPhone {
      app.tabBars.buttons["その他"].tap()
      app.buttons["設定"].firstMatch.tap()
    } else {
      app.buttons["検索"].firstMatch.tap()
      app.buttons["設定を開く"].firstMatch.tap()
    }
    let security = app.buttons["settings.section.security"]
    XCTAssertTrue(security.waitForExistence(timeout: 5))
    security.tap()
    let offline = app.buttons["settings.connection.simulate-offline"]
    reveal(offline, in: app)
    offline.tap()
    if isPhone { app.tabBars.buttons["タスク"].tap() } else {
      // iPad では、設定を選んでいる間はタブの帯の「タスク」が隠れることがあるので、検索の「画面を開く」から開く。
      app.buttons["検索"].firstMatch.tap()
      app.buttons["タスクを開く"].firstMatch.tap()
    }
    app.buttons["タスクを追加"].firstMatch.tap()
    let title = app.textFields["task.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("電池を買う\n")
    app.buttons["task.form.save"].tap()
    let open = app.buttons["queue.open"]
    XCTAssertTrue(open.waitForExistence(timeout: 8))
    XCTAssertTrue(app.staticTexts["未送信の変更が1件あります"].exists)
    shoot(app, "queue-card")
    open.tap()
    XCTAssertTrue(app.staticTexts["タスク「電池を買う」を作成"].waitForExistence(timeout: 5))
    shoot(app, "queue-sheet")
    app.buttons["queue.retry-all"].tap()
    XCTAssertTrue(app.staticTexts["1件を送信しました。"].waitForExistence(timeout: 8))
    app.buttons["閉じる"].firstMatch.tap()
    XCTAssertFalse(open.waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["電池を買う"].firstMatch.waitForExistence(timeout: 5))
  }

  /// 文字を最大にしても、主な画面の文字が切れずに読めるか（監査で確かめる）。
  func testLargestTextKeepsTheAudit() throws {
    let app = launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
    sleep(2)
    shoot(app, "large-today")
    try audit(app, "今日・最大")
    for (tab, heading) in [("タスク", "家族のタスク"), ("メモ", "家族のメモ")] {
      if isPhone { app.tabBars.buttons[tab].tap() } else { app.buttons[tab].firstMatch.tap() }
      XCTAssertTrue(app.staticTexts[heading].waitForExistence(timeout: 5))
      sleep(2)
      shoot(app, "large-\(tab)")
      try audit(app, "\(tab)・最大")
    }
  }
}
