import Foundation
import FHModel

/// 季節。元: src/domain/season.ts。3〜5月が春、6〜8月が夏、9〜11月が秋、12〜2月が冬。
public enum Season: String, Sendable, CaseIterable, Codable {
  case spring, summer, autumn, winter

  public init(dateOrMonthKey key: String) {
    let month = Int(key.dropFirst(5).prefix(2)) ?? 0
    switch month {
    case 3...5: self = .spring
    case 6...8: self = .summer
    case 9...11: self = .autumn
    default: self = .winter
    }
  }
}

/// 時刻の帯。元: src/domain/timeStrip.ts。
public enum TimeStrip {
  public struct Mark: Sendable, Equatable, Decodable {
    public var start: Double
    public var minutes: Double
    public init(start: Double, minutes: Double) { self.start = start; self.minutes = minutes }
  }

  public struct Layout: Sendable, Equatable, Decodable {
    public var from: Int
    public var to: Int
    public var ticks: [Int]
    public var lanes: [Int]
    public var laneCount: Int

    /// 帯の上の位置（0〜1）。範囲の外は端にそろえる。
    public func position(_ minutes: Double) -> Double {
      (min(Double(to), max(Double(from), minutes)) - Double(from)) / Double(to - from)
    }
  }

  /// 重なって見える印を別の段に分ける。
  public static func lanes(_ marks: [Mark], range: Double) -> [Int] {
    let least = range / 24
    var ends: [Double] = []
    return marks.map { mark in
      let left = mark.minutes > 0 ? mark.start : mark.start - least / 2
      let right = max(left + least, mark.start + mark.minutes)
      if let lane = ends.firstIndex(where: { $0 <= left }) { ends[lane] = right; return lane }
      ends.append(right)
      return ends.count - 1
    }
  }

  public static func layout(_ marks: [Mark], now: Double) -> Layout {
    let first = ([6 * 60] + marks.map(\.start)).min()!
    let last = ([22 * 60, now] + marks.map { $0.start + $0.minutes }).max()!
    let from = Int(floor(first / 180)) * 180
    let to = min(24 * 60, Int(ceil(last / 180)) * 180)
    let ticks = Array(stride(from: from, to: to, by: 180))
    let lanes = lanes(marks, range: Double(to - from))
    return Layout(from: from, to: to, ticks: ticks, lanes: lanes, laneCount: max(1, (lanes.map { $0 + 1 }.max() ?? 0)))
  }
}

/// 表示を絞る相手。元: src/domain/memberScope.ts。"all" はすべて、"me" は見ている本人、それ以外はメンバーの ID。
public enum MemberScope {
  public struct Choice: Sendable, Equatable, Decodable, Identifiable {
    public var value: String
    public var label: String
    public var id: String { value }
  }

  public static func parse(_ value: String?) -> String { (value?.isEmpty ?? true) ? "all" : value! }

  /// 絞る相手のメンバー ID。すべてなら nil。停止中や退出済みのメンバーなら、すべてに戻す。
  public static func scopedMemberId(_ scope: String, viewerId: Id, memberships: [HouseholdMembership]) -> Id? {
    if scope == "all" { return nil }
    if scope == "me" { return viewerId }
    return memberships.contains { $0.id == scope && $0.status == .active } ? scope : nil
  }

  public static func choices(viewerId: Id, memberships: [HouseholdMembership]) -> [Choice] {
    [Choice(value: "all", label: "すべて"), Choice(value: "me", label: "自分")]
      + memberships.filter { $0.status == .active && $0.id != viewerId }.map { Choice(value: $0.id, label: $0.displayName) }
  }

  /// 選択肢に合わせた値。保存したメンバーが選べないときは all。
  public static func shown(_ scope: String, viewerId: Id, memberships: [HouseholdMembership]) -> String {
    scope == "me" || scopedMemberId(scope, viewerId: viewerId, memberships: memberships) != nil ? scope : "all"
  }

