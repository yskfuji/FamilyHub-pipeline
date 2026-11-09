import Foundation
import FHModel
import FHCopy

// タスクの一覧・状態の流れ・入力。元: src/domain/taskList.ts、todoFlow.ts、taskForm.ts、src/features/tasks/taskLabels.ts、
// src/content/ja.ts の taskActionLabel・taskActionAriaLabel。

/// タスクの一覧の絞り込み。Web の URL の filter の値と同じ。
public enum TaskFilter: String, CaseIterable, Sendable, Codable {
  case open, mine, review, done

  public static func parse(_ value: String?) -> TaskFilter { value.flatMap(TaskFilter.init(rawValue:)) ?? .open }

  public var label: String {
    let labels = Copy.ja.ja.taskFilter.self
    return switch self { case .open: labels.open; case .mine: labels.mine; case .review: labels.review; case .done: labels.done }
  }
}

public enum TaskList {
  static let unfinished: [TodoStatus] = [.open, .doing, .review, .waiting]

  /// 絞り込みごとに並べる状態の列。
  public static func columns(_ filter: TaskFilter) -> [TodoStatus] {
    switch filter {
    case .open, .mine: unfinished
    case .review: [.review]
    case .done: [.done]
    }
  }

  static func matches(_ todo: Todo, _ filter: TaskFilter, viewerId: Id) -> Bool {
    columns(filter).contains(todo.status) && (filter != .mine || todo.assigneeMembershipId == viewerId)
  }

  /// 期限の近い順。完了は新しい順。期限のないものはどちらでも最後。同じ期限は名前の順にして、読み直しても動かない。
  public static func filter(_ todos: [Todo], _ filter: TaskFilter, viewerId: Id) -> [Todo] {
    let direction: Double = filter == .done ? -1 : 1
    return todos.filter { matches($0, filter, viewerId: viewerId) }.stableSorted { a, b in
      order(a, b, direction: direction) < 0
    }
  }

  static func order(_ a: Todo, _ b: Todo, direction: Double) -> Double {
    if let left = a.dueAt, let right = b.dueAt, left != right {
      // Web と同じく、書き方だけ違う同じ時刻は 0（名前では比べない）。
      return (TodayDigest.milliseconds(left) - TodayDigest.milliseconds(right)) * direction
    }
    if (a.dueAt != nil) != (b.dueAt != nil) { return a.dueAt != nil ? -1 : 1 }
    return Double(jsLocaleCompare(a.title, b.title, locale: "ja"))
  }

  public static func counts(_ todos: [Todo], viewerId: Id) -> [TaskFilter: Int] {
    Dictionary(uniqueKeysWithValues: TaskFilter.allCases.map { filter in (filter, todos.filter { matches($0, filter, viewerId: viewerId) }.count) })
  }

  /// 期限の表示。期間のタスクは開始も示す。
  public static func dueText(dueAt: Rfc3339?, dueStartAt: Rfc3339?, asOf: String) -> String {
    if let dueStartAt { return "\(Format.due(dueStartAt, asOf: asOf))〜\(Format.due(dueAt, asOf: asOf))" }
    return Format.due(dueAt, asOf: asOf)
  }

  public static func dueText(_ todo: Todo, asOf: String) -> String { dueText(dueAt: todo.dueAt, dueStartAt: todo.dueStartAt, asOf: asOf) }

  public static func statusLabel(_ status: TodoStatus) -> String {
    let labels = Copy.ja.ja.taskStatus.self
    return switch status {
    case .open: labels.open
    case .doing: labels.doing
    case .review: labels.review
    case .waiting: labels.waiting
    case .done: labels.done
    default: status.rawValue
    }
  }

  public static func priorityLabel(_ priority: TodoPriority) -> String {
    let labels = Copy.ja.ja.taskPriority.self
    return switch priority { case .low: labels.low; case .high: labels.high; default: labels.normal }
  }
}

