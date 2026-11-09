import SwiftUI
import FHModel
import FHGateway
import FHDomain
import FHDesign
import FHCopy

/// タスクの入力（Web の TaskForm.tsx）。下書きの確かめと送る形への変換は FHDomain の TaskForm（Web と同じ答え）。
struct TaskFormView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let initial: TaskDraft
  let creatorId: Id
  let busy: Bool
  let error: String
  /// 繰り返しを変えられないときの説明。
  var recurrenceNote: String?
  /// 今の規則がこの画面で作れないときの表示名。
  var keptRuleLabel: String?
  @Binding var draft: TaskDraft
  @Binding var problem: String

  var body: some View {
    let colors = theme.colors
    let snapshot = model.snapshot
    let memberships = snapshot?.memberships ?? []
    let people = TaskForm.assignablePeople(memberships, keep: [initial.assigneeId, initial.reviewerId])
    let visible = memberships.filter { $0.status == .active || draft.selectedIds.contains($0.id) }
    let outside = TaskForm.peopleOutsideVisibility(draft, memberships: memberships, creatorId: creatorId)
    let today = snapshot.flatMap { CalendarDate.dateKey(fromRfc3339: $0.context.asOf) } ?? "2026-09-30"
    Form {
      if !(problem.isEmpty && error.isEmpty) {
        Section { Text(problem.isEmpty ? error : problem).foregroundStyle(colors.danger.color).accessibilityIdentifier("task.form.error") }
      }
      Section {
        TextField("タスク名", text: limited($draft.title, TaskForm.titleLimit), prompt: Text("例：提出物を確認する"))
          .accessibilityIdentifier("task.form.title")
        TextField("メモ（任意）", text: limited($draft.note, TaskForm.noteLimit), axis: .vertical).lineLimit(2...6)
      }
      Section {
        Toggle("期限を決める", isOn: Binding(get: { !draft.end.isEmpty }, set: { on in
          draft.end = on ? "\(draft.start.isEmpty ? today : String(draft.start.prefix(10)))T20:00" : ""
          if !on { draft.start = "" }
        }))
        if !draft.end.isEmpty {
          DatePicker("期限", selection: Binding(get: { LocalTime.date(draft.end) ?? Date() }, set: { draft.end = LocalTime.local(from: $0) }))
          Toggle("開始を決める", isOn: Binding(get: { !draft.start.isEmpty }, set: { draft.start = $0 ? "\(draft.end.prefix(10))T09:00" : "" }))
          if !draft.start.isEmpty {
            DatePicker("開始", selection: Binding(get: { LocalTime.date(draft.start) ?? Date() }, set: { draft.start = LocalTime.local(from: $0) }))
          }
        }
      } footer: {
        if !draft.start.isEmpty { Text("開始から期限までの毎日に、カレンダーへ表示します。") }
      }
      .environment(\.timeZone, EventFormView.tokyo)
      Section {
        Picker("担当者", selection: $draft.assigneeId) {
          ForEach(people) { Text($0.displayName).tag($0.id) }
        }
        Picker("確認する人（任意）", selection: $draft.reviewerId) {
          Text("なし").tag("")
          ForEach(people) { Text($0.displayName).tag($0.id) }
        }
        Picker("優先度", selection: $draft.priority) {
          ForEach([TodoPriority.low, .normal, .high], id: \.self) { Text(TaskList.priorityLabel($0)).tag($0) }
        }
      }
      VisibilitySection(kind: .task, audience: $draft.audience, selectedIds: $draft.selectedIds, initialAudience: initial.audience, people: visible)
      if !outside.isEmpty {
        Section {
          Label("\(outside.map(\.displayName).joined(separator: "、"))さんには、この公開範囲だとタスクが表示されません。", systemImage: "exclamationmark.triangle")
            .foregroundStyle(colors.ink.color)
        }
      }
      if let recurrenceNote {
        Section { Text(recurrenceNote).font(.footnote).foregroundStyle(colors.inkSoft.color) }
      } else {
        RecurrenceSection(rule: $draft.rule, startDate: draft.end.isEmpty ? today : String(draft.end.prefix(10)), keptRuleLabel: initial.recurrence == .keep ? (keptRuleLabel ?? "") : nil)
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
    }
    .disabled(busy)
    .onChange(of: problem) { _, message in if !message.isEmpty { announce(message) } }
    .onChange(of: error) { _, message in if !message.isEmpty { announce(message) } }
  }
}

