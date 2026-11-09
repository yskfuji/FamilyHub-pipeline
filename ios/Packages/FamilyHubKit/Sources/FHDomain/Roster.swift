import Foundation

// 貼り付けた勤務表を読む。何も保存せず、同じ入力には同じ結果を返す。元: src/domain/shift/roster.ts。
// 表計算・チャット・メールの書き方を読み分ける。答えは TS の parseRoster が出したものと照らす（FHDomainTests）。

public struct RosterRow: Sendable, Hashable, Codable {
  public var date: String
  /// 表に書かれていた記号。
  public var symbol: String
  public var kind: Kind
  public var title: String
  public var startTime: String?
  public var endTime: String?
  public var endsNextDay: Bool
  public var warning: String?

  public enum Kind: String, Sendable, Codable { case work, off, unknown }
}

public struct RosterResult: Sendable, Equatable {
  public var rows: [RosterRow]
  /// 表に見つかった人。読み取る人を選ぶのに使う。
  public var people: [String]
  /// 表の凡例から読んだ規則。
  public var legend: [ShiftTimeRule]
  /// 読めなかった行の説明。
  public var skipped: [String]
  public var layout: String
}

public enum Roster {
  static let maxTextLength = 40_000
  static let maxRows = 200
  static let blankCell = JSRegex(#"^[-・._/ー\s]*$"#)
  static let notAPerson = JSRegex("^(合計|計|小計|人数|備考|出勤|出勤者数|勤務|シフト|区分|No|NO|番号|社員番号|氏名|名前|スタッフ|担当)$")
  static let notASymbol = JSRegex("^(休憩|勤務時間|時間|営業時間|受付|集合|提出|締切|期限|凡例|記号|例|備考|※)$")
  static let nameLabels = JSRegex(#"^(氏名|名前|スタッフ|担当|従業員|社員|メンバー|No\.?|番号|社員番号)$"#, ignoreCase: true)
  static let dateLabels = JSRegex("^(日付|日|月日|日にち|年月日|DATE)$", ignoreCase: true)
  static let weekdayLabels = JSRegex("^(曜日?)$")
  static let columnLabels = JSRegex("^(シフト|勤務|区分|予定|勤務区分)$")

  struct Resolved { var symbol: String; var kind: RosterRow.Kind; var title: String; var startTime: String?; var endTime: String?; var endsNextDay: Bool }

  static let cleanEdges = JSRegex(#"^[\s:は、,。.「『(]+|[\s、,。.!」』)]+$"#)
  static let cleanTail = JSRegex("(です|でした|でお願いします|勤務|シフト|となります|になります)$")

  static func clean(_ text: String) -> String { cleanTail.replaceFirst(cleanEdges.replaceAll(text, with: ""), with: "") }

  static func resolveOne(_ raw: String, _ rules: [ShiftTimeRule]) -> Resolved {
    if let range = ShiftText.clockRange(raw) {
      let label = clean(raw.jsReplaceFirst(range.text, with: ""))
      let rule = label.isEmpty ? nil : ShiftRules.find(rules, label)
      return Resolved(symbol: label.isEmpty ? "\(range.start)-\(range.end)" : label, kind: .work, title: rule?.label ?? (label.isEmpty ? "勤務" : label), startTime: range.start, endTime: range.end, endsNextDay: range.endsNextDay)
    }
    let symbol = clean(raw)
    guard let rule = ShiftRules.find(rules, raw.jsTrimmed) ?? ShiftRules.find(rules, symbol) else {
      return Resolved(symbol: raw.jsTrimmed, kind: .unknown, title: raw.jsTrimmed, endsNextDay: false)
    }
    if rule.off { return Resolved(symbol: symbol, kind: .off, title: rule.label, endsNextDay: false) }
    return Resolved(symbol: symbol, kind: .work, title: rule.label, startTime: rule.start, endTime: rule.end, endsNextDay: rule.endsNextDay || rule.end <= rule.start)
  }

  static let cellParts = JSRegex("[/&+・]")

  /// 1つの欄を読む。空なら何も返さない。「早/遅」のように2つ書かれた欄は、両方が読めるときだけ分ける。
  static func resolveCell(_ raw: String, _ rules: [ShiftTimeRule]) -> [Resolved] {
    if blankCell.test(raw) { return [] }
    if ShiftText.clockRange(raw) == nil {
      let parts = cellParts.split(raw).map(\.jsTrimmed).filter { !$0.isEmpty }
      if parts.count > 1, parts.allSatisfy({ ShiftRules.find(rules, $0) != nil }) { return parts.map { resolveOne($0, rules) } }
    }
    return [resolveOne(raw, rules)]
  }

  struct Day: Equatable { var day: Int; var month: Int?; var weekday: String? }

  static let bareDayCell = JSRegex(#"^(\d{1,2})日?(?:\(?([日月火水木金土])\)?)?$"#)
  static let datedCell = JSRegex(#"^(\d{1,2})[/月](\d{1,2})日?(?:\(?([日月火水木金土])\)?)?$"#)

  static func day(of cell: String) -> Day? {
    if let bare = bareDayCell.exec(cell) {
      let value = (bare[1] ?? "0").jsInt
      return (1...31).contains(value) ? Day(day: value, weekday: bare[2]) : nil
    }
    guard let dated = datedCell.exec(cell) else { return nil }
    let month = (dated[1] ?? "0").jsInt, value = (dated[2] ?? "0").jsInt
    return month <= 12 && value <= 31 ? Day(day: value, month: month, weekday: dated[3]) : nil
  }

  struct YearMonth: Equatable { var year: Int; var month: Int }

  static func parseMonth(_ month: String) -> YearMonth { YearMonth(year: month.jsSlice(0, 4).jsInt, month: month.jsSlice(5, 7).jsInt) }
  static func addMonths(_ base: YearMonth, _ count: Int) -> YearMonth {
    let index = base.year * 12 + base.month - 1 + count
    let year = Int((Double(index) / 12).rounded(.down))
    return YearMonth(year: year, month: index - year * 12 + 1)
  }
  static func monthGap(_ a: YearMonth, _ b: YearMonth) -> Int { (a.year - b.year) * 12 + a.month - b.month }

  /// 月まで書かれた日付の年を決める。基準の月から前後1か月の外は読まない。
  static func dateWithMonth(_ base: YearMonth, _ month: Int, _ day: Int, year: Int? = nil) -> String? {
    let candidates = year.map { [$0] } ?? [base.year - 1, base.year, base.year + 1]
    guard let nearest = candidates.map({ YearMonth(year: $0, month: month) }).stableSorted(by: { abs(monthGap($0, base)) < abs(monthGap($1, base)) }).first else { return nil }
    return abs(monthGap(nearest, base)) > 1 ? nil : ShiftText.isoDate(nearest.year, nearest.month, day)
  }

  /// 日だけが並ぶ列を、月をまたぐ並び（21…31, 1…20）も含めて日付にする。
  static func dates(of days: [Day], base: YearMonth) -> [String?] {
    var current = base
    var previous = 0
    return days.map { item in
      if let month = item.month {
        current.month = month
        previous = item.day
        return dateWithMonth(base, month, item.day)
      }
      if item.day < previous { current = addMonths(current, 1) }
      previous = item.day
      return ShiftText.isoDate(current.year, current.month, item.day)
    }
  }

  static func consecutive(_ days: [Day]) -> Bool {
    days.indices.allSatisfy { $0 == 0 || days[$0].day == days[$0 - 1].day + 1 || (days[$0 - 1].day >= 28 && days[$0].day == 1) }
  }

  struct Located {
    var layout: String
    var headerIndex: Int
    var labels: [String]
    var days: [Day]
    /// 日の列の右にある、合計などの列の数。
    var extras: Int
    var weekdayIndex: Int?
    var rows: [Int]
    var exact: Bool
  }

  static let legendHead = JSRegex("^(凡例|※|記号|時間)")

  static func legendLike(_ line: String, _ cells: [String]) -> Bool {
    if legendHead.test(line) || line.jsIncludes("=") { return true }
    let times = cells.filter { ShiftText.clockRange($0) != nil }.count
    return times > 0 && cells.count == times * 2
  }

  static let weekdayMark = JSRegex(#"^\(?[日月火水木金土]曜?\)?$"#)
  static let weekdayDecoration = JSRegex("[()曜]")

  static func isWeekdayRow(_ cells: [String]) -> Bool {
    let named = cells.filter { !$0.isEmpty }
    let marks = named.filter { cell in
      let first = weekdayDecoration.replaceAll(cell, with: "").jsSlice(0, 1)
      return cell.jsLength <= 3 && ShiftText.weekdayNames.jsIncludes(first) && weekdayMark.test(cell)
    }
    return marks.count >= 5 && marks.count >= named.count - 2
  }

  static let separatorCell = JSRegex("^:?-+:?$")

  /// 日が横に並ぶ表を探す。
  static func locateTable(_ lines: [String], _ split: [ShiftText.Cells]) -> Located? {
    for index in lines.indices {
      let cells = split[index].cells, exact = split[index].exact
      guard let start = cells.firstIndex(where: { day(of: $0) != nil }), start <= 2 else { continue }
      let labels = Array(cells[..<start])
      if labels.contains(where: { !$0.isEmpty && !nameLabels.test($0) }) { continue }
      var days: [Day] = []
      var position = start
      while position < cells.count, let found = day(of: cells[position]) { days.append(found); position += 1 }
      if days.count < 5 || !consecutive(days) { continue }
      let before = index > 0 ? split[index - 1].cells : []
      let after = index + 1 < split.count ? split[index + 1].cells : []
      let weekdayIndex: Int? = isWeekdayRow(after) ? index + 1 : isWeekdayRow(before) ? index - 1 : nil
      var rows: [Int] = []
      var row = weekdayIndex == index + 1 ? index + 2 : index + 1
      while row < lines.count {
        let line = split[row]
        defer { row += 1 }
        if line.cells.isEmpty || lines[row].jsTrimmed.isEmpty { if !rows.isEmpty { break }; continue }
        if line.cells.allSatisfy({ separatorCell.test($0) }) { continue }
        if !line.exact, legendLike(lines[row], line.cells) { if !rows.isEmpty { break }; continue }
        if line.cells.count >= 2 { rows.append(row) }
      }
      return Located(layout: "table", headerIndex: index, labels: labels, days: days, extras: cells.count - position, weekdayIndex: weekdayIndex, rows: rows, exact: exact)
    }
    return nil
  }

  static let columnDateCell = JSRegex(#"^(\d{4}[-/年])?\d{1,2}([-/月]\d{1,2}日?)?日?(\(?[日月火水木金土]\)?)?$"#)

  /// 日付が縦に、人が横に並ぶ表を探す。
  static func locateColumns(_ split: [ShiftText.Cells]) -> Located? {
    for index in split.indices {
      let cells = split[index].cells
      guard cells.count >= 2, dateLabels.test(cells[0]) else { continue }
      let rows = ((index + 1)..<max(index + 1, split.count)).filter { columnDateCell.test(split[$0].cells.first ?? "") }
      if !rows.isEmpty { return Located(layout: "columns", headerIndex: index, labels: cells, days: [], extras: 0, weekdayIndex: nil, rows: rows, exact: split[index].exact) }
    }
    return nil
  }

  static let legend = JSRegex(#"([^\s=:,、/;()\d][^\s=:,、/;()]{0,7})(?:[\s=:]+([^\s=:,、/;()\d][^\s=:,、/;()]{0,7}))?[\s=:(]*(\d{1,2}(?::\d{2})?\s*(?:~|-|から)\s*翌?日?\s*\d{1,2}(?::\d{2})?)"#)

  /// 「A=9:00-18:00」「早番 7:00〜16:00」のような凡例の行を規則として読む。
  public static func legendRules(_ text: String) -> [ShiftTimeRule] {
    legendOfLines(ShiftText.normalize(text.jsSlice(0, maxTextLength)).jsSplit("\n"))
  }

  static func legendOfLines(_ lines: [String]) -> [ShiftTimeRule] {
    var found: [(String, ShiftTimeRule)] = []
    for line in lines {
      if !dateTokens(line).isEmpty { continue }
      for match in legend.matches(line) {
        let names = [match[1], match[2]].compactMap { $0 }.filter { !$0.isEmpty && !notASymbol.test($0) }
        guard !names.isEmpty, let range = ShiftText.clockRange(match[3] ?? "") else { continue }
        let label = names.stableSorted { $0.jsLength > $1.jsLength }[0]
        let key = ShiftRules.normalizeSymbol(names[0])
        if !found.contains(where: { $0.0 == key }) {
          found.append((key, ShiftTimeRule(id: "legend-\(key)", label: label, aliases: names.filter { $0 != label }, start: range.start, end: range.end, endsNextDay: range.endsNextDay)))
        }
      }
    }
    return found.map(\.1)
  }

  struct DateToken { var index: Int; var length: Int; var year: Int?; var month: Int; var day: Int; var weekday: String? }

  static let dateToken = JSRegex(#"(?:(\d{4})\s*[年/.-]\s*)?(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?(?:\s*\(\s*([日月火水木金土])\s*(?:曜日?)?\s*\)|\s*([日月火水木金土])曜日?)?|(\d{4})-(\d{1,2})-(\d{1,2})(?:\s*\(\s*([日月火水木金土])\s*\))?"#)

  static func dateTokens(_ line: String) -> [DateToken] {
    dateToken.matches(line).compactMap { match in
      let year = (match[1] ?? match[6]).map(\.jsInt).flatMap { $0 == 0 ? nil : $0 }
      let month = (match[2] ?? match[7] ?? "0").jsInt
      let day = (match[3] ?? match[8] ?? "0").jsInt
      let weekday = match[4] ?? match[5] ?? match[9]
      return (1...12).contains(month) && (1...31).contains(day) ? DateToken(index: match.index, length: match.length, year: year, month: month, day: day, weekday: weekday) : nil
    }
  }

  static let bareDay = JSRegex(#"^\s*(\d{1,2})\s*日?(?:\s*\(?\s*([日月火水木金土])\s*(?:曜日?)?\s*\)?)?(?![\d:/月年])[\s.:、\t-]*(.*)$"#)
  static let section = JSRegex(#"^(?:[【[■●◆<]\s*([^\s】\]>:]{1,16})\s*(?:さん|様)?\s*[】\]>:]?|([^\s【[■●◆<\d:]{1,16}?)(?:さん|様)(?:の(?:シフト|勤務|予定))?\s*:?|([^\s【[■●◆<\d:]{1,16})\s*:)$"#)
  static let notASectionName = JSRegex("(シフト|勤務表|予定表|月度|月分|お知らせ|ご連絡)")

  static func sectionName(_ line: String) -> String? {
    guard let match = section.exec(line.jsTrimmed), let name = match[1] ?? match[2] ?? match[3], !name.isEmpty else { return nil }
    return !notAPerson.test(name) && !notASymbol.test(name) && !notASectionName.test(name) ? name : nil
  }

  static let symbolSeparators = JSRegex(#"[\s、,]+"#)
  static let tokenSeparators = JSRegex(#"[\s、,。]+"#)

  static func firstSymbol(_ rest: String, _ rules: [ShiftTimeRule]) -> String? {
    let text = clean(rest)
    if text.isEmpty { return nil }
    if let range = ShiftText.clockRange(text) {
      let before = symbolSeparators.split(text.jsSlice(0, text.jsIndexOf(range.text)).jsTrimmed).last ?? ""
      return "\(before) \(range.text)".jsTrimmed
    }
    let tokens = tokenSeparators.split(text).filter { !$0.isEmpty }
    if let known = tokens.first(where: { ShiftRules.find(rules, $0) != nil || ShiftRules.find(rules, clean($0)) != nil }) { return known }
    let upper = text.jsUpper
    let long = rules.flatMap { [$0.label] + $0.aliases }.filter { $0.jsLength >= 2 }.stableSorted { $0.jsLength > $1.jsLength }.first { upper.jsIncludes(ShiftRules.normalizeSymbol($0)) }
    if let long { return long }
    if let first = tokens.first, first.jsLength <= 8 { return first }
    return nil
  }

  struct Entry { var person: String; var date: String; var cell: String; var weekday: String? }

  static let ownerPrefix = JSRegex(#"^[^\d\s:]{2,10}$"#)
  static let notAnOwner = JSRegex("(期限|締切|提出|日時|まで|から)")
  static let trailingMark = JSRegex("[:、]$")
  static let ownerHonorific = JSRegex("(さん|様)$")
  static let namePairs = JSRegex(#"([^\s:,、\d][^\s:,、\d]*)\s*:\s*([^\s,、]+)"#)

  static func readLines(_ lines: [String], _ base: YearMonth, _ rules: [ShiftTimeRule], _ skipped: inout [String]) -> [Entry] {
    var entries: [Entry] = []
    var currentSection = ""
    var current = base
    var previous = 0
    func add(_ person: String, _ date: String?, _ cell: String?, _ weekday: String?, _ source: String, _ skipped: inout [String]) {
      guard let cell else { return }
      guard let date else { skipped.append("「\(source)」は日付を読めないか、選んだ月から離れています。"); return }
      entries.append(Entry(person: person, date: date, cell: cell, weekday: weekday))
    }
    func readRest(_ date: String?, _ rest: String, _ weekday: String?, _ source: String, _ owner: String, _ skipped: inout [String]) {
      let pairs = ShiftText.clockRange(rest) != nil ? [] : namePairs.matches(rest)
      if !pairs.isEmpty, pairs.allSatisfy({ ShiftRules.find(rules, $0[1] ?? "") == nil }) {
        for pair in pairs { add(ownerHonorific.replaceFirst(pair[1] ?? "", with: ""), date, pair[2], weekday, source, &skipped) }
        return
      }
      add(owner, date, firstSymbol(rest, rules), weekday, source, &skipped)
    }
    for line in lines {
      if line.jsTrimmed.isEmpty { continue }
      let tokens = dateTokens(line)
      if let firstToken = tokens.first {
        let prefix = trailingMark.replaceFirst(line.jsSlice(0, firstToken.index).jsTrimmed, with: "")
        let owner = ownerPrefix.test(prefix) && !notAPerson.test(prefix) && !notASymbol.test(prefix) && ShiftRules.find(rules, prefix) == nil && !notAnOwner.test(prefix)
          ? ownerHonorific.replaceFirst(prefix, with: "") : currentSection
        for (index, token) in tokens.enumerated() {
          let end = index + 1 < tokens.count ? tokens[index + 1].index : line.jsLength
          let rest = line.jsSlice(token.index + token.length, end)
          let date = dateWithMonth(base, token.month, token.day, year: token.year)
          let source = line.jsSlice(token.index, token.index + token.length).jsTrimmed
          readRest(date, rest, token.weekday, source, owner, &skipped)
        }
        continue
      }
      if let bare = bareDay.exec(line) {
        let rest = bare[3] ?? ""
        let restIndex = line.jsIndexOf(rest)
        // JS の line.slice(0, line.indexOf(rest) || undefined)。0 のときは行の全体を見る。
        let head = restIndex == 0 ? line : line.jsSlice(0, restIndex)
        if ShiftText.clockRange(head) == nil {
          let value = (bare[1] ?? "0").jsInt
          if (1...31).contains(value), !rest.jsTrimmed.isEmpty {
            if value < previous { current = addMonths(current, 1) }
            previous = value
            readRest(ShiftText.isoDate(current.year, current.month, value), rest, bare[2], "\(value)日", currentSection, &skipped)
            continue
          }
        }
      }
      if let name = sectionName(line) { currentSection = name }
    }
    return entries
  }

  static let digitsOnly = JSRegex(#"^\d+$"#)
  static let weekdayChar = JSRegex("[日月火水木金土]")

  static func readTable(_ table: Located, _ split: [ShiftText.Cells], _ base: YearMonth, _ skipped: inout [String]) -> [Entry] {
    let dateList = dates(of: table.days, base: base)
    let count = table.days.count
    var entries: [Entry] = []
    let weekdays: [String] = table.weekdayIndex.map { index in
      let found = split[index].cells.filter { weekdayChar.test($0) && !nameLabels.test($0) }
      return Array(found.suffix(count))
    } ?? []
    for (index, item) in table.days.enumerated() where dateList[index] == nil {
      skipped.append("\(item.month.map { "\($0)/" } ?? "")\(item.day)は日付を読めないか、選んだ月から離れています。")
    }
    for rowIndex in table.rows {
      let cells = split[rowIndex].cells, exact = split[rowIndex].exact
      let longEnough = cells.count >= count + table.extras
      let offset = exact ? (table.labels.isEmpty ? (cells.count == count + table.extras + 1 ? 1 : 0) : table.labels.count)
        : longEnough ? cells.count - count - table.extras : table.labels.count
      let name = cells.prefix(max(0, offset)).filter { !$0.isEmpty && !digitsOnly.test($0) }.joined(separator: " ")
      if notAPerson.test(ShiftText.personKey(name)) { continue }
      for column in 0..<count {
        let position = offset + column
        guard let date = dateList[column], position >= 0, position < cells.count, !cells[position].isEmpty else { continue }
        let weekday = table.days[column].weekday ?? (column < weekdays.count ? weekdayDecoration.replaceAll(weekdays[column], with: "") : nil)
        entries.append(Entry(person: name, date: date, cell: cells[position], weekday: weekday))
      }
    }
    return entries
  }

  static func readColumns(_ table: Located, _ split: [ShiftText.Cells], _ base: YearMonth, _ skipped: inout [String]) -> [Entry] {
    let headers = table.labels
    let weekdayColumn = headers.firstIndex { weekdayLabels.test($0) } ?? -1
    let people: [(index: Int, name: String)] = headers.enumerated().compactMap { index, cell in
      index == 0 || index == weekdayColumn || cell.isEmpty ? nil : (index, columnLabels.test(cell) ? "" : cell)
    }
    let bare = table.rows.map { day(of: split[$0].cells.first ?? "") ?? Day(day: 0) }
    let sequence = dates(of: bare.map { $0.day == 0 ? Day(day: 1) : $0 }, base: base)
    var entries: [Entry] = []
    for (order, row) in table.rows.enumerated() {
      let cells = split[row].cells, exact = split[row].exact
      let first = cells.first ?? ""
      let token = dateTokens(first).first
      let found = day(of: first)
      let date: String?
      if let token { date = dateWithMonth(base, token.month, token.day, year: token.year) }
      else { date = found != nil ? sequence[order] : nil }
      guard let date else { skipped.append("「\(first)」は日付を読めないか、選んだ月から離れています。"); continue }
      let second = cells.count > 1 ? cells[1] : ""
      let shift = !exact && weekdayColumn < 0 && found?.weekday == nil && second.range(of: "^[日月火水木金土]$", options: .regularExpression) != nil ? 1 : 0
      let weekday = token?.weekday ?? found?.weekday ?? (weekdayColumn >= 0 ? (weekdayColumn < cells.count ? weekdayDecoration.replaceAll(cells[weekdayColumn], with: "") : nil) : shift == 1 ? second : nil)
      for person in people {
        let position = person.index + shift
        if position < cells.count, !cells[position].isEmpty { entries.append(Entry(person: person.name, date: date, cell: cells[position], weekday: weekday)) }
      }
    }
    return entries
  }

  /// 貼り付けた勤務表を読む。
  public static func parse(_ text: String, month: String, rules: [ShiftTimeRule], person: String? = nil) -> RosterResult {
    let lines = ShiftText.normalize(text.jsSlice(0, maxTextLength)).jsSplit("\n")
    let split = lines.map(ShiftText.cells)
    let base = parseMonth(month)
    var skipped: [String] = []
    let table = locateTable(lines, split) ?? locateColumns(split)
    var used = Set<Int>()
    if let table {
      used.insert(table.headerIndex)
      if let weekdayIndex = table.weekdayIndex { used.insert(weekdayIndex) }
      used.formUnion(table.rows)
    }
    let legend = legendOfLines(lines.enumerated().filter { !used.contains($0.offset) }.map(\.element))
    let merged = ShiftRules.merge(rules, legend)
    let entries: [Entry]
    switch table?.layout {
    case "table": entries = readTable(table!, split, base, &skipped)
    case "columns": entries = readColumns(table!, split, base, &skipped)
    default: entries = readLines(lines, base, merged, &skipped)
    }
    // JS の new Map(...) と同じく、同じ人は最初の位置に、最後の書き方で残す。
    var keys: [String] = []
    var names: [String: String] = [:]
    for entry in entries where !entry.person.isEmpty {
      let key = ShiftText.personKey(entry.person)
      if names[key] == nil { keys.append(key) }
      names[key] = entry.person
    }
    let people = keys.compactMap { names[$0] }
    let wanted = person?.jsTrimmed.isEmpty == false ? person!.jsTrimmed : (people.count == 1 ? people[0] : "")
    let named = !people.isEmpty
    let matching = named && wanted.isEmpty ? [] : entries.filter { !named || $0.person.isEmpty || ShiftText.samePerson($0.person, wanted) }
    var seen = Set<String>()
    var resolvedRows: [RosterRow] = []
    for entry in matching {
      let mismatch: Bool = entry.weekday.map { !$0.isEmpty && ShiftText.weekday(of: entry.date) != $0 } ?? false
      let warning: String? = mismatch ? "曜日が日付と合いません（表は\(entry.weekday ?? "")曜）" : nil
      for resolved in resolveCell(entry.cell, merged) {
        let row = RosterRow(date: entry.date, symbol: resolved.symbol, kind: resolved.kind, title: resolved.title, startTime: resolved.startTime, endTime: resolved.endTime, endsNextDay: resolved.endsNextDay, warning: warning)
        let key = "\(row.date)|\(row.title)|\(row.startTime ?? "")"
        if seen.insert(key).inserted { resolvedRows.append(row) }
      }
    }
    let rows = resolvedRows.stableSorted { (a: RosterRow, b: RosterRow) -> Bool in
      if a.date != b.date { return a.date < b.date }
      return (a.startTime ?? "") < (b.startTime ?? "")
    }.prefix(maxRows)
    return RosterResult(rows: Array(rows), people: people, legend: legend, skipped: skipped.uniqued(), layout: table?.layout ?? (entries.isEmpty ? "none" : "lines"))
  }

  static let fullMonth = JSRegex(#"(\d{4})\s*[年/.-]\s*(\d{1,2})(?:\s*月)?(?![\d/-])"#)
  static let namedMonth = JSRegex(#"(\d{1,2})\s*月\s*(?:度|分|の?シフト|の?勤務)"#)

  /// 表の見出しから対象の月を読む。読めなければ nil。
  public static func detectMonth(_ text: String, todayMonth: String) -> String? {
    let normalized = ShiftText.normalize(text.jsSlice(0, maxTextLength))
    if let full = fullMonth.exec(normalized), let month = full[2].map(\.jsInt), (1...12).contains(month) {
      return String(format: "%@-%02d", full[1] ?? "", month)
    }
    let named = namedMonth.exec(normalized)
    let token = dateTokens(normalized).first
    guard let month = named.map({ ($0[1] ?? "0").jsInt }) ?? token?.month, month != 0, month <= 12 else { return nil }
    if let year = token?.year, named == nil { return String(format: "%d-%02d", year, month) }
    let today = parseMonth(todayMonth)
    let nearest = [today.year - 1, today.year, today.year + 1].stableSorted { abs(monthGap(YearMonth(year: $0, month: month), today)) < abs(monthGap(YearMonth(year: $1, month: month), today)) }[0]
    return String(format: "%d-%02d", nearest, month)
  }
}
