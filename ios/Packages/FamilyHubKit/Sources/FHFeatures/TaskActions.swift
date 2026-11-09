import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

// タスクの状態の変更（Web の useTodoTransition・useInlineTodoAction）。一覧・詳細・予定の日の一覧で同じ流れを使う。

extension AppModel {
  /// 状態を変える。成功したら記録を取り直し、終えたことを知らせる。繰り返しのタスクを完了にすると、次の回ができる。
  @discardableResult
  func transition(_ todo: Todo, _ action: TodoAction, note: String? = nil) async -> Bool {
    let id = todo.id, version = todo.version, status = action.status
    let trimmed = note.map(Account.jsTrim).flatMap { $0.isEmpty ? nil : $0 }
    switch await mutate({ await $0.updateTodoStatus(id: id, status: status, expectedVersion: version, note: trimmed) }) {
    case .success:
      announce("「\(todo.title)」\(action.doneText)\(todo.recurrence != nil && status == .done ? "。次の回を作成しました" : "")")
      return true
    case .failure(let failure):
      announce(failure.message)
      return false
    }
  }
}

/// 一覧の丸いボタン。勧める操作が「完了にする」「確認を依頼する」「確認して完了にする」のときだけ押せる。
struct InlineTodoButton: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let todo: Todo
  @State private var busy = false

  var body: some View {
    let colors = theme.colors
    let done = todo.status == .done
    if let viewer = model.snapshot?.viewer, let action = TodoFlow.inline(todo, viewer: viewer) {
      Button {
        guard !busy else { return }
        busy = true
        Task { await model.transition(todo, action); busy = false }
      } label: {
        Image(systemName: action == .requestReview ? "arrow.up.circle" : "circle")
          .font(.title2)
          .foregroundStyle(colors.accent.color)
          .frame(minWidth: 44, minHeight: 44)
      }
      .buttonStyle(.plain)
      .disabled(busy)
      .accessibilityLabel(action.ariaLabel(from: todo.status, title: todo.title))
      .accessibilityIdentifier("task.inline.\(todo.id)")
    } else {
      Image(systemName: done ? "checkmark.circle.fill" : "circle.dotted")
        .font(.title2)
        .foregroundStyle(done ? colors.success.color : colors.inkSoft.color)
        .frame(minWidth: 44, minHeight: 44)
        .accessibilityHidden(true)
    }
  }
}

func recurrenceScopeLabel(_ scope: RecurrenceScope) -> String {
  scope == .this ? Copy.ja.ja.recurrence.task.this : Copy.ja.ja.recurrence.task.series
}

/// 状態の印の色（Web の TaskDrawer の StatusBadge）。
func taskStatusTone(_ status: TodoStatus) -> StatusBadge.Tone {
  switch status {
  case .review: .attention
  case .done: .success
  default: .neutral
  }
}
