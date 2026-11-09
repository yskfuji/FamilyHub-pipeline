import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// シフトを読み取る（Web の ShiftDialog.tsx）。勤務表の文字を貼り付けると、予定の候補を表にする。確かめて保存するまで何も追加しない。
/// 読み取りはこの端末の中だけで行い（FHDomain の Roster。Web と同じ答え）、記号と時刻の規則だけをこの端末に残す。
struct ShiftReaderSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  @State private var text = ""
  @State private var chosenMonth: String?
  @State private var chosenPerson: String?
  @State private var memberId: Id = ""
  @State private var rules = ShiftRules.load(.standard)
  @State private var rulesOpen = false
  @State private var workLabelId = ""
  @State private var offLabelId = ""
  @State private var choices: [String: Bool] = [:]
  @State private var saved: Set<String> = []
  @State private var failures: [String: String] = [:]
  @State private var summary = ""
  @State private var progress: (done: Int, total: Int)?
  @State private var operationKeys: [String: String] = [:]
  @State private var asking = false

  private static let nearbyMonths = [-2, -1, 0, 1, 2, 3, 4]
  private var busy: Bool { progress != nil }

  var body: some View {
    let colors = theme.colors
    NavigationStack {
      if let snapshot = model.snapshot {
        let state = reading(snapshot)
        Form {
          Section {
            TextEditor(text: limited(Binding(get: { text }, set: { text = $0; summary = "" }), 40_000))
              .frame(minHeight: 120)
              .font(.body.monospaced())
              .overlay(alignment: .topLeading) {
                if text.isEmpty { Text("10/1 早番\n10/2 遅番\n10/3 休み").foregroundStyle(colors.inkFaint.color).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false).accessibilityHidden(true) }
              }
              .accessibilityLabel("勤務表の文字")
              .accessibilityIdentifier("calendar.shift.text")
          } header: { Text("勤務表の文字") } footer: { Text("表計算、チャット、メールからの貼り付けに対応します。読み取りはこの端末の中だけで行います。") }
          Section {
            Picker("対象の月", selection: Binding(get: { state.month }, set: { chosenMonth = $0 })) {
              ForEach(state.months, id: \.self) { Text(CalendarText.month($0)).tag($0) }
            }
            Picker("予定に入れる人", selection: $memberId) {
              ForEach(snapshot.memberships.filter { $0.status == .active }) { Text($0.displayName).tag($0.id) }
            }
            if state.allPeople.count > 1 {
              Picker("表の中の人", selection: Binding(get: { state.person }, set: { chosenPerson = $0 })) {
                Text("選んでください").tag("")
                ForEach(state.allPeople, id: \.self) { Text($0).tag($0) }
              }
            }
          }
          if !snapshot.colorLabels.isEmpty {
            Section {
              Picker("勤務のリスト", selection: $workLabelId) { Text("なし").tag(""); ForEach(snapshot.colorLabels) { Text($0.name).tag($0.id) } }
              Picker("休みのリスト", selection: $offLabelId) { Text("なし").tag(""); ForEach(snapshot.colorLabels) { Text($0.name).tag($0.id) } }
            }
          }
          ShiftRulesSection(rules: $rules, legend: state.result.legend, open: $rulesOpen)
          statusSection(state)
          if !state.rows.isEmpty { reviewSection(state, snapshot: snapshot) }
        }
        .disabled(busy)
        .navigationTitle("シフトを読み取る")
        .inlineNavigationTitle()
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(saved.isEmpty ? Copy.ja.ja.actions.cancel : Copy.ja.ja.actions.close) { if dirty { asking = true } else { dismiss() } }.disabled(busy)
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : "\(state.selected.count)件を保存") { Task { await save(state.selected, snapshot: snapshot) } }
              .disabled(busy || state.selected.isEmpty)
              .accessibilityIdentifier("calendar.shift.save")
          }
        }
        .onAppear { if memberId.isEmpty { memberId = snapshot.viewer.membershipId } }
        .onChange(of: rules) { _, next in
          if next.allSatisfy({ ShiftRules.problem($0, next) == nil }) { ShiftRules.save(next, to: .standard) }
        }
      }
    }
    .modifier(UnsavedGuard(dirty: dirty, asking: $asking) { dismiss() })
  }

  private var dirty: Bool { saved.isEmpty && !text.jsTrimmedForForm.isEmpty }

  struct State {
    var month: String
    var months: [String]
    var allPeople: [String]
    var person: String
    var result: RosterResult
    var rows: [ShiftProposal]
    var selected: [ShiftProposal]
  }

  /// まず全員の名前を読み、選ばれていなければ予定に入れる人と同じ名前を選ぶ。
  private func reading(_ snapshot: HouseholdSnapshot) -> State {
    let current = CalendarDate.monthKey(fromRfc3339: snapshot.context.asOf) ?? "2026-09"
    let detected = Roster.detectMonth(text, todayMonth: current)
    let month = chosenMonth ?? detected ?? current
    let months = Array(Set(Self.nearbyMonths.compactMap { CalendarDate.shiftMonth(current, $0) } + [month])).sorted()
    let name = snapshot.memberships.first { $0.id == memberId }?.displayName ?? ""
    let found = Roster.parse(text, month: month, rules: rules).people
    let person = chosenPerson.flatMap { found.contains($0) ? $0 : nil } ?? found.first { ShiftText.samePerson($0, name) } ?? ""
    let result = Roster.parse(text, month: month, rules: rules, person: person)
    let rows = ShiftProposals.make(result.rows, events: snapshot.events, memberId: memberId).filter { !saved.contains($0.id) }
    let selected = rows.filter(included)
    return State(month: month, months: months, allPeople: found, person: person, result: result, rows: rows, selected: selected)
  }

  private func included(_ row: ShiftProposal) -> Bool {
    row.row.kind != .unknown && (choices[row.id] ?? ShiftProposals.includedByDefault(row))
  }

  @ViewBuilder
  private func statusSection(_ state: State) -> some View {
    let trimmed = !text.jsTrimmedForForm.isEmpty
    let messages = [
      trimmed && state.allPeople.count > 1 && state.person.isEmpty ? "表に\(state.allPeople.count)人の名前があります。読み取る人を選んでください。" : nil,
      trimmed && state.rows.isEmpty && saved.isEmpty && (state.allPeople.count <= 1 || !state.person.isEmpty) ? "シフトを読み取れませんでした。日付と記号が入っているか確かめてください。" : nil,
    ].compactMap { $0 } + state.result.skipped
    if !messages.isEmpty || !summary.isEmpty || progress != nil {
      Section {
        ForEach(messages, id: \.self) { Text($0).font(.footnote).foregroundStyle(theme.colors.inkSoft.color) }
        if !summary.isEmpty { Text(summary).foregroundStyle(theme.colors.danger.color) }
        if let progress { Text("\(progress.total)件中\(progress.done)件を保存しました。").font(.footnote) }
      }
    }
  }

  @ViewBuilder
  private func reviewSection(_ state: State, snapshot: HouseholdSnapshot) -> some View {
    let colors = theme.colors
    Section {
      if state.rows.contains(where: { $0.row.kind == .off }), offLabelId.isEmpty, !snapshot.colorLabels.isEmpty {
        Text("休みの日は終日の予定になります。不要な行は外してください。").font(.footnote).foregroundStyle(colors.inkSoft.color)
      }
      ForEach(state.rows) { row in
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Toggle(isOn: Binding(get: { included(row) }, set: { choices[row.id] = $0 })) {
            VStack(alignment: .leading, spacing: 2) {
              Text("\(CalendarText.day(row.row.date))  \(row.row.title)").font(.body.weight(.semibold))
              Text(ShiftProposals.timeText(row.row)).font(.footnote).monospacedDigit().foregroundStyle(colors.inkSoft.color)
            }
          }
          .disabled(row.row.kind == .unknown)
          .accessibilityLabel("\(CalendarText.day(row.row.date))の\(row.row.title)を保存する")
          HStack(spacing: TokenSpace.space2) {
            if row.duplicate { StatusBadge("同じ予定があります") }
            if let warning = row.row.warning { StatusBadge(warning, tone: .attention) }
          }
          if row.row.kind == .unknown {
            Button("「\(row.row.symbol)」の規則を追加") {
              rules = ShiftRules.merge(rules, [ShiftRules.custom(row.row.symbol, rules)])
              rulesOpen = true
            }
            .fhButton(.secondary)
          }
          if let failure = failures[row.id] { Text(failure).font(.footnote).foregroundStyle(colors.danger.color) }
        }
      }
    } header: {
      HStack { Text("保存する予定の確認"); Spacer(); Text("\(state.rows.count)件中\(state.selected.count)件") }
    }
  }

  /// 1行ずつ保存する。失敗した行があっても残りを続け、どの行が失敗したかを表に残す。
  private func save(_ rows: [ShiftProposal], snapshot: HouseholdSnapshot) async {
    guard !busy, !rows.isEmpty else { return }
    let audience = Visibility.defaultAudience(snapshot.viewer.role, .event, preferred: model.privacy?.defaultAudience)
    let target = ShiftSaveTarget(memberId: memberId, workLabelId: workLabelId, offLabelId: offLabelId, audience: audience)
    failures = [:]; summary = ""; progress = (0, rows.count)
    var added: [String] = []
    var failed: [String: String] = [:]
    for (index, row) in rows.enumerated() {
      // 応答だけが届かなかった行を送り直しても、予定が2つにならないようにする。
      let signature = "\(row.id)|\(memberId)|\(workLabelId)|\(offLabelId)"
      let key = operationKeys[signature] ?? UUID().uuidString.lowercased()
      operationKeys[signature] = key
      let input = ShiftProposals.eventInput(row.row, target: target)
      let context = model.mutationContext(key: key)
      switch await model.run({ [gateway = model.gateway] in await gateway.createEvent(input, context: context) }) {
      case .success: added.append(row.id)
      case .failure(let failure): failed[row.id] = failure.message
      }
      progress = (index + 1, rows.count)
    }
    saved.formUnion(added)
    failures = failed
    progress = nil
    if !added.isEmpty { await model.refresh() }
    if failed.isEmpty { model.announce("\(added.count)件の予定を保存しました"); dismiss(); return }
    summary = "\(added.count)件を保存しました。\(failed.count)件は保存できなかったので、表に残しています。"
  }
}

