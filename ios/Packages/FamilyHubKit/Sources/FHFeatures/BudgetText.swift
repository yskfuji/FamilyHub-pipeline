import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 家計の画面の文言（Web の BudgetPage などの部品にある書き方）。
enum BudgetText {
  /// 2026年9月。
  static func month(_ key: String) -> String {
    let parts = key.split(separator: "-")
    guard parts.count == 2, let year = Int(parts[0]), let month = Int(parts[1]) else { return key }
    return "\(year)年\(month)月"
  }

  /// 9月。
  static func shortMonth(_ key: String) -> String { "\(Int(key.suffix(2)) ?? 0)月" }

  static func category(_ category: ExpenseCategory) -> String {
    let labels = Copy.ja.ja.expenseCategory.self
    return switch category.rawValue {
    case "food": labels.food
    case "dining": labels.dining
    case "transport": labels.transport
    case "utilities": labels.utilities
    case "home": labels.home
    case "education": labels.education
    case "health": labels.health
    case "entertainment": labels.entertainment
    case "shopping": labels.shopping
    case "savings": labels.savings
    case "other": labels.other
    case "income_salary": labels.income_salary
    case "income_bonus": labels.income_bonus
    case "income_side": labels.income_side
    case "income_investment": labels.income_investment
    case "income_gift": labels.income_gift
    case "income_other": labels.income_other
    default: category.rawValue
    }
  }

  static func kind(_ kind: ExpenseKind) -> String { kind == .income ? Copy.ja.ja.expenseKind.income : Copy.ja.ja.expenseKind.expense }
  static func payerLabel(_ kind: ExpenseKind) -> String { kind == .income ? "受け取った人" : "支払った人" }

  /// 9月28日 20:00（日本時間）。
  static func at(_ value: Rfc3339) -> String {
    guard let date = Tokyo.parse(value) else { return value }
    let parts = Tokyo.components(of: date)
    return "\(parts.date.month)月\(parts.date.day)日 \(String(format: "%02d:%02d", parts.hour, parts.minute))"
  }

  // settleAllCopy の関数（Copy.swift には書き出せない）。
  static func settleAllDescription(_ count: Int) -> String { "残りのある負担\(count)件を、次の受け渡しでまとめて精算済みにします。" }
  static func settleAllRecords(_ count: Int) -> String { "含める記録：\(count)件" }
  static func transfer(_ from: String, _ to: String) -> String { "\(from)さんから\(to)さんへ" }
  static func settleAllDone(_ count: Int) -> String { "\(count)件の負担をまとめて精算しました。精算の履歴から、まとめて取り消せます。" }
  static func batchTitle(_ count: Int) -> String { "まとめて精算（\(count)件）" }
  static func batchReversalTitle(_ count: Int) -> String { "まとめた精算の取り消し（\(count)件）" }
  static func clearsShares(_ people: String) -> String { "収入にすると、負担の記録（\(people)）は消えます。保存するまでは元のままです。" }
}

/// 家計の画面の操作（Web の useBudgetActions）。一度に1つだけ動かし、取り消しの知らせを持つ。
@Observable @MainActor
final class BudgetActions {
  enum Undo: Equatable {
    case settlement(expenseId: Id, record: SettlementRecord)
    case batch(SettlementBatch)
    case deleted(id: Id, title: String)
  }

  private(set) var busy: String?
  var undo: Undo?

  /// 操作を1つずつ流す。流している間に押されたら断る。
  private func run<Value: Sendable>(_ key: String, model: AppModel, _ operation: @escaping @Sendable (any FamilyHubGateway) async -> GatewayResult<Value>) async -> GatewayResult<Value>? {
    guard busy == nil else { model.announce("前の操作を処理しています。終わってからもう一度お試しください。"); return nil }
    busy = key
    defer { busy = nil }
    return await model.mutate(operation)
  }

