import Foundation
import FHModel

// カレンダーの配置。繰り返しの展開、月の表の段、時間軸の列。元: src/domain/calendarLayout.ts。
// 答えは scripts/ios/export-vectors.ts が TS の関数から作り、FHDomainTests で照らす。

/// 繰り返しを展開した1回分。event の startsAt / endsAt はその回の日時で、occurrenceDate はその回の始まりの日。
@dynamicMemberLookup
public struct Occurrence: Sendable, Hashable, Identifiable {
  public var event: CalendarEvent
  public var occurrenceDate: IsoDate

  public init(event: CalendarEvent, occurrenceDate: IsoDate) {
    self.event = event
    self.occurrenceDate = occurrenceDate
  }

  /// 画面の中で1回分を見分ける鍵。
  public var id: String { "\(event.id)-\(occurrenceDate)" }

  public subscript<Value>(dynamicMember keyPath: KeyPath<CalendarEvent, Value>) -> Value { event[keyPath: keyPath] }
}

public enum CalendarLayout {
  public static let minutesInDay = 24 * 60
  /// 時間軸の予定の最小の長さ。短い予定でも押せる高さを保ち、重なりもこの長さで判定する。
  public static let minBlockMinutes = 45

  static func dayGap(_ from: String, _ to: String) -> Int {
    guard let a = CivilDate(key: from), let b = CivilDate(key: to) else { return 0 }
    return b.daysSinceEpoch - a.daysSinceEpoch
  }

  public static func dateKey(_ value: String) -> String { CalendarDate.dateKey(fromRfc3339: value) ?? String(value.prefix(10)) }
  public static func add(_ key: String, _ days: Int) -> String { CalendarDate.addDays(key, days) ?? key }

  /// 日本時間の、その日の始まりからの分。
  public static func minutesOfDay(_ value: String) -> Int { TodayDigest.minutesOfDay(value) }

  /// 予定の最後の日。ちょうど0時に終わる予定は、前の日までの予定として扱う。
  public static func lastDate(startsAt: String, endsAt: String) -> String {
    let start = dateKey(startsAt)
    let end = dateKey(endsAt)
    return end > start && minutesOfDay(endsAt) == 0 ? add(end, -1) : end
  }

  public static func lastDate(_ event: CalendarEvent) -> String { lastDate(startsAt: event.startsAt, endsAt: event.endsAt) }
  public static func lastDate(_ occurrence: Occurrence) -> String { lastDate(occurrence.event) }

  static func occurrence(_ event: CalendarEvent, on date: String) -> Occurrence {
    let span = dayGap(dateKey(event.startsAt), dateKey(event.endsAt))
    var copy = event
    copy.startsAt = Recurrence.occurrenceStartsAt(event.startsAt, on: date)
    copy.endsAt = Recurrence.occurrenceStartsAt(event.endsAt, on: add(date, span))
    return Occurrence(event: copy, occurrenceDate: date)
  }

  /// dateKey に始まる回。繰り返しの回でなければ nil。
  public static func occurrence(startingOn dateKey: String, of event: CalendarEvent) -> Occurrence? {
    let start = Self.dateKey(event.startsAt)
    let hit = event.recurrence.map { Recurrence.occurrenceDates(start: start, recurrence: $0, from: dateKey, to: dateKey).count == 1 } ?? (start == dateKey)
    return hit ? occurrence(event, on: dateKey) : nil
  }

  /// [from, to] に1日でもかかる回。範囲より前に始まって続いている回も含める。
  public static func expand(_ event: CalendarEvent, from: String, to: String) -> [Occurrence] {
    let start = dateKey(event.startsAt)
    let earliest = add(from, -dayGap(start, lastDate(event)))
    let dates: [String]
    if let recurrence = event.recurrence {
      dates = Recurrence.occurrenceDates(start: start, recurrence: recurrence, from: earliest, to: to)
    } else {
      dates = start >= earliest && start <= to ? [start] : []
    }
    return dates.map { occurrence(event, on: $0) }
  }

  public static func occurrences(_ events: [CalendarEvent], from: String, to: String) -> [Occurrence] {
    events.flatMap { expand($0, from: from, to: to) }.stableSorted { $0.startsAt < $1.startsAt }
  }

  public static func occurs(_ occurrence: Occurrence, on date: String) -> Bool {
    occurrence.occurrenceDate <= date && lastDate(occurrence) >= date
  }

