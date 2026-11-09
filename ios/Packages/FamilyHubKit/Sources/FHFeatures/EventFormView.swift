import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 予定の入力（Web の EventForm.tsx）。下書きの確かめと送る形への変換は FHDomain の EventForm（Web と同じ答え）。
/// 日時は日付と時刻の部品で選ぶ（文字で打たない）。日本時間で表示する。
struct EventFormView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let initial: EventDraft
  let busy: Bool
  let error: String
  /// 新規のとき、過去の予定から内容を入れられるようにする。
  var offerTemplates = false
  /// 繰り返しを変えられないときの説明。
  var recurrenceNote: String?
  /// 今の規則がこの画面で作れないときの表示名。
  var keptRuleLabel: String?
  /// 保存の前に示す見通し（繰り返しの「すべて」の編集で日付を変えたとき）。
  var preview: ((EventDraft) -> EventForm.SeriesPreview?)?
  var onSwitchToFuture: (() -> Void)?
  /// 読み取りの候補から開いたときの一言。
  var note: String?
  @Binding var draft: EventDraft
  @Binding var problem: String

  static let tokyo = TimeZone(identifier: "Asia/Tokyo")!

  var body: some View {
    let colors = theme.colors
    let snapshot = model.snapshot
    let people = (snapshot?.memberships ?? []).filter { $0.status == .active || draft.participantIds.contains($0.id) || draft.selectedIds.contains($0.id) }
    let templates = offerTemplates ? EventForm.pastTemplates(snapshot?.events ?? [], now: snapshot?.context.asOf ?? "") : []
    let outlook = preview?(draft)
    Form {
      // 保存のボタンは上にあるので、知らせも上に出す。
      if !(problem.isEmpty && error.isEmpty) {
        Section { Text(problem.isEmpty ? error : problem).foregroundStyle(colors.danger.color).accessibilityIdentifier("calendar.event.error") }
      }
      if let note {
        Section { Label(note, systemImage: "eye").font(.callout) }
      }
      if !templates.isEmpty {
        Section("過去の予定から入力") {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TokenSpace.space2) {
              ForEach(templates) { template in
                Button(template.title) {
                  draft = EventForm.applyTemplate(draft, template, allowedAudiences: Policy.allowedAudiences(snapshot?.viewer.role ?? .adult), memberIds: people.map(\.id))
                }
                .fhButton(.secondary)
                .accessibilityLabel("「\(template.title)」の内容を入れる")
              }
            }
          }
        }
      }
      Section {
        TextField("予定名", text: limited($draft.title, EventForm.titleLimit))
          .accessibilityIdentifier("calendar.event.title")
        Toggle("終日", isOn: $draft.allDay)
        if draft.allDay {
          DatePicker("開始日", selection: dateBinding(\.start, keepTime: "00:00"), displayedComponents: .date)
          DatePicker("終了日", selection: dateBinding(\.end, keepTime: "23:59"), displayedComponents: .date)
        } else {
          DatePicker("開始", selection: Binding(get: { LocalTime.date(draft.start) ?? Date() }, set: { draft = EventForm.withStart(draft, LocalTime.local(from: $0)) }))
          DatePicker("終了", selection: Binding(get: { LocalTime.date(draft.end) ?? Date() }, set: { draft.end = LocalTime.local(from: $0) }))
        }
      }
      .environment(\.timeZone, Self.tokyo)
      Section {
        TextField("場所（任意）", text: limited($draft.location, EventForm.locationLimit))
        TextField("メモ（任意）", text: limited($draft.note, EventForm.noteLimit), axis: .vertical).lineLimit(2...6)
      }
      Section("参加者") {
        ForEach(people) { member in
          Toggle(member.displayName, isOn: Binding(get: { draft.participantIds.contains(member.id) }, set: { on in
            draft.participantIds = on ? draft.participantIds + [member.id] : draft.participantIds.filter { $0 != member.id }
          }))
        }
      }
      VisibilitySection(kind: .event, audience: $draft.audience, selectedIds: $draft.selectedIds, initialAudience: initial.audience, people: people)
      if let recurrenceNote {
        Section { Text(recurrenceNote).font(.footnote).foregroundStyle(colors.inkSoft.color) }
      } else {
        RecurrenceSection(rule: $draft.rule, startDate: String(draft.start.prefix(10)), keptRuleLabel: initial.recurrence == .keep ? (keptRuleLabel ?? "") : nil)
      }
      if let labels = snapshot?.colorLabels, !labels.isEmpty {
        Section {
          Picker("リスト", selection: $draft.colorLabelId) {
            Text("なし").tag("")
            ForEach(labels) { label in
              Label { Text(label.name) } icon: { Image(systemName: "circle.fill").foregroundStyle(Color(hex: label.color) ?? colors.line.color) }.tag(label.id)
            }
          }
        }
      }
      Section {
        Picker("通知", selection: $draft.reminderMinutes) {
          Text("通知しない").tag(Int?.none)
          ForEach(reminderOptions, id: \.self) { Text(CalendarText.reminder($0)).tag(Int?.some($0)) }
        }
        Toggle("天気の影響を表示する", isOn: $draft.weatherSensitive)
      }
      if let outlook {
        Section {
          VStack(alignment: .leading, spacing: TokenSpace.space2) {
            Label(outlook.text, systemImage: outlook.refused ? "exclamationmark.triangle" : "calendar")
              .foregroundStyle(outlook.refused ? colors.danger.color : colors.ink.color)
            if outlook.refused, let onSwitchToFuture {
              Button(Copy.ja.seriesPreviewCopy.switchToFuture, action: onSwitchToFuture).fhButton(.secondary)
            }
          }
          .accessibilityElement(children: .combine)
        }
      }
    }
    .disabled(busy)
    .onChange(of: problem) { _, message in if !message.isEmpty { announce(message) } }
    .onChange(of: error) { _, message in if !message.isEmpty { announce(message) } }
  }

  private var reminderOptions: [Int] {
    let choices = EventForm.reminderChoices
    if let current = draft.reminderMinutes, !choices.contains(current) { return choices + [current] }
    return choices
  }

  /// 終日の日付。時刻の部分は変えない。
  private func dateBinding(_ key: WritableKeyPath<EventDraft, String>, keepTime: String) -> Binding<Date> {
    Binding(
      get: { LocalTime.date("\(draft[keyPath: key].prefix(10))T12:00") ?? Date() },
      set: { date in
        let day = String(LocalTime.local(from: date).prefix(10))
        let time = draft[keyPath: key].count >= 16 ? String(draft[keyPath: key].suffix(5)) : keepTime
        if key == \EventDraft.start { draft = EventForm.withStart(draft, "\(day)T\(time)") } else { draft[keyPath: key] = "\(day)T\(time)" }
      })
  }
}

