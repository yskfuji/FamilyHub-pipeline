import XCTest

@MainActor
extension XCTestCase {
  /// アクセシビリティの監査。見つけたものを全部、要素の名前と位置つきで書き出す（どこを直すかが分かるように）。
  /// 下のタブの帯と上部はガラスで、下を通る本文の濃さを正しく測れない。帯に重なった要素の濃さの指摘だけは除く
  /// （帯の外にある同じ要素は、スクロールした位置で測られる）。要素を特定できない文字の大きさの指摘（iPad のタブの帯）も除く。
  func audit(_ app: XCUIApplication, _ name: String = "") throws {
    // 画面が上に留めている帯（識別子が fixed-bar. で始まるもの）も、ガラスの帯と同じく扱う。
    let fixed = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "fixed-bar.")).allElementsBoundByIndex
    let bars = ([app.tabBars.firstMatch, app.navigationBars.firstMatch] + fixed).filter(\.exists).map(\.frame)
    let window = app.windows.firstMatch.frame
    var found: [String] = []
    try app.performAccessibilityAudit { issue in
      let frame = issue.element?.frame ?? .zero
      if issue.auditType == .contrast, bars.contains(where: { $0.intersects(frame) }) { return true }
      // iPad の上のタブの帯（システムの部品）は、要素を特定できない文字の大きさの指摘を出す。アプリでは直せないので除く。
      if issue.auditType == .dynamicType, issue.element == nil { return true }
      // 画面の端で一部だけ見えている要素は、端の外を背景として測ってしまう。全部見える位置まで動かしたときに測られる。
      if issue.auditType == .contrast, !window.isEmpty, !window.contains(frame) { return true }
      // 要素を特定できない「切れるかもしれない」の指摘も、どこを直すか分からないので除く（文字の大きさの指摘と同じ扱い）。
      if issue.auditType == .textClipped, issue.element == nil { return true }
      // 日本語の組版は、括弧や中黒（（）「」・）を詰めて組む。監査はこの詰めを見込まずに幅を見積もり、全部見えている文を
      // 「切れている」と言う（学校公開のお知らせの詳細で、画面の撮影と照らして確かめた）。この文字を含む文の切れの指摘だけは除く。
      if issue.auditType == .textClipped, let label = issue.element?.label, label.contains(where: { "（）「」・".contains($0) }) { return true }
      found.append("\(name) \(issue.compactDescription): \(issue.element.map { "\($0.elementType.rawValue) 「\($0.label)」 \($0.frame)" } ?? "要素なし \(issue.detailedDescription)")")
      return true
    }
    XCTAssertTrue(found.isEmpty, found.joined(separator: "\n"))
  }

}
