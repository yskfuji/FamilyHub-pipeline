// 日本の祝日（祝日法の今の規則）。振替休日と国民の休日を含む。元: src/domain/holidays.ts
// 春分と秋分の近似式が使える 2007〜2099 年だけを計算し、その外は空を返す（推測しない）。

public struct HolidayEntry: Hashable, Sendable {
  public let date: String
  public let name: String
}

public enum Holidays {
  public static let range = 2007...2099

  private static func nthMonday(_ year: Int, _ month: Int, _ nth: Int) -> Int {
    let first = CivilDate(year: year, month: month, day: 1).weekday
    return 1 + ((8 - first) % 7) + (nth - 1) * 7
  }

  private static func equinoxDay(_ year: Int, _ base: Double) -> Int {
    Int((base + 0.242194 * Double(year - 1980) - (Double(year - 1980) / 4).rounded(.down)).rounded(.down))
  }

  private static func named(_ year: Int) -> [String: String] {
    var days: [String: String] = [:]
    func set(_ month: Int, _ day: Int, _ name: String) { days[CivilDate(year: year, month: month, day: day).key] = name }
    set(1, 1, "元日")
    set(1, nthMonday(year, 1, 2), "成人の日")
    set(2, 11, "建国記念の日")
    if year >= 2020 { set(2, 23, "天皇誕生日") } else if year <= 2018 { set(12, 23, "天皇誕生日") }
    set(3, equinoxDay(year, 20.8431), "春分の日")
    set(4, 29, "昭和の日")
    set(5, 3, "憲法記念日")
    set(5, 4, "みどりの日")
    set(5, 5, "こどもの日")
    if year == 2020 { set(7, 23, "海の日"); set(7, 24, "スポーツの日"); set(8, 10, "山の日") }
    else if year == 2021 { set(7, 22, "海の日"); set(7, 23, "スポーツの日"); set(8, 8, "山の日") }
    else {
      set(7, nthMonday(year, 7, 3), "海の日")
      if year >= 2016 { set(8, 11, "山の日") }
      set(10, nthMonday(year, 10, 2), year >= 2020 ? "スポーツの日" : "体育の日")
    }
    set(9, nthMonday(year, 9, 3), "敬老の日")
    set(9, equinoxDay(year, 23.2488), "秋分の日")
    set(11, 3, "文化の日")
    set(11, 23, "勤労感謝の日")
    if year == 2019 { set(5, 1, "天皇の即位の日"); set(10, 22, "即位礼正殿の儀の行われる日") }
    return days
  }

  /// その年の祝日を日付の順に。
  public static func of(year: Int) -> [HolidayEntry] {
    guard range.contains(year) else { return [] }
    var days = named(year)
    for date in days.keys.sorted() {
      guard let civil = CivilDate(key: date), civil.weekday == 0 else { continue }
      var substitute = civil.adding(days: 1)
      while days[substitute.key] != nil { substitute = substitute.adding(days: 1) }
      days[substitute.key] = "振替休日"
    }
    for date in days.keys.sorted() {
      guard let civil = CivilDate(key: date) else { continue }
      let between = civil.adding(days: 1)
      if days[between.key] == nil, days[civil.adding(days: 2).key] != nil, between.weekday != 0, between.year == year {
        days[between.key] = "国民の休日"
      }
    }
    return days.sorted { $0.key < $1.key }.map { HolidayEntry(date: $0.key, name: $0.value) }
  }

  /// [from, to] の祝日。
  public static func between(_ from: String, _ to: String) -> [HolidayEntry] {
    guard let first = CivilDate(key: from), let last = CivilDate(key: to), first.year <= last.year else { return [] }
    return (first.year...last.year).flatMap { of(year: $0) }.filter { $0.date >= from && $0.date <= to }
  }
}