/// 状態を変える操作。文言は表示する側で付ける。
public enum TodoAction: String, CaseIterable, Sendable, Codable {
  case complete, requestReview = "request-review", confirmDone = "confirm-done", start, wait, reset, reopen

  public var status: TodoStatus {
    switch self {
    case .complete, .confirmDone: .done
    case .requestReview: .review
    case .start: .doing
    case .wait: .waiting
    case .reset, .reopen: .open
    }
  }

  /// ボタンの文言。戻す先が同じでも、今の状態で言い方が変わる。
  public func label(from status: TodoStatus) -> String {
    if self == .start, status == .waiting { return "再開する" }
    if self == .start, status == .review { return "進行中に戻す" }
    return Copy.ja.ja.taskAction[rawValue] ?? rawValue
  }

  /// 読み上げの文言。対象のタスクの名前を含める。
  public func ariaLabel(from status: TodoStatus, title: String) -> String {
    "「\(title)」\(self == .requestReview ? "の" : "を")\(label(from: status))"
  }

  /// 終えたときの知らせ（「を完了にしました」など）。
  public var doneText: String { Copy.ja.ja.taskActionDone[rawValue] ?? "" }
}

public struct TodoFlow: Sendable, Hashable, Codable {
  /// いちばんに勧める操作。確認を待っている人には勧めるものがない。
  public var suggested: TodoAction?
  /// そのほかに選べる操作。
  public var others: [TodoAction]
  /// 自分ではない人の確認を待っているとき。
  public var awaitingReviewer: Bool

  public init(suggested: TodoAction?, others: [TodoAction], awaitingReviewer: Bool) {
    self.suggested = suggested; self.others = others; self.awaitingReviewer = awaitingReviewer
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(suggested, forKey: .suggested)
    try container.encode(others, forKey: .others)
    try container.encode(awaitingReviewer, forKey: .awaitingReviewer)
  }

  static let none = TodoFlow(suggested: nil, others: [], awaitingReviewer: false)

  /// 状態を変えられる人。関わっている人と、管理者と大人のメンバー。
  public static func canTransition(_ viewer: ViewerContext, _ todo: Todo) -> Bool {
    guard Policy.authorize(viewer, .taskTransition) == nil else { return false }
    return viewer.role == .owner || viewer.role == .adult || [todo.creatorMembershipId, todo.assigneeMembershipId, todo.reviewerMembershipId].contains(viewer.membershipId)
  }

  static func suggested(_ todo: Todo, viewerId: Id) -> TodoAction? {
    if todo.status == .done { return .reopen }
    guard let reviewer = todo.reviewerMembershipId, !reviewer.isEmpty else { return .complete }
    if reviewer == viewerId { return todo.status == .review ? .confirmDone : .complete }
    return todo.status == .review ? nil : .requestReview
  }

  /// 見ている人に合わせた次の操作。
  public static func of(_ todo: Todo, viewer: ViewerContext) -> TodoFlow {
    guard canTransition(viewer, todo) else { return .none }
    let suggested = suggested(todo, viewerId: viewer.membershipId)
    if todo.status == .done { return TodoFlow(suggested: suggested, others: [], awaitingReviewer: false) }
    let others = [TodoAction.complete, .start, .wait, .reset].filter { action in
      action.status != todo.status && !(suggested.map { action.status == $0.status } ?? false)
    }
    return TodoFlow(suggested: suggested, others: others, awaitingReviewer: suggested == nil)
  }

  /// 一覧の丸ボタンで行う操作。勧める操作が完了・確認の依頼・確認して完了のときだけ出す。
  public static func inline(_ todo: Todo, viewer: ViewerContext) -> TodoAction? {
    let suggested = of(todo, viewer: viewer).suggested
    return [.complete, .requestReview, .confirmDone].contains(suggested) ? suggested : nil
  }
}

