import Foundation

// シフトの記号と時刻の規則、貼り付けた文字のそろえ方。元: src/domain/shift/rules.ts と text.ts。

public struct ShiftTimeRule: Codable, Sendable, Hashable, Identifiable {
  public var id: String
  public var label: String
  /// 表の中で使われる書き方。名前そのものは数えなくてよい。
  public var aliases: [String]
  public var start: String
  public var end: String
  /// 終了が開始より後でも翌日に終わる勤務（例：8:30〜翌9:00）。
  public var endsNextDay: Bool
  /// 休みの記号。時刻を持たず、終日の予定になる。
  public var off: Bool

  public init(id: String, label: String, aliases: [String], start: String, end: String, endsNextDay: Bool = false, off: Bool = false) {
    self.id = id; self.label = label; self.aliases = aliases; self.start = start; self.end = end; self.endsNextDay = endsNextDay; self.off = off
  }
}

public enum ShiftRules {
  public static let defaults: [ShiftTimeRule] = [
    ShiftTimeRule(id: "early", label: "早番", aliases: ["早", "E"], start: "07:00", end: "16:00"),
    ShiftTimeRule(id: "day", label: "日勤", aliases: ["日", "D", "○"], start: "09:00", end: "18:00"),
    ShiftTimeRule(id: "late", label: "遅番", aliases: ["遅", "L"], start: "13:00", end: "22:00"),
    ShiftTimeRule(id: "night", label: "夜勤", aliases: ["夜", "N"], start: "22:00", end: "07:00"),
    ShiftTimeRule(id: "code-a", label: "A勤務", aliases: ["A"], start: "09:00", end: "18:00"),
    ShiftTimeRule(id: "code-b", label: "B勤務", aliases: ["B"], start: "13:00", end: "22:00"),
    ShiftTimeRule(id: "code-c", label: "C勤務", aliases: ["C"], start: "22:00", end: "07:00"),
    ShiftTimeRule(id: "off", label: "休み", aliases: ["休", "公休", "希望休", "有休", "有給", "代休", "年休", "特休", "明", "明け", "×", "OFF"], start: "00:00", end: "00:00", off: true),
  ]

  /// 新しい規則。時刻は日勤の値から編集してもらう。
  public static func custom(_ label: String, _ rules: [ShiftTimeRule]) -> ShiftTimeRule {
    let taken = Set(rules.map(\.id))
    var number = rules.count + 1
    while taken.contains("custom-\(number)") { number += 1 }
    return ShiftTimeRule(id: "custom-\(number)", label: (label.isEmpty ? "新しい規則\(number)" : label).jsSlice(0, 20), aliases: [], start: "09:00", end: "18:00")
  }

  /// 比べるための形。全角と大文字小文字の違いをなくす。
  public static func normalizeSymbol(_ text: String) -> String { text.nfkc.jsTrimmed.jsUpper }

  public static func symbols(_ rule: ShiftTimeRule) -> [String] { ([rule.label] + rule.aliases).map(normalizeSymbol) }

  public static func find(_ rules: [ShiftTimeRule], _ symbol: String) -> ShiftTimeRule? {
    let wanted = normalizeSymbol(symbol)
    return rules.first { symbols($0).contains(wanted) }
  }

  public static func isOvernight(_ rule: ShiftTimeRule) -> Bool { rule.endsNextDay || rule.end <= rule.start }

  public static func rangeText(_ rule: ShiftTimeRule) -> String {
    rule.off ? "休み" : "\(rule.start)〜\(isOvernight(rule) ? "翌" : "")\(rule.end)"
  }

