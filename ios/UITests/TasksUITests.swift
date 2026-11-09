import XCTest

/// タスクの画面（段階 S3）。見本の家族で、絞り込み、一覧の丸での完了、確認の依頼、追加と編集、削除と復元を通す。
@MainActor
final class TasksUITests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
  }

  private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  private func openTasks() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"]
    app.launch()
    XCTAssertTrue(app.staticTexts["次にすること"].waitForExistence(timeout: 10))
    if isPhone { app.tabBars.buttons["タスク"].tap() } else { app.buttons["タスク"].firstMatch.tap() }
    XCTAssertTrue(app.staticTexts["家族のタスク"].waitForExistence(timeout: 5))
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

  func testFiltersAndTheInlineCheck() {
    let app = openTasks()
    shoot(app, "tasks-open")
    let library = app.buttons["task.row.todo-library"]
    XCTAssertTrue(library.waitForExistence(timeout: 5))
    // 一覧の丸で完了にすると、未完了の一覧から消え、完了の一覧に移る。
    let check = app.buttons["「図書館の本を返す」を完了にする"]
    reveal(check, in: app)
    check.tap()
    XCTAssertTrue(app.staticTexts["「図書館の本を返す」を完了にしました"].waitForExistence(timeout: 5) || !library.waitForExistence(timeout: 1))
    let gone = NSPredicate(format: "exists == false")
    expectation(for: gone, evaluatedWith: library)
    waitForExpectations(timeout: 5)
    app.swipeDown()
    app.buttons["task.filter.done"].tap()
    XCTAssertTrue(app.buttons["task.row.todo-library"].waitForExistence(timeout: 5))
    app.buttons["task.filter.review"].tap()
    XCTAssertTrue(app.buttons["task.row.todo-form"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["task.row.todo-garbage"].exists)
  }

  func testTodayOpensTheTaskToReview() {
    let app = XCUIApplication()
    app.launchArguments = ["-FHResetPreferences", "-FHSampleMode"]
    app.launch()
    let review = app.buttons["タスクを確認"]
    XCTAssertTrue(review.waitForExistence(timeout: 10))
    review.tap()
    XCTAssertTrue(app.staticTexts["蓮さんの確認を待っています。"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["就学援助の確認票"].firstMatch.exists)
  }

  func testAddRequestReviewAndEdit() {
    let app = openTasks()
    app.buttons["タスクを追加"].firstMatch.tap()
    let title = app.textFields["task.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    app.buttons["task.form.save"].tap()
    XCTAssertTrue(app.staticTexts["タスク名を入力してください。"].waitForExistence(timeout: 5))
    title.tap()
    title.typeText("上履きを洗う\n")
    // 確認する人を選ぶ（選択肢の一覧から）。
    let reviewer = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "確認する人")).firstMatch
    XCTAssertTrue(reviewer.waitForExistence(timeout: 5))
    reviewer.tap()
    let ren = app.buttons["蓮"].firstMatch
    XCTAssertTrue(ren.waitForExistence(timeout: 5))
    ren.tap()
    app.buttons["task.form.save"].tap()
    // 追加したタスクの内容が開く。一言を付けて確認を依頼する。
    let note = app.textFields["task.detail.note"]
    XCTAssertTrue(note.waitForExistence(timeout: 5))
    note.tap()
    note.typeText("乾かしてあります")
    // iPad は一覧の丸にも同じ名前のボタンがあるので、詳細のボタンを識別子で選ぶ。
    let request = app.buttons["task.detail.suggested"]
    XCTAssertEqual(request.label, "「上履きを洗う」の確認を依頼する")
    reveal(request, in: app)
    request.tap()
    XCTAssertTrue(app.staticTexts["乾かしてあります"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["蓮さんの確認を待っています。"].waitForExistence(timeout: 5))
    shoot(app, "tasks-detail")
    let edit = app.buttons["task.detail.edit"]
    reveal(edit, in: app)
    edit.tap()
    let field = app.textFields["task.form.title"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("（2足）")
    app.buttons["task.form.save"].tap()
    XCTAssertTrue(app.staticTexts["上履きを洗う（2足）"].firstMatch.waitForExistence(timeout: 5))
  }

  func testUnsavedChangesAskBeforeClosing() {
    let app = openTasks()
    app.buttons["タスクを追加"].firstMatch.tap()
    let title = app.textFields["task.form.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("書きかけ")
    app.buttons["キャンセル"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["入力中の内容を破棄しますか"].waitForExistence(timeout: 5))
    app.buttons["編集に戻る"].tap()
    XCTAssertTrue(title.exists)
    app.buttons["キャンセル"].firstMatch.tap()
    app.buttons["破棄する"].tap()
    XCTAssertTrue(app.staticTexts["家族のタスク"].waitForExistence(timeout: 5))
  }

  func testDeleteAndRestore() {
    let app = openTasks()
    let row = app.buttons["task.row.todo-library"]
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    row.tap()
    let delete = app.buttons["タスクを削除"]
    XCTAssertTrue(delete.waitForExistence(timeout: 5))
    reveal(delete, in: app)
    delete.tap()
    let confirm = app.buttons["削除する"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
    let undo = app.buttons["元に戻す"]
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["task.row.todo-library"].exists)
    undo.tap()
    XCTAssertTrue(app.buttons["task.row.todo-library"].waitForExistence(timeout: 5))
  }

  func testTasksPassTheAccessibilityAudit() throws {
    let app = openTasks()
    sleep(1)
    try audit(app, "一覧")
    // 昼と夜の切り替えは一覧で行う（詳細から戻る途中に切り替えると、移り変わりの途中の色を測ってしまう）。
    app.buttons["暗いテーマに切り替え"].firstMatch.tap()
    sleep(2)
    shoot(app, "audit-task-list-night")
    try audit(app, "一覧・夜")
    app.buttons["task.row.todo-garbage"].tap()
    XCTAssertTrue(app.buttons["task.detail.edit"].waitForExistence(timeout: 5))
    sleep(2)
    shoot(app, "audit-task-detail-night")
    try audit(app, "詳細・夜")
  }

  func testTaskDetailPassesTheAccessibilityAudit() throws {
    let app = openTasks()
    app.buttons["task.row.todo-form"].tap()
    XCTAssertTrue(app.buttons["task.detail.edit"].waitForExistence(timeout: 5))
    sleep(2)
    shoot(app, "audit-task-detail")
    try audit(app, "詳細")
  }
}
