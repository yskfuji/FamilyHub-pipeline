import Foundation
import FHModel
import FHCopy

// 家計の集計と精算。元: src/domain/ledger.ts、budgetSummary.ts、budgetTrend.ts。
// 入力は閲覧者に見えている支出（表示する人で絞ったもの）。画面・今日の画面が同じ計算を使い、表示が食い違わないようにする。



public enum Budget {
  public static let categoryOrder = ExpenseCategory.spending + ExpenseCategory.income

  /// 端数を最大剰余法で配り、表示する割合の合計を必ず100にする。
  public static func percentages(_ values: [Int]) -> [Int] {
    let total = values.reduce(0, +)
    if total == 0 { return values.map { _ in 0 } }
    let raw = values.map { Double($0) / Double(total) * 100 }
    var floored = raw.map { Int(floor($0)) }
    var rest = 100 - floored.reduce(0, +)
    let order = raw.enumerated().map { (index: $0.offset, fraction: $0.element - floor($0.element)) }
      .stableSorted { a, b in a.fraction != b.fraction ? a.fraction > b.fraction : a.index < b.index }
    for item in order {
      if rest <= 0 { break }
      floored[item.index] += 1
      rest -= 1
    }
    return floored
  }

  /// 精算済みの正味。取り消しの記録（負の額）を差し引く。
  public static func settledNet(_ expenses: [Expense]) -> Int {
    Ledger.live(expenses).flatMap(\.settlements).reduce(0) { $0 + $1.amountJpy }
  }

  public struct CategoryTotal: Codable, Sendable, Hashable {
    public var category: ExpenseCategory
    public var totalJpy: Int
    public var percent: Int
  }

  static func breakdown(_ inMonth: [Expense], categories: [ExpenseCategory]) -> [CategoryTotal] {
    let totals = categories
      .map { category in (category: category, total: inMonth.filter { $0.category == category }.reduce(0) { $0 + $1.amountJpy }) }
      .filter { $0.total > 0 }
      .stableSorted { a, b in a.total != b.total ? a.total > b.total : categories.firstIndex(of: a.category)! < categories.firstIndex(of: b.category)! }
    let shares = percentages(totals.map(\.total))
    return totals.enumerated().map { CategoryTotal(category: $0.element.category, totalJpy: $0.element.total, percent: shares[$0.offset]) }
  }

  /// 費目別の支出の合計（多い順）。0円の費目は出さない。
  public static func categoryBreakdown(_ expenses: [Expense], month: String) -> [CategoryTotal] {
    breakdown(Ledger.spending(expenses).filter { $0.incurredOn.hasPrefix("\(month)-") }, categories: ExpenseCategory.spending)
  }

  /// 費目別の収入の合計（多い順）。
  public static func incomeBreakdown(_ expenses: [Expense], month: String) -> [CategoryTotal] {
    breakdown(expenses.filter { $0.kind == .income && $0.deletedAt == nil && $0.incurredOn.hasPrefix("\(month)-") }, categories: ExpenseCategory.income)
  }

  /// 支払った人以外の負担のうち、まだ残りがあるもの。まとめた精算はこの単位で記録する。
  public struct OpenShare: Codable, Sendable, Hashable {
    public var expenseId: Id
    public var membershipId: Id
    public var payerMembershipId: Id
    public var remainingJpy: Int
  }

  public static func openShares(_ expenses: [Expense]) -> [OpenShare] {
    Ledger.live(expenses).flatMap { expense in
      Ledger.remaining(expense).map { OpenShare(expenseId: expense.id, membershipId: $0.membershipId, payerMembershipId: expense.payerMembershipId, remainingJpy: $0.amountJpy) }
    }
  }

  /// 人ごとの正味（現れた順）。正は受け取る額、負は渡す額。合計は必ず0になる。
  public struct Balance: Sendable, Hashable {
    public var membershipId: Id
    public var amountJpy: Int
  }

  public static func netBalances(_ shares: [OpenShare]) -> [Balance] {
    var order: [Id] = []
    var net: [Id: Int] = [:]
    func add(_ id: Id, _ amount: Int) {
      if net[id] == nil { order.append(id) }
      net[id, default: 0] += amount
    }
    for share in shares {
      add(share.membershipId, -share.remainingJpy)
      add(share.payerMembershipId, share.remainingJpy)
    }
    return order.map { Balance(membershipId: $0, amountJpy: net[$0]!) }
  }

