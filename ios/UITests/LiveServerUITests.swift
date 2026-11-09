import XCTest

/// 手元のサーバーにつないで、失敗の場面を起こして確かめる（npm run verify:ios:live。scripts/ios/live.mjs が
/// 使い捨てのサーバーと切り替えのできる中継を用意し、TEST_RUNNER_FH_LIVE=1 で流す）。
/// 試験の側から、同じサーバーへ別の端末として API を呼び、競合や権限の変更を起こす。
@MainActor
final class LiveServerUITests: XCTestCase {
  static let password = "current-password-long-enough"

  override func setUp() async throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["FH_LIVE"] == "1", "サーバーにつなぐ試験は FH_LIVE=1 のときだけ")
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  /// サーバーにつないでサインインし、今日の画面まで進む。
  private func signIn(_ email: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences"]
    app.launch()
    addUIInterruptionMonitor(withDescription: "パスワードの保存") { alert in
      for label in ["今はしない", "Not Now"] where alert.buttons[label].exists { alert.buttons[label].tap(); return true }
      return false
    }
    let server = app.buttons["welcome.server"]
    XCTAssertTrue(server.waitForExistence(timeout: 10))
    server.tap()
    let field = app.textFields["auth.email"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText(email)
    let password = app.secureTextFields["auth.password"]
    password.tap()
    password.typeText(Self.password)
    app.buttons["auth.sign-in"].tap()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 15))
    return app
  }

  private func openTab(_ app: XCUIApplication, _ name: String) {
    if isPhone { app.tabBars.buttons[name].tap() } else {
      app.buttons["検索"].firstMatch.tap()
      app.buttons["\(name)を開く"].firstMatch.tap()
    }
  }

  private func openSettings(_ app: XCUIApplication, _ key: String) {
    if isPhone {
      app.tabBars.buttons["その他"].tap()
      app.buttons["設定"].firstMatch.tap()
    } else {
      openTab(app, "設定")
    }
    let section = app.buttons["settings.section.\(key)"]
    XCTAssertTrue(section.waitForExistence(timeout: 5))
    section.tap()
  }

  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    _ = element.waitForExistence(timeout: 2)
    for _ in 0..<14 where !(element.exists && element.isHittable) { app.swipeUp() }
    XCTAssertTrue(element.waitForExistence(timeout: 3))
  }

  /// 通信が切れている間に追加したタスクは未送信の変更として残り、戻ってから送ると1件だけ届く。
  func testOfflineChangeIsSentOnceAfterReconnecting() async throws {
    let app = signIn("aoi@example.test")
    try await LiveAPI.proxy("offline")
    openTab(app, "タスク")
    app.buttons["タスクを追加"].firstMatch.tap()
    let title = app.textFields["task.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("乾電池を買う\n")
    app.buttons["task.form.save"].tap()
    let open = app.buttons["queue.open"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    try await LiveAPI.proxy("online")
    open.tap()
    XCTAssertTrue(app.staticTexts["タスク「乾電池を買う」を作成"].waitForExistence(timeout: 5))
    app.buttons["queue.retry-all"].tap()
    XCTAssertTrue(app.staticTexts["1件を送信しました。"].waitForExistence(timeout: 10))
    // 送り直しでも同じ冪等の鍵を使うので、サーバーには1件だけある。
    let api = LiveAPI()
    try await api.signIn("aoi@example.test")
    let todos = try await api.snapshot()["todos"] as? [[String: Any]] ?? []
    XCTAssertEqual(todos.filter { $0["title"] as? String == "乾電池を買う" }.count, 1)
  }

  /// ほかの端末で先に変えたタスクを保存すると、版の競合を知らせる。
  func testConflictAsksToCheckTheLatest() async throws {
    let api = LiveAPI()
    try await api.signIn("aoi@example.test")
    let created = try await api.call("POST", "/v1/todos", ["title": "競合の確かめ", "assigneeMembershipId": "member-aoi"])
    let id = try XCTUnwrap(created["id"] as? String)
    let version = try XCTUnwrap(created["version"] as? Int)
    let app = signIn("aoi@example.test")
    openTab(app, "タスク")
    let row = app.staticTexts["競合の確かめ"].firstMatch
    reveal(row, in: app)
    row.tap()
    let edit = app.buttons["task.detail.edit"]
    reveal(edit, in: app)
    edit.tap()
    let field = app.textFields["task.form.title"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    // アプリが開いている間に、別の端末で題を変える。
    _ = try await api.call("PATCH", "/v1/todos/\(id)", ["scope": "series", "input": ["title": "競合の確かめ（別の端末）"], "expectedVersion": version])
    field.tap()
    field.typeText("（アプリ）")
    app.buttons["task.form.save"].tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "別の端末でタスクが更新されています")).firstMatch.waitForExistence(timeout: 8))
  }

  /// 本人確認の時間（試験では20秒）を過ぎてから招待を作ると、パスワードを聞いてから同じ操作を続ける。
  func testReauthenticationContinuesTheSameAction() async throws {
    let app = signIn("aoi@example.test")
    openSettings(app, "household")
    sleep(25)
    let create = app.buttons["settings.invite.create"]
    reveal(create, in: app)
    create.tap()
    let password = app.secureTextFields.firstMatch
    XCTAssertTrue(app.staticTexts["この操作を続けるには、パスワードを入力してください。"].waitForExistence(timeout: 8))
    password.tap()
    password.typeText(Self.password)
    app.buttons["続ける"].tap()
    XCTAssertTrue(app.staticTexts["settings.invite.token"].waitForExistence(timeout: 10))
  }

  /// 管理者が権限を変えると、読み直したときに見られない画面が消える。
  func testPermissionChangeHidesTheBudget() async throws {
    let app = signIn("ren@example.test")
    let budget = isPhone ? app.buttons["家計"] : app.buttons["家計"].firstMatch
    if isPhone { app.tabBars.buttons["その他"].tap() }
    XCTAssertTrue(budget.waitForExistence(timeout: 5))
    let api = LiveAPI()
    try await api.signIn("aoi@example.test")
    let viewer = try await api.snapshot()["viewer"] as? [String: Any]
    let revision = try XCTUnwrap(viewer?["permissionRevision"] as? Int)
    _ = try await api.call("PUT", "/v1/household-memberships/member-ren/permission-overrides", [
      "overrides": [["membershipId": "member-ren", "capability": "expense.read", "effect": "deny"]], "expectedPermissionRevision": revision,
    ])
    if isPhone { app.buttons["設定"].firstMatch.tap(); app.buttons["settings.section.accessibility"].tap() } else { openSettings(app, "accessibility") }
    let refresh = app.buttons["settings.sync.refresh"]
    reveal(refresh, in: app)
    refresh.tap()
    XCTAssertTrue(app.staticTexts["最新の内容を読み込みました。"].waitForExistence(timeout: 8))
    if isPhone { app.navigationBars.buttons.element(boundBy: 0).tap(); app.navigationBars.buttons.element(boundBy: 0).tap() }
    XCTAssertFalse(budget.waitForExistence(timeout: 3))
    // 後の試験のために戻す。
    let latest = try await api.snapshot()["viewer"] as? [String: Any]
    _ = try await api.call("DELETE", "/v1/household-memberships/member-ren/permission-overrides?expectedPermissionRevision=\(latest?["permissionRevision"] as? Int ?? 0)")
  }

  /// 無操作の時間（1分）が過ぎる前に予告し、過ぎるとサインインの画面に戻る。
  func testIdleTimeoutWarnsAndSignsOut() async throws {
    let api = LiveAPI()
    try await api.signIn("hana@example.test")
    _ = try await api.call("PATCH", "/v1/account", ["idleTimeoutMinutes": 1])
    let app = signIn("hana@example.test")
    XCTAssertTrue(app.buttons["続ける"].waitForExistence(timeout: 70))
    XCTAssertTrue(app.textFields["auth.email"].waitForExistence(timeout: 75))
    try await api.signIn("hana@example.test")
    _ = try await api.call("PATCH", "/v1/account", ["idleTimeoutMinutes": 30])
  }
}

