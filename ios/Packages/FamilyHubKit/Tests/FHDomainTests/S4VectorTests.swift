import Foundation
import Testing
import FHModel
@testable import FHDomain

/// 段階 S4（家計）の計算が、Web の TS の関数の答え（scripts/ios/export-vectors.ts）と同じになること。

enum S4Fixtures {
  static let expenses: [Expense] = (try? JSON.decode(JSON.load("budgetExpenses"))) ?? []
  static let batches: [SettlementBatch] = (try? JSON.decode(JSON.load("budgetBatches"))) ?? []
  static func expense(_ id: String) -> Expense? { expenses.first { $0.id == id } }
  static let memberships: [HouseholdMembership] = S2Fixtures.snapshot?.memberships ?? []
  static let adultIds = ExpenseForm.activeAdults(memberships).map(\.id)
  static func scoped(_ scope: String) -> [Expense] {
    scope == "all" ? expenses : expenses.filter { $0.payerMembershipId == scope || $0.shares.contains { $0.membershipId == scope } }
  }
  /// JSON から読んだ下書きの負担の並びを、Web の並びに戻す。
  static func draft(_ value: JSONValue, order: JSONValue) throws -> ExpenseDraft {
    var draft: ExpenseDraft = try JSON.decode(value)
    draft.customAmounts = draft.customAmounts.ordered(order.array.compactMap(\.string))
    return draft
  }
}

struct LedgerVectorTests {
  @Test func vectorsLoad() {
    #expect(S4Fixtures.expenses.count == 85)
    #expect(S4Fixtures.batches.count == 3)
  }

  @Test(arguments: JSON.cases("budgetMonths"))
  func months(_ vector: JSONCase) {
    let list = S4Fixtures.scoped(vector.input["scope"].string!)
    let month = vector.input["month"].string!
    let expected = vector.expected
    #expect(same(Budget.monthOverview(list, month: month), expected["overview"]), "\(vector.input)")
    #expect(same(Budget.monthComparison(list, month: month), expected["comparison"]), "\(vector.input)")
    #expect(same(Budget.categoryBreakdown(list, month: month), expected["categories"]), "\(vector.input)")
    #expect(same(Budget.incomeBreakdown(list, month: month), expected["income"]), "\(vector.input)")
    #expect(same(Budget.memberTotals(list, month: month, memberships: S4Fixtures.memberships), expected["members"]), "\(vector.input)")
    let trend = Budget.trend(list, endMonth: month)
    #expect(same(trend, expected["trend"]), "\(vector.input)")
    #expect(trend.drawable == expected["drawable"].bool)
  }

  @Test(arguments: JSON.cases("budgetLedger"))
  func ledger(_ vector: JSONCase) {
    let list = S4Fixtures.scoped(vector.input.string!)
    let expected = vector.expected
    #expect(same(Ledger.unsettled(list), expected["unsettled"]))
    #expect(Budget.settledNet(list) == expected["settledNet"].int)
    let shares = Budget.openShares(list)
    #expect(same(shares, expected["openShares"]))
    #expect(sameRaw(.array(Budget.netBalances(shares).map { .array([.string($0.membershipId), .number(Double($0.amountJpy))]) }), expected["balances"]))
    #expect(same(Budget.simplifiedTransfers(list), expected["transfers"]))
    #expect(same(Budget.settleAllRequest(list, memberFilterActive: false), expected["settleAll"]))
    #expect(same(Budget.settleAllRequest(list, memberFilterActive: true), expected["settleAllFiltered"]))
    let history = Budget.settlementHistory(list).map { entry -> JSONValue in
      .object(["expenseId": .string(entry.expenseId), "record": .string(entry.record.id), "reverses": entry.reverses.map { .string($0.id) } ?? .null, "reversedBy": entry.reversedBy.map { .string($0.id) } ?? .null, "canReverse": .bool(entry.canReverse)])
    }
    #expect(sameRaw(.array(history), expected["history"]))
    let grouped = Budget.groupedSettlementHistory(list, batches: S4Fixtures.batches).map { row -> JSONValue in
      switch row {
      case .single(let entry): return .object(["kind": .string("single"), "record": .string(entry.record.id)])
      case .batch(let batch):
        return .object(["kind": .string("batch"), "batchId": .string(batch.batchId), "reversal": .bool(batch.reversal), "recordedAt": .string(batch.recordedAt), "records": .array(batch.entries.map { .string($0.record.id) }),
                        "totalJpy": .number(Double(batch.totalJpy)), "canReverse": .bool(batch.canReverse), "partlyReversed": .bool(batch.partlyReversed), "reversed": .bool(batch.reversed)])
      }
    }
    #expect(sameRaw(.array(grouped), expected["grouped"]))
    #expect(same(Budget.openExpenses(list).map(\.id), expected["open"]))
    #expect(BudgetList.latestMonth(list, currentMonth: "2026-09") == expected["latest"].string)
    let active = list.map { expense -> JSONValue in
      .array([.string(expense.id), .bool(Budget.hasActiveSettlement(expense)), .array(Ledger.remaining(expense).map { .object(["membershipId": .string($0.membershipId), "amountJpy": .number(Double($0.amountJpy))]) })])
    }
    #expect(sameRaw(.array(active), expected["active"]))
  }

