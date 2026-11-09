import XCTest

/// 家計の画面（段階 S4）。見本の家族（碧さん）で、概要・一覧・メンバー別・精算、支出の追加と編集、精算と取り消し、削除と復元を通す。
@MainActor
final class BudgetUITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  private func openBudget() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"]
    app.launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    if isPhone {
      app.tabBars.buttons["その他"].tap()
      app.buttons["家計"].firstMatch.tap()
    } else {
      app.buttons["家計"].firstMatch.tap()
    }
    XCTAssertTrue(app.staticTexts["家計と割り勘"].waitForExistence(timeout: 5))
    return app
  }

  private func shoot(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<12 where !element.isHittable { app.swipeUp() }
  }

  private func show(_ app: XCUIApplication, _ view: String) {
    let control = app.segmentedControls.buttons[view].firstMatch
    for _ in 0..<4 where !control.isHittable { app.swipeDown() }
    control.tap()
  }

  func testEveryViewShowsTheSampleMonth() {
    let app = openBudget()
    XCTAssertTrue(app.staticTexts["2026年9月"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["￥12,060"].exists)
    XCTAssertTrue(app.staticTexts["+￥307,940"].exists)
    shoot(app, "budget-overview")
    show(app, "一覧")
    XCTAssertTrue(app.buttons["budget.expense.open.expense-books"].waitForExistence(timeout: 5))
    shoot(app, "budget-list")
    show(app, "メンバー別")
    XCTAssertTrue(app.staticTexts["メンバー別の支払いと負担"].waitForExistence(timeout: 5))
    show(app, "精算")
    XCTAssertTrue(app.staticTexts["￥3,110"].waitForExistence(timeout: 5))
    let open = app.buttons["budget.settle-all.open"]
    reveal(open, in: app)
    shoot(app, "budget-settlements")
    // 碧さんには見えない蓮さんの記録に残りがあるので、まとめた精算は断られる（Web と同じ）。
    open.tap()
    let confirm = app.buttons["budget.settle-all.confirm"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
    XCTAssertTrue(app.buttons["閉じる"].firstMatch.waitForExistence(timeout: 5))
    app.buttons["閉じる"].firstMatch.tap()
  }

  func testCategoryOpensTheFilteredList() {
    let app = openBudget()
    let food = app.buttons["budget.category.open.food"]
    reveal(food, in: app)
    food.tap()
    XCTAssertTrue(app.buttons["budget.expense.open.expense-groceries"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["budget.expense.open.expense-books"].exists)
  }

  func testAddAnExpenseSplitEqually() {
    let app = openBudget()
    app.buttons["支出を追加"].firstMatch.tap()
    let title = app.textFields["budget.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    app.buttons["budget.form.save"].tap()
    XCTAssertTrue(app.staticTexts["支出名を入力してください。"].waitForExistence(timeout: 5))
    title.tap()
    title.typeText("上履き\n")
    let amount = app.textFields["budget.form.amount"]
    amount.tap()
    amount.typeText("1001")
    XCTAssertEqual(amount.value as? String, "1,001")
    // 負担の見通しは金額の下の行。iPad の入力の画面は低いので、見えるところまで送る。
    let preview = app.staticTexts["碧さん ￥501・蓮さん ￥500"]
    for _ in 0..<4 where !preview.waitForExistence(timeout: 1) { app.swipeUp() }
    XCTAssertTrue(preview.exists)
    app.buttons["budget.form.save"].tap()
    let edit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "budget.expense.edit.")).firstMatch
    XCTAssertTrue(edit.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["上履き"].firstMatch.exists)
    shoot(app, "budget-detail-new")
  }

  func testSettleAndUndo() {
    let app = openBudget()
    show(app, "一覧")
    let books = app.buttons["budget.expense.open.expense-books"]
    XCTAssertTrue(books.waitForExistence(timeout: 5))
    books.tap()
    let half = app.buttons["budget.settlement.preset.half.expense-books.member-ren"]
    reveal(half, in: app)
    half.tap()
    let record = app.buttons["budget.settlement.record.expense-books.member-ren"]
    XCTAssertEqual(record.label, "蓮さんの￥715を精算")
    record.tap()
    // 精算の記録があるうちは削除できない。
    let delete = app.buttons["budget.expense.delete.expense-books"]
    reveal(delete, in: app)
    XCTAssertFalse(delete.isEnabled)
    let reverse = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "budget.settlement.reverse.detail.")).firstMatch
    reveal(reverse, in: app)
    reverse.tap()
    XCTAssertTrue(app.staticTexts["取り消し済み"].waitForExistence(timeout: 5))
    XCTAssertTrue(delete.isEnabled)
  }

  func testDeleteAndRestore() {
    let app = openBudget()
    show(app, "一覧")
    let salary = app.buttons["budget.expense.open.income-salary"]
    XCTAssertTrue(salary.waitForExistence(timeout: 5))
    salary.tap()
    let delete = app.buttons["budget.expense.delete.income-salary"]
    reveal(delete, in: app)
    delete.tap()
    app.buttons["削除する"].tap()
    let restore = app.buttons["元に戻す"]
    XCTAssertTrue(restore.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["budget.expense.open.income-salary"].exists)
    restore.tap()
    XCTAssertTrue(app.buttons["budget.expense.open.income-salary"].waitForExistence(timeout: 5))
  }

  func testBudgetPassesTheAccessibilityAudit() throws {
    let app = openBudget()
    sleep(1)
    try audit(app, "概要")
    show(app, "精算")
    sleep(1)
    try audit(app, "精算")
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    sleep(2)
    try audit(app, "精算・夜")
    show(app, "一覧")
    app.buttons["budget.expense.open.expense-books"].tap()
    XCTAssertTrue(app.buttons["budget.expense.edit.expense-books"].waitForExistence(timeout: 5))
    sleep(2)
    shoot(app, "audit-budget-detail-night")
    try audit(app, "詳細・夜")
  }
}
