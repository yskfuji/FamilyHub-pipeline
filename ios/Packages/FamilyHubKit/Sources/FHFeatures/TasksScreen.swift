import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// タスクの画面（Web の src/features/tasks/TasksPage.tsx）。担当する人と確認する人を分けて管理する。
/// iPhone は一覧から押して詳細へ進む。iPad は一覧と、右に詳細を並べる。
struct TasksScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.dynamicTypeSize) private var typeSize

  @AppStorage("fh.taskFilter") private var storedFilter = TaskFilter.open.rawValue
  @State private var selection: Id?
  @State private var creating = false
  @State private var deleted: DeletedRecord?

  private var filter: TaskFilter { TaskFilter.parse(storedFilter) }
  private var narrow: Bool { sizeClass == .compact }

  var body: some View {
    Group {
      if let snapshot = model.snapshot {
        if narrow {
          list(snapshot).navigationDestination(item: $selection) { id in detail(id) }
        } else {
          HStack(alignment: .top, spacing: 0) {
            list(snapshot).frame(maxWidth: .infinity)
            Divider()
            Group {
              if let selection { detail(selection) } else {
                EmptyStateView(title: "タスクを選んでください", message: "一覧のタスクを選ぶと、ここに内容を表示します。", compact: true).padding(TokenSpace.space4)
              }
            }
            .frame(width: 400)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(theme.colors.sheet.color)
          }
        }
      } else if model.loading {
        ProgressView("タスクを読み込んでいます。").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(theme.colors.paper.color.ignoresSafeArea())
    .sheet(isPresented: $creating) { TaskCreateSheet { selection = $0.id } }
    .onAppear(perform: takeFocus)
    .onChange(of: model.focus) { _, _ in takeFocus() }
  }

  /// ほかの画面から開くように頼まれたタスク。
  private func takeFocus() {
    guard case .task(let id)? = model.focus else { return }
    model.focus = nil
    if let todo = model.snapshot?.todos.first(where: { $0.id == id }), !TaskList.columns(filter).contains(todo.status) {
      storedFilter = todo.status == .done ? TaskFilter.done.rawValue : TaskFilter.open.rawValue
    }
    selection = id
  }

  private func detail(_ id: Id) -> some View {
    TaskDetailView(id: id) { removed in
      deleted = removed
      selection = nil
    }
    .id(id)
  }

  @ViewBuilder
  private func list(_ snapshot: HouseholdSnapshot) -> some View {
    let colors = theme.colors
    let viewer = snapshot.viewer.membershipId
    let scoped = MemberScope.scoped(snapshot, scope: preferences.memberScope)
    let counts = TaskList.counts(scoped.todos, viewerId: viewer)
    let shown = TaskList.filter(scoped.todos, filter, viewerId: viewer)
    let canCreate = model.can(.taskCreate)
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        if let error = model.error { ErrorBanner(error: error) }
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("タスク")
          Text("家族のタスク").font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("担当する人と確認する人を分けて管理できます。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          MemberScopePicker(snapshot: snapshot)
          if canCreate {
            Button { creating = true } label: { Label("タスクを追加", systemImage: "plus") }.fhButton(.primary)
          }
        }
        if let deleted { DeletedCallout(record: deleted) { await restore(deleted) } }
        FilterGrid(filter: filter, counts: counts) { storedFilter = $0.rawValue }
        Text("\(shown.count)件").font(.footnote.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
        if shown.isEmpty {
          empty(snapshot, scoped: scoped, counts: counts, canCreate: canCreate)
        } else {
          ForEach(TaskList.columns(filter), id: \.self) { status in
            let items = shown.filter { $0.status == status }
            if !items.isEmpty {
              VStack(alignment: .leading, spacing: TokenSpace.space2) {
                HStack {
                  Text(TaskList.statusLabel(status)).font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
                  StatusBadge("\(items.count)")
                }
                VStack(spacing: 0) {
                  ForEach(items) { todo in
                    TaskRow(todo: todo, snapshot: snapshot, selected: !narrow && selection == todo.id) { selection = todo.id }
                    if todo.id != items.last?.id { Divider().overlay(colors.line.color) }
                  }
                }
                .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
              }
            }
          }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  @ViewBuilder
  private func empty(_ snapshot: HouseholdSnapshot, scoped: MemberScope.Scoped, counts: [TaskFilter: Int], canCreate: Bool) -> some View {
    let viewer = snapshot.viewer.membershipId
    if scoped.memberId != nil {
      EmptyStateView(title: "該当するタスクはありません", message: "表示する人を「すべて」に戻すと、ほかの記録を確認できます。", illustration: .emptyTasks, compact: true)
    } else if scoped.todos.isEmpty {
      EmptyStateView(title: "まだタスクはありません", message: canCreate ? "家族の用事を追加すると、担当する人と確認する人を分けて管理できます。" : "共有されたタスクが追加されると、ここに表示します。", illustration: .emptyTasks, compact: true) {
        if canCreate { Button("最初のタスクを追加") { creating = true }.fhButton(.primary) }
      }
    } else if (filter == .open && (counts[.done] ?? 0) > 0) || (filter == .mine && scoped.todos.contains { $0.status == .done && $0.assigneeMembershipId == viewer }) {
      EmptyStateView(title: filter == .mine ? "自分の担当は全部済みました" : "タスクは全部済みました", message: "新しいタスクが追加されると、ここに表示します。", illustration: .emptyDone, compact: true) {
        Button("完了したタスクを見る") { storedFilter = TaskFilter.done.rawValue }.fhButton(.secondary)
      }
    } else {
      EmptyStateView(title: "該当するタスクはありません", message: "別の条件を選ぶか、タスクを追加してください。", illustration: .emptySearch, compact: true)
    }
  }

  private func restore(_ removed: DeletedRecord) async {
    let id = removed.id
    switch await model.mutate({ await $0.restoreTodo(id: id) }) {
    case .success:
      deleted = nil
      model.announce("「\(removed.title)」を元に戻しました")
    case .failure(let failure):
      model.announce(failure.message)
    }
  }
}

/// 消した記録（「元に戻す」の知らせに使う）。
struct DeletedRecord: Hashable, Sendable {
  let id: Id
  let title: String
}

/// 削除の後の知らせ。7日以内は元に戻せる。
struct DeletedCallout: View {
  let record: DeletedRecord
  let restore: () async -> Void
  @State private var busy = false
  var body: some View {
    Callout(systemImage: "trash", title: "「\(record.title)」を削除しました", detail: "7日以内は元に戻せます。", tone: .info) {
      Button(Copy.ja.ja.actions.restore) {
        busy = true
        Task { await restore(); busy = false }
      }
      .fhButton(.secondary)
      .disabled(busy)
    }
  }
}

/// 絞り込み（Web の segmented group）。4つを2列に並べ、文字がとても大きいときは1列にする。
struct FilterGrid: View {
  @Environment(\.theme) private var theme
  @Environment(\.dynamicTypeSize) private var typeSize
  let filter: TaskFilter
  let counts: [TaskFilter: Int]
  let choose: (TaskFilter) -> Void

  var body: some View {
    // 遅延の格子（LazyVGrid）は、文字の大きさの監査で「一部しか対応していない」と出るので、行を並べる。
    let perRow = typeSize.isAccessibilitySize ? 1 : 2
    let rows = stride(from: 0, to: TaskFilter.allCases.count, by: perRow).map { Array(TaskFilter.allCases[$0..<min($0 + perRow, TaskFilter.allCases.count)]) }
    VStack(spacing: TokenSpace.space2) {
      ForEach(rows, id: \.self) { row in
        HStack(spacing: TokenSpace.space2) {
          ForEach(row, id: \.self) { item in button(item) }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("タスクの絞り込み")
  }

  private func button(_ item: TaskFilter) -> some View {
    let colors = theme.colors
    let chosen = item == filter
    return Button { choose(item) } label: {
      HStack {
        Text(item.label).font(.callout.weight(.semibold))
        Spacer(minLength: TokenSpace.space1)
        Text("\(counts[item] ?? 0)").font(.callout.weight(.bold)).monospacedDigit()
      }
      .foregroundStyle(chosen ? colors.onAccent.color : colors.ink.color)
      .padding(.horizontal, TokenSpace.space3)
      .padding(.vertical, TokenSpace.space2)
      .frame(maxWidth: .infinity, minHeight: 44)
      .background(chosen ? colors.accent.color : colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
      .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(item.label) \(counts[item] ?? 0)件")
    .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
    .accessibilityIdentifier("task.filter.\(item.rawValue)")
  }
}

/// 一覧の1行（Web の TaskCard）。丸いボタンで状態を進め、残りを押すと詳細を開く。
struct TaskRow: View {
  @Environment(\.theme) private var theme
  @Environment(\.dynamicTypeSize) private var typeSize
  let todo: Todo
  let snapshot: HouseholdSnapshot
  let selected: Bool
  let open: () -> Void

  var body: some View {
    let colors = theme.colors
    let label = todo.colorLabelId.flatMap { id in snapshot.colorLabels.first { $0.id == id } }
    let rule = todo.recurrence.flatMap { rule in todo.dueAt.flatMap { CalendarDate.dateKey(fromRfc3339: $0) }.map { Recurrence.describe(start: $0, recurrence: rule) } }
    HStack(alignment: .top, spacing: TokenSpace.space2) {
      InlineTodoButton(todo: todo)
      Button(action: open) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Text(todo.title).font(.body.weight(.bold)).foregroundStyle(colors.ink.color).multilineTextAlignment(.leading)
          Label(TaskList.dueText(todo, asOf: snapshot.context.asOf), systemImage: "clock").font(.footnote).foregroundStyle(colors.inkSoft.color)
          Text(people).font(.footnote).foregroundStyle(colors.inkSoft.color).multilineTextAlignment(.leading)
          if label != nil || (todo.priority ?? .normal) != .normal || rule != nil {
            HStack(spacing: TokenSpace.space2) {
              if let label {
                HStack(spacing: 4) {
                  Image(systemName: "circle.fill").font(.caption2).foregroundStyle(Color(hex: label.color) ?? colors.line.color).accessibilityHidden(true)
                  Text(label.name).font(.footnote).foregroundStyle(colors.inkSoft.color)
                }
              }
              if let priority = todo.priority, priority != .normal { StatusBadge("優先度：\(TaskList.priorityLabel(priority))", tone: priority == .high ? .attention : .neutral) }
              if let rule, !typeSize.isAccessibilitySize { StatusBadge(rule) }
            }
          }
          if let rule, typeSize.isAccessibilitySize { StatusBadge(rule) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityElement(children: .combine)
      .accessibilityHint("内容を開きます")
      .accessibilityIdentifier("task.row.\(todo.id)")
      Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(colors.inkSoft.color).padding(.top, TokenSpace.space2).accessibilityHidden(true)
    }
    .padding(.vertical, TokenSpace.space2)
    .padding(.horizontal, TokenSpace.space2)
    .background(selected ? colors.accent.color.opacity(0.08) : .clear)
  }

  private var people: String {
    let name = { (id: Id) in memberName(snapshot.memberships, id) }
    return ["担当：\(name(todo.assigneeMembershipId))", todo.reviewerMembershipId.map { "確認する人：\(name($0))" }].compactMap { $0 }.joined(separator: " · ")
  }
}
