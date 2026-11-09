import XCTest

/// 段階 S7。設定の12のタブを、見本の家族の管理者（碧さん）で通す。
@MainActor
final class SettingsUITests: XCTestCase {
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

  /// 設定を開く。iPhone は「その他」から、iPad は検索の「画面を開く」から。
  private func openSettings(_ app: XCUIApplication) {
    if isPhone {
      app.tabBars.buttons["その他"].tap()
      app.buttons["設定"].firstMatch.tap()
    } else {
      app.buttons["検索"].firstMatch.tap()
      let command = app.buttons["設定を開く"].firstMatch
      XCTAssertTrue(command.waitForExistence(timeout: 5))
      command.tap()
    }
    XCTAssertTrue(app.buttons["settings.section.household"].waitForExistence(timeout: 5))
  }

  private func section(_ app: XCUIApplication, _ key: String) {
    let button = app.buttons["settings.section.\(key)"]
    for _ in 0..<6 where !button.isHittable { app.swipeUp() }
    button.tap()
  }

  /// 一覧の行は、画面に近づくまで作られない。見つかって押せるようになるまで上へ送る。
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    _ = element.waitForExistence(timeout: 2)
    for _ in 0..<14 where !(element.exists && element.isHittable) { app.swipeUp() }
    XCTAssertTrue(element.waitForExistence(timeout: 3))
  }

  /// 一覧（Form）の画面で最初に流した監査だけ、中ほどの行の文字の大きさと濃さを測り損ねる（どのタブでも、最初の1回だけ）。
  /// 監査の前に1つのタブで監査を1回流し（結果は使わない）、戻っておく。
  private func warmUp(_ app: XCUIApplication) {
    section(app, "privacy")
    sleep(2)
    try? app.performAccessibilityAudit { _ in true }
    if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap(); sleep(1) }
  }

  private func shoot(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  func testFamilyInvitePermissionsAndColorList() {
    let app = launch()
    openSettings(app)
    section(app, "household")
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "利用中 5人 / 8人まで")).firstMatch.waitForExistence(timeout: 5))
    shoot(app, "settings-household")
    // 家族グループの名前を変える（24時間で3回まで）。
    app.buttons["settings.household.name-edit"].tap()
    let field = app.alerts.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.typeText("の家")
    app.alerts.buttons["名前を保存"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["家族グループの名前を「森さんちの家」にしました。"].waitForExistence(timeout: 5))
    // 招待コードを作ると、この画面でだけコードを出す。
    let create = app.buttons["settings.invite.create"]
    reveal(create, in: app)
    create.tap()
    XCTAssertTrue(app.staticTexts["settings.invite.token"].waitForExistence(timeout: 5))
    // 蓮さんの個別設定を1つ変えて保存する。
    for _ in 0..<4 { app.swipeDown() }
    let permissions = app.buttons["settings.member.permissions.member-ren"]
    reveal(permissions, in: app)
    permissions.tap()
    let first = app.buttons["settings.member.permission.member-ren.household.members.read"]
    reveal(first, in: app)
    first.tap()
    app.buttons["利用を制限"].firstMatch.tap()
    let save = app.buttons["settings.member.save-overrides.member-ren"]
    reveal(save, in: app)
    save.tap()
    XCTAssertTrue(app.staticTexts["蓮さんの個別設定を保存しました。"].waitForExistence(timeout: 5))
    // 色のリストを足す。
    let add = app.buttons["settings.color-list.create"]
    reveal(add, in: app)
    add.tap()
    let name = app.textFields["settings.color-list.name"]
    XCTAssertTrue(name.waitForExistence(timeout: 5))
    name.tap()
    name.typeText("部活")
    app.buttons["settings.color-list.color.2e7d4f"].tap()
    app.buttons["settings.color-list.save"].tap()
    XCTAssertTrue(app.staticTexts["部活"].waitForExistence(timeout: 5))
  }

  func testSecurityPasswordPasskeyAndSessions() {
    let app = launch()
    openSettings(app)
    section(app, "security")
    XCTAssertTrue(app.staticTexts["MacBook"].waitForExistence(timeout: 5))
    shoot(app, "settings-security")
    // 確認用の入力が違えば、送らずに知らせる。
    app.buttons["settings.password.open"].tap()
    let current = app.secureTextFields["settings.password.current"]
    XCTAssertTrue(current.waitForExistence(timeout: 5))
    current.tap(); current.typeText("current-password-long")
    let next = app.secureTextFields["settings.password.new"]
    next.tap(); next.typeText("sunset ladder quietly lantern")
    let confirm = app.secureTextFields["settings.password.confirm"]
    confirm.tap(); confirm.typeText("sunset ladder quietly lanterns")
    app.buttons["settings.password.submit"].tap()
    XCTAssertTrue(app.staticTexts["新しいパスワードと確認用の入力が一致しません。"].waitForExistence(timeout: 5))
    app.buttons["settings.password.cancel"].tap()
    // パスキーのデモ登録。
    let passkey = app.buttons["settings.passkey.add"]
    XCTAssertTrue(passkey.waitForExistence(timeout: 5))
    passkey.tap()
    XCTAssertTrue(app.staticTexts["この端末（デモ）"].waitForExistence(timeout: 5))
    // ほかの端末をサインアウトさせる。
    let revoke = app.buttons["settings.session.revoke-open.session-iphone"]
    reveal(revoke, in: app)
    revoke.tap()
    app.alerts.buttons["サインアウト"].tap()
    XCTAssertTrue(app.staticTexts["指定した端末からサインアウトしました。"].waitForExistence(timeout: 5))
    XCTAssertFalse(revoke.exists)
  }

  func testAccountNameAndVerificationCode() {
    let app = launch()
    openSettings(app)
    section(app, "account")
    let name = app.textFields["settings.account.name"]
    XCTAssertTrue(name.waitForExistence(timeout: 5))
    app.buttons["settings.account.avatar-preset.leaf"].tap()
    XCTAssertTrue(app.staticTexts["アイコンを変更しました。"].waitForExistence(timeout: 5))
    let begin = app.buttons["settings.account.totp-begin"]
    reveal(begin, in: app)
    begin.tap()
    let code = app.textFields["settings.account.totp-code"]
    XCTAssertTrue(code.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["settings.account.totp-uri"].exists)
    code.tap()
    code.typeText("123456")
    app.buttons["settings.account.totp-confirm"].tap()
    let close = app.buttons["settings.account.recovery-close"]
    XCTAssertTrue(close.waitForExistence(timeout: 8))
    shoot(app, "settings-recovery")
    close.tap()
    XCTAssertTrue(app.buttons["settings.account.totp-disable"].waitForExistence(timeout: 5))
  }

  func testHelpOpensTheRelatedSettings() {
    let app = launch()
    openSettings(app)
    section(app, "help")
    let search = app.textFields["settings.help.search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("元に戻せ")
    let item = app.buttons["settings.help.item.recently-deleted"].firstMatch
    XCTAssertTrue(item.waitForExistence(timeout: 5))
    item.tap()
    let related = app.buttons["settings.help.related.recently-deleted"]
    reveal(related, in: app)
    related.tap()
    XCTAssertTrue(app.staticTexts["最近削除したものはありません"].waitForExistence(timeout: 8))
  }

  func testAuditFiltersAndOwnRecord() {
    let app = launch()
    openSettings(app)
    section(app, "audit")
    XCTAssertTrue(app.staticTexts["記録の改ざんは見つかっていません"].waitForExistence(timeout: 8))
    shoot(app, "settings-audit")
    app.segmentedControls.buttons["自分の操作"].tap()
    XCTAssertTrue(app.staticTexts["自分の操作の記録"].waitForExistence(timeout: 5))
  }

  func testPrivacyLocationAndDisplay() {
    let app = launch()
    openSettings(app)
    section(app, "privacy")
    let hide = app.switches["settings.privacy.hide-notification-content"]
    XCTAssertTrue(hide.waitForExistence(timeout: 5))
    hide.switches.firstMatch.tap()
    XCTAssertTrue(app.staticTexts["通知の題名と内容を表示するようにしました。"].waitForExistence(timeout: 5))
    if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap() }
    section(app, "accessibility")
    let matcha = app.buttons["settings.theme.palette.matcha"]
    XCTAssertTrue(matcha.waitForExistence(timeout: 5))
    matcha.tap()
    XCTAssertTrue(matcha.isSelected)
    app.segmentedControls.buttons["コンパクト"].tap()
    XCTAssertTrue(app.staticTexts["表示の密度を「コンパクト」にしました。"].waitForExistence(timeout: 5))
    if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap() }
    section(app, "legal")
    XCTAssertTrue(app.staticTexts["草案"].waitForExistence(timeout: 5))
  }

  func testSettingsPassTheAccessibilityAudit() throws {
    let app = launch()
    openSettings(app)
    warmUp(app)
    for key in ["household", "security", "account", "privacy", "notifications", "accessibility", "recently-deleted", "audit", "help"] {
      section(app, key)
      // 変更の記録などは開いてから読み込み、読めた行を薄い色から出す。出し終わるのを待ってから測る。
      sleep(4)
      try audit(app, key)
      if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap(); sleep(1) }
    }
    try audit(app, "一覧")
  }

  func testSettingsKeepTheAuditAtNight() throws {
    let app = launch()
    openSettings(app)
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    sleep(2)
    warmUp(app)
    for key in ["household", "security", "location", "resources", "legal"] {
      section(app, key)
      sleep(2)
      try audit(app, "\(key)・夜")
      if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap(); sleep(1) }
    }
    try audit(app, "一覧・夜")
  }
}