  @Test(arguments: JSON.cases("percentages"))
  func percentages(_ vector: JSONCase) {
    #expect(same(Budget.percentages(vector.input.array.compactMap(\.int)), vector.expected), "\(vector.input)")
  }

  @Test(arguments: JSON.cases("transfers"))
  func transfers(_ vector: JSONCase) {
    let balances = vector.input.array.map { Budget.Balance(membershipId: $0[0].string!, amountJpy: $0[1].int!) }
    let transfers = Budget.transfers(balances)
    #expect(same(transfers, vector.expected["transfers"]), "\(vector.input)")
    #expect(Budget.transfersSettle(balances, transfers) == vector.expected["settles"].bool)
    if let first = transfers.first {
      var changed = transfers
      changed[0] = SettlementTransfer(from: first.from, to: first.to, amountJpy: first.amountJpy + 1)
      #expect(Budget.transfersSettle(balances, changed) == vector.expected["offByOne"].bool)
    }
  }

  @Test(arguments: JSON.cases("splitShares"))
  func split(_ vector: JSONCase) {
    let input = vector.input
    #expect(same(Budget.splitShares(input["amount"].int!, payer: input["payer"].string!, ids: input["ids"].array.compactMap(\.string)), vector.expected))
  }

  @Test(arguments: JSON.cases("balanceOf"))
  func balance(_ vector: JSONCase) {
    #expect(same(Budget.balanceOf(spending: vector.input[0].int!, income: vector.input[1].int!), vector.expected))
  }

  @Test(arguments: JSON.cases("budgetRanges"))
  func ranges(_ vector: JSONCase) throws {
    let input = vector.input
    let period = try #require(BudgetPeriod(rawValue: input["period"].string!))
    #expect(same(BudgetList.range(month: input["month"].string!, period: period, from: input["from"].string, to: input["to"].string, today: input["today"].string!), vector.expected), "\(input)")
  }

  @Test(arguments: JSON.cases("budgetLists"))
  func lists(_ vector: JSONCase) throws {
    let input = vector.input
    let sort = try #require(BudgetSort(rawValue: input["sort"].string!))
    let range = DateRange(start: input["range"]["start"].string!, end: input["range"]["end"].string!)
    let sorted = BudgetList.sort(BudgetList.filter(S4Fixtures.expenses, range: range, category: input["category"].string.map(ExpenseCategory.init(rawValue:))), sort, memberOrder: S4Fixtures.memberships.map(\.id))
    #expect(same(sorted.map(\.id), vector.expected["ids"]), "\(input)")
    let groups = BudgetList.groups(sorted, sort).map { group -> JSONValue in
      .object(["date": group.date.map(JSONValue.string) ?? .null, "ids": .array(group.items.map { .string($0.id) }), "expenseJpy": .number(Double(group.expenseJpy)), "incomeJpy": .number(Double(group.incomeJpy))])
    }
    #expect(sameRaw(.array(groups), vector.expected["groups"]), "\(input)")
  }
}

struct ExpenseFormVectorTests {
  @Test(arguments: JSON.cases("parseYen"))
  func parse(_ vector: JSONCase) {
    let text = vector.input.string!
    #expect(ExpenseForm.parseYen(text) == vector.expected["yen"].int, "\(text)")
    #expect(ExpenseForm.formatAmountInput(text) == vector.expected["formatted"].string, "\(text)")
  }

  @Test(arguments: JSON.cases("formatAmount"))
  func format(_ vector: JSONCase) {
    #expect(ExpenseForm.formatAmountInput(vector.input.string!) == vector.expected.string, "\(vector.input)")
  }

  @Test(arguments: JSON.cases("caretAfterDigits"))
  func caret(_ vector: JSONCase) {
    #expect(ExpenseForm.caretAfterDigits(vector.input[0].string!, digitsBefore: vector.input[1].int!) == vector.expected.int)
  }

  @Test(arguments: JSON.cases("expenseDrafts"))
  func drafts(_ vector: JSONCase) throws {
    let expense = try #require(S4Fixtures.expense(vector.input.string!))
    let adults = S4Fixtures.adultIds
    let draft = ExpenseForm.draft(from: expense, adultIds: adults)
    let expected = vector.expected
    #expect(same(draft, expected["draft"]), "\(expense.id)")
    #expect(same(draft.customAmounts.ids, expected["order"]), "\(expense.id)")
    #expect(ExpenseForm.problem(draft, splitLocked: false) == expected["problem"].string, "\(expense.id)")
    #expect(ExpenseForm.problem(draft, splitLocked: true) == expected["locked"].string, "\(expense.id)")
    #expect(same(ExpenseForm.createInput(draft, adultIds: adults), expected["create"]), "\(expense.id)")
    #expect(same(ExpenseForm.plannedShares(draft, adultIds: adults), expected["planned"]), "\(expense.id)")
    #expect(ExpenseForm.customSplitGap(draft) == expected["gap"].int, "\(expense.id)")
    var empty = draft
    empty.customAmounts = CustomAmounts()
    #expect(same(ExpenseForm.seedCustomAmounts(empty, adultIds: adults), expected["seeded"]), "\(expense.id)")
    #expect(same(ExpenseForm.peopleOutside(draft, adultIds: adults, memberships: S4Fixtures.memberships, creatorId: expense.creatorMembershipId).map(\.id), expected["outside"]), "\(expense.id)")
    #expect(Budget.hasActiveSettlement(expense) == expected["active"].bool)
    #expect(same(ExpenseForm.kindChangeEffects(expense, .expense), expected["kindChange"]["expense"]))
    #expect(same(ExpenseForm.kindChangeEffects(expense, .income), expected["kindChange"]["income"]))
  }

