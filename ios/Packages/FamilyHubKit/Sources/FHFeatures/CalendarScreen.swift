import SwiftUI
import FHModel
import FHDomain
import FHDesign

/// 予定の画面（Web の src/features/calendar/CalendarPage.tsx）。月・週・日・一覧で、家族の予定と参加者を見る。
/// iPhone の月は月を縦に続けて読み、日を押すと下からその日の一覧を出す。iPad の月は表と、横にその日の一覧を置く。
struct CalendarScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.dynamicTypeSize) private var typeSize

  @AppStorage("fh.calendarView") private var storedView = CalendarView.month.rawValue
  @State private var monthKey: String?
  @State private var selected: String?
  /// 前月・次月・今月・年月の選択で移ったか（狭い幅の月で、その月まで送るため）。
  @State private var jump = 0
  @State private var daySheet = false
  @State private var monthPicker = false
  @State private var opened: OpenedEvent?
  @State private var creating: EventFormRequest?
  @State private var shiftReader = false
  @State private var eventReader = false
  @State private var deleted: DeletedEvent?
  @State private var readingStatus: AssistantStatus?

  private var view: CalendarView { CalendarView(rawValue: storedView) ?? .month }
  private var narrow: Bool { sizeClass == .compact }

  var body: some View {
    let colors = theme.colors
    Group {
      if let snapshot = model.snapshot {
        content(snapshot)
      } else if model.loading {
        ProgressView("予定を読み込んでいます。").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(colors.paper.color.ignoresSafeArea())
    .task { await loadReadingStatus() }
  }

  private func today(_ snapshot: HouseholdSnapshot) -> String { CalendarDate.dateKey(fromRfc3339: snapshot.context.asOf) ?? "2026-09-30" }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot) -> some View {
    let todayKey = today(snapshot)
    let month = monthKey ?? String(todayKey.prefix(7))
    let chosen = selected ?? (month == String(todayKey.prefix(7)) ? todayKey : nil)
    let anchor = chosen ?? "\(month)-01"
    let scoped = MemberScope.scoped(snapshot, scope: preferences.memberScope)
    let context = CalendarContext(snapshot: snapshot, scoped: scoped, todayKey: todayKey, selected: chosen, narrow: narrow, canCreate: model.can(.eventCreate),
                                  select: { select($0, snapshot: snapshot) }, open: { opened = OpenedEvent(occurrence: $0) },
                                  create: { date, time in creating = EventFormRequest(prefill: EventPrefill(date: date, time: time)) })
    let heading = CalendarText.heading(view: view, monthKey: month, anchor: anchor)
    let toolbar = CalendarToolbar(view: view, heading: heading, monthKey: month, onView: { change(to: $0, anchor: anchor) }, onStep: { step($0, month: month, anchor: anchor) },
                                  onToday: { jumpTo(String(todayKey.prefix(7)), date: todayKey) }, onMonth: { monthPicker = true })
    // 文字がとても大きいときは、操作の帯を本文と一緒に流す（上に固定すると本文の場所がなくなる）。
    let floating = typeSize.isAccessibilitySize
    VStack(spacing: 0) {
      if !floating {
        toolbar
        Divider()
      }
      switch view {
      case .month:
        if narrow {
          MonthFlowView(context: context, monthKey: month, jump: jump) { header(snapshot, context: context, toolbar: floating ? toolbar : nil) }
        } else {
          sideBySide(context: context) { MonthGridView(context: context, monthKey: month) { header(snapshot, context: context, toolbar: floating ? toolbar : nil) } }
        }
      case .week:
        sideBySide(context: context) { TimelineScreen(context: context, dates: CalendarDate.weekDates(anchor)) { header(snapshot, context: context, toolbar: floating ? toolbar : nil) } }
      case .day:
        sideBySide(context: context) { TimelineScreen(context: context, dates: [anchor]) { header(snapshot, context: context, toolbar: floating ? toolbar : nil) }.id(anchor) }
      case .list:
        if narrow {
          AgendaListView(context: context, monthKey: month) { header(snapshot, context: context, toolbar: floating ? toolbar : nil) }.id(month)
        } else {
          sideBySide(context: context) { AgendaListView(context: context, monthKey: month) { header(snapshot, context: context, toolbar: floating ? toolbar : nil) }.id(month) }
        }
      }
    }
    .sheet(isPresented: $daySheet) {
      NavigationStack {
        ScrollView { DayEntriesView(context: context).padding(TokenSpace.space4) }
          .navigationTitle(chosen.map(CalendarText.day) ?? "選択した日")
          .inlineNavigationTitle()
          .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { daySheet = false } } }
      }
      .presentationDetents([.medium, .large])
      .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }
    .sheet(isPresented: $monthPicker) {
      MonthPickerSheet(monthKey: month) { picked in jumpTo(picked, date: picked == String(todayKey.prefix(7)) ? todayKey : nil) }
    }
    .sheet(item: $opened) { item in
      EventDetailSheet(occurrence: item.occurrence) { removed in deleted = removed }
    }
    .sheet(item: $creating) { request in
      EventCreateSheet(request: request)
    }
    .sheet(isPresented: $shiftReader) { ShiftReaderSheet() }
    .sheet(isPresented: $eventReader) {
      EventReaderSheet(sample: readingStatus?.sample == true) { candidate, note in
        eventReader = false
        creating = EventFormRequest(prefill: EventPrefill(date: candidate.date), candidate: candidate, note: note)
      }
    }
    .onChange(of: view) { _, _ in daySheet = false }
  }

  /// 広い幅では、右にその日の一覧を置く。狭い幅では本文だけ。
  @ViewBuilder
  private func sideBySide<Main: View>(context: CalendarContext, @ViewBuilder main: () -> Main) -> some View {
    if narrow {
      main()
    } else {
      HStack(alignment: .top, spacing: 0) {
        main().frame(maxWidth: .infinity)
        Divider()
        ScrollView { DayEntriesView(context: context).padding(TokenSpace.space4) }
          .frame(width: 320)
          .background(theme.colors.sheet.color)
      }
    }
  }

  /// 画面の見出し（Web の PageHeader と読み取りの入口）。本文と一緒に流れる。
  @ViewBuilder
  private func header(_ snapshot: HouseholdSnapshot, context: CalendarContext, toolbar: CalendarToolbar?) -> some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      if let toolbar { toolbar.padding(.horizontal, -TokenSpace.space4) }
      if let error = model.error { ErrorBanner(error: error) }
      VStack(alignment: .leading, spacing: TokenSpace.space1) {
        Eyebrow("予定")
        Text("家族の予定").font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        Text("月・週・日・一覧で、家族の予定と参加者を確認できます。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
      }
      ViewThatFits(in: .horizontal) {
        HStack(spacing: TokenSpace.space3) { actions(snapshot, context: context) }
        VStack(alignment: .leading, spacing: TokenSpace.space2) { actions(snapshot, context: context) }
      }
      if let deleted { deletedCallout(deleted) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func actions(_ snapshot: HouseholdSnapshot, context: CalendarContext) -> some View {
    MemberScopePicker(snapshot: snapshot)
    if context.canCreate {
      Button { creating = EventFormRequest(prefill: EventPrefill(date: context.selected ?? context.todayKey)) } label: { Label("予定を追加", systemImage: "plus") }
        .fhButton(.primary)
      Button { shiftReader = true } label: { Label("シフトを読み取る", systemImage: "list.bullet.rectangle") }.fhButton(.secondary)
      if readingStatus?.available == true, model.can(.assistantUse) {
        Button { eventReader = true } label: { Label("URL・チラシから読み取る", systemImage: "doc.text.viewfinder") }.fhButton(.secondary)
      }
    }
  }

  private func deletedCallout(_ removed: DeletedEvent) -> some View {
    Callout(systemImage: "calendar", title: "「\(removed.title)」を削除しました", detail: "7日以内は元に戻せます。", tone: .info) {
      Button("元に戻す") { Task { await restore(removed) } }.fhButton(.secondary)
    }
  }

  private func restore(_ removed: DeletedEvent) async {
    let id = removed.id, date = removed.occurrenceDate
    switch await model.mutate({ await $0.restoreEvent(id: id, occurrenceDate: date) }) {
    case .success(let event):
      deleted = nil
      model.announce("「\(event.title)」を元に戻しました")
    case .failure(let failure):
      model.announce(failure.message)
    }
  }

  // MARK: 移動

  private func select(_ date: String, snapshot: HouseholdSnapshot) {
    selected = date
    monthKey = String(date.prefix(7))
    if narrow, view == .month { daySheet = true }
  }

  private func step(_ direction: Int, month: String, anchor: String) {
    jump += 1
    switch view {
    case .week: move(to: CalendarDate.addDays(anchor, direction * 7) ?? anchor)
    case .day: move(to: CalendarDate.addDays(anchor, direction) ?? anchor)
    case .month, .list:
      monthKey = CalendarDate.shiftMonth(month, direction) ?? month
      selected = nil
    }
  }

  private func move(to date: String) {
    selected = date
    monthKey = String(date.prefix(7))
  }

  private func jumpTo(_ month: String, date: String?) {
    jump += 1
    monthKey = month
    selected = date
  }

  /// 日と週は1日を基準に見るので、日を選んでいなければ基準の日を選んだ状態にする。
  private func change(to next: CalendarView, anchor: String) {
    if next == .day || next == .week { selected = anchor }
    storedView = next.rawValue
    daySheet = false
  }

  private func loadReadingStatus() async {
    guard model.can(.assistantUse) else { return }
    if case .success(let status) = await model.gateway.getAssistantStatus(), status.available { readingStatus = status }
  }
}

/// 予定の画面の部品が共通で使う値。
struct CalendarContext {
  let snapshot: HouseholdSnapshot
  let scoped: MemberScope.Scoped
  let todayKey: String
  let selected: String?
  let narrow: Bool
  let canCreate: Bool
  let select: (String) -> Void
  let open: (Occurrence) -> Void
  let create: (String, String?) -> Void

  func color(_ id: Id?) -> Color? {
    guard let id, let label = snapshot.colorLabels.first(where: { $0.id == id }) else { return nil }
    return Color(hex: label.color)
  }
}

struct OpenedEvent: Identifiable {
  let occurrence: Occurrence
  var id: String { occurrence.id }
}

/// 元に戻すために覚えておく、削除した範囲。1回だけの削除は、その回を指定して戻す。
struct DeletedEvent: Equatable {
  let id: Id
  let title: String
  let occurrenceDate: IsoDate?
}

/// 予定の追加を開く頼み。読み取りの候補から開くときは、候補と一言を添える。
struct EventFormRequest: Identifiable {
  let id = UUID()
  var prefill: EventPrefill
  var candidate: EventCandidate?
  var note: String?
}

/// 前・今・次と見出し、表示の切り替え（Web の CalendarToolbar）。
struct CalendarToolbar: View {
  @Environment(\.theme) private var theme
  @Environment(\.dynamicTypeSize) private var typeSize
  let view: CalendarView
  let heading: String
  let monthKey: String
  let onView: (CalendarView) -> Void
  let onStep: (Int) -> Void
  let onToday: () -> Void
  let onMonth: () -> Void

  var body: some View {
    let labels = view.stepLabels
    VStack(spacing: TokenSpace.space2) {
      if typeSize.isAccessibilitySize {
        // 文字がとても大きいときは、見出しを1行に置き、前・今・次をその下に並べる。
        headingButton
        HStack(spacing: TokenSpace.space2) {
          Button { onStep(-1) } label: { Image(systemName: "chevron.left") }.fhButton(.secondary).accessibilityLabel(labels.previous)
          Button(labels.current, action: onToday).fhButton(.secondary)
          Button { onStep(1) } label: { Image(systemName: "chevron.right") }.fhButton(.secondary).accessibilityLabel(labels.next)
        }
      } else {
      HStack(spacing: TokenSpace.space2) {
        Button { onStep(-1) } label: { Image(systemName: "chevron.left").frame(minWidth: 28) }
          .fhButton(.secondary).accessibilityLabel(labels.previous)
        headingButton
        Button(labels.current, action: onToday).fhButton(.secondary)
        Button { onStep(1) } label: { Image(systemName: "chevron.right").frame(minWidth: 28) }
          .fhButton(.secondary).accessibilityLabel(labels.next)
      }
      }
      Picker("カレンダーの表示", selection: Binding(get: { view }, set: { onView($0) })) {
        ForEach(CalendarView.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
    }
    .padding(.horizontal, TokenSpace.space4)
    .padding(.vertical, TokenSpace.space2)
    .background(theme.colors.paper.color)
    // 上に留まる帯。試験の監査は、この下に隠れた本文の濃さを測らない（下のタブの帯と同じ扱い）。
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("fixed-bar.calendar")
  }

  private var headingButton: some View {
        Button(action: onMonth) {
          HStack(spacing: TokenSpace.space1) {
            SeasonDot(key: monthKey)
            Text(heading).font(.headline).foregroundStyle(theme.colors.ink.color).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            Image(systemName: "chevron.down").imageScale(.small).accessibilityHidden(true)
          }
          .frame(maxWidth: .infinity, minHeight: 44)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(heading)、表示する年月を選ぶ")
  }
}

/// 季節の小さな印（Web の SeasonMark）。色だけの飾りなので読み上げない。
struct SeasonDot: View {
  @Environment(\.theme) private var theme
  let key: String
  var body: some View {
    let colors = theme.colors
    let color: Color = switch Season(dateOrMonthKey: key) {
    case .spring: colors.kakiSoft.color
    case .summer: colors.mossSoft.color
    case .autumn: colors.kaki.color
    case .winter: colors.infoSoft.color
    }
    Circle().fill(color).frame(width: 10, height: 10).accessibilityHidden(true)
  }
}

/// 表示する年月を選ぶ（1900年から2100年）。
struct MonthPickerSheet: View {
  @Environment(\.dismiss) private var dismiss
  let monthKey: String
  let onPick: (String) -> Void
  @State private var year = 2026
  @State private var month = 9

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("年", selection: $year) { ForEach(1900...2100, id: \.self) { Text(verbatim: "\($0)年").tag($0) } }
          Picker("月", selection: $month) { ForEach(1...12, id: \.self) { Text("\($0)月").tag($0) } }
        } footer: { Text("1900年から2100年まで選べます。") }
      }
      .navigationTitle("表示する年月を選ぶ")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("この年月を表示") { onPick(String(format: "%04d-%02d", year, month)); dismiss() }
        }
      }
      .onAppear {
        year = Int(monthKey.prefix(4)) ?? 2026
        month = Int(monthKey.suffix(2)) ?? 9
      }
    }
    .presentationDetents([.medium])
  }
}

extension Color {
  /// #rrggbb の色（利用者が決めたリストの色）。
  init?(hex: String) {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard digits.count == 6, let value = Int(digits, radix: 16) else { return nil }
    self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
  }
}
