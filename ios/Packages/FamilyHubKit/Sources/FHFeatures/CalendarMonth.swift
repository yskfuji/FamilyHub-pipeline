import SwiftUI
import FHModel
import FHDomain
import FHDesign

// 月の表示（Web の MonthView.tsx）。週の行ごとに、帯（終日・日をまたぐ予定）と1日の予定を段に並べる。
// 段の割り当ては FHDomain の CalendarLayout.layoutLanes（Web と同じ答え）。段に入らない予定は「+n」と日の一覧で示す。

private let weekdayNames = ["日", "月", "火", "水", "木", "金", "土"]

/// 曜日の見出し。日曜は赤、土曜は青。曜日は日のボタンの名前（9月30日(水)…）で伝えるので、この行は描くだけの飾り（Web の aria-hidden と同じ）。
struct WeekdayHeader: View {
  @Environment(\.theme) private var theme
  @ScaledMetric(relativeTo: .footnote) private var height: CGFloat = 22

  var body: some View {
    let colors = theme.colors
    Canvas { graphics, size in
      let width = size.width / 7
      for index in 0..<7 {
        let color = index == 0 ? colors.danger.color : index == 6 ? colors.accent.color : colors.inkSoft.color
        let text = graphics.resolve(Text(weekdayNames[index]).font(.footnote.weight(.bold)).foregroundStyle(color))
        graphics.draw(text, at: CGPoint(x: width * (CGFloat(index) + 0.5), y: size.height / 2), anchor: .center)
      }
    }
    .frame(height: height)
    .padding(.vertical, TokenSpace.space1)
    .accessibilityHidden(true)
  }
}

/// 1か月分の週の行。
struct MonthWeeks: View {
  let context: CalendarContext
  let monthKey: String
  let occurrences: [Occurrence]
  let holidays: [String: String]
  let expenseDays: Set<String>
  let maxLanes: Int
  /// 狭い幅の連続表示。ほかの月の日は出さず、帯も月の中で切る。
  var flow = false

  var body: some View {
    let clip = flow ? (from: "\(monthKey)-01", to: CalendarLayout.lastDayOfMonth(monthKey)) : nil
    VStack(spacing: 0) {
      ForEach(CalendarLayout.monthWeeks(monthKey), id: \.first?.date) { week in
        let dates = week.map(\.date)
        let items = occurrences.filter { item in dates.contains { CalendarLayout.occurs(item, on: $0) } }
        WeekRow(context: context, week: week, layout: CalendarLayout.layoutLanes(dates, items, maxLanes: maxLanes, clip: clip), counts: dates.map { date in items.filter { CalendarLayout.occurs($0, on: date) }.count },
                holidays: holidays, expenseDays: expenseDays, maxLanes: maxLanes, flow: flow)
        Divider()
      }
    }
  }
}

struct WeekRow: View {
  @Environment(\.theme) private var theme
  @ScaledMetric(relativeTo: .caption2) private var laneHeight: CGFloat = 17
  let context: CalendarContext
  let week: [CalendarDate.GridDate]
  let layout: CalendarLayout.LaneLayout
  let counts: [Int]
  let holidays: [String: String]
  let expenseDays: Set<String>
  let maxLanes: Int
  let flow: Bool

  var body: some View {
    let lanesHeight = CGFloat(maxLanes) * (laneHeight + 2) + TokenSpace.space1
    HStack(spacing: 0) {
      ForEach(Array(week.enumerated()), id: \.element.date) { column, day in
        if flow && !day.inCurrentMonth {
          Color.clear.frame(maxWidth: .infinity, minHeight: lanesHeight)
        } else {
          DayCell(context: context, day: day, holiday: holidays[day.date], count: counts[column], yen: expenseDays.contains(day.date), lanesHeight: lanesHeight)
        }
      }
    }
    // 段は日のマスの下の部分に描く。日の見出しの高さは文字の大きさで変わるので、下に合わせる。
    .overlay(alignment: .bottomLeading) {
      LaneCanvas(context: context, layout: layout, maxLanes: maxLanes, laneHeight: laneHeight)
        .frame(height: lanesHeight)
        // 段の上の項目は飾り。読み上げは日のボタンの説明と日の一覧で伝え、押すと下の日が選ばれる（Web と同じ）。
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }
}

/// 段の上の予定を描く。帯は前後に続く印（‹ ›）を付ける。文字は枠の中で切る。
struct LaneCanvas: View {
  @Environment(\.theme) private var theme
  let context: CalendarContext
  let layout: CalendarLayout.LaneLayout
  let maxLanes: Int
  let laneHeight: CGFloat