  /// 正味を、最大の貸し手と最大の借り手を組んで受け渡しにする（貪欲法）。
  public static func transfers(_ balances: [Balance]) -> [SettlementTransfer] {
    let largestFirst: (Balance, Balance) -> Bool = { a, b in a.amountJpy != b.amountJpy ? a.amountJpy > b.amountJpy : jsLocaleCompare(a.membershipId, b.membershipId) < 0 }
    var debtors = balances.filter { $0.amountJpy < 0 }.map { Balance(membershipId: $0.membershipId, amountJpy: -$0.amountJpy) }.stableSorted(by: largestFirst)
    var creditors = balances.filter { $0.amountJpy > 0 }.stableSorted(by: largestFirst)
    var result: [SettlementTransfer] = []
    var debtor = 0, creditor = 0
    while debtor < debtors.count, creditor < creditors.count {
      let amount = min(debtors[debtor].amountJpy, creditors[creditor].amountJpy)
      result.append(SettlementTransfer(from: debtors[debtor].membershipId, to: creditors[creditor].membershipId, amountJpy: amount))
      debtors[debtor].amountJpy -= amount
      creditors[creditor].amountJpy -= amount
      if debtors[debtor].amountJpy == 0 { debtor += 1 }
      if creditors[creditor].amountJpy == 0 { creditor += 1 }
    }
    return result
  }

  /// 受け渡しが、正味をちょうど0にするか。
  public static func transfersSettle(_ balances: [Balance], _ transfers: [SettlementTransfer]) -> Bool {
    var left = Dictionary(balances.map { ($0.membershipId, $0.amountJpy) }, uniquingKeysWith: { $1 })
    for transfer in transfers {
      left[transfer.from, default: 0] += transfer.amountJpy
      left[transfer.to, default: 0] -= transfer.amountJpy
    }
    return left.values.allSatisfy { $0 == 0 }
  }

  /// 残りのある記録をすべて相殺したうえで、誰が誰にいくら渡せば済むか。
  public static func simplifiedTransfers(_ expenses: [Expense]) -> [SettlementTransfer] { transfers(netBalances(openShares(expenses))) }

  /// まとめた精算の要求。人で絞って表示しているときと、精算するものがないときは nil。
  public static func settleAllRequest(_ expenses: [Expense], memberFilterActive: Bool) -> SettleAllInput? {
    if memberFilterActive { return nil }
    let shares = openShares(expenses)
    if shares.isEmpty { return nil }
    return SettleAllInput(shares: shares.map { SettleAllInput.Share(expenseId: $0.expenseId, membershipId: $0.membershipId, remainingJpy: $0.remainingJpy) }, transfers: transfers(netBalances(shares)))
  }

  public struct HistoryEntry: Sendable, Hashable, Identifiable {
    public var expenseId: Id
    public var expenseTitle: String
    public var record: SettlementRecord
    /// 取り消しの記録なら、取り消した元の精算。
    public var reverses: SettlementRecord?
    /// 元の精算なら、それを取り消した記録。
    public var reversedBy: SettlementRecord?
    public var canReverse: Bool
    public var id: Id { record.id }
  }

  /// 精算の履歴（新しい順）。取り消しは反対の記録として並べる。
  public static func settlementHistory(_ expenses: [Expense]) -> [HistoryEntry] {
    Ledger.live(expenses).flatMap { expense in
      expense.settlements.map { record in
        HistoryEntry(expenseId: expense.id, expenseTitle: expense.title, record: record,
                     reverses: record.reversalOfSettlementId.flatMap { id in expense.settlements.first { $0.id == id } },
                     reversedBy: expense.settlements.first { $0.reversalOfSettlementId == record.id },
                     canReverse: record.amountJpy > 0 && record.reversedAt == nil)
      }
    }.stableSorted { a, b in
      let byTime = jsLocaleCompare(b.record.recordedAt, a.record.recordedAt)
      return byTime != 0 ? byTime < 0 : jsLocaleCompare(b.record.id, a.record.id) < 0
    }
  }

  public struct BatchRow: Sendable, Hashable {
    public var batchId: Id
    public var reversal: Bool
    public var recordedAt: Rfc3339
    public var transfers: [SettlementTransfer]
    public var entries: [HistoryEntry]
    public var totalJpy: Int
    public var canReverse: Bool
    public var partlyReversed: Bool
    public var reversed: Bool
  }

