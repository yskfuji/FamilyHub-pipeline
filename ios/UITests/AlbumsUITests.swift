import XCTest

/// アルバムの画面（段階 S5）。見本の家族（碧さん）で、一覧・中身・表示・スライドショー・作成と編集・削除と復元・並べ替えを通す。
/// 写真を選ぶ操作は UI の試験では動かしにくいので、送信は Gateway と見本の試験で確かめる。
@MainActor
final class AlbumsUITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  private func openAlbums() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"]
    app.launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    if isPhone {
      app.tabBars.buttons["その他"].tap()
      app.buttons["アルバム"].firstMatch.tap()
    } else {
      app.buttons["アルバム"].firstMatch.tap()
    }
    XCTAssertTrue(app.staticTexts["家族のアルバム"].waitForExistence(timeout: 5))
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

  func testOpenAnAlbumAndStepThroughPhotos() {
    let app = openAlbums()
    let sports = app.buttons["albums.open.album-sports"]
    XCTAssertTrue(sports.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["albums.open.album-park"].exists)
    shoot(app, "albums-list")
    sports.tap()
    let first = app.buttons["albums.item.open.item-sports-1"]
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    shoot(app, "albums-detail")
    first.tap()
    XCTAssertTrue(app.buttons["albums.viewer.close"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "1 / 3")).firstMatch.waitForExistence(timeout: 5))
    app.buttons["次の項目"].tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "2 / 3")).firstMatch.waitForExistence(timeout: 5))
    // 2枚目は時差の記録がないので（推定）が付く。
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "（推定）")).firstMatch.exists)
    app.buttons["詳しい情報"].tap()
    XCTAssertTrue(app.staticTexts["撮影場所は取り除いて保存しています"].waitForExistence(timeout: 5))
    shoot(app, "albums-viewer")
    app.buttons["albums.viewer.close"].tap()
  }

  func testSlideshowPlaysMusic() {
    let app = openAlbums()
    app.buttons["albums.open.album-sports"].tap()
    let start = app.buttons["albums.detail.slideshow"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    start.tap()
    let music = app.buttons["albums.slideshow.bgm.toggle"]
    XCTAssertTrue(music.waitForExistence(timeout: 5))
    music.tap()
    XCTAssertEqual(music.label, "曲を止める")
    app.buttons["一時停止"].tap()
    XCTAssertTrue(app.buttons["再生"].exists)
    app.buttons["閉じる"].firstMatch.tap()
  }

  func testCreateEditDeleteAndRestore() {
    let app = openAlbums()
    app.buttons["albums.create.open"].tap()
    let title = app.textFields["albums.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    app.buttons["albums.form.submit"].tap()
    XCTAssertTrue(app.staticTexts["アルバム名を入力してください。"].waitForExistence(timeout: 5))
    title.tap()
    title.typeText("夏休み")
    app.buttons["albums.form.submit"].tap()
    XCTAssertTrue(app.staticTexts["まだ写真や動画はありません"].waitForExistence(timeout: 5))
    app.buttons["albums.detail.edit"].tap()
    let field = app.textFields["albums.form.title"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("の海")
    app.buttons["albums.form.submit"].tap()
    XCTAssertTrue(app.staticTexts["夏休みの海"].firstMatch.waitForExistence(timeout: 5))
    let delete = app.buttons["albums.detail.delete"]
    reveal(delete, in: app)
    delete.tap()
    app.buttons["削除する"].tap()
    let restore = app.buttons["albums.restore"]
    XCTAssertTrue(restore.waitForExistence(timeout: 5))
    restore.tap()
    XCTAssertTrue(app.staticTexts["夏休みの海"].firstMatch.waitForExistence(timeout: 5))
  }

  func testOrganizeMovesAndSetsTheCover() {
    let app = openAlbums()
    app.buttons["albums.open.album-sports"].tap()
    let organize = app.buttons["albums.detail.organize"]
    XCTAssertTrue(organize.waitForExistence(timeout: 5))
    organize.tap()
    let later = app.buttons["「item-sports-1」を後ろへ"]
    reveal(later, in: app)
    later.tap()
    let cover = app.buttons["「item-sports-3」を表紙にする"]
    reveal(cover, in: app)
    cover.tap()
    XCTAssertTrue(app.staticTexts["写真 · 表紙"].waitForExistence(timeout: 5))
  }

  func testAlbumsPassTheAccessibilityAudit() throws {
    let app = openAlbums()
    sleep(2)
    try audit(app, "一覧")
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    sleep(2)
    try audit(app, "一覧・夜")
    app.buttons["albums.open.album-sports"].tap()
    XCTAssertTrue(app.buttons["albums.item.open.item-sports-1"].waitForExistence(timeout: 5))
    sleep(2)
    shoot(app, "audit-album-detail-night")
    try audit(app, "中身・夜")
  }
}