  /// 帯として描く予定（終日、または日をまたぐ予定）。
  public static func isSpanning(_ occurrence: Occurrence) -> Bool {
    occurrence.allDay == true || lastDate(occurrence) > occurrence.occurrenceDate
  }

  // MARK: 月の表の段

  public struct LanePlacement: Sendable, Hashable, Identifiable {
    public var occurrence: Occurrence
    public var lane: Int
    public var colStart: Int
    public var colEnd: Int
    public var continuesBefore: Bool
    public var continuesAfter: Bool
    public var id: String { occurrence.id }
  }

  public struct LaneLayout: Sendable, Hashable {
    public var placements: [LanePlacement]
    /// 列ごとの、段に入らなかった項目の数。
    public var hidden: [Int]
  }

  /// 週の行の段の割り当て。帯を先に長い順で段へ入れ、1日の項目はその列で空いている一番上の段へ入れる。
  /// 列の項目が段に収まらないときは、その列の最後の段を「+n」に使い、そこにかかる項目は隠して数える。
  /// clip を渡すと、その範囲の外の列には置かない（狭い幅の月の切れ目で使う）。
  public static func layoutLanes(_ dates: [String], _ occurrences: [Occurrence], maxLanes: Int, clip: (from: String, to: String)? = nil) -> LaneLayout {
    guard let firstDate = dates.first, let lastDateOfRow = dates.last else { return LaneLayout(placements: [], hidden: []) }
    let from = clip.map { $0.from > firstDate ? $0.from : firstDate } ?? firstDate
    let to = clip.map { $0.to < lastDateOfRow ? $0.to : lastDateOfRow } ?? lastDateOfRow
    var hidden = dates.map { _ in 0 }
    let inRange = occurrences.filter { $0.occurrenceDate <= to && lastDate($0) >= from }
    struct Segment { var item: Occurrence; var colStart: Int; var colEnd: Int; var lane = 0 }
    func segment(_ item: Occurrence) -> Segment {
      let first = item.occurrenceDate < from ? from : item.occurrenceDate
      let last = lastDate(item) > to ? to : lastDate(item)
      return Segment(item: item, colStart: dates.firstIndex(of: first) ?? -1, colEnd: dates.firstIndex(of: last) ?? -1)
    }
    let spans = inRange.filter(isSpanning).map(segment).stableSorted { a, b in
      if a.colStart != b.colStart { return a.colStart < b.colStart }
      let lengthA = a.colEnd - a.colStart, lengthB = b.colEnd - b.colStart
      if lengthA != lengthB { return lengthA > lengthB }
      return a.item.startsAt < b.item.startsAt
    }
    var used = dates.map { _ in Set<Int>() }
    func columns(_ start: Int, _ end: Int) -> ArraySlice<Set<Int>> {
      // JS の slice と同じく、範囲の外は空にする。
      let lower = max(0, start < 0 ? used.count + start : start), upper = min(used.count, end + 1)
      return lower < upper ? used[lower..<upper] : []
    }
    let packed = spans.map { span -> Segment in
      var span = span
      var lane = 0
      while columns(span.colStart, span.colEnd).contains(where: { $0.contains(lane) }) { lane += 1 }
      if span.colStart >= 0 { for column in span.colStart...max(span.colStart, span.colEnd) where column < used.count { used[column].insert(lane) } }
      span.lane = lane
      return span
    }
    let singles = inRange.filter { !isSpanning($0) }.map(segment).map { single -> Segment in
      var single = single
      var lane = 0
      guard single.colStart >= 0 else { return single }
      while used[single.colStart].contains(lane) { lane += 1 }
      used[single.colStart].insert(lane)
      single.lane = lane
      return single
    }
    let capacity = used.map { $0.count > maxLanes ? max(0, maxLanes - 1) : maxLanes }
    var placements: [LanePlacement] = []
    for segment in packed + singles {
      let lower = max(0, segment.colStart), upper = min(capacity.count, segment.colEnd + 1)
      let fits = lower >= upper || capacity[lower..<upper].allSatisfy { segment.lane < $0 }
      if fits {
        placements.append(LanePlacement(
          occurrence: segment.item, lane: segment.lane, colStart: segment.colStart, colEnd: segment.colEnd,
          continuesBefore: segment.colStart >= 0 && segment.item.occurrenceDate < dates[segment.colStart],
          continuesAfter: segment.colEnd >= 0 && lastDate(segment.item) > dates[segment.colEnd]))
      } else {
        for column in lower..<upper { hidden[column] += 1 }
      }
    }
    return LaneLayout(placements: placements, hidden: hidden)
  }