public struct TaskDraft: Sendable, Hashable, Codable {
  public var title: String
  public var note: String
  /// 日本時間の YYYY-MM-DDTHH:mm。空なら指定なし。
  public var start: String
  public var end: String
  public var assigneeId: Id
  /// 空なら確認する人なし。
  public var reviewerId: String
  public var priority: TodoPriority
  public var colorLabelId: String
  public var audience: VisibilityAudience
  public var selectedIds: [Id]
  public var recurrence: RecurrenceChoice
  public var intervalDays: Int
  public var until: String

  public var rule: RecurrenceDraft {
    get { RecurrenceDraft(recurrence: recurrence, intervalDays: intervalDays, until: until) }
    set { recurrence = newValue.recurrence; intervalDays = newValue.intervalDays; until = newValue.until }
  }

  public init(title: String, note: String, start: String, end: String, assigneeId: Id, reviewerId: String, priority: TodoPriority, colorLabelId: String, audience: VisibilityAudience, selectedIds: [Id], recurrence: RecurrenceChoice, intervalDays: Int, until: String) {
    self.title = title; self.note = note; self.start = start; self.end = end; self.assigneeId = assigneeId; self.reviewerId = reviewerId
    self.priority = priority; self.colorLabelId = colorLabelId; self.audience = audience; self.selectedIds = selectedIds
    self.recurrence = recurrence; self.intervalDays = intervalDays; self.until = until
  }
}

public enum TaskForm {
  public static let titleLimit = 120
  public static let noteLimit = 2000
  public static let handoffLimit = 500

  public static func newDraft(date: String, viewer: Id, audience: VisibilityAudience) -> TaskDraft {
    TaskDraft(title: "", note: "", start: "", end: "\(date)T20:00", assigneeId: viewer, reviewerId: "", priority: .normal, colorLabelId: "", audience: audience, selectedIds: [], recurrence: .none, intervalDays: 2, until: "")
  }

  public static func draft(from todo: Todo) -> TaskDraft {
    let rule = EventForm.choice(of: todo.recurrence, start: todo.dueAt.flatMap { CalendarDate.dateKey(fromRfc3339: $0) } ?? "")
    return TaskDraft(title: todo.title, note: todo.note ?? "", start: todo.dueStartAt.map(LocalTime.local(fromInstant:)) ?? "", end: todo.dueAt.map(LocalTime.local(fromInstant:)) ?? "",
                     assigneeId: todo.assigneeMembershipId, reviewerId: todo.reviewerMembershipId ?? "", priority: todo.priority ?? .normal, colorLabelId: todo.colorLabelId ?? "",
                     audience: todo.visibility.audience, selectedIds: todo.visibility.selectedMembershipIds,
                     recurrence: rule.recurrence, intervalDays: rule.intervalDays, until: rule.until)
  }

  /// 担当と確認に選べる人。ゲストと利用中でない人は除く。今の担当者は、変えずに保存できるように残す。
  public static func assignablePeople(_ memberships: [HouseholdMembership], keep: [String]) -> [HouseholdMembership] {
    memberships.filter { ($0.status == .active && $0.role != .guest) || keep.contains($0.id) }
  }

  /// 担当する人と確認する人のうち、公開範囲の外になる人。
  public static func peopleOutsideVisibility(_ draft: TaskDraft, memberships: [HouseholdMembership], creatorId: Id) -> [HouseholdMembership] {
    Visibility.peopleOutside([draft.assigneeId, draft.reviewerId], audience: draft.audience, selectedIds: draft.selectedIds, memberships: memberships, creatorId: creatorId)
  }

  static func trimmed(_ text: String) -> String { Account.jsTrim(text) }

