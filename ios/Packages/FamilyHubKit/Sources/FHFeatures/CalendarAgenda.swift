import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 一覧（Web の AgendaView.tsx）。月の初めから日ごとに読み、「さらに表示」で30日ずつ後の日を足す。
/// Web は画面の端に近づくと自動で足すが、アプリでは押したときだけにする（読んでいる途中で中身が伸びて位置がずれないように）。
struct AgendaListView<Header: View>: View {
  @Environment(\.theme) private var theme
  @Environment(AppModel.self) private var model
  let context: CalendarContext
  let monthKey: String
  @ViewBuilder let header: () -> Header
  @State private var to: String?

  private static var stepDays: Int { 30 }
  private static var maxDays: Int { 366 }

  var body: some View {
    let colors = theme.colors
    let from = "\(monthKey)-01"
    let limit = CalendarLayout.add(from, Self.maxDays)
    let end = to ?? CalendarLayout.lastDayOfMonth(monthKey)
    let occurrences = CalendarLayout.occurrences(context.scoped.events, from: from, to: end)
    let holidays = CalendarText.holidayMap(from, end)
    let days = Self.days(occurrences, from: from, to: end, anchors: [context.todayKey, context.selected].compactMap { $0 })
    let canGrow = end < limit
    ScrollViewReader { proxy in
      ScrollView {
        header().padding(TokenSpace.space4)
        VStack(alignment: .leading, spacing: 0) {
          ForEach(days, id: \.self) { day in
            VStack(alignment: .leading, spacing: 0) {
              AgendaHeading(day: day, today: day == context.todayKey, holiday: holidays[day]).id(day)
              let entries = occurrences.filter { CalendarLayout.occurs($0, on: day) }
              if entries.isEmpty {
                Text("予定はありません").font(.footnote).foregroundStyle(colors.inkSoft.color).padding(.horizontal, TokenSpace.space4).padding(.vertical, TokenSpace.space2)
              } else {
                ForEach(entries) { entry in OccurrenceRow(context: context, occurrence: entry, day: day).padding(.horizontal, TokenSpace.space4) }
              }
            }
          }
          // 空の状態は、今日（と選んだ日）の行の下に置く（Web の段階12と同じ）。
          if occurrences.isEmpty {
            EmptyStateView(title: "\(CalendarText.month(monthKey))からの予定はありません", message: "前月・次月の予定も確認できます。", illustration: .emptyEvents) {
              if context.canCreate {
                Button("この月に予定を追加") { context.create(context.selected ?? from, nil) }.fhButton(.primary)
              }
            }
            .padding(TokenSpace.space4)
          }
          if canGrow {
            Button("さらに表示") { to = min(CalendarLayout.add(end, Self.stepDays), limit) }
              .fhButton(.secondary)
              .padding(TokenSpace.space4)
          } else {
            Text("\(limit.prefix(4) != from.prefix(4) ? "\(Int(limit.prefix(4)) ?? 0)年" : "")\(CalendarText.day(limit))までの予定を表示しました。")
              .font(.footnote).foregroundStyle(colors.inkSoft.color).padding(TokenSpace.space4)
          }
        }
      }
      .refreshable { await model.refresh() }
      .onAppear {
        if let selected = context.selected, selected != from { Task { @MainActor in proxy.scrollTo(selected, anchor: .top) } }
      }
    }
  }

  static func days(_ occurrences: [Occurrence], from: String, to: String, anchors: [String]) -> [String] {
    var dates = Set(anchors.filter { $0 >= from && $0 <= to })
    for item in occurrences {
      var date = item.occurrenceDate < from ? from : item.occurrenceDate
      while CalendarLayout.occurs(item, on: date), date <= to {
        dates.insert(date)
        date = CalendarLayout.add(date, 1)
      }
    }
    return dates.sorted()
  }
}

struct AgendaHeading: View {
  @Environment(\.theme) private var theme
  let day: String
  let today: Bool
  let holiday: String?

  var body: some View {
    let colors = theme.colors
    let tone = CalendarText.tone(day, holiday: holiday)
    // 1つの文にして、文字が大きいときは折り返す（部品を入れ替えると、文字の大きさに付いていけない）。
    var line = Text(CalendarText.day(day)).font(.subheadline.weight(.bold))
      .foregroundStyle(tone == .holiday ? colors.danger.color : tone == .saturday ? colors.accent.color : colors.ink.color)
    if today { line = line + Text("　今日").font(.caption.weight(.bold)).foregroundStyle(colors.info.color) }
    if let holiday { line = line + Text("　\(holiday)").font(.caption.weight(.bold)).foregroundStyle(colors.danger.color) }
    return line
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, TokenSpace.space4)
    .padding(.vertical, TokenSpace.space2)
    .frame(maxWidth: .infinity)
    .background(colors.paper.color)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }
}