/// タスクの追加。開いている間は1つの冪等の鍵を使い、二度押しでも1件にする。
struct TaskCreateSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let onCreated: (Todo) -> Void
  @State private var draft = TaskForm.newDraft(date: "", viewer: "", audience: .household)
  @State private var initial = TaskForm.newDraft(date: "", viewer: "", audience: .household)
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false
  @State private var key = UUID().uuidString.lowercased()

  var body: some View {
    NavigationStack {
      TaskFormView(initial: initial, creatorId: model.snapshot?.viewer.membershipId ?? "", busy: busy, error: error, draft: $draft, problem: $problem)
        .navigationTitle("タスクを追加")
        .inlineNavigationTitle()
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.add) { Task { await submit() } }.disabled(busy).accessibilityIdentifier("task.form.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
    .onAppear(perform: prepare)
  }

  private func prepare() {
    guard let snapshot = model.snapshot, draft.assigneeId.isEmpty else { return }
    let today = CalendarDate.dateKey(fromRfc3339: snapshot.context.asOf) ?? ""
    let audience = Visibility.defaultAudience(snapshot.viewer.role, .task, preferred: model.privacy?.defaultAudience)
    let fresh = TaskForm.newDraft(date: today, viewer: snapshot.viewer.membershipId, audience: audience)
    initial = fresh
    draft = fresh
  }

  private func submit() async {
    guard !busy else { return }
    if let found = TaskForm.problem(draft, recurrenceEditable: true) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = TaskForm.createInput(draft)
    let context = model.mutationContext(key: key)
    switch await model.mutateOrQueue(.taskCreate(input: input), summary: "タスク「\(input.title)」を作成", key: key, { await $0.createTodo(input, context: context) }) {
    case .completed(let todo):
      model.announce("タスクを追加しました")
      onCreated(todo)
      dismiss()
    case .queued: dismiss()
    case .failed(let failure):
      error = failure.message
    }
  }
}

/// タスクの編集。繰り返しのタスクは、変える範囲（このタスクだけ・すべてのタスク）を詳細で選んでから開く。
struct TaskEditSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let todo: Todo
  let scope: RecurrenceScope
  @State private var draft: TaskDraft
  @State private var initial: TaskDraft
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false

  init(todo: Todo, scope: RecurrenceScope) {
    self.todo = todo
    self.scope = scope
    let start = TaskForm.draft(from: todo)
    _draft = State(initialValue: start)
    _initial = State(initialValue: start)
  }

  private var recurring: Bool { todo.recurrence != nil }
  private var recurrenceEditable: Bool { !recurring || scope != .this }

  var body: some View {
    NavigationStack {
      TaskFormView(
        initial: initial, creatorId: todo.creatorMembershipId, busy: busy, error: error,
        recurrenceNote: recurrenceEditable ? nil : "繰り返しを変えるときは、対象を「\(recurrenceScopeLabel(.series))」にしてください。",
        keptRuleLabel: todo.recurrence.map { rule in Recurrence.describe(start: todo.dueAt.flatMap { CalendarDate.dateKey(fromRfc3339: $0) } ?? "", recurrence: rule) },
        draft: $draft, problem: $problem)
        .navigationTitle("タスクを編集")
        .inlineNavigationTitle()
        .navigationSubtitle(recurring ? "変更する範囲：\(recurrenceScopeLabel(scope))" : "")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.saveChanges) { Task { await submit() } }.disabled(busy).accessibilityIdentifier("task.form.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
  }

  private func submit() async {
    guard !busy else { return }
    if let found = TaskForm.problem(draft, recurrenceEditable: recurrenceEditable) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = TaskForm.updateInput(draft, original: todo, recurrenceEditable: recurrenceEditable)
    let id = todo.id, version = todo.version, chosen = scope
    switch await model.mutateOrQueue(.taskUpdate(id: id, scope: chosen, input: input, expectedVersion: version), summary: "タスク「\(todo.title)」を変更", key: nil, { await $0.updateTodo(id: id, scope: chosen, input: input, expectedVersion: version, context: nil) }) {
    case .completed:
      model.announce("「\(Account.jsTrim(draft.title))」を更新しました")
      dismiss()
    case .queued: dismiss()
    case .failed(let failure):
      error = failure.message
    }
  }
}
