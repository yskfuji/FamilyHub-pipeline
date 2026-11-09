import Foundation
import FHModel

// カレンダーの見出しと日時の説明、日を動かすキー。元: src/features/calendar/calendarLabels.ts と src/domain/calendarDate.ts。

public enum CalendarView: String, CaseIterable, Sendable, Codable {
  case month, week, day, list

  public var label: String {
    switch self {
    case .month: "月"
    case .week: "週"
    case .day: "日"
    case .list: "一覧"
    }
  }

  /// 前・今・次のボタンの文言。
  public var stepLabels: (previous: String, current: String, next: String) {
    switch self {
    case .month, .list: ("前月", "今月", "次月")
    case .week: ("前週", "今週", "次週")
    case .day: ("前日", "今日", "翌日")
    }
  }
}

/// 月の表の中で日を動かすキー（iPad のキーボード）。
public enum CalendarDayKey: String, CaseIterable, Sendable {
  case left = "ArrowLeft", right = "ArrowRight", up = "ArrowUp", down = "ArrowDown"
  case home = "Home", end = "End", pageUp = "PageUp", pageDown = "PageDown"
}

extension CalendarDate {
  /// 実在する日付の鍵か。
  public static func isDateKey(_ value: String?) -> Bool {
    guard let value, value.count == 10, value.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil,
          isMonthKey(String(value.prefix(7))) else { return false }
    return addDays(value, 0) == value
  }

  /// 同じ日のある月へ移す。その日がない月では月末にする（1月31日の次の月は2月28日）。
  static func shiftDateMonth(_ dateKey: String, _ delta: Int) -> String {
    guard let month = shiftMonth(String(dateKey.prefix(7)), delta) else { return dateKey }
    let last = CalendarLayout.lastDayOfMonth(month)
    let day = min(Int(dateKey.suffix(2)) ?? 1, Int(last.suffix(2)) ?? 28)
    return String(format: "%@-%02d", month, day)
  }

  /// キーで動かした先の日。Home と End はその週の日曜と土曜、PageUp と PageDown は前後の月。
  public static func moved(_ dateKey: String, _ key: CalendarDayKey) -> String {
    let weekday = CivilDate(key: dateKey)?.weekday ?? 0
    switch key {
    case .left: return addDays(dateKey, -1) ?? dateKey
    case .right: return addDays(dateKey, 1) ?? dateKey
    case .up: return addDays(dateKey, -7) ?? dateKey
    case .down: return addDays(dateKey, 7) ?? dateKey
    case .home: return addDays(dateKey, -weekday) ?? dateKey
    case .end: return addDays(dateKey, 6 - weekday) ?? dateKey
    case .pageUp: return shiftDateMonth(dateKey, -1)
    case .pageDown: return shiftDateMonth(dateKey, 1)
    }
  }
}

public enum CalendarText {
  /// 9月30日(水)。
  public static func day(_ date: String) -> String {
    CivilDate(key: date).map(Format.monthDay) ?? date
  }

  public static func timezone(_ timezone: String) -> String { timezone == "Asia/Tokyo" ? "日本時間" : timezone }

  /// 2026年9月。
  public static func month(_ monthKey: String) -> String {
    let parts = monthKey.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return monthKey }
    return "\(parts[0])年\(parts[1])月"
  }

  /// 2026年9月30日(水)。
  public static func yearDay(_ date: String) -> String { "\(Int(date.prefix(4)) ?? 0)年\(day(date))" }

  /// 2026年9月27日〜10月3日。
  public static func week(_ dates: [String]) -> String {
    guard let first = dates.first, let last = dates.last else { return "" }
    let strip = { (text: String) in text.replacingOccurrences(of: #"\(.\)$"#, with: "", options: .regularExpression) }
    return "\(Int(first.prefix(4)) ?? 0)年\(strip(day(first)))〜\(strip(day(last)))"
  }

  /// 画面の見出し。
  public static func heading(view: CalendarView, monthKey: String, anchor: String) -> String {
    switch view {
    case .week: week(CalendarDate.weekDates(anchor))
    case .day: yearDay(anchor)
    case .month, .list: month(monthKey)
    }
  }

  public enum Tone: String, Sendable { case holiday, saturday }

  /// 日の色分け。日曜と祝日は赤、土曜は青。
  public static func tone(_ date: String, holiday: String?) -> Tone? {
    let weekday = CivilDate(key: date)?.weekday ?? 1
    if holiday != nil || weekday == 0 { return .holiday }
    return weekday == 6 ? .saturday : nil
  }

  public static func holidayMap(_ from: String, _ to: String) -> [String: String] {
    Dictionary(Holidays.between(from, to).map { ($0.date, $0.name) }, uniquingKeysWith: { first, _ in first })
  }

  /// 予定の日時の説明。
  public static func when(_ occurrence: Occurrence) -> String {
    let last = CalendarLayout.lastDate(occurrence)
    let multiDay = last > occurrence.occurrenceDate
    let first = day(occurrence.occurrenceDate)
    if occurrence.allDay == true { return "\(first)\(multiDay ? "〜\(day(last))" : "")（終日）" }
    if multiDay { return "\(first) \(Format.time(occurrence.startsAt))〜\(day(last)) \(Format.time(occurrence.endsAt))" }
    return "\(first) \(Format.time(occurrence.startsAt))〜\(Format.time(occurrence.endsAt))"
  }

  /// 日の一覧の時刻の欄。
  public static func time(_ occurrence: Occurrence, on date: String) -> String {
    if occurrence.allDay == true { return "終日" }
    let first = occurrence.occurrenceDate == date
    let last = CalendarLayout.lastDate(occurrence) == date
    if first { return Format.time(occurrence.startsAt) }
    return last ? "〜\(Format.time(occurrence.endsAt))" : "終日"
  }

  /// 通知の時刻の表示（10分前・1時間前・1日前）。
  public static func reminder(_ minutes: Int) -> String {
    if minutes % 1440 == 0 { return "\(minutes / 1440)日前" }
    if minutes % 60 == 0 { return "\(minutes / 60)時間前" }
    return "\(minutes)分前"
  }
}