/// 一覧と日の一覧の1行。リストの色は文字ではなく左の線にだけ使う。
struct OccurrenceRow: View {
  @Environment(\.theme) private var theme
  @Environment(\.dynamicTypeSize) private var typeSize
  let context: CalendarContext
  let occurrence: Occurrence
  let day: String

  var body: some View {
    let colors = theme.colors
    let time = Text(CalendarText.time(occurrence, on: day)).font(.callout.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color).fixedSize()
    let text = VStack(alignment: .leading, spacing: 2) {
      Text(occurrence.title).font(.body.weight(.bold)).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
      Text(occurrence.location ?? "場所は未設定です").font(.caption.weight(.semibold)).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
    }
    let open = Button("開く") { context.open(occurrence) }.fhButton(.secondary).accessibilityLabel("\(occurrence.title)を開く")
    Group {
      // 文字がとても大きいときは、時刻・名前・開くを縦に並べる。
      if typeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: TokenSpace.space2) { time; text; open }
      } else {
        HStack(alignment: .center, spacing: TokenSpace.space3) {
          time.frame(minWidth: 48, alignment: .leading)
          text
          Spacer(minLength: TokenSpace.space2)
          open
        }
      }
    }
    .padding(.vertical, TokenSpace.space2)
    .padding(.leading, TokenSpace.space2)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .leading) { Rectangle().fill(context.color(occurrence.colorLabelId) ?? .clear).frame(width: 3) }
  }
}

/// 選んだ日の予定、タスク、支出（Web の DayPanel.tsx）。
struct DayEntriesView: View {
  @Environment(\.theme) private var theme
  let context: CalendarContext

  var body: some View {
    let colors = theme.colors
    let snapshot = context.snapshot
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      Eyebrow("選択した日")
      if let selected = context.selected {
        let events = CalendarLayout.occurrences(context.scoped.events, from: selected, to: selected)
        let next = Holidays.between(selected, CalendarLayout.add(selected, 400)).first
        let todos = snapshot.viewer.capabilities.contains(.taskRead) ? CalendarLayout.todos(context.scoped.todos, on: selected) : []
        let expenses = snapshot.viewer.capabilities.contains(.expenseRead) ? CalendarLayout.expenses(context.scoped.expenses, on: selected) : []
        Text(CalendarText.day(selected)).font(.title2.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        if let next, next.date == selected { Text(next.name).font(.callout.weight(.bold)).foregroundStyle(colors.danger.color) }
        if events.isEmpty {
          Text("この日の予定はありません。").foregroundStyle(colors.inkSoft.color)
        } else {
          VStack(spacing: 0) {
            ForEach(events) { event in
              OccurrenceRow(context: context, occurrence: event, day: selected)
              Divider()
            }
          }
        }
        if context.canCreate {
          Button("この日に予定を追加") { context.create(selected, nil) }.fhButton(.secondary)
        }
        if !todos.isEmpty {
          Text("タスク").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          ForEach(todos) { todo in
            HStack {
              Image(systemName: todo.status == .done ? "checkmark.circle.fill" : "circle").foregroundStyle(todo.status == .done ? colors.success.color : colors.inkSoft.color).accessibilityHidden(true)
              VStack(alignment: .leading, spacing: 2) {
                Text(todo.title).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
                Text(taskStatusLabel(todo.status)).font(.caption.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
              }
            }
            .accessibilityElement(children: .combine)
          }
        }
        if !expenses.isEmpty {
          Text("家計").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          ForEach(expenses) { expense in
            HStack {
              Text(expense.title).foregroundStyle(colors.ink.color)
              Spacer()
              if expense.kind == .income { StatusBadge("収入", tone: .success) }
              Text(Format.yen(expense.amountJpy)).monospacedDigit().foregroundStyle(colors.ink.color)
            }
            .accessibilityElement(children: .combine)
          }
        }
        Divider()
        Text("次の祝日").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        Text(next.map { "\(CalendarText.day($0.date)) \($0.name)" } ?? "登録されている祝日はありません。").foregroundStyle(colors.inkSoft.color)
      } else {
        Text("日付を選んでください").font(.title2.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        Text("カレンダーの日付を選ぶと、その日の予定を確認できます。").foregroundStyle(colors.inkSoft.color)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

func taskStatusLabel(_ status: TodoStatus) -> String {
  let labels = Copy.ja.taskStatusLabels.self
  return switch status {
  case .open: labels.open
  case .doing: labels.doing
  case .review: labels.review
  case .waiting: labels.waiting
  case .done: labels.done
  default: status.rawValue
  }
}