/// 入力の長さの上限（Web の maxLength と同じく UTF-16 で数える）。
func limited(_ text: Binding<String>, _ limit: Int) -> Binding<String> {
  Binding(get: { text.wrappedValue }, set: { value in
    text.wrappedValue = value.utf16.count > limit ? String(String.UnicodeView(value).prefix(limit)) : value
  })
}

private extension String {
  /// UTF-16 で上限までの文字（文字の途中で切らない）。
  struct UnicodeView {
    let value: String
    init(_ value: String) { self.value = value }
    func prefix(_ limit: Int) -> Substring {
      var count = 0
      var end = value.startIndex
      for index in value.indices {
        let size = value[index].utf16.count
        if count + size > limit { break }
        count += size
        end = value.index(after: index)
      }
      return value[..<end]
    }
  }
}

/// 公開範囲の選択（Web の VisibilityFields）。予定・タスク・メモで共通。
struct VisibilitySection: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let kind: SharedKind
  @Binding var audience: VisibilityAudience
  @Binding var selectedIds: [Id]
  let initialAudience: VisibilityAudience
  let people: [HouseholdMembership]

  var body: some View {
    let role = model.snapshot?.viewer.role ?? .adult
    Section {
      Picker("公開範囲", selection: $audience) {
        ForEach(Visibility.choices(role, kind, current: initialAudience), id: \.self) { Text(Visibility.label(kind, $0)).tag($0) }
      }
      if audience == .selected {
        ForEach(people) { member in
          let checked = selectedIds.contains(member.id)
          Toggle(member.displayName, isOn: Binding(get: { checked }, set: { on in
            selectedIds = on ? selectedIds + [member.id] : selectedIds.filter { $0 != member.id }
          }))
          .disabled(!checked && selectedIds.count >= Visibility.maxSelectedMembers)
        }
      }
    } footer: {
      VStack(alignment: .leading, spacing: 2) {
        Text(Visibility.help(kind, audience))
        if audience == .selected { Text("公開するメンバー（\(Visibility.maxSelectedMembers)人まで）") }
      }
    }
  }
}

