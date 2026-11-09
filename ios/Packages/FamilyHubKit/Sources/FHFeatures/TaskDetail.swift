import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// タスクの内容（Web の TaskDrawer.tsx）。次の操作、編集、削除。
struct TaskDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let id: Id
  let onDeleted: (DeletedRecord) -> Void
  @State private var scope: RecurrenceScope = .this
  @State private var note = ""
  @State private var editing = false
  @State private var deleting = false
  @State private var busy = false

  var body: some View {
    Group {
      if let snapshot = model.snapshot, let todo = snapshot.todos.first(where: { $0.id == id }) {
        content(snapshot, todo: todo)
          .sheet(isPresented: $editing) { TaskEditSheet(todo: todo, scope: todo.recurrence == nil ? .series : scope) }
      } else {
        ScrollView {
          EmptyStateView(title: "タスクが見つからないか、表示する権限がありません", message: "削除されたか、共有の範囲が変わった可能性があります。", illustration: .emptyTasks)
            .padding(TokenSpace.space4)
        }
      }
    }
    .navigationTitle(model.snapshot?.todos.first { $0.id == id }?.title ?? "タスク")
    .inlineNavigationTitle()
  }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot, todo: Todo) -> some View {
    let colors = theme.colors
    let viewer = snapshot.viewer
    let flow = TodoFlow.of(todo, viewer: viewer)
    let name = { (id: Id) in memberName(snapshot.memberships, id) }
    let canEdit = Policy.canMutateOwned(viewer, .taskUpdate, ownerMembershipId: todo.creatorMembershipId)
    let canDelete = Policy.canDelete(viewer, .taskDelete, stakeholders: [todo.creatorMembershipId, todo.assigneeMembershipId])
    let recurring = todo.recurrence != nil
    let rule = todo.recurrence.flatMap { rule in todo.dueAt.flatMap { CalendarDate.dateKey(fromRfc3339: $0) }.map { Recurrence.describe(start: $0, recurrence: rule) } }
    let label = todo.colorLabelId.flatMap { id in snapshot.colorLabels.first { $0.id == id } }
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("タスクの内容")
          Text(todo.title).font(.title2.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        }
        Card {
          VStack(alignment: .leading, spacing: TokenSpace.space3) {
            VStack(alignment: .leading, spacing: TokenSpace.space1) {
              Text("状態").font(.subheadline.weight(.bold)).foregroundStyle(colors.inkSoft.color)
              HStack {
                StatusBadge(TaskList.statusLabel(todo.status), tone: taskStatusTone(todo.status))
                if let priority = todo.priority, priority != .normal { StatusBadge("優先度：\(TaskList.priorityLabel(priority))", tone: priority == .high ? .attention : .neutral) }
              }
            }
            .accessibilityElement(children: .combine)
            DetailItem(title: "期限", value: TaskList.dueText(todo, asOf: snapshot.context.asOf) + (rule.map { "\n\($0)" } ?? ""))
          }
        }
        Card {
          VStack(alignment: .leading, spacing: TokenSpace.space3) {
            Text("担当する人と確認する人").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
            DetailItem(title: "担当する人", value: name(todo.assigneeMembershipId))
            DetailItem(title: "確認する人", value: todo.reviewerMembershipId.map(name) ?? "なし")
            DetailItem(title: "作成した人", value: name(todo.creatorMembershipId))
          }
        }
        if let text = todo.note { DetailItem(title: "メモ", value: text) }
        if let text = todo.handoffNote { DetailItem(title: "引き継ぎの一言", value: text) }
        if let text = todo.completionNote { DetailItem(title: "完了の一言", value: text) }
        DetailItem(title: "公開範囲", value: Visibility.text(.task, todo.visibility, nameOf: name))
        if let label { DetailItem(title: "リスト", value: label.name) }
        if recurring {
          Picker("対象とするタスク", selection: $scope) {
            ForEach([RecurrenceScope.this, .series], id: \.self) { Text(recurrenceScopeLabel($0)).tag($0) }
          }
          .accessibilityIdentifier("task.detail.scope")
        }
        if flow.suggested != nil || !flow.others.isEmpty || flow.awaitingReviewer {
          actions(todo, flow: flow, reviewer: todo.reviewerMembershipId.map(name))
        }
        if canEdit || canDelete {
          HStack(spacing: TokenSpace.space3) {
            if canEdit { Button("内容を編集") { editing = true }.fhButton(.secondary, fullWidth: true).accessibilityIdentifier("task.detail.edit") }
            if canDelete { Button("タスクを削除") { deleting = true }.fhButton(.danger, fullWidth: true).disabled(busy) }
          }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(colors.paper.color)
    .confirmationDialog("タスクを削除しますか", isPresented: $deleting, titleVisibility: .visible) {
      Button(Copy.ja.ja.actions.delete, role: .destructive) { Task { await remove(todo) } }
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
    } message: {
      Text("「\(todo.title)」\(recurring ? "（\(recurrenceScopeLabel(scope))）" : "")を削除します。削除すると、共有相手の画面にも表示されなくなります。7日以内なら元に戻せます。")
    }
  }

  @ViewBuilder
  private func actions(_ todo: Todo, flow: TodoFlow, reviewer: String?) -> some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      Text("次の操作").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
      if flow.awaitingReviewer, let reviewer {
        Text("\(reviewer)さんの確認を待っています。").foregroundStyle(colors.inkSoft.color)
      }
      if flow.suggested != nil || !flow.others.isEmpty {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          TextField("一言（任意）", text: limited($note, TaskForm.handoffLimit), axis: .vertical)
            .lineLimit(1...4)
            .textFieldStyle(.plain)
            .foregroundStyle(colors.ink.color)
            .padding(TokenSpace.space3)
            .frame(minHeight: 44)
            .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
            .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
            .accessibilityIdentifier("task.detail.note")
          Text("状態を変えるときに、次の人への一言として残します。完了のときは完了の一言になります。").font(.footnote).foregroundStyle(colors.inkSoft.color)
        }
        if let suggested = flow.suggested {
          Button(suggested.label(from: todo.status)) { run(todo, suggested) }
            .fhButton(.primary, fullWidth: true)
            .disabled(busy)
            .accessibilityLabel(suggested.ariaLabel(from: todo.status, title: todo.title))
            .accessibilityIdentifier("task.detail.suggested")
        }
        ForEach(flow.others, id: \.self) { action in
          Button(action.label(from: todo.status)) { run(todo, action) }
            .fhButton(.secondary, fullWidth: true)
            .disabled(busy)
            .accessibilityLabel(action.ariaLabel(from: todo.status, title: todo.title))
        }
      }
    }
  }

  private func run(_ todo: Todo, _ action: TodoAction) {
    guard !busy else { return }
    busy = true
    Task {
      if await model.transition(todo, action, note: note) { note = "" }
      busy = false
    }
  }

  private func remove(_ todo: Todo) async {
    busy = true
    defer { busy = false }
    let recurring = todo.recurrence != nil
    let id = todo.id, version = todo.version, chosen: RecurrenceScope = recurring ? scope : .series
    switch await model.mutate({ await $0.deleteTodo(id: id, expectedVersion: version, scope: chosen) }) {
    case .success:
      model.announce("「\(todo.title)」\(recurring && chosen == .this ? "の今回分" : "")を削除しました")
      onDeleted(DeletedRecord(id: id, title: todo.title))
    case .failure(let failure):
      model.announce(failure.message)
    }
  }
}