  @Test(arguments: JSON.cases("newExpenseDrafts"))
  func newDrafts(_ vector: JSONCase) {
    let kind = ExpenseKind(rawValue: vector.input["kind"].string!)
    #expect(same(ExpenseForm.newDraft(date: "2026-09-30", viewer: vector.input["viewer"].string!, adultIds: S4Fixtures.adultIds, audience: .household, kind: kind), vector.expected))
  }

  @Test(arguments: JSON.cases("expenseDraftChecks"))
  func checks(_ vector: JSONCase) throws {
    let draft = try S4Fixtures.draft(vector.input["draft"], order: vector.input["order"])
    let adults = S4Fixtures.adultIds
    let expected = vector.expected
    let name = vector.input["name"]
    #expect(ExpenseForm.problem(draft, splitLocked: false) == expected["problem"].string, "\(name)")
    #expect(ExpenseForm.problem(draft, splitLocked: true) == expected["locked"].string, "\(name)")
    #expect(same(ExpenseForm.createInput(draft, adultIds: adults), expected["create"]), "\(name)")
    #expect(same(ExpenseForm.plannedShares(draft, adultIds: adults), expected["planned"]), "\(name)")
    #expect(ExpenseForm.customSplitGap(draft) == expected["gap"].int, "\(name)")
    let seeded = ExpenseForm.seedCustomAmounts(draft, adultIds: adults)
    #expect(same(seeded, expected["seeded"]), "\(name)")
    #expect(same(seeded.ids, expected["seededOrder"]), "\(name)")
    #expect(same(ExpenseForm.peopleOutside(draft, adultIds: adults, memberships: S4Fixtures.memberships, creatorId: "member-aoi").map(\.id), expected["outside"]), "\(name)")
    #expect(same(ExpenseForm.withKind(draft, .income), expected["toIncome"]), "\(name)")
    var income = draft
    income.kind = .income
    income.category = "income_bonus"
    #expect(same(ExpenseForm.withKind(income, .expense), expected["toExpense"]), "\(name)")
  }

  @Test(arguments: JSON.cases("expenseUpdates"))
  func updates(_ vector: JSONCase) throws {
    let original = try #require(S4Fixtures.expense(vector.input["id"].string!))
    let draft = try S4Fixtures.draft(vector.input["draft"], order: vector.input["order"])
    let name = vector.input["name"]
    #expect(same(ExpenseForm.updateInput(draft, original: original, adultIds: S4Fixtures.adultIds, splitLocked: false), vector.expected["plain"]), "\(original.id) \(name)")
    #expect(same(ExpenseForm.updateInput(draft, original: original, adultIds: S4Fixtures.adultIds, splitLocked: true), vector.expected["locked"]), "\(original.id) \(name)")
  }

  @Test(arguments: JSON.cases("payerChoices"))
  func payers(_ vector: JSONCase) {
    #expect(same(ExpenseForm.payerChoices(S4Fixtures.memberships, keep: vector.input.string).map(\.id), vector.expected))
  }

  @Test(arguments: JSON.cases("settlementForms"))
  func settlementProblems(_ vector: JSONCase) {
    #expect(SettlementForm.amountProblem(vector.input["text"].string!, remaining: vector.input["rest"].int!) == vector.expected.string, "\(vector.input)")
  }

  @Test(arguments: JSON.cases("settlementPresets"))
  func presets(_ vector: JSONCase) {
    #expect(same(SettlementForm.presets(vector.input.int!), vector.expected))
  }

  @Test(arguments: JSON.cases("receiptDrafts"))
  func receipts(_ vector: JSONCase) throws {
    let receipt: ReceiptProposal = try JSON.decode(vector.input)
    let base = ExpenseForm.newDraft(date: "2026-09-30", viewer: "member-aoi", adultIds: S4Fixtures.adultIds, audience: .household)
    let applied = JSON.value(ExpenseForm.apply(receipt, to: base))
    guard case .object(let fields) = vector.expected else { Issue.record("答えの形が違う"); return }
    for (key, value) in fields { #expect(applied[key] == value, "\(key)") }
    // 答えにない項目は、元の下書きのまま。
    for key in ["title", "amount", "date"] where fields[key] == nil { #expect(applied[key] == JSON.value(base)[key], "\(key)") }
  }
}