  public static func involves(_ event: CalendarEvent, _ id: Id) -> Bool {
    event.ownerMembershipId == id || event.visibility.creatorMembershipId == id || event.participantMembershipIds.contains(id)
  }
  public static func involves(_ todo: Todo, _ id: Id) -> Bool {
    todo.creatorMembershipId == id || todo.assigneeMembershipId == id || todo.reviewerMembershipId == id
  }
  public static func involves(_ memo: Memo, _ id: Id) -> Bool { memo.authorMembershipId == id }
  public static func involves(_ expense: Expense, _ id: Id) -> Bool {
    expense.creatorMembershipId == id || expense.payerMembershipId == id || expense.shares.contains { $0.membershipId == id }
  }

  /// 表示する人で絞った記録（src/app/useMemberScope.ts）。
  public struct Scoped: Sendable {
    public var memberId: Id?
    public var events: [CalendarEvent]
    public var todos: [Todo]
    public var memos: [Memo]
    public var expenses: [Expense]
  }

  public static func scoped(_ snapshot: HouseholdSnapshot, scope: String) -> Scoped {
    let id = scopedMemberId(scope, viewerId: snapshot.viewer.membershipId, memberships: snapshot.memberships)
    guard let id else { return Scoped(memberId: nil, events: snapshot.events, todos: snapshot.todos, memos: snapshot.memos, expenses: snapshot.expenses) }
    return Scoped(
      memberId: id,
      events: snapshot.events.filter { involves($0, id) },
      todos: snapshot.todos.filter { involves($0, id) },
      memos: snapshot.memos.filter { involves($0, id) },
      expenses: snapshot.expenses.filter { involves($0, id) }
    )
  }
}

/// 家計の集計（一部）。元: src/domain/ledger.ts。入力は閲覧者に見えている支出。
public enum Ledger {
  public struct Summary: Sendable, Hashable, Codable {
    public var totalJpy: Int
    public var count: Int
  }

  static func live(_ expenses: [Expense]) -> [Expense] { expenses.filter { $0.deletedAt == nil } }
  static func spending(_ expenses: [Expense]) -> [Expense] { live(expenses).filter { $0.kind != .income } }

  /// 支払った人以外の負担のうち、まだ精算されていない額。
  public static func remaining(_ expense: Expense) -> [(membershipId: Id, amountJpy: Int)] {
    expense.shares
      .filter { $0.membershipId != expense.payerMembershipId }
      .map { (membershipId: $0.membershipId, amountJpy: max(0, $0.amountJpy - $0.settledJpy)) }
      .filter { $0.amountJpy > 0 }
  }
  public static func remainingTotal(_ expense: Expense) -> Int { remaining(expense).reduce(0) { $0 + $1.amountJpy } }

  public static func unsettled(_ expenses: [Expense]) -> Summary {
    let open = live(expenses).filter { remainingTotal($0) > 0 }
    return Summary(totalJpy: open.reduce(0) { $0 + remainingTotal($1) }, count: open.count)
  }

  public static func month(_ expenses: [Expense], monthKey: String) -> Summary {
    let inMonth = spending(expenses).filter { $0.incurredOn.hasPrefix("\(monthKey)-") }
    return Summary(totalJpy: inMonth.reduce(0) { $0 + $1.amountJpy }, count: inMonth.count)
  }

  public static func monthIncome(_ expenses: [Expense], monthKey: String) -> Summary {
    let inMonth = live(expenses).filter { $0.kind == .income && $0.incurredOn.hasPrefix("\(monthKey)-") }
    return Summary(totalJpy: inMonth.reduce(0) { $0 + $1.amountJpy }, count: inMonth.count)
  }
}

/// メンバーの表示名。見えない人や退出した人は「非公開」。元: src/domain/memberName.ts。
public func memberName(_ memberships: [HouseholdMembership], _ id: Id?) -> String {
  memberships.first { $0.id == id }?.displayName ?? "非公開"
}

extension Array {
  /// JS の Array.prototype.sort と同じく、同じ順位のものは元の順を保つ。
  func stableSorted(by less: (Element, Element) -> Bool) -> [Element] {
    enumerated().sorted { a, b in
      if less(a.element, b.element) { return true }
      if less(b.element, a.element) { return false }
      return a.offset < b.offset
    }.map(\.element)
  }
}
