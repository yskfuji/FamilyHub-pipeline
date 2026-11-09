import Foundation

// 日付の鍵（YYYY-MM-DD）と年月の鍵（YYYY-MM）。家族の時間帯は日本時間（夏時間がない +09:00）。
// 元: src/domain/calendarDate.ts。答えは scripts/ios/export-vectors.ts が TS の関数から作り、試験で照らす。

/// 暦の日付。時刻や時間帯を持たない。
public struct CivilDate: Hashable, Comparable, Sendable {
  public let year: Int
  public let month: Int
  public let day: Int

  public init(year: Int, month: Int, day: Int) {
    self.year = year; self.month = month; self.day = day
  }

  /// 1970-01-01 からの日数（Howard Hinnant の days_from_civil）。
  public var daysSinceEpoch: Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = (month + 9) % 12
    let doy = (153 * mp + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
  }

  public init(daysSinceEpoch days: Int) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let day = doy - (153 * mp + 2) / 5 + 1
    let month = mp < 10 ? mp + 3 : mp - 9
    self.init(year: yoe + era * 400 + (month <= 2 ? 1 : 0), month: month, day: day)
  }

  /// 0 が日曜。
  public var weekday: Int { ((daysSinceEpoch % 7) + 11) % 7 }

  public func adding(days delta: Int) -> CivilDate { CivilDate(daysSinceEpoch: daysSinceEpoch + delta) }

  public var key: String { String(format: "%04d-%02d-%02d", year, month, day) }
  public var monthKey: String { String(format: "%04d-%02d", year, month) }

  public init?(key: String) {
    let parts = key.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3, key.count == 10 else { return nil }
    self.init(year: parts[0], month: parts[1], day: parts[2])
  }

  public static func < (lhs: CivilDate, rhs: CivilDate) -> Bool { lhs.daysSinceEpoch < rhs.daysSinceEpoch }
}

/// 日本時間。
public enum Tokyo {
  public static let offsetSeconds = 9 * 60 * 60
  public static let weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"]

  /// RFC 3339 の時刻を読む（小数の秒と時差に対応）。
  public static func parse(_ value: String) -> Date? {
    if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value) { return date }
    return try? Date.ISO8601FormatStyle().parse(value)
  }

  /// その時刻の、日本時間の日付と時刻（時・分・秒）。
  public static func components(of date: Date) -> (date: CivilDate, hour: Int, minute: Int, second: Int) {
    let seconds = Int(floor(date.timeIntervalSince1970)) + offsetSeconds
    let days = Int(floor(Double(seconds) / 86_400))
    let rest = seconds - days * 86_400
    return (CivilDate(daysSinceEpoch: days), rest / 3600, (rest % 3600) / 60, rest % 60)
  }
}

public enum CalendarDate {
  public static func dateKey(fromRfc3339 value: String) -> String? {
    Tokyo.parse(value).map { Tokyo.components(of: $0).date.key }
  }

  public static func monthKey(fromRfc3339 value: String) -> String? {
    Tokyo.parse(value).map { Tokyo.components(of: $0).date.monthKey }
  }

  public static func addDays(_ dateKey: String, _ delta: Int) -> String? {
    CivilDate(key: dateKey)?.adding(days: delta).key
  }

  public static func isMonthKey(_ value: String?) -> Bool {
    guard let value, value.count == 7, value.range(of: #"^\d{4}-\d{2}$"#, options: .regularExpression) != nil else { return false }
    let parts = value.split(separator: "-").compactMap { Int($0) }
    return (1900...2100).contains(parts[0]) && (1...12).contains(parts[1])
  }

  public static func shiftMonth(_ monthKey: String, _ delta: Int) -> String? {
    guard isMonthKey(monthKey) else { return nil }
    let parts = monthKey.split(separator: "-").compactMap { Int($0) }
    let index = parts[0] * 12 + (parts[1] - 1) + delta
    let year = Int(floor(Double(index) / 12))
    return String(format: "%04d-%02d", year, index - year * 12 + 1)
  }

  public struct GridDate: Hashable, Sendable {
    public let date: String
    public let day: Int
    public let inCurrentMonth: Bool
  }

  /// 月の表の42マス（日曜はじまり）。
  public static func monthGrid(_ monthKey: String) -> [GridDate] {
    guard isMonthKey(monthKey), let first = CivilDate(key: "\(monthKey)-01") else { return [] }
    let start = first.adding(days: -first.weekday)
    return (0..<42).map { index in
      let date = start.adding(days: index)
      return GridDate(date: date.key, day: date.day, inCurrentMonth: date.monthKey == monthKey)
    }
  }

  public static func weekDates(_ anchor: String) -> [String] {
    guard let date = CivilDate(key: anchor) else { return [] }
    let start = date.adding(days: -date.weekday)
    return (0..<7).map { start.adding(days: $0).key }
  }

  /// 日本時間の時差つき RFC 3339（例: 2026-09-30T07:45:00+09:00）。
  public static func toJstRfc3339(_ date: Date) -> String {
    let parts = Tokyo.components(of: date)
    return String(format: "%@T%02d:%02d:%02d+09:00", parts.date.key, parts.hour, parts.minute, parts.second)
  }
}