/// 試験の側から、同じサーバーを別の端末として呼ぶ（中継を通さずに 127.0.0.1:8799 へ）。
@MainActor
final class LiveAPI {
  private let base = URL(string: "http://127.0.0.1:8799")!
  private let session = URLSession(configuration: .ephemeral)
  private var csrf: String?

  /// 中継（127.0.0.1:8798）で、アプリからの通信を切る・戻す。
  static func proxy(_ state: String) async throws {
    _ = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:8798/__proxy/\(state)")!)
  }

  func signIn(_ email: String) async throws {
    csrf = nil
    _ = try await call("POST", "/v1/auth/password", ["email": email, "password": LiveServerUITests.password])
    csrf = nil
  }

  func snapshot() async throws -> [String: Any] { try await call("GET", "/v1/households/current/snapshot") }

  @discardableResult
  func call(_ method: String, _ path: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
    var request = URLRequest(url: URL(string: path, relativeTo: base)!)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if method != "GET" {
      if csrf == nil {
        let (data, _) = try await session.data(from: URL(string: "/v1/auth/csrf", relativeTo: base)!)
        csrf = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["token"] as? String
      }
      request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
      request.setValue(UUID().uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key")
    }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw NSError(domain: "LiveAPI", code: status, userInfo: [NSLocalizedDescriptionKey: "\(method) \(path) → \(status) \(String(decoding: data, as: UTF8.self))"]) }
    if data.isEmpty { return [:] }
    return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
  }
}