  func settle(_ expense: Expense, from: Id, amount: Int, model: AppModel) async -> String? {
    let id = expense.id
    guard let result = await run("settle:\(id)", model: model, { await $0.recordSettlement(expenseId: id, fromMembershipId: from, amountJpy: amount) }) else { return nil }
    switch result {
    case .success(let updated):
      guard let record = updated.settlements.last else { return nil }
      undo = .settlement(expenseId: id, record: record)
      let adjusted = record.amountJpy != amount ? "残りの額が変わっていたため、残りの分だけ記録しました。" : ""
      model.announce("\(memberName(model.snapshot?.memberships ?? [], from))さんの\(Format.yen(record.amountJpy))の精算を記録しました。\(adjusted)精算の履歴から取り消せます。")
      return nil
    case .failure(let failure): return failure.message
    }
  }

  func reverse(expenseId: Id, record: SettlementRecord, model: AppModel) async {
    let recordId = record.id
    guard let result = await run(recordId, model: model, { await $0.reverseSettlement(expenseId: expenseId, settlementId: recordId) }) else { return }
    switch result {
    case .success:
      if case .settlement(_, let shown)? = undo, shown.id == recordId { undo = nil }
      model.announce("\(Format.yen(record.amountJpy))の精算を取り消しました。元の記録と取り消しの記録は履歴に残ります。")
    case .failure(let failure): model.announce(failure.message)
    }
  }

  func reverseBatch(_ batchId: Id, model: AppModel) async {
    let key = UUID().uuidString.lowercased()
    guard let result = await run("batch:\(batchId)", model: model, { await $0.reverseBatch(id: batchId, idempotencyKey: key) }) else { return }
    switch result {
    case .success:
      if case .batch(let shown)? = undo, shown.id == batchId { undo = nil }
      model.announce(Copy.ja.settleAllCopy.reverseDone)
    case .failure(let failure): model.announce(failure.message)
    }
  }

  func update(_ expense: Expense, input: ExpenseUpdateInput, model: AppModel) async -> String? {
    let id = expense.id, version = expense.version
    guard let result = await run("update:\(id)", model: model, { await $0.updateExpense(id: id, input: input, expectedVersion: version) }) else { return "前の操作を処理しています。終わってからもう一度お試しください。" }
    switch result {
    case .success(let updated):
      model.announce(updated.kind == expense.kind ? "\(BudgetText.kind(expense.kind))を更新しました。" : "「\(updated.title)」を\(BudgetText.kind(updated.kind))に変えました。")
      return nil
    case .failure(let failure): return failure.message
    }
  }

  func remove(_ expense: Expense, model: AppModel) async -> Bool {
    let id = expense.id, version = expense.version
    guard let result = await run("delete:\(id)", model: model, { await $0.deleteExpense(id: id, expectedVersion: version) }) else { return false }
    switch result {
    case .success:
      undo = .deleted(id: id, title: expense.title)
      model.announce("「\(expense.title)」を削除しました。7日以内なら元に戻せます。")
      return true
    case .failure(let failure):
      model.announce(failure.message)
      return false
    }
  }

  func restore(_ id: Id, model: AppModel) async {
    guard let result = await run("restore:\(id)", model: model, { await $0.restoreExpense(id: id) }) else { return }
    switch result {
    case .success(let value):
      undo = nil
      model.announce("「\(value.title)」を元に戻しました。")
    case .failure(let failure): model.announce(failure.message)
    }
  }

  func settledAll(_ batch: SettlementBatch, model: AppModel) {
    undo = .batch(batch)
    model.announce(BudgetText.settleAllDone(batch.items.count))
  }
}

/// 金額の欄（Web の AmountInput）。入力のたびに3桁ごとの区切りを付け直す。数字のキーボードを出す。
struct AmountField: View {
  let label: String
  @Binding var text: String
  var identifier: String?

  var body: some View {
    TextField(label, text: $text)
      .numberKeyboard()
      // 入力の途中でも区切りを付け直す（値を書き換えると、欄の表示も変わる）。
      .onChange(of: text) { _, value in
        let formatted = ExpenseForm.formatAmountInput(value)
        if formatted != value { text = formatted }
      }
      .accessibilityIdentifier(identifier ?? "")
  }
}

extension View {
  @ViewBuilder func numberKeyboard() -> some View {
    #if os(iOS)
    keyboardType(.numberPad)
    #else
    self
    #endif
  }
}