/// 繰り返しの選択（Web の RecurrenceFields）。予定とタスクで共通。
struct RecurrenceSection: View {
  @Binding var rule: RecurrenceDraft
  /// 最初の回の日付。
  let startDate: String
  /// 今の規則がこの画面で作れないときの表示名。あれば「今の設定のまま」を選べる。
  let keptRuleLabel: String?

  var body: some View {
    Section {
      Picker("繰り返し", selection: $rule.recurrence) {
        ForEach(RecurrenceChoice.allCases.filter { $0 != .keep }, id: \.self) { Text($0.label).tag($0) }
        if let keptRuleLabel { Text("今の設定のまま（\(keptRuleLabel)）").tag(RecurrenceChoice.keep) }
      }
      if rule.recurrence == .everyNDays {
        Stepper(value: $rule.intervalDays, in: 1...366) { Text("\(rule.intervalDays)日ごと") }
      }
      if rule.recurrence != .none, rule.recurrence != .keep {
        Toggle("繰り返しの終了日を決める", isOn: Binding(get: { !rule.until.isEmpty }, set: { rule.until = $0 ? CalendarLayout.add(startDate, 30) : "" }))
        if !rule.until.isEmpty {
          DatePicker("繰り返しの終了日", selection: Binding(get: { LocalTime.date("\(rule.until)T12:00") ?? Date() }, set: { rule.until = String(LocalTime.local(from: $0).prefix(10)) }), displayedComponents: .date)
            .environment(\.timeZone, EventFormView.tokyo)
        }
      }
    } footer: {
      if rule.recurrence == .monthEnd { Text("31日がない月は、その月の最後の日に入ります。最初の回は開始日以降の月末です。") }
      else if rule.recurrence == .monthly, (Int(startDate.suffix(2)) ?? 0) > 28 { Text("その日がない月には入りません。月の最後の日に入れるときは「毎月の末日」を選びます。") }
    }
  }
}

/// 保存していない入力があるときの確かめ（Web の unsavedGuard と同じ文言）。
struct UnsavedGuard: ViewModifier {
  let dirty: Bool
  @Binding var asking: Bool
  let discard: () -> Void

  func body(content: Content) -> some View {
    content
      .interactiveDismissDisabled(dirty)
      .alert("入力中の内容を破棄しますか", isPresented: $asking) {
        Button("編集に戻る", role: .cancel) {}
        Button("破棄する", role: .destructive, action: discard)
      } message: { Text("保存していない変更は失われます。") }
  }
}

/// 予定の追加（Web の すぐに追加 の予定）。開いている間は1つの冪等の鍵を使い、二度押しでも1件にする。
struct EventCreateSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let request: EventFormRequest
  @State private var draft: EventDraft
  @State private var initial: EventDraft
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false
  @State private var key = UUID().uuidString.lowercased()

  init(request: EventFormRequest) {
    self.request = request
    let blank = EventForm.newDraft(request.prefill, viewer: "", audience: .household)
    _draft = State(initialValue: blank)
    _initial = State(initialValue: blank)
  }

  var body: some View {
    NavigationStack {
      EventFormView(initial: initial, busy: busy, error: error, offerTemplates: request.candidate == nil, note: request.note, draft: $draft, problem: $problem)
        .navigationTitle("予定を追加")
        .inlineNavigationTitle()
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.add) { Task { await submit() } }.disabled(busy).accessibilityIdentifier("calendar.event.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
    .onAppear(perform: prepare)
  }

  /// 見る人と公開範囲の初期値は、家族の記録が分かってから決める。
  private func prepare() {
    guard let snapshot = model.snapshot, draft.participantIds == [""] else { return }
    let audience = Visibility.defaultAudience(snapshot.viewer.role, .event, preferred: model.privacy?.defaultAudience)
    var fresh = EventForm.newDraft(request.prefill, viewer: snapshot.viewer.membershipId, audience: audience)
    let blank = fresh
    if let candidate = request.candidate { fresh = Reading.apply(candidate, to: fresh) }
    // 読み取りの候補は、利用者が確かめるまで保存していない入力として扱う。
    initial = blank
    draft = fresh
  }

  private func submit() async {
    guard !busy else { return }
    if let found = EventForm.problem(draft, recurrenceEditable: true) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = EventForm.createInput(draft)
    let context = model.mutationContext(key: key)
    switch await model.mutate({ await $0.createEvent(input, context: context) }) {
    case .success:
      model.announce("予定を追加しました")
      dismiss()
    case .failure(let failure):
      error = failure.message
    }
  }
}