  static let aliasSeparator = JSRegex(#"[,、/／\s]+"#)

  /// 読点・カンマ・スラッシュ・空白で区切られた別名を分ける。
  public static func parseAliases(_ text: String) -> [String] {
    aliasSeparator.split(text).map(\.jsTrimmed).filter { !$0.isEmpty }.uniqued()
  }

  static let clockPattern = JSRegex(#"^([01]\d|2[0-3]):[0-5]\d$"#)

  /// 保存できる形か（shiftRuleSchema）。
  static func isWellFormed(_ rule: ShiftTimeRule) -> Bool {
    let label = rule.label.jsTrimmed
    guard !rule.id.isEmpty, rule.id.unicodeScalars.count <= 60, !label.isEmpty, label.unicodeScalars.count <= 20,
          rule.aliases.count <= 16, rule.aliases.allSatisfy({ let alias = $0.jsTrimmed; return !alias.isEmpty && alias.unicodeScalars.count <= 12 }),
          clockPattern.test(rule.start), clockPattern.test(rule.end) else { return false }
    return true
  }

  /// 入力の確認。問題があれば文言を返す。
  public static func problem(_ rule: ShiftTimeRule, _ rules: [ShiftTimeRule]) -> String? {
    if rule.label.jsTrimmed.isEmpty { return "規則の名前を入力してください。" }
    if !isWellFormed(rule) { return "名前、別名、時刻を確認してください。" }
    let clash = symbols(rule).first { symbol in rules.contains { $0.id != rule.id && symbols($0).contains(symbol) } }
    return clash.map { "「\($0)」はほかの規則で使われています。" }
  }

  /// 追加する規則を優先して合わせる。同じ記号を持つ規則は、その記号だけを外し、残らなければ消す。
  public static func merge(_ rules: [ShiftTimeRule], _ additions: [ShiftTimeRule]) -> [ShiftTimeRule] {
    let taken = Set(additions.flatMap(symbols))
    let kept = rules.flatMap { item -> [ShiftTimeRule] in
      let free = item.aliases.filter { !taken.contains(normalizeSymbol($0)) }
      if taken.contains(normalizeSymbol(item.label)) {
        if additions.contains(where: { $0.id == item.id }) { return [] }
        guard let first = free.first else { return [] }
        var renamed = item
        renamed.label = first
        renamed.aliases = free
        return [renamed]
      }
      var trimmed = item
      trimmed.aliases = free
      return [trimmed]
    }
    return kept + additions
  }

  /// 端末に残す鍵。記号と時刻だけで、貼り付けた表や名前は残さない。
  public static let storageKey = "fh.shiftRules"

  public static func load(_ defaults: UserDefaults) -> [ShiftTimeRule] {
    guard let data = defaults.data(forKey: storageKey),
          let rules = try? JSONDecoder().decode([ShiftTimeRule].self, from: data),
          (1...40).contains(rules.count), rules.allSatisfy(isWellFormed) else { return Self.defaults }
    return rules
  }

  public static func save(_ rules: [ShiftTimeRule], to defaults: UserDefaults) {
    if let data = try? JSONEncoder().encode(rules) { defaults.set(data, forKey: storageKey) }
  }

  public static func reset(_ defaults: UserDefaults) -> [ShiftTimeRule] {
    defaults.removeObject(forKey: storageKey)
    return Self.defaults
  }
}

public enum ShiftText {
  static let lineBreaks = JSRegex(#"\r\n?"#)
  static let tildes = JSRegex("[〜∼]")
  static let dashes = JSRegex("[−–—―‐]")
  static let longVowelBetweenDigits = JSRegex(#"(\d)\s*ー\s*(\d)"#)
  static let reiwa = JSRegex(#"令和\s*(\d{1,2})\s*年"#)
  static let reiwaShort = JSRegex(#"(^|[^A-Z0-9])R\s*(\d{1,2})[./年]"#)
  static let halfHour = JSRegex(#"(\d{1,2})時半"#)
  static let hourMinute = JSRegex(#"(\d{1,2})時(\d{1,2})分?"#)
  static let hour = JSRegex(#"(\d{1,2})時"#)

  /// 貼り付けた文字をそろえる。全角の数字や記号、時刻の書き方の違いをなくす。
  public static func normalize(_ text: String) -> String {
    var value = text.nfkc
    value = lineBreaks.replaceAll(value, with: "\n")
    value = tildes.replaceAll(value, with: "~")
    value = dashes.replaceAll(value, with: "-")
    value = longVowelBetweenDigits.replaceAll(value) { "\($0[1] ?? "")-\($0[2] ?? "")" }
    value = reiwa.replaceAll(value) { "\(2018 + ($0[1] ?? "0").jsInt)年" }
    value = reiwaShort.replaceAll(value) { "\($0[1] ?? "")\(2018 + ($0[2] ?? "0").jsInt)年" }
    value = halfHour.replaceAll(value) { "\($0[1] ?? ""):30" }
    value = hourMinute.replaceAll(value) { match in
      let minute = match[2] ?? ""
      return "\(match[1] ?? ""):\(minute.jsLength < 2 ? String(repeating: "0", count: 2 - minute.jsLength) + minute : minute)"
    }
    value = hour.replaceAll(value) { "\($0[1] ?? ""):00" }
    return value
  }

  public struct Cells: Sendable, Equatable {
    public var cells: [String]
    /// 区切りが表の列を保っているとき。空の列も数える。
    public var exact: Bool
  }

  static let edgeBars = JSRegex(#"^\||\|$"#)
  static let spaces = JSRegex(#"\s+"#)

  /// 行を列に分ける。タブ・縦棒・カンマは空の列を保ち、空白だけの行は続いた空白を1つに数える。
  public static func cells(_ line: String) -> Cells {
    if line.jsIncludes("\t") { return Cells(cells: line.jsSplit("\t").map(\.jsTrimmed), exact: true) }
    if line.jsIncludes("|") { return Cells(cells: edgeBars.replaceAll(line.jsTrimmed, with: "").jsSplit("|").map(\.jsTrimmed), exact: true) }
    if line.filter({ $0 == "," }).count >= 3 { return Cells(cells: line.jsSplit(",").map(\.jsTrimmed), exact: true) }
    return Cells(cells: spaces.split(line.jsTrimmed).filter { !$0.isEmpty }, exact: false)
  }

  public struct ClockRange: Sendable, Equatable {
    public var start: String
    public var end: String
    public var endsNextDay: Bool
    public var text: String
  }

  static let range = JSRegex(#"(\d{1,2})(?::(\d{2}))?\s*(?:~|-|から)\s*(翌日?)?\s*(\d{1,2})(?::(\d{2}))?(?:まで)?"#)

  static func clock(_ hour: Int, _ minute: Int) -> String { String(format: "%02d:%02d", hour, minute) }

  /// 文字の中の時刻の範囲を読む。24時以降の書き方（22:00-31:00）は翌日の時刻に直す。
  public static func clockRange(_ text: String) -> ClockRange? {
    guard let match = range.exec(text) else { return nil }
    let hours = [(match[1] ?? "0").jsInt, (match[4] ?? "0").jsInt]
    let minutes = [(match[2] ?? "00").jsInt, (match[5] ?? "00").jsInt]
    if hours[0] > 29 || hours[1] > 47 || minutes.contains(where: { $0 > 59 }) { return nil }
    let startsNext = hours[0] >= 24
    let start = clock(hours[0] % 24, minutes[0])
    let end = clock(hours[1] % 24, minutes[1])
    let endsNextDay = match[3] != nil || hours[1] >= 24 || (end <= start && !startsNext)
    return ClockRange(start: start, end: end, endsNextDay: endsNextDay, text: match.text)
  }

  public static let weekdayNames = "日月火水木金土"

  /// 日付が実在するときだけ YYYY-MM-DD を返す（JS の Date.UTC と同じく、0〜99年は1900年代として読むので外れる）。
  public static func isoDate(_ year: Int, _ month: Int, _ day: Int) -> String? {
    guard !(0...99).contains(year), (1...12).contains(month), day >= 1 else { return nil }
    let date = CivilDate(year: year, month: month, day: day)
    guard CivilDate(daysSinceEpoch: date.daysSinceEpoch) == date else { return nil }
    return date.key
  }

  public static func weekday(of dateKey: String) -> String {
    let index = CivilDate(key: dateKey)?.weekday ?? 0
    return String(Array(weekdayNames)[index])
  }

  static let honorific = JSRegex("(さん|様|君|ちゃん)$")

  /// 名前の比べ方。空白と敬称を除く。
  public static func personKey(_ name: String) -> String {
    honorific.replaceFirst(spaces.replaceAll(name.nfkc, with: ""), with: "")
  }

  /// 同じ人かどうか。名字だけの指定も認める。
  public static func samePerson(_ a: String, _ b: String) -> Bool {
    let left = personKey(a), right = personKey(b)
    return !left.isEmpty && !right.isEmpty && (left == right || left.jsIncludes(right) || right.jsIncludes(left))
  }
}
