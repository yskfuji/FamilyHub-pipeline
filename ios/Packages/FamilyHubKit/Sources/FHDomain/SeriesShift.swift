import Foundation
import FHModel
import FHCopy

/// 繰り返しの「すべて」の編集で日付を変えるとき、シリーズ全体を同じ日数だけずらす（A13）。元: src/domain/seriesShift.ts。
/// ずらした後の回の集合が、元の回の集合を deltaDays だけずらしたものと必ず一致する規則だけを受け付け、それ以外は理由を返す。
public enum SeriesShift {
  public enum Refusal: String, Sendable, Codable { case monthEnd = "month-end", setPosition = "set-position", crossesWeek = "crosses-week", outOfRange = "out-of-range", unsupported }

  static func weekday(_ key: String) -> Int { CivilDate(key: key)?.weekday ?? 0 }
  static func dayOfMonth(_ key: String) -> Int { Int(key.suffix(2)) ?? 0 }
  static func inSafeMonthDays(_ day: Int) -> Bool { (1...28).contains(day) }
  static func mod7(_ value: Int) -> Int { ((value % 7) + 7) % 7 }
  /// JS の Math.floor(a / 7)。
  static func floorDiv7(_ value: Int) -> Int { Int((Double(value) / 7).rounded(.down)) }

  /// 日付の差（日）。from から to まで。
  public static func daysBetween(_ from: String, _ to: String) -> Int { CalendarLayout.dayGap(from, to) }

  static func shiftInstant(_ value: String, _ deltaDays: Int) -> String {
    Recurrence.occurrenceStartsAt(value, on: CalendarLayout.add(CalendarLayout.dateKey(value), deltaDays))
  }

  /// 規則がずらせるか。ずらせなければ理由。
  public static func refusal(start: String, recurrence: RecurrenceRule, deltaDays: Int) -> Refusal? {
    guard let rule = Recurrence.parse(recurrence.rrule) else { return .unsupported }
    if deltaDays == 0 || rule.freq == .daily { return nil }
    if rule.freq == .weekly {
      if rule.interval == 1 || rule.byDay.isEmpty { return nil }
      let anchorWeek = floorDiv7(weekday(start) + deltaDays)
      return rule.byDay.allSatisfy { floorDiv7($0 + deltaDays) == anchorWeek } ? nil : .crossesWeek
    }
    if rule.byMonthDay.isEmpty {
      let day = dayOfMonth(start)
      if day > 28 { return .monthEnd }
      return inSafeMonthDays(day + deltaDays) ? nil : .outOfRange
    }
    if rule.byMonthDay.contains(where: { $0 > 28 }) { return .monthEnd }
    if rule.bySetPos != nil { return .setPosition }
    if !rule.byMonthDay.allSatisfy({ inSafeMonthDays($0 + deltaDays) }) { return .outOfRange }
    // 開始日の月から INTERVAL か月ごとに数えるので、開始日が別の月へ移ると組がずれる。
    return CalendarLayout.add(start, deltaDays).prefix(7) == start.prefix(7) ? nil : .outOfRange
  }

  /// RRULE の BYDAY・BYMONTHDAY・UNTIL を deltaDays だけずらす。ほかの項目（COUNT を含む）は変えない。
  static func shiftRRule(_ rrule: String, _ deltaDays: Int) -> String {
    rrule.split(separator: ";", omittingEmptySubsequences: false).map { part -> String in
      let pieces = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
      let key = pieces[0]
      let value = pieces.count > 1 ? pieces[1] : ""
      switch key {
      case "BYDAY":
        return "BYDAY=" + value.split(separator: ",", omittingEmptySubsequences: false).map { code in
          Recurrence.dayCodes[mod7((Recurrence.dayCodes.firstIndex(of: String(code)) ?? -1) + deltaDays)]
        }.joined(separator: ",")
      case "BYMONTHDAY":
        return "BYMONTHDAY=" + value.split(separator: ",", omittingEmptySubsequences: false).map { String((Int($0) ?? 0) + deltaDays) }.joined(separator: ",")
      case "UNTIL":
        let date = "\(value.prefix(4))-\(value.dropFirst(4).prefix(2))-\(value.dropFirst(6).prefix(2))"
        return "UNTIL=\(CalendarLayout.add(date, deltaDays).replacingOccurrences(of: "-", with: ""))\(value.dropFirst(8))"
      default:
        return String(part)
      }
    }.joined(separator: ";")
  }

  /// シリーズ全体を deltaDays 日ずらす。ずらせなければ理由。
  public static func shift(_ event: CalendarEvent, by deltaDays: Int) -> Result<CalendarEvent, RefusalError> {
    let start = CalendarLayout.dateKey(event.startsAt)
    if let recurrence = event.recurrence, let reason = refusal(start: start, recurrence: recurrence, deltaDays: deltaDays) { return .failure(RefusalError(reason: reason)) }
    var shifted = event
    if deltaDays == 0 { return .success(shifted) }
    shifted.startsAt = shiftInstant(event.startsAt, deltaDays)
    shifted.endsAt = shiftInstant(event.endsAt, deltaDays)
    if let recurrence = event.recurrence {
      shifted.recurrence = RecurrenceRule(rrule: shiftRRule(recurrence.rrule, deltaDays), timezone: recurrence.timezone, exceptions: recurrence.exceptions.map { CalendarLayout.add($0, deltaDays) })
    }
    return .success(shifted)
  }

  public struct RefusalError: Error, Sendable, Equatable { public let reason: Refusal }

  /// 拒否の理由を、利用者に見せる文にする。「これ以降の予定」への案内を含む。
  public static func refusalMessage(_ reason: Refusal) -> String {
    let copy = Copy.ja.seriesShiftCopy.self
    let text = copy.refusal[reason.rawValue] ?? copy.refusal["unsupported"] ?? ""
    return text + copy.pointer
  }

  /// 保存の前に示す文（例:「すべての予定を1日後へ移します（毎週木曜）」）。ja.ts の seriesShiftCopy.confirm と同じ文。
  public static func describe(_ event: CalendarEvent, by deltaDays: Int) -> String? {
    guard deltaDays != 0, event.recurrence != nil, case .success(let shifted) = shift(event, by: deltaDays), let recurrence = shifted.recurrence else { return nil }
    let rule = Recurrence.describe(start: CalendarLayout.dateKey(shifted.startsAt), recurrence: recurrence)
    return "すべての予定を\(abs(deltaDays))日\(deltaDays > 0 ? "後" : "前")へ移します（\(rule)）"
  }
}