/// 記号と時刻の対応の編集（Web の ShiftRules.tsx）。変更はこの端末に残し、ほかの人の画面は変わらない。
struct ShiftRulesSection: View {
  @Environment(\.theme) private var theme
  @Binding var rules: [ShiftTimeRule]
  let legend: [ShiftTimeRule]
  @Binding var open: Bool
  @State private var sample = ""
  @State private var sampleNote = ""

  var body: some View {
    Section {
      DisclosureGroup("時刻の規則（\(rules.count)件）", isExpanded: $open) {
        Text("記号と時刻の対応を変えられます。この端末に残し、ほかの人の画面は変わりません。").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
        if !legend.isEmpty {
          VStack(alignment: .leading, spacing: TokenSpace.space1) {
            Text("表の凡例から\(legend.count)件の規則を読みました").font(.callout.weight(.bold))
            Text("この読み取りに使っています。保存すると次回も使えます。").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
            Button("規則を保存") { rules = ShiftRules.merge(rules, legend) }.fhButton(.secondary)
          }
        }
        ForEach($rules) { $rule in ShiftRuleRow(rule: $rule, rules: rules) { rules.removeAll { $0.id == rule.id } } }
        HStack {
          Button("規則を追加") { rules.append(ShiftRules.custom("", rules)) }.fhButton(.secondary)
          Button("初期の規則に戻す") { rules = ShiftRules.reset(.standard) }.fhButton(.secondary)
        }
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          TextField("見本から規則を作る", text: Binding(get: { sample }, set: { sample = $0; sampleNote = "" }), prompt: Text("A=9:00-18:00"), axis: .vertical)
          Text("凡例の行を貼り付けると、規則として端末に保存します。").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
          HStack {
            Button("見本から保存") {
              let found = Roster.legendRules(sample)
              if found.isEmpty { sampleNote = "規則を読み取れませんでした。「A=9:00-18:00」のように書いてください。"; return }
              rules = ShiftRules.merge(rules, found)
              sample = ""
              sampleNote = "\(found.count)件の規則を保存しました。"
            }
            .fhButton(.secondary)
            .disabled(sample.jsTrimmedForForm.isEmpty)
            if !sampleNote.isEmpty { StatusBadge(sampleNote) }
          }
        }
      }
    }
  }
}

