import SwiftUI
import FHModel
import FHDomain
import FHDesign

/// 週と日の時間軸（Web の TimelineView.tsx）。何もない所を押すと、その30分の枠で予定の追加を開く。
/// 重なる予定の列の分け方は FHDomain の CalendarLayout.layoutTimeline（Web と同じ答え）。
struct TimelineScreen<Header: View>: View {
  @Environment(\.theme) private var theme
  @Environment(AppModel.self) private var model
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .body) private var hourHeight: CGFloat = 52
  let context: CalendarContext
  let dates: [String]
  @ViewBuilder let header: () -> Header
  @State private var openedAt: Int?

  private var week: Bool { dates.count > 1 }
  /// 押せる幅を保てる列の数。入らない予定は「他n件」と日の一覧で示す。
  private var maxColumns: Int { week ? (context.narrow ? 1 : 2) : (context.narrow ? 4 : 6) }

  var body: some View {
    // 文字がとても大きいときは、時間軸に入りきらないので、日ごとの一覧にする（同じ予定を同じ順で読む）。
    if typeSize.isAccessibilitySize { DaysListView(context: context, dates: dates, header: header) } else { timeline }
  }

  @ViewBuilder private var timeline: some View {
    let colors = theme.colors
    let from = dates.first ?? context.todayKey, to = dates.last ?? context.todayKey
    let occurrences = CalendarLayout.occurrences(context.scoped.events, from: from, to: to)
    let holidays = CalendarText.holidayMap(from, to)
    let layouts = Dictionary(uniqueKeysWithValues: dates.map { ($0, CalendarLayout.layoutTimeline(occurrences, date: $0, maxColumns: maxColumns)) })
    let now = TodayDigest.minutesOfDay(context.snapshot.context.asOf)
    // 日付の行は上に固定する（時刻の列と同じ幅で並べる）。
    VStack(spacing: 0) {
    DateRow(context: context, dates: dates, holidays: holidays, hidden: dates.map { layouts[$0]?.hidden ?? 0 })
      .background(colors.paper.color)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("fixed-bar.calendar-dates")
    ScrollViewReader { proxy in
      ScrollView {
        header().padding(TokenSpace.space4)
        VStack(spacing: 0) {
          AllDayRow(context: context, dates: dates, occurrences: occurrences)
          Divider()
          HStack(alignment: .top, spacing: 0) {
            HourGutter(hourHeight: hourHeight)
            ForEach(dates, id: \.self) { date in
              DayColumn(context: context, date: date, blocks: layouts[date]?.blocks ?? [], hourHeight: hourHeight, now: date == context.todayKey ? now : nil)
            }
          }
          .padding(.bottom, TokenSpace.space6)
        }
        .background(colors.sheet.color)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(week ? "\(CalendarText.day(from))から\(CalendarText.day(to))の予定" : "\(CalendarText.day(from))の予定")
      }
      .refreshable { await model.refresh() }
      .onAppear {
        let first = CalendarLayout.initialTimelineMinutes(dates, today: context.todayKey, now: openedAt ?? now)
        openedAt = openedAt ?? now
        Task { @MainActor in proxy.scrollTo("hour-\(first / 60)", anchor: .top) }
      }
    }
    }
  }
}

private let weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"]

/// 日付の行。押すとその日を選ぶ。
struct DateRow: View {
  @Environment(\.theme) private var theme
  @ScaledMetric(relativeTo: .caption2) private var gutter: CGFloat = 46
  let context: CalendarContext
  let dates: [String]
  let holidays: [String: String]
  let hidden: [Int]

