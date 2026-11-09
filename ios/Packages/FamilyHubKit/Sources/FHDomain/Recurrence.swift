import Foundation
import FHModel

/// 繰り返し規則（RFC 5545 RRULE の一部）を、表示する範囲の分だけ日付に展開する。元: src/domain/recurrence.ts。
/// 対応しない規則は nil にし、呼び出し側は最初の1回だけを扱う（推測で展開しない）。
public enum Recurrence {
  public enum Frequency: String, Sendable { case daily = "DAILY", weekly = "WEEKLY", monthly = "MONTHLY" }

  public struct Rule: Sendable, Equatable {
    public var freq: Frequency
    public var interval: Int
    public var byDay: [Int]
    public var byMonthDay: [Int]
    public var bySetPos: Int?
    public var until: String?
    public var count: Int?
  }

  static let dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
  static let dayLabels = ["日", "月", "火", "水", "木", "金", "土"]
  static let maxDailySteps = 40_000
  static let maxMonthSteps = 2_400

  /// 毎月の末日。31日がない月は月の最後の日になり、翌月以降へずれない。
  public static let lastDayOfMonthRule = "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1"

  /// JS の Number(文字列)。空なら 0、読めなければ nil（NaN）。
  static func jsNumber(_ text: String?) -> Double? {
    guard let text else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return 0 }
    guard trimmed.allSatisfy({ "0123456789+-.eE".contains($0) }) else { return nil }
    return Double(trimmed)
  }
  static func integer(_ value: Double?) -> Int? {
    guard let value, value.isFinite, value.rounded() == value, abs(value) < 1e15 else { return nil }
    return Int(value)
  }

  public static func parse(_ rrule: String) -> Rule? {
    var parts: [String: String?] = [:]
    var order: [String] = []
    for part in rrule.split(separator: ";", omittingEmptySubsequences: false) {
      let pieces = part.split(separator: "=", omittingEmptySubsequences: false).map(String.init)
      let key = pieces[0]
      if parts[key] == nil { order.append(key) }
      parts[key] = pieces.count > 1 ? pieces[1] : String?.none
    }
    func get(_ key: String) -> String? { parts[key] ?? nil }
    guard let freqRaw = get("FREQ"), let freq = Frequency(rawValue: freqRaw) else { return nil }
    for key in order where !["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYSETPOS", "UNTIL", "COUNT"].contains(key) { return nil }
    guard let interval = integer(jsNumber(get("INTERVAL") ?? "1")), interval >= 1, interval <= 366 else { return nil }
    var byDay: [Int] = []
    if let raw = get("BYDAY"), !raw.isEmpty {
      byDay = raw.split(separator: ",", omittingEmptySubsequences: false).map { dayCodes.firstIndex(of: String($0)) ?? -1 }
    }
    if byDay.contains(where: { $0 < 0 }) || (!byDay.isEmpty && freq != .weekly) { return nil }
    var byMonthDay: [Int] = []
    if let raw = get("BYMONTHDAY"), !raw.isEmpty {
      var values: [Int] = []
      for piece in raw.split(separator: ",", omittingEmptySubsequences: false) {
        guard let value = integer(jsNumber(String(piece))), (1...31).contains(value) else { return nil }
        values.append(value)
      }
      byMonthDay = values
    }
    if !byMonthDay.isEmpty && freq != .monthly { return nil }
    var bySetPos: Int?
    if parts.keys.contains("BYSETPOS") {
      guard let value = integer(jsNumber(get("BYSETPOS"))), value == 1 || value == -1, !byMonthDay.isEmpty else { return nil }
      bySetPos = value
    }
    var until: String?
    if let raw = get("UNTIL"), !raw.isEmpty {
      guard let match = raw.prefixMatch(of: /(\d{4})(\d{2})(\d{2})/) else { return nil }
      until = "\(match.1)-\(match.2)-\(match.3)"
    }
    var count: Int?
    if parts.keys.contains("COUNT") {
      guard let value = integer(jsNumber(get("COUNT"))), value >= 1 else { return nil }
      count = value
    }
    return Rule(freq: freq, interval: interval, byDay: Array(Set(byDay)).sorted(), byMonthDay: Array(Set(byMonthDay)).sorted(), bySetPos: bySetPos, until: until, count: count)
  }

  static func weekday(_ key: String) -> Int { CivilDate(key: key)?.weekday ?? 0 }
  static func add(_ key: String, _ days: Int) -> String { CalendarDate.addDays(key, days) ?? key }

  /// 月の数を足した年と月（Date.UTC と同じく、月が 12 を超えたら次の年へ）。
  static func shiftedMonth(year: Int, month: Int, by delta: Int) -> (year: Int, month: Int) {
    let total = year * 12 + (month - 1) + delta
    let y = Int(floor(Double(total) / 12))
    return (y, total - y * 12 + 1)
  }
  static func daysIn(year: Int, month: Int) -> Int {
    let next = shiftedMonth(year: year, month: month, by: 1)
    return CivilDate(year: next.year, month: next.month, day: 1).daysSinceEpoch - CivilDate(year: year, month: month, day: 1).daysSinceEpoch
  }

  /// 規則に従う候補の日付を、古い順に渡す。visit が false を返したら止める。
  static func candidates(_ start: String, _ rule: Rule, _ visit: (String) -> Bool) {
    switch rule.freq {
    case .daily:
      for index in 0..<maxDailySteps where !visit(add(start, index * rule.interval)) { return }
    case .weekly:
      let days = rule.byDay.isEmpty ? [weekday(start)] : rule.byDay
      let weekStart = add(start, -weekday(start))
      var week = 0
      while week < maxDailySteps {
        for day in days {
          let date = add(weekStart, week * 7 + day)
          if date >= start, !visit(date) { return }
        }
        week += rule.interval
      }
    case .monthly:
      guard let first = CivilDate(key: start) else { return }
      for index in 0..<maxMonthSteps {
        let (year, month) = shiftedMonth(year: first.year, month: first.month, by: index * rule.interval)
        if !rule.byMonthDay.isEmpty {
          let length = daysIn(year: year, month: month)
          let days = rule.byMonthDay.filter { $0 <= length }
          let picked: [Int] = switch rule.bySetPos {
          case .some(1): Array(days.prefix(1))
          case .some(-1): Array(days.suffix(1))
          default: days
          }
          for value in picked {
            let date = CivilDate(year: year, month: month, day: value).key
            if date >= start, !visit(date) { return }
          }
          continue
        }
        // 31日などがない月は飛ばす（RFC 5545 と同じ扱い）。
        if first.day > daysIn(year: year, month: month) { continue }
        if !visit(CivilDate(year: year, month: month, day: first.day).key) { return }
      }
    }
  }

  /// 開始日から規則に従う日付のうち、[from, to] に入り、例外日を除いたもの。
  public static func occurrenceDates(start: String, recurrence: RecurrenceRule, from: String, to: String) -> [String] {
    guard let rule = parse(recurrence.rrule) else { return start >= from && start <= to ? [start] : [] }
    let exceptions = Set(recurrence.exceptions)
    var result: [String] = []
    var produced = 0
    candidates(start, rule) { date in
      if let until = rule.until, date > until { return false }
      if let count = rule.count, produced >= count { return false }
      produced += 1 // COUNT は例外日を除く前の回数で数える（RFC 5545）
      if date > to { return false }
      if date >= from, !exceptions.contains(date) { result.append(date) }
      return true
    }
    return result
  }

  public static func isOccurrence(start: String, recurrence: RecurrenceRule, on date: String) -> Bool {
    occurrenceDates(start: start, recurrence: recurrence, from: date, to: date).count == 1
  }

  /// date より後の最初の回。
  public static func nextOccurrence(start: String, recurrence: RecurrenceRule, after date: String) -> String? {
    occurrenceDates(start: start, recurrence: recurrence, from: add(date, 1), to: add(date, 800)).first
  }

  /// 規則の UNTIL を置き換える（COUNT は外す）。
  public static func withUntil(_ rrule: String, _ untilKey: String) -> String {
    let kept = rrule.split(separator: ";", omittingEmptySubsequences: false).filter { !$0.hasPrefix("UNTIL=") && !$0.hasPrefix("COUNT=") }.map(String.init)
    return (kept + ["UNTIL=\(untilKey.replacingOccurrences(of: "-", with: ""))"]).joined(separator: ";")
  }

  /// 分割した後半のシリーズの規則。COUNT があれば、前半で消化した回数を差し引く。
  public static func remainderRule(start: String, recurrence: RecurrenceRule, split: String) -> String {
    guard let count = parse(recurrence.rrule)?.count else { return recurrence.rrule }
    var plain = recurrence
    plain.exceptions = []
    let before = occurrenceDates(start: start, recurrence: plain, from: start, to: add(split, -1)).count
    let rest = max(1, count - before)
    return recurrence.rrule.split(separator: ";", omittingEmptySubsequences: false).map { $0.hasPrefix("COUNT=") ? "COUNT=\(rest)" : String($0) }.joined(separator: ";")
  }

  /// 「毎週水曜」「2週間ごと（火・木）」「毎月15日」などの表示名。
  public static func describe(start: String, recurrence: RecurrenceRule) -> String {
    guard let rule = parse(recurrence.rrule) else { return "繰り返し" }
    let days = (rule.byDay.isEmpty ? [weekday(start)] : rule.byDay).map { dayLabels[$0] }.joined(separator: "・")
    let base: String
    switch rule.freq {
    case .daily: base = rule.interval == 1 ? "毎日" : "\(rule.interval)日ごと"
    case .weekly: base = rule.interval == 1 ? "毎週\(days)曜" : "\(rule.interval)週間ごと（\(days)曜）"
    case .monthly:
      let prefix = rule.interval == 1 ? "毎月" : "\(rule.interval)か月ごと"
      let day = rule.byMonthDay.isEmpty ? "\(Int(start.dropFirst(8).prefix(2)) ?? 0)日" : (rule.bySetPos == -1 ? "末日" : "\(rule.byMonthDay.map(String.init).joined(separator: "・"))日")
      base = prefix + day
    }
    if let until = rule.until { return "\(base)・\(Int(until.dropFirst(5).prefix(2)) ?? 0)月\(Int(until.dropFirst(8).prefix(2)) ?? 0)日まで" }
    if let count = rule.count { return "\(base)・\(count)回" }
    return base
  }

  /// 回の開始日時。元の日時の時刻と時差（+09:00）をそのまま使う。
  public static func occurrenceStartsAt(_ originalStartsAt: String, on dateKey: String) -> String {
    dateKey + originalStartsAt.dropFirst(10)
  }
}