  public enum HistoryRow: Sendable, Hashable, Identifiable {
    case single(HistoryEntry)
    case batch(BatchRow)
    public var id: String {
      switch self {
      case .single(let entry): entry.record.id
      case .batch(let row): "\(row.batchId):\(row.reversal ? "reversal" : "batch")"
      }
    }
  }

  /// 精算の履歴を、まとめた精算ごとに1件にまとめる（新しい順）。まとめの記録が見えないときは、記録ごとの行のまま出す。
  public static func groupedSettlementHistory(_ expenses: [Expense], batches: [SettlementBatch]) -> [HistoryRow] {
    var rows: [HistoryRow] = []
    var groups: [String: BatchRow] = [:]
    var order: [String] = []
    for entry in settlementHistory(expenses) {
      guard let batchId = entry.record.batchId, let batch = batches.first(where: { $0.id == batchId }) else {
        rows.append(.single(entry))
        continue
      }
      let reversal = entry.reverses != nil
      let key = "\(batch.id):\(reversal ? "reversal" : "batch")"
      if groups[key] == nil {
        groups[key] = BatchRow(batchId: batch.id, reversal: reversal, recordedAt: entry.record.recordedAt, transfers: batch.transfers, entries: [], totalJpy: 0, canReverse: false, partlyReversed: false, reversed: batch.reversedAt != nil)
        order.append(key)
        rows.append(.batch(groups[key]!))
      }
      groups[key]!.entries.append(entry)
      groups[key]!.totalJpy += abs(entry.record.amountJpy)
    }
    for key in order where !(groups[key]!.reversal) {
      var row = groups[key]!
      row.partlyReversed = !row.reversed && row.entries.contains { $0.reversedBy.map { $0.batchId == nil } ?? false }
      row.canReverse = !row.reversed && !row.partlyReversed && row.entries.allSatisfy(\.canReverse)
      groups[key] = row
    }
    return rows.map { row in
      if case .batch(let batch) = row { return .batch(groups["\(batch.batchId):\(batch.reversal ? "reversal" : "batch")"]!) }
      return row
    }
  }

  /// 金額・支払った人・負担を変えてよいか。精算が1件でも生きていれば変えられない。
  public static func hasActiveSettlement(_ expense: Expense) -> Bool { expense.settlements.contains { $0.amountJpy > 0 && $0.reversedAt == nil } }

  /// 円を負担者に配る。端数は先頭から1円ずつ。支払った人の負担は最初から精算済み。
  public static func splitShares(_ amountJpy: Int, payer: Id, ids: [Id]) -> [ExpenseShare] {
    guard !ids.isEmpty else { return [] }
    let base = Int(floor(Double(amountJpy) / Double(ids.count)))
    var remainder = amountJpy - base * ids.count
    return ids.map { id in
      let amount = base + (remainder > 0 ? 1 : 0)
      remainder -= 1
      return ExpenseShare(membershipId: id, amountJpy: amount, settledJpy: id == payer ? amount : 0)
    }
  }

  // MARK: 月の集計（budgetSummary.ts）

  public struct Overview: Codable, Sendable, Hashable {
    public var spending: Ledger.Summary
    public var income: Ledger.Summary
    public var netJpy: Int
    public var count: Int
  }

  public static func monthOverview(_ expenses: [Expense], month: String) -> Overview {
    let spending = Ledger.month(expenses, monthKey: month), income = Ledger.monthIncome(expenses, monthKey: month)
    return Overview(spending: spending, income: income, netJpy: income.totalJpy - spending.totalJpy, count: spending.count + income.count)
  }