  var body: some View {
    let colors = theme.colors
    Canvas { graphics, size in
      let width = size.width / 7
      for placement in layout.placements {
        let occurrence = placement.occurrence
        let spanning = CalendarLayout.isSpanning(occurrence)
        let rect = CGRect(x: width * CGFloat(placement.colStart) + 2, y: CGFloat(placement.lane) * (laneHeight + 2),
                          width: max(0, width * CGFloat(placement.colEnd - placement.colStart + 1) - 4), height: laneHeight)
        graphics.drawLayer { layer in
          layer.clip(to: Path(rect))
          if spanning { layer.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(colors.mossSoft.color)) }
          if !placement.continuesBefore {
            let mark = context.color(occurrence.colorLabelId) ?? (spanning ? colors.moss.color : colors.accent.color)
            layer.fill(Path(CGRect(x: rect.minX, y: rect.minY, width: 3, height: rect.height)), with: .color(mark))
          }
          var label = placement.continuesBefore ? "‹ " : ""
          if !spanning, !context.narrow { label += Format.time(occurrence.startsAt) + " " }
          label += occurrence.title
          let text = layer.resolve(Text(label).font(.caption2.weight(.bold)).foregroundStyle(colors.ink.color))
          layer.draw(text, at: CGPoint(x: rect.minX + 5, y: rect.midY), anchor: .leading)
          if placement.continuesAfter {
            let arrow = layer.resolve(Text("›").font(.caption2.weight(.bold)).foregroundStyle(colors.inkSoft.color))
            layer.draw(arrow, at: CGPoint(x: rect.maxX - 2, y: rect.midY), anchor: .trailing)
          }
        }
      }
      for (column, count) in layout.hidden.enumerated() where count > 0 {
        let text = graphics.resolve(Text("+\(count)").font(.caption2.weight(.bold)).foregroundStyle(colors.inkSoft.color))
        graphics.draw(text, at: CGPoint(x: width * CGFloat(column) + 5, y: CGFloat(maxLanes - 1) * (laneHeight + 2) + laneHeight / 2), anchor: .leading)
      }
    }
  }
}

/// 日のマス。押すとその日を選ぶ。
struct DayCell: View {
  @Environment(\.theme) private var theme
  @ScaledMetric(relativeTo: .callout) private var headHeight: CGFloat = 26
  @ScaledMetric(relativeTo: .caption2) private var holidayHeight: CGFloat = 15
  let context: CalendarContext
  let day: CalendarDate.GridDate
  let holiday: String?
  let count: Int
  let yen: Bool
  let lanesHeight: CGFloat

  var body: some View {
    let colors = theme.colors
    let isToday = day.date == context.todayKey
    let isSelected = day.date == context.selected
    let tone = CalendarText.tone(day.date, holiday: holiday)
    let numberColor: Color = isToday ? colors.onAccent.color : tone == .holiday ? colors.danger.color : tone == .saturday ? colors.accent.color : colors.ink.color
    Button { context.select(day.date) } label: {
      // 日の見出し（日・祝日・支出の印）は描くだけにする。読み上げと声の操作は、ボタンの名前で伝える。
      Canvas { graphics, size in
        let number = graphics.resolve(Text("\(day.day)").font(.callout.weight(isToday ? .heavy : .semibold)).monospacedDigit().foregroundStyle(numberColor))
        let measured = number.measure(in: size)
        let origin = CGPoint(x: 7, y: 3)
        if isToday {
          graphics.fill(Path(roundedRect: CGRect(x: origin.x - 5, y: origin.y, width: measured.width + 10, height: measured.height), cornerRadius: measured.height / 2), with: .color(colors.accent.color))
        }
        graphics.draw(number, at: origin, anchor: .topLeading)
        if yen {
          let mark = graphics.resolve(Text("¥").font(.caption2.weight(.heavy)).foregroundStyle(day.inCurrentMonth ? colors.gold.color : colors.inkSoft.color))
          graphics.draw(mark, at: CGPoint(x: size.width - 4, y: origin.y + measured.height / 2), anchor: .trailing)
        }
        if let holiday {
          let name = graphics.resolve(Text(holiday).font(.caption2.weight(.bold)).foregroundStyle(colors.danger.color))
          graphics.drawLayer { layer in
            layer.clip(to: Path(CGRect(x: 0, y: 0, width: size.width - 2, height: size.height)))
            layer.draw(name, at: CGPoint(x: 4, y: origin.y + measured.height + 1), anchor: .topLeading)
          }
        }
      }
      .frame(height: headHeight + (holiday == nil ? 0 : holidayHeight))
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .padding(.bottom, lanesHeight)
      .background(isSelected ? colors.brandSoft.color : day.inCurrentMonth ? Color.clear : colors.paperDeep.color.opacity(0.6))
      .overlay { if isSelected { Rectangle().strokeBorder(colors.brand.color, lineWidth: 2) } }
      .opacity(day.inCurrentMonth ? 1 : 0.55)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel([CalendarText.day(day.date), holiday, "予定\(count)件", yen ? "支出あり" : nil].compactMap { $0 }.joined(separator: "、"))
    .accessibilityInputLabels([Text(verbatim: "\(day.day)"), Text(holiday ?? CalendarText.day(day.date))])
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .accessibilityValue(isToday ? "今日" : "")
    .accessibilityIdentifier("calendar.day.\(day.date)")
  }
}

/// 広い幅の1か月の表示。矢印などのキーで日を動かせる。
struct MonthGridView<Header: View>: View {
  @Environment(\.theme) private var theme
  let context: CalendarContext
  let monthKey: String
  @ViewBuilder let header: () -> Header
  @FocusState private var focused: Bool

