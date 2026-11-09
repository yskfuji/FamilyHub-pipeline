import Foundation
import FHModel

/// 今日の画面に出す中身。元: src/domain/todayDigest.ts（Web の今日の画面と同じ計算。答えは VectorTests で照らす）。
public struct TodayDigest: Sendable {
  public struct Event: Sendable, Identifiable {
    public var event: CalendarEvent
    /// その回の開始日時。
    public var startsAt: Rfc3339
    public var minutes: Double
    public var id: Id { event.id }
  }

  public enum Kind: String, Sendable { case event = "予定", task = "タスク" }

  public struct Item: Sendable, Identifiable, Equatable {
    public var key: String
    public var at: Rfc3339
    public var minutes: Double
    public var title: String
    public var meta: String
    public var href: String
    public var targetId: Id
    public var kind: Kind
    public var id: String { key }
  }

  public var today: IsoDate
  public var now: Int
  public var greeting: String
  public var mine: [Todo]
  public var unsettled: Ledger.Summary
  public var spentThisMonth: Ledger.Summary
  public var reviewTodo: Todo?
  public var events: [Event]
  public var affected: [Event]
  public var showWeather: Bool
  public var timeline: [Item]
  public var upcoming: Item?
  public var nextTask: Todo?
  public var attention: Int
  public var empty: Bool

  /// 0時からの分（日本時間）。
  public static func minutesOfDay(_ value: String) -> Int {
    guard let date = Tokyo.parse(value) else { return 0 }
    let parts = Tokyo.components(of: date)
    return parts.hour * 60 + parts.minute
  }

  public static func greeting(_ asOf: String) -> String {
    let hour = minutesOfDay(asOf) / 60
    return hour < 10 ? "おはよう" : hour < 18 ? "こんにちは" : "こんばんは"
  }

  public static func milliseconds(_ value: String) -> Double { (Tokyo.parse(value)?.timeIntervalSince1970 ?? 0) * 1000 }

  /// 今日に当たる回（繰り返しを含む）を、その回の開始日時と長さ付きで返す。
  public static func todaysEvents(_ events: [CalendarEvent], today: String) -> [Event] {
    events.compactMap { event in
      guard let start = CalendarDate.dateKey(fromRfc3339: event.startsAt) else { return nil }
      let hit = event.recurrence.map { !Recurrence.occurrenceDates(start: start, recurrence: $0, from: today, to: today).isEmpty } ?? (start == today)
      guard hit else { return nil }
      let minutes = max(0, (milliseconds(event.endsAt) - milliseconds(event.startsAt)) / 60_000)
      return Event(event: event, startsAt: Recurrence.occurrenceStartsAt(event.startsAt, on: today), minutes: minutes)
    }
  }

  public init(snapshot: HouseholdSnapshot, scoped: MemberScope.Scoped) {
    let asOf = snapshot.context.asOf
    let weather = snapshot.context.weather
    let today = CalendarDate.dateKey(fromRfc3339: asOf) ?? ""
    let me = snapshot.viewer.membershipId
    let name = { (id: Id?) in memberName(snapshot.memberships, id) }
    let mine = scoped.todos.filter { $0.assigneeMembershipId == me && $0.status != .done }.stableSorted { ($0.dueAt ?? "9") < ($1.dueAt ?? "9") }
    let reviewTodo = scoped.todos.first { $0.status == .review && ($0.reviewerMembershipId == me || $0.assigneeMembershipId == me) }
    let events = Self.todaysEvents(scoped.events, today: today)
    let affected = events.filter { $0.event.weatherSensitive == true }
    // 「次にすること」には、今日の予定に影響する天気だけを出す。
    let showWeather = weather.condition != .sunny && !(weather.alert ?? "").isEmpty && !affected.isEmpty
    let eventItems = events.map { item in
      Item(key: "event-\(item.id)", at: item.startsAt, minutes: item.minutes, title: item.event.title, meta: item.event.location ?? name(item.event.ownerMembershipId), href: "/calendar/\(item.id)?on=\(today)", targetId: item.id, kind: .event)
    }
    let todoItems = scoped.todos.filter { $0.status != .done && $0.dueAt.flatMap(CalendarDate.dateKey(fromRfc3339:)) == today }.map { todo in
      Item(key: "todo-\(todo.id)", at: todo.dueAt!, minutes: 0, title: todo.title, meta: "担当：\(name(todo.assigneeMembershipId))", href: "/tasks/\(todo.id)", targetId: todo.id, kind: .task)
    }
    let timeline = (eventItems + todoItems).stableSorted { $0.at < $1.at }
    let upcoming = timeline.first { Self.milliseconds($0.at) >= Self.milliseconds(asOf) && $0.targetId != reviewTodo?.id }
    self.today = today
    self.now = Self.minutesOfDay(asOf)
    self.greeting = Self.greeting(asOf)
    self.mine = mine
    self.reviewTodo = reviewTodo
    self.events = events
    self.affected = affected
    self.showWeather = showWeather
    self.timeline = timeline
    self.upcoming = upcoming
    self.nextTask = upcoming == nil ? mine.first { $0.id != reviewTodo?.id } : nil
    self.unsettled = Ledger.unsettled(scoped.expenses)
    self.spentThisMonth = Ledger.month(scoped.expenses, monthKey: String(today.prefix(7)))
    self.attention = (reviewTodo == nil ? 0 : 1) + (showWeather ? 1 : 0)
    self.empty = snapshot.events.count + snapshot.todos.count + snapshot.expenses.count == 0
  }

  /// 時刻の帯の目盛りと段。
  public var strip: TimeStrip.Layout {
    TimeStrip.layout(timeline.map { TimeStrip.Mark(start: Double(Self.minutesOfDay($0.at)), minutes: $0.minutes) }, now: Double(now))
  }
}