  var body: some View {
    let colors = theme.colors
    HStack(spacing: 0) {
      Color.clear.frame(width: gutter)
      ForEach(Array(dates.enumerated()), id: \.element) { index, date in
        let holiday = holidays[date]
        let tone = CalendarText.tone(date, holiday: holiday)
        let selected = date == context.selected
        let isToday = date == context.todayKey
        Button { context.select(date) } label: {
          VStack(spacing: 1) {
            VStack(spacing: 0) {
              Text("\(Int(date.suffix(2)) ?? 0)").font(.headline).monospacedDigit().fixedSize()
              Text(weekdayLabels[CivilDate(key: date)?.weekday ?? 0]).font(.caption2.weight(.bold)).fixedSize()
            }
            .foregroundStyle(tone == .holiday ? colors.danger.color : tone == .saturday ? colors.accent.color : colors.ink.color)
            if let holiday { Text(holiday).font(.caption2.weight(.bold)).foregroundStyle(colors.danger.color).lineLimit(1) }
            if hidden[index] > 0 { Text("他\(hidden[index])件").font(.caption2).foregroundStyle(colors.inkSoft.color) }
          }
          .frame(maxWidth: .infinity, minHeight: 44)
          .background(selected ? colors.brandSoft.color : .clear)
          .overlay(alignment: .bottom) { if isToday { Rectangle().fill(colors.accent.color).frame(height: 3) } }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel([CalendarText.day(date), holiday, hidden[index] > 0 ? "ほかに\(hidden[index])件" : nil].compactMap { $0 }.joined(separator: "、"))
        .accessibilityValue(isToday ? "今日" : "")
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .padding(.vertical, TokenSpace.space1)
    .overlay(alignment: .bottom) { Divider() }
  }
}

/// 終日と日をまたぐ予定の帯。
struct AllDayRow: View {
  @Environment(\.theme) private var theme
  @ScaledMetric(relativeTo: .caption2) private var gutter: CGFloat = 46
  @ScaledMetric(relativeTo: .caption) private var laneHeight: CGFloat = 26
  let context: CalendarContext
  let dates: [String]
  let occurrences: [Occurrence]

  var body: some View {
    let colors = theme.colors
    let spanning = occurrences.filter(CalendarLayout.isSpanning)
    let maxLanes = dates.count == 1 ? 4 : context.narrow ? 2 : 3
    let layout = CalendarLayout.layoutLanes(dates, spanning, maxLanes: maxLanes)
    let lanes = max(1, (layout.placements.map(\.lane).max() ?? -1) + 1 + (layout.hidden.contains { $0 > 0 } ? 1 : 0))
    HStack(alignment: .top, spacing: 0) {
      Text("終日").font(.caption2.weight(.bold)).foregroundStyle(colors.inkSoft.color).fixedSize().frame(width: gutter, alignment: .center).padding(.top, 6)
      GeometryReader { proxy in
        let width = proxy.size.width / CGFloat(dates.count)
        ForEach(layout.placements) { placement in
          let occurrence = placement.occurrence
          Button { context.open(occurrence) } label: {
            HStack(spacing: 2) {
              if placement.continuesBefore { Text("‹").foregroundStyle(colors.inkSoft.color) }
              Text(occurrence.title).lineLimit(1)
              Spacer(minLength: 0)
              if placement.continuesAfter { Text("›").foregroundStyle(colors.inkSoft.color) }
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(colors.ink.color)
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(colors.mossSoft.color, in: RoundedRectangle(cornerRadius: 4))
            .overlay(alignment: .leading) { Rectangle().fill(context.color(occurrence.colorLabelId) ?? colors.moss.color).frame(width: 3) }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .frame(width: max(0, width * CGFloat(placement.colEnd - placement.colStart + 1) - 4), height: laneHeight - 2)
          .offset(x: width * CGFloat(placement.colStart) + 2, y: CGFloat(placement.lane) * laneHeight + 2)
          .accessibilityLabel("\(occurrence.title)を開く")
        }
        ForEach(Array(layout.hidden.enumerated()), id: \.offset) { column, count in
          if count > 0 {
            Text("他\(count)件").font(.caption2.weight(.bold)).foregroundStyle(colors.inkSoft.color)
              .frame(width: width - 4, height: laneHeight - 2, alignment: .leading)
              .offset(x: width * CGFloat(column) + 4, y: CGFloat(maxLanes - 1) * laneHeight + 2)
          }
        }
      }
      .frame(height: CGFloat(min(lanes, maxLanes)) * laneHeight + 4)
    }
  }
}

/// 時刻の目盛り。
struct HourGutter: View {
  @Environment(\.theme) private var theme
  @ScaledMetric(relativeTo: .caption2) private var width: CGFloat = 46
  let hourHeight: CGFloat
  var body: some View {
    VStack(spacing: 0) {
      ForEach(0..<24, id: \.self) { hour in
        Text(hour == 0 ? "" : "\(hour):00")
          .font(.caption2.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(theme.colors.inkSoft.color)
          .fixedSize()
          .frame(width: width, height: hourHeight, alignment: .topTrailing)
          .padding(.trailing, 4)
          .offset(y: -6)
          .id("hour-\(hour)")
      }
    }
    .frame(width: width)
    .accessibilityHidden(true)
  }
}

/// 1日の列。何もない所を押すと、その30分の枠で予定の追加を開く。
struct DayColumn: View {
  @Environment(\.theme) private var theme
  let context: CalendarContext
  let date: String
  let blocks: [CalendarLayout.TimelineBlock]
  let hourHeight: CGFloat
  let now: Int?

  var body: some View {
    let colors = theme.colors
    let total = hourHeight * 24
    ZStack(alignment: .topLeading) {
      // 時刻の線。
      VStack(spacing: 0) {
        ForEach(0..<24, id: \.self) { _ in
          Rectangle().fill(colors.line.color).frame(height: 1).frame(maxHeight: .infinity, alignment: .top)
        }
      }
      .frame(height: total)
      .accessibilityHidden(true)
      if context.canCreate {
        Color.clear
          .contentShape(Rectangle())
          .frame(height: total)
          .onTapGesture { location in
            context.create(date, CalendarLayout.clock(CalendarLayout.slotMinutes(offsetY: location.y, hourHeight: hourHeight)))
          }
          // 読み上げや声で操作するときは位置がないので、朝の枠で開く（Web のキーボードと同じ）。
          .accessibilityElement()
          .accessibilityLabel("\(CalendarText.day(date))に予定を追加")
          .accessibilityAddTraits(.isButton)
          .accessibilityAction { context.create(date, CalendarLayout.clock(9 * 60)) }
      }
      GeometryReader { proxy in
        ForEach(blocks) { block in
          let width = (proxy.size.width - 4) / CGFloat(block.columns)
          TimelineBlockView(context: context, block: block)
            .frame(width: max(0, width - 2), height: max(hourHeight * 0.8, hourHeight * CGFloat(block.end - block.start) / 60 - 1))
            .offset(x: 2 + width * CGFloat(block.column), y: hourHeight * CGFloat(block.start) / 60)
        }
        if let now {
          let y = hourHeight * CGFloat(now) / 60
          ZStack(alignment: .leading) {
            Rectangle().fill(colors.danger.color).frame(height: 2)
            Circle().fill(colors.danger.color).frame(width: 8, height: 8).offset(x: -4)
          }
          .offset(y: y - 1)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
        }
      }
      .frame(height: total)
    }
    .frame(maxWidth: .infinity)
    .overlay(alignment: .leading) { Rectangle().fill(colors.line.color).frame(width: 1).accessibilityHidden(true) }
  }
}

struct TimelineBlockView: View {
  @Environment(\.theme) private var theme
  let context: CalendarContext
  let block: CalendarLayout.TimelineBlock

  var body: some View {
    let colors = theme.colors
    let occurrence = block.occurrence
    let start = Format.time(occurrence.startsAt), end = Format.time(occurrence.endsAt)
    Button { context.open(occurrence) } label: {
      VStack(alignment: .leading, spacing: 0) {
        // 色の付いた面の上なので、時刻も濃い文字にする（薄い文字では対比が足りない）。
        Text(start).font(.caption2.weight(.semibold)).monospacedDigit().foregroundStyle(colors.ink.color).fixedSize()
        // 名前は省略記号にせず、枠の下で切る。全部の名前は読み上げの名前と日の一覧で示す（Web と同じ）。
        Text(occurrence.title).font(.caption.weight(.bold)).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
      }
      .padding(4)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .background(colors.accent.mixed(0.12, with: colors.sheet).color, in: RoundedRectangle(cornerRadius: 4))
      .overlay(alignment: .leading) { Rectangle().fill(context.color(occurrence.colorLabelId) ?? colors.accent.color).frame(width: 3) }
      .clipShape(RoundedRectangle(cornerRadius: 4))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    // 名前は見えている「時刻 予定名」から始め、終わりの時刻は後ろに足す（Web と同じ）。
    .accessibilityLabel("\(start)\(occurrence.title)を開く（\(start)〜\(end)）")
  }
}


/// 文字がとても大きいときの週と日（Web の一覧と同じ並び）。日ごとに見出しを置き、予定を時刻の順に並べる。
struct DaysListView<Header: View>: View {
  @Environment(\.theme) private var theme
  @Environment(AppModel.self) private var model
  let context: CalendarContext
  let dates: [String]
  @ViewBuilder let header: () -> Header

  var body: some View {
    let colors = theme.colors
    let from = dates.first ?? context.todayKey, to = dates.last ?? context.todayKey
    let occurrences = CalendarLayout.occurrences(context.scoped.events, from: from, to: to)
    let holidays = CalendarText.holidayMap(from, to)
    ScrollView {
      header().padding(TokenSpace.space4)
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(dates, id: \.self) { day in
          AgendaHeading(day: day, today: day == context.todayKey, holiday: holidays[day])
          let entries = occurrences.filter { CalendarLayout.occurs($0, on: day) }
          if entries.isEmpty {
            Text("予定はありません").font(.footnote).foregroundStyle(colors.inkSoft.color).padding(.horizontal, TokenSpace.space4).padding(.vertical, TokenSpace.space2)
          }
          ForEach(entries) { entry in OccurrenceRow(context: context, occurrence: entry, day: day).padding(.horizontal, TokenSpace.space4) }
          if context.canCreate {
            Button("\(CalendarText.day(day))に予定を追加") { context.create(day, nil) }.fhButton(.secondary).padding(.horizontal, TokenSpace.space4).padding(.bottom, TokenSpace.space2)
          }
        }
      }
    }
    .refreshable { await model.refresh() }
  }
}