struct ShiftRuleRow: View {
  @Environment(\.theme) private var theme
  @Binding var rule: ShiftTimeRule
  let rules: [ShiftTimeRule]
  let remove: () -> Void
  @State private var aliases = ""

  var body: some View {
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      TextField("名前", text: limited($rule.label, 20))
      TextField("別名", text: Binding(get: { aliases }, set: { aliases = $0; rule.aliases = ShiftRules.parseAliases($0) }))
      if !rule.off {
        DatePicker("開始", selection: clock(\.start), displayedComponents: .hourAndMinute)
        DatePicker("終了", selection: clock(\.end), displayedComponents: .hourAndMinute)
        Toggle("翌日に終わる", isOn: Binding(get: { ShiftRules.isOvernight(rule) }, set: { rule.endsNextDay = $0 })).disabled(rule.end <= rule.start)
      }
      Toggle("休み", isOn: $rule.off)
      Button("消す", role: .destructive, action: remove).accessibilityLabel("「\(rule.label)」の規則を消す")
      if let problem = ShiftRules.problem(rule, rules) { Text(problem).font(.footnote).foregroundStyle(theme.colors.danger.color) }
    }
    .environment(\.timeZone, EventFormView.tokyo)
    .onAppear { aliases = rule.aliases.joined(separator: "、") }
  }

  private func clock(_ key: WritableKeyPath<ShiftTimeRule, String>) -> Binding<Date> {
    Binding(
      get: { LocalTime.date("2026-01-01T\(rule[keyPath: key])") ?? Date() },
      set: { rule[keyPath: key] = String(LocalTime.local(from: $0).suffix(5)) })
  }
}

extension String {
  /// JS の trim と同じ空白の扱いで、空かどうかを見るための形。
  var jsTrimmedForForm: String { Account.jsTrim(self) }
}