  public struct Comparison: Sendable, Hashable, Encodable {
    public var previousMonth: String
    public var differenceJpy: Int?
    public func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(previousMonth, forKey: .previousMonth)
      try container.encode(differenceJpy, forKey: .differenceJpy)
    }
    enum CodingKeys: String, CodingKey { case previousMonth, differenceJpy }
  }

  /// 先月と比べた支出の差。先月の支出の記録がなければ比べない。
  public static func monthComparison(_ expenses: [Expense], month: String) -> Comparison {
    let previousMonth = CalendarDate.shiftMonth(month, -1) ?? month
    let previous = Ledger.month(expenses, monthKey: previousMonth)
    if previous.count == 0 { return Comparison(previousMonth: previousMonth, differenceJpy: nil) }
    return Comparison(previousMonth: previousMonth, differenceJpy: Ledger.month(expenses, monthKey: month).totalJpy - previous.totalJpy)
  }

  public struct BalanceOf: Sendable, Hashable, Encodable {
    public var percent: Int?
    public var leftJpy: Int
    public var overJpy: Int
    public func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(percent, forKey: .percent)
      try container.encode(leftJpy, forKey: .leftJpy)
      try container.encode(overJpy, forKey: .overJpy)
    }
    enum CodingKeys: String, CodingKey { case percent, leftJpy, overJpy }
  }

  /// 収入のうち支出に使った割合。収入の記録がないときは割合を出さない。
  public static func balanceOf(spending: Int, income: Int) -> BalanceOf {
    let over = max(0, spending - income)
    if income == 0 { return BalanceOf(percent: nil, leftJpy: 0, overJpy: over) }
    return BalanceOf(percent: Int(floor(Double(spending) / Double(income) * 100)), leftJpy: max(0, income - spending), overJpy: over)
  }

  public struct MemberTotal: Codable, Sendable, Hashable {
    public var membershipId: Id
    public var paidJpy: Int
    public var burdenJpy: Int
    public var differenceJpy: Int
  }

  /// 月の支出について、人ごとの支払った額と負担する額。精算は含めない。
  public static func memberTotals(_ expenses: [Expense], month: String, memberships: [HouseholdMembership]) -> [MemberTotal] {
    var paid: [Id: Int] = [:], burden: [Id: Int] = [:], seen: [Id] = []
    func note(_ id: Id) { if !seen.contains(id) { seen.append(id) } }
    for expense in expenses where expense.kind != .income && expense.deletedAt == nil && expense.incurredOn.hasPrefix("\(month)-") {
      paid[expense.payerMembershipId, default: 0] += expense.amountJpy
      for share in expense.shares { burden[share.membershipId, default: 0] += share.amountJpy }
    }
    // Web は支払いの人を先に、負担の人を後に集めてから並べる。
    for expense in expenses where expense.kind != .income && expense.deletedAt == nil && expense.incurredOn.hasPrefix("\(month)-") { note(expense.payerMembershipId) }
    for expense in expenses where expense.kind != .income && expense.deletedAt == nil && expense.incurredOn.hasPrefix("\(month)-") { expense.shares.forEach { note($0.membershipId) } }
    let order = memberships.map(\.id)
    let rank = { (id: Id) in order.firstIndex(of: id) ?? order.count }
    return seen.stableSorted { a, b in rank(a) != rank(b) ? rank(a) < rank(b) : jsLocaleCompare(a, b) < 0 }.map { id in
      MemberTotal(membershipId: id, paidJpy: paid[id] ?? 0, burdenJpy: burden[id] ?? 0, differenceJpy: (paid[id] ?? 0) - (burden[id] ?? 0))
    }
  }

  /// 残りのある記録。月によらず、古いものから。
  public static func openExpenses(_ expenses: [Expense]) -> [Expense] {
    expenses.filter { $0.deletedAt == nil && Ledger.remainingTotal($0) > 0 }
      .stableSorted { a, b in
        let byDate = jsLocaleCompare(a.incurredOn, b.incurredOn)
        return byDate != 0 ? byDate < 0 : jsLocaleCompare(a.id, b.id) < 0
      }
  }

  // MARK: 推移（budgetTrend.ts）

  public struct TrendMonth: Codable, Sendable, Hashable, Identifiable {
    public var month: String
    public var spendingJpy: Int
    public var incomeJpy: Int
    public var hasRecords: Bool
    public var id: String { month }
  }

  public struct Trend: Codable, Sendable, Hashable {
    public var months: [TrendMonth]
    public var showIncome: Bool
    public var monthsWithRecords: Int
    /// 推移として描けるか。記録のある月が2か月以上。
    public var drawable: Bool { monthsWithRecords >= 2 }
  }

  public static let trendMonths = 6

  public static func trend(_ expenses: [Expense], endMonth: String, count: Int = trendMonths) -> Trend {
    let months = (0..<count).map { CalendarDate.shiftMonth(endMonth, $0 - count + 1) ?? endMonth }.map { month in
      let spending = Ledger.month(expenses, monthKey: month), income = Ledger.monthIncome(expenses, monthKey: month)
      return TrendMonth(month: month, spendingJpy: spending.totalJpy, incomeJpy: income.totalJpy, hasRecords: spending.count + income.count > 0)
    }
    return Trend(months: months, showIncome: months.contains { $0.incomeJpy > 0 }, monthsWithRecords: months.filter(\.hasRecords).count)
  }
}
