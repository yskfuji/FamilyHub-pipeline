import Foundation
import FHModel
import FHCopy

// 家計の画面の状態と一覧。元: src/domain/budgetView.ts。

public enum BudgetViewKind: String, CaseIterable, Sendable, Codable {
  case overview, list, members, settlements
  public var label: String {
    let labels = Copy.ja.ja.budgetView.self
    return switch self { case .overview: labels.overview; case .list: labels.list; case .members: labels.members; case .settlements: labels.settlements }
  }
}

public enum BudgetPeriod: String, CaseIterable, Sendable, Codable { case month, week, custom }

public enum BudgetSort: String, CaseIterable, Sendable, Codable {
  case dateNew = "date-new", dateOld = "date-old", amountHigh = "amount-high", amountLow = "amount-low", category, payer
  public var label: String { Copy.ja.ja.budgetSort[rawValue] ?? rawValue }
}

public struct DateRange: Codable, Sendable, Hashable {
  public var start: String
  public var end: String
  public init(start: String, end: String) { self.start = start; self.end = end }
}

public struct LedgerGroup: Sendable, Hashable, Identifiable {
  /// 日付の順でないときは nil。区切らず1つにまとめる。
  public var date: String?
  public var items: [Expense]
  public var expenseJpy: Int
  public var incomeJpy: Int
  public var id: String { date ?? "all" }
}

public enum BudgetList {
  /// 移動できる最後の月。今月より先の日付の記録があれば、その月まで開ける。
  public static func latestMonth(_ expenses: [Expense], currentMonth: String) -> String {
    expenses.reduce(currentMonth) { latest, expense in
      let month = String(expense.incurredOn.prefix(7))
      return month > latest ? month : latest
    }
  }

  public static func monthRange(_ month: String) -> DateRange {
    DateRange(start: "\(month)-01", end: CalendarDate.addDays("\(CalendarDate.shiftMonth(month, 1) ?? month)-01", -1) ?? "\(month)-28")
  }

  /// 一覧に出す期間。週は日曜はじまりで月の中に切り詰める。今月なら今日を含む週、ほかの月なら最初の週。
  public static func range(month: String, period: BudgetPeriod, from: String?, to: String?, today: String) -> DateRange {
    let whole = monthRange(month)
    if period == .week {
      let days = CalendarDate.weekDates(today.hasPrefix("\(month)-") ? today : whole.start)
      return DateRange(start: days[0] > whole.start ? days[0] : whole.start, end: days[6] < whole.end ? days[6] : whole.end)
    }
    if period == .custom, let from, let to, !from.isEmpty, !to.isEmpty {
      return from <= to ? DateRange(start: from, end: to) : DateRange(start: to, end: from)
    }
    return whole
  }

  public static func filter(_ expenses: [Expense], range: DateRange, category: ExpenseCategory?) -> [Expense] {
    expenses.filter { $0.incurredOn >= range.start && $0.incurredOn <= range.end && (category == nil || $0.category == category) }
  }

  static func newestFirst(_ a: Expense, _ b: Expense) -> Int {
    let byDate = jsLocaleCompare(b.incurredOn, a.incurredOn)
    return byDate != 0 ? byDate : jsLocaleCompare(b.id, a.id)
  }

  /// 並べる。同じ値どうしは日付の新しい順。支払った人はメンバーの並びに合わせる。
  public static func sort(_ expenses: [Expense], _ sort: BudgetSort, memberOrder: [Id]) -> [Expense] {
    let rank = { (id: Id) in memberOrder.firstIndex(of: id) ?? memberOrder.count }
    let categoryRank = { (category: ExpenseCategory) in Budget.categoryOrder.firstIndex(of: category) ?? -1 }
    let compare: (Expense, Expense) -> Int = switch sort {
    case .dateNew: newestFirst
    case .dateOld: { a, b in
      let byDate = jsLocaleCompare(a.incurredOn, b.incurredOn)
      return byDate != 0 ? byDate : jsLocaleCompare(a.id, b.id)
    }
    case .amountHigh: { a, b in b.amountJpy != a.amountJpy ? b.amountJpy - a.amountJpy : newestFirst(a, b) }
    case .amountLow: { a, b in a.amountJpy != b.amountJpy ? a.amountJpy - b.amountJpy : newestFirst(a, b) }
    case .category: { a, b in categoryRank(a.category) != categoryRank(b.category) ? categoryRank(a.category) - categoryRank(b.category) : newestFirst(a, b) }
    case .payer: { a, b in rank(a.payerMembershipId) != rank(b.payerMembershipId) ? rank(a.payerMembershipId) - rank(b.payerMembershipId) : newestFirst(a, b) }
    }
    return expenses.stableSorted { compare($0, $1) < 0 }
  }

  /// 日付の順では日ごとに区切って合計を出す。ほかの順では区切らない。
  public static func groups(_ sorted: [Expense], _ sort: BudgetSort) -> [LedgerGroup] {
    let byDate = sort == .dateNew || sort == .dateOld
    var groups: [LedgerGroup] = []
    for expense in sorted {
      let date = byDate ? expense.incurredOn : nil
      if groups.isEmpty || groups[groups.count - 1].date != date { groups.append(LedgerGroup(date: date, items: [], expenseJpy: 0, incomeJpy: 0)) }
      groups[groups.count - 1].items.append(expense)
      if expense.kind == .income { groups[groups.count - 1].incomeJpy += expense.amountJpy } else { groups[groups.count - 1].expenseJpy += expense.amountJpy }
    }
    return groups
  }
}