  // MARK: 時間軸

  public struct TimelineBlock: Sendable, Hashable, Identifiable {
    public var occurrence: Occurrence
    /// その日の始まりからの分。短い予定は minBlockMinutes まで伸ばす。
    public var start: Int
    public var end: Int
    public var column: Int
    public var columns: Int
    public var id: String { occurrence.id }
  }

  /// その日の時間軸に置く予定を、重なりごとに列へ分ける。maxColumns に入らない列の予定は hidden に数える。
  public static func layoutTimeline(_ occurrences: [Occurrence], date: String, maxColumns: Int) -> (blocks: [TimelineBlock], hidden: Int) {
    struct Timed { var occurrence: Occurrence; var start: Int; var end: Int }
    let timed = occurrences.filter { !isSpanning($0) && occurs($0, on: date) }.map { occurrence -> Timed in
      let start = min(minutesOfDay(occurrence.startsAt), minutesInDay - minBlockMinutes)
      let stopRaw = minutesOfDay(occurrence.endsAt)
      let stop = stopRaw == 0 ? minutesInDay : stopRaw
      return Timed(occurrence: occurrence, start: start, end: min(minutesInDay, max(stop, start + minBlockMinutes)))
    }.stableSorted { a, b in a.start != b.start ? a.start < b.start : b.end < a.end }
    var blocks: [TimelineBlock] = []
    var hidden = 0
    var cursor = 0
    while cursor < timed.count {
      var cluster = [timed[cursor]]
      var clusterEnd = timed[cursor].end
      cursor += 1
      while cursor < timed.count, timed[cursor].start < clusterEnd {
        cluster.append(timed[cursor])
        clusterEnd = max(clusterEnd, timed[cursor].end)
        cursor += 1
      }
      var columnEnds: [Int] = []
      let assigned = cluster.map { item -> (Timed, Int) in
        let column = columnEnds.firstIndex { $0 <= item.start } ?? columnEnds.count
        if column == columnEnds.count { columnEnds.append(item.end) } else { columnEnds[column] = item.end }
        return (item, column)
      }
      let columns = min(columnEnds.count, maxColumns)
      for (item, column) in assigned {
        if column < columns { blocks.append(TimelineBlock(occurrence: item.occurrence, start: item.start, end: item.end, column: column, columns: columns)) }
        else { hidden += 1 }
      }
    }
    return (blocks, hidden)
  }

  /// 押した位置を30分の刻みの開始時刻（分）にする。
  public static func slotMinutes(offsetY: Double, hourHeight: Double) -> Int {
    guard hourHeight > 0 else { return 9 * 60 }
    return max(0, min(minutesInDay - 30, Int((offsetY / hourHeight * 2).rounded(.down)) * 30))
  }

  public static func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }

  /// 時間軸を開いたときの先頭の分。今日を含むなら今の1時間前、そうでなければ7時。
  public static func initialTimelineMinutes(_ dates: [String], today: String, now: Int) -> Int {
    dates.contains(today) ? max(0, now - 60) : 7 * 60
  }

  /// 月の週。ほかの月の日だけの週は出さない。
  public static func monthWeeks(_ monthKey: String) -> [[CalendarDate.GridDate]] {
    let grid = CalendarDate.monthGrid(monthKey)
    guard grid.count == 42 else { return [] }
    return (0..<6).map { Array(grid[($0 * 7)..<($0 * 7 + 7)]) }.filter { $0.contains { $0.inCurrentMonth } }
  }

  public static func lastDayOfMonth(_ monthKey: String) -> String {
    guard let next = CalendarDate.shiftMonth(monthKey, 1) else { return "\(monthKey)-31" }
    return add("\(next)-01", -1)
  }

  /// その日に関わるタスク。期間のあるタスクは期間の日すべてに出す。
  public static func todos(_ todos: [Todo], on date: String) -> [Todo] {
    todos.filter { todo in
      guard let dueAt = todo.dueAt else { return false }
      let end = dateKey(dueAt)
      return (todo.dueStartAt.map(dateKey) ?? end) <= date && date <= end
    }
  }

  public static func expenses(_ expenses: [Expense], on date: String) -> [Expense] {
    expenses.filter { $0.incurredOn == date }
  }
}