/// 予定の編集。繰り返しの予定は、変える範囲（この予定だけ・これ以降・すべて）を選んでから開く。
struct EventEditSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let occurrence: Occurrence
  let series: CalendarEvent
  @Binding var scope: RecurrenceScope
  @State private var draft: EventDraft
  @State private var initial: EventDraft
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false

  init(occurrence: Occurrence, series: CalendarEvent, scope: Binding<RecurrenceScope>) {
    self.occurrence = occurrence
    self.series = series
    _scope = scope
    var start = EventForm.draft(from: occurrence.event)
    // 開いた回ではなく、シリーズの開始日で規則を読む（曜日の判定が開始日によるため）。
    if occurrence.recurrence != nil { start.rule = EventForm.choice(of: series.recurrence, start: CalendarLayout.dateKey(series.startsAt)) }
    _draft = State(initialValue: start)
    _initial = State(initialValue: start)
  }

  private var recurring: Bool { occurrence.recurrence != nil }
  /// 1回だけの変更と分割では、規則はシリーズから決まるので変えられない。
  private var recurrenceEditable: Bool { !recurring || scope == .series }

  var body: some View {
    let seriesStart = CalendarLayout.dateKey(series.startsAt)
    NavigationStack {
      EventFormView(
        initial: initial, busy: busy, error: error,
        recurrenceNote: recurrenceEditable ? nil : "繰り返しの変更は、対象を「\(scopeLabel(.series))」にすると行えます。",
        keptRuleLabel: occurrence.recurrence.map { Recurrence.describe(start: seriesStart, recurrence: $0) },
        preview: recurring && scope == .series ? { EventForm.seriesPreview($0, series: series, occurrenceDate: occurrence.occurrenceDate, recurrenceEditable: recurrenceEditable) } : nil,
        onSwitchToFuture: { scope = .future; error = "" },
        draft: $draft, problem: $problem)
        .navigationTitle("予定を編集")
        .inlineNavigationTitle()
        .navigationSubtitle(recurring ? "変更する範囲：\(scopeLabel(scope))" : "この予定の内容を変更します。")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.saveChanges) { Task { await submit() } }
              .disabled(busy || (recurring && scope == .series && EventForm.seriesPreview(draft, series: series, occurrenceDate: occurrence.occurrenceDate, recurrenceEditable: recurrenceEditable)?.refused == true))
              .accessibilityIdentifier("calendar.event.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
  }

  private func submit() async {
    guard !busy else { return }
    if let found = EventForm.problem(draft, recurrenceEditable: recurrenceEditable) { problem = found; return }
    let wholeSeries = recurring && scope == .series
    // 日付を動かすときは、シリーズ全体を同じ日数だけずらす。ずらせない規則は送らない。
    if wholeSeries, let preview = EventForm.seriesPreview(draft, series: series, occurrenceDate: occurrence.occurrenceDate, recurrenceEditable: recurrenceEditable), preview.refused {
      error = preview.text; return
    }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = EventForm.updateInput(draft, original: series, recurrenceEditable: recurrenceEditable,
                                      seriesStart: wholeSeries ? CalendarLayout.dateKey(series.startsAt) : nil, occurrenceDate: wholeSeries ? occurrence.occurrenceDate : nil)
    let id = occurrence.event.id, version = occurrence.event.version, chosen = scope
    let date = recurring && scope != .series ? occurrence.occurrenceDate : nil
    switch await model.mutate({ await $0.updateEvent(id: id, scope: chosen, input: input, expectedVersion: version, context: nil, occurrenceDate: date) }) {
    case .success(let event):
      model.announce("「\(event.title)」を更新しました")
      dismiss()
    case .failure(let failure):
      error = failure.message
    }
  }
}

func scopeLabel(_ scope: RecurrenceScope) -> String {
  let labels = Copy.ja.ja.recurrence.event.self
  return switch scope {
  case .this: labels.this
  case .future: labels.future
  default: labels.series
  }
}