  /// 入力の確認。問題があれば文言を返す。recurrenceEditable が false のときは繰り返しを見ない。
  public static func problem(_ draft: TaskDraft, recurrenceEditable: Bool) -> String? {
    if trimmed(draft.title).isEmpty { return "タスク名を入力してください。" }
    if !draft.start.isEmpty, !LocalTime.isValid(draft.start) { return "開始の日時を確認してください。" }
    if !draft.end.isEmpty, !LocalTime.isValid(draft.end) { return "期限の日時を確認してください。" }
    if !draft.start.isEmpty, draft.end.isEmpty { return "開始を入れたときは、期限も入力してください。" }
    if !draft.start.isEmpty, let start = LocalTime.milliseconds(draft.start), let end = LocalTime.milliseconds(draft.end), start > end { return "期限は開始より後にしてください。" }
    if let shared = Visibility.problem(draft.audience, draft.selectedIds) { return shared }
    if !recurrenceEditable || draft.recurrence == .none || draft.recurrence == .keep { return nil }
    if draft.end.isEmpty { return "繰り返すタスクには、期限を入力してください。" }
    return EventForm.recurrenceProblem(draft.rule, start: String(draft.end.prefix(10)), noun: "タスク")
  }

  static func recurrenceRule(_ draft: TaskDraft, exceptions: [IsoDate]) -> RecurrenceRule? {
    EventForm.rrule(draft.rule).map { RecurrenceRule(rrule: $0, exceptions: exceptions) }
  }

  public static func createInput(_ draft: TaskDraft) -> TodoInput {
    let note = trimmed(draft.note)
    return TodoInput(
      title: trimmed(draft.title),
      dueAt: draft.end.isEmpty ? nil : LocalTime.instant(draft.end),
      dueStartAt: draft.start.isEmpty ? nil : LocalTime.instant(draft.start),
      assigneeMembershipId: draft.assigneeId,
      reviewerMembershipId: draft.reviewerId.isEmpty ? nil : draft.reviewerId,
      note: note.isEmpty ? nil : note,
      priority: draft.priority == .normal ? nil : draft.priority,
      colorLabelId: draft.colorLabelId.isEmpty ? nil : draft.colorLabelId,
      recurrence: recurrenceRule(draft, exceptions: []),
      visibility: VisibilityInput(audience: draft.audience, selectedMembershipIds: draft.selectedIds))
  }

  /// 変更の入力。空にした項目は null で外す。公開範囲と繰り返しは、変えたときだけ送る。
  public static func updateInput(_ draft: TaskDraft, original: Todo, recurrenceEditable: Bool) -> TodoUpdateInput {
    let before = self.draft(from: original)
    let next = EventForm.rrule(draft.rule)
    let changed = recurrenceEditable && draft.recurrence != .keep && next != EventForm.rrule(before.rule)
    var input = TodoUpdateInput()
    input.title = trimmed(draft.title)
    input.assigneeMembershipId = draft.assigneeId
    input.reviewerMembershipId = draft.reviewerId.isEmpty ? .clear : .set(draft.reviewerId)
    input.dueAt = draft.end.isEmpty ? .clear : .set(LocalTime.instant(draft.end))
    input.dueStartAt = draft.start.isEmpty ? .clear : .set(LocalTime.instant(draft.start))
    let note = trimmed(draft.note)
    input.note = note.isEmpty ? .clear : .set(note)
    input.priority = draft.priority == .normal ? .clear : .set(draft.priority)
    input.colorLabelId = draft.colorLabelId.isEmpty ? .clear : .set(draft.colorLabelId)
    input.visibility = Visibility.change(draft.audience, draft.selectedIds, original: original.visibility)
    if changed { input.recurrence = recurrenceRule(draft, exceptions: original.recurrence?.exceptions ?? []).map(Patch.set) ?? .clear }
    return input
  }
}

/// 削除から元に戻せる日数。元: src/domain/restoreWindow.ts。
public enum RestoreWindow {
  public static let days = 7
  public static let retentionDays = 30

  /// 元に戻せる残りの日数。途中の日も1日と数える。
  public static func daysLeft(deletedAt: Rfc3339, now: Rfc3339) -> Int {
    let day = 86_400_000.0
    let left = TodayDigest.milliseconds(deletedAt) + Double(days) * day - TodayDigest.milliseconds(now)
    return min(days, max(1, Int((left / day).rounded(.up))))
  }
}