  var body: some View {
    let weeks = CalendarLayout.monthWeeks(monthKey)
    let from = weeks.first?.first?.date ?? "\(monthKey)-01"
    let to = weeks.last?.last?.date ?? CalendarLayout.lastDayOfMonth(monthKey)
    let occurrences = CalendarLayout.occurrences(context.scoped.events, from: from, to: to)
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        header()
        VStack(spacing: 0) {
          WeekdayHeader()
          Divider()
          MonthWeeks(context: context, monthKey: monthKey, occurrences: occurrences, holidays: CalendarText.holidayMap(from, to), expenseDays: expenseDays(context), maxLanes: 4)
        }
        .background(theme.colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).strokeBorder(theme.colors.line.color))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("月の日付")
        .focusable()
        // 選んだ日の枠で位置を示すので、表全体に重なる焦点の色は出さない（文字の対比が変わる）。
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .home, .end, .pageUp, .pageDown]) { press in
          guard let key = CalendarDayKey(press.key) else { return .ignored }
          context.select(CalendarDate.moved(context.selected ?? context.todayKey, key))
          return .handled
        }
      }
      .padding(TokenSpace.space4)
    }
    .refreshable { await refresh() }
  }

  @Environment(AppModel.self) private var model
  private func refresh() async { await model.refresh() }
}

func expenseDays(_ context: CalendarContext) -> Set<String> {
  guard context.snapshot.viewer.capabilities.contains(.expenseRead) else { return [] }
  return Set(context.scoped.expenses.map(\.incurredOn))
}

extension CalendarDayKey {
  init?(_ key: KeyEquivalent) {
    switch key {
    case .leftArrow: self = .left
    case .rightArrow: self = .right
    case .upArrow: self = .up
    case .downArrow: self = .down
    case .home: self = .home
    case .end: self = .end
    case .pageUp: self = .pageUp
    case .pageDown: self = .pageDown
    default: return nil
    }
  }
}

/// 狭い幅の表示。月を縦に続け、下へ進むと次の月を足す。月の見出しは上に留まる。
struct MonthFlowView<Header: View>: View {
  @Environment(\.theme) private var theme
  @Environment(AppModel.self) private var model
  let context: CalendarContext
  let monthKey: String
  let jump: Int
  @ViewBuilder let header: () -> Header
  @State private var span: (from: String, to: String)?
  private static var lastMonth: String { "2100-12" }

  var body: some View {
    let range = span ?? (monthKey, CalendarDate.shiftMonth(monthKey, 2) ?? monthKey)
    let months = Self.months(range.from, range.to)
    let from = "\(range.from)-01", to = CalendarLayout.lastDayOfMonth(range.to)
    let occurrences = CalendarLayout.occurrences(context.scoped.events, from: from, to: to)
    let holidays = CalendarText.holidayMap(from, to)
    let expenses = expenseDays(context)
    // 曜日の行は上に固定する（iPhone のカレンダーと同じ）。月の見出しは本文と一緒に流れる。
    VStack(spacing: 0) {
      WeekdayHeader().background(theme.colors.paper.color)
      Divider()
    ScrollViewReader { proxy in
      ScrollView {
        header().padding(TokenSpace.space4)
        LazyVStack(spacing: 0) {
          ForEach(months, id: \.self) { month in
            VStack(spacing: 0) {
              HStack(spacing: TokenSpace.space2) {
                SeasonDot(key: month)
                Text(CalendarText.month(month)).font(.headline).foregroundStyle(theme.colors.ink.color).accessibilityAddTraits(.isHeader)
                Spacer()
              }
              .padding(.horizontal, TokenSpace.space4)
              .padding(.vertical, TokenSpace.space2)
              Divider()
              MonthWeeks(context: context, monthKey: month, occurrences: occurrences, holidays: holidays, expenseDays: expenses, maxLanes: 3, flow: true)
                .background(theme.colors.sheet.color)
            }
            .id(month)
          }
          if range.to < Self.lastMonth {
            ProgressView()
              .padding()
              .onAppear { span = (range.from, CalendarDate.shiftMonth(range.to, 1) ?? range.to) }
          }
        }
      }
      .refreshable { await model.refresh() }
      .onChange(of: monthKey) { _, next in
        // 前月・次月や年月の選択で範囲の外へ移ったら、その月まで広げる。
        let current = span ?? range
        if next < current.from || next > current.to { span = (min(next, current.from), max(next, current.to)) }
      }
      .onChange(of: jump) { _, _ in
        Task { @MainActor in withAnimation { proxy.scrollTo(monthKey, anchor: .top) } }
      }
    }
    }
  }

  static func months(_ from: String, _ to: String) -> [String] {
    var list = [from]
    while let last = list.last, last < to, let next = CalendarDate.shiftMonth(last, 1) { list.append(next) }
    return list
  }
}
