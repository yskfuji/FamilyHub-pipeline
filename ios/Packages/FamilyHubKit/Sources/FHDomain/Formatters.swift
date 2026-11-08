import Foundation
import FHCopy

// 金額・日付・時刻の書式。元: src/design-system/components.tsx の formatYen など。
// Web（Chrome と node）と同じ文字にする。円の記号は全角の ￥（Apple の ICU は半角になるので、自分で組み立てる）。

public enum Format {
  private static func grouped(_ value: Int) -> String {
    let digits = String(value)
    var result = ""
    for (index, character) in digits.enumerated() {
      if index > 0, (digits.count - index) % 3 == 0 { result.append(",") }
      result.append(character)
    }
    return result
  }

  /// ￥1,234。負の数は -￥2,860（Web と同じ）。
  public static func yen(_ value: Int) -> String {
    value < 0 ? "-￥\(grouped(-value))" : "￥\(grouped(value))"
  }

  /// 増減を表す金額。0円には符号を付けない。減りは全角に近い − を使う。
  public static func signedYen(_ value: Int) -> String {
    if value == 0 { return yen(0) }
    return "\(value > 0 ? "+" : "−")\(yen(abs(value)))"
  }

  /// 07:30（日本時間）。値がなければ「期限なし」。
  public static func time(_ value: String?) -> String {
    guard let value, let date = Tokyo.parse(value) else { return Copy.ja.ja.states.noDueDate }
    let parts = Tokyo.components(of: date)
    return String(format: "%02d:%02d", parts.hour, parts.minute)
  }

  /// 9月30日(水)（日本時間）。
  public static func date(_ value: String) -> String {
    guard let date = Tokyo.parse(value) else { return value }
    return monthDay(Tokyo.components(of: date).date)
  }

  public static func monthDay(_ date: CivilDate) -> String {
    "\(date.month)月\(date.day)日(\(Tokyo.weekdayLabels[date.weekday]))"
  }

  /// 2026年9月30日。
  public static func dateOnly(_ key: String) -> String {
    guard let date = CivilDate(key: key) else { return key }
    return "\(date.year)年\(date.month)月\(date.day)日"
  }

  /// 期限の表示。今日なら時刻だけ、明日・昨日はそう書き、それ以外は日付も付ける。
  public static func due(_ value: String?, asOf: String) -> String {
    guard let value, let today = CalendarDate.dateKey(fromRfc3339: asOf), let day = CalendarDate.dateKey(fromRfc3339: value) else { return Copy.ja.ja.states.noDueDate }
    let clock = time(value)
    if day == today { return clock }
    if day == CalendarDate.addDays(today, 1) { return "明日 \(clock)" }
    if day == CalendarDate.addDays(today, -1) { return "昨日 \(clock)" }
    return "\(date(value)) \(clock)"
  }

  /// 基準時刻からの経過。「5分前」「2時間前」、7日以上前は日付。
  public static func relative(_ value: String, asOf: String) -> String {
    guard let then = Tokyo.parse(value), let now = Tokyo.parse(asOf) else { return value }
    // JS の Math.round と同じ（.5 は大きい方へ）。
    let minutes = Int(floor(now.timeIntervalSince(then) / 60 + 0.5))
    if minutes < 1 { return "たった今" }
    if minutes < 60 { return "\(minutes)分前" }
    if minutes < 60 * 24 { return "\(minutes / 60)時間前" }
    if minutes < 60 * 24 * 7 { return "\(minutes / (60 * 24))日前" }
    return date(value)
  }
}
