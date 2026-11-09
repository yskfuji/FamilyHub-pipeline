import Foundation
import Testing
import FHModel
@testable import FHDomain

/// 段階 S3（タスク・メモ）の計算が、Web の TS の関数の答え（scripts/ios/export-vectors.ts）と同じになること。

enum S3Fixtures {
  static let todos: [Todo] = (try? JSON.decode(JSON.load("taskTodos"))) ?? []
  static func todo(_ id: String) -> Todo? { todos.first { $0.id == id } }
  static let memos: [Memo] = (try? JSON.decode(JSON.load("memos"))) ?? []
  static func memo(_ id: String) -> Memo? { memos.first { $0.id == id } }
  static let viewers: [ViewerContext] = (try? JSON.decode(JSON.load("todoFlowViewers"))) ?? []
  static let memberships: [HouseholdMembership] = S2Fixtures.snapshot?.memberships ?? []
  static let asOf = "2026-09-30T07:30:00+09:00"
}

struct TaskVectorTests {
  @Test func vectorsLoad() {
    #expect(S3Fixtures.todos.count == 65)
    #expect(S3Fixtures.memos.count == 33)
    #expect(S3Fixtures.viewers.count == 6)
  }

  @Test(arguments: JSON.cases("taskList"))
  func list(_ vector: JSONCase) {
    let viewer = vector.input.string!
    let counts = TaskList.counts(S3Fixtures.todos, viewerId: viewer)
    #expect(sameRaw(.object(Dictionary(uniqueKeysWithValues: counts.map { ($0.key.rawValue, JSONValue.number(Double($0.value))) })), vector.expected["counts"]))
    for filter in TaskFilter.allCases {
      let ids = TaskList.filter(S3Fixtures.todos, filter, viewerId: viewer).map(\.id)
      #expect(same(ids, vector.expected["filtered"][filter.rawValue]), "\(viewer) \(filter)")
    }
  }

  @Test(arguments: JSON.cases("taskFilters"))
  func filters(_ vector: JSONCase) {
    let filter = TaskFilter.parse(vector.input.string)
    #expect(filter.rawValue == vector.expected["filter"].string)
    #expect(same(TaskList.columns(filter), vector.expected["columns"]))
  }

  @Test(arguments: JSON.cases("todoFlow"))
  func flow(_ vector: JSONCase) throws {
    let viewer = S3Fixtures.viewers[vector.input["viewer"].int!]
    let todo = try #require(S3Fixtures.todo(vector.input["id"].string!))
    #expect(TodoFlow.canTransition(viewer, todo) == vector.expected["can"].bool)
    #expect(same(TodoFlow.of(todo, viewer: viewer), vector.expected["flow"]))
    #expect(same(TodoFlow.inline(todo, viewer: viewer), vector.expected["inline"]))
  }

  @Test(arguments: JSON.cases("todoActionLabels"))
  func actionLabels(_ vector: JSONCase) throws {
    let action = try #require(TodoAction(rawValue: vector.input["action"].string!))
    let status = TodoStatus(rawValue: vector.input["status"].string!)
    #expect(action.label(from: status) == vector.expected["label"].string)
    #expect(action.ariaLabel(from: status, title: "図書館の本を返す") == vector.expected["aria"].string)
  }

  @Test(arguments: JSON.cases("taskDueText"))
  func dueText(_ vector: JSONCase) throws {
    let todo = try #require(S3Fixtures.todo(vector.input.string!))
    #expect(TaskList.dueText(todo, asOf: S3Fixtures.asOf) == vector.expected.string)
  }

  @Test(arguments: JSON.cases("taskDrafts"))
  func drafts(_ vector: JSONCase) throws {
    let todo = try #require(S3Fixtures.todo(vector.input.string!))
    let draft = TaskForm.draft(from: todo)
    #expect(same(draft, vector.expected["draft"]), "\(todo.id)")
    #expect(TaskForm.problem(draft, recurrenceEditable: true) == vector.expected["problem"].string, "\(todo.id)")
    #expect(TaskForm.problem(draft, recurrenceEditable: false) == vector.expected["locked"].string, "\(todo.id)")
    #expect(same(TaskForm.createInput(draft), vector.expected["create"]), "\(todo.id)")
  }

  @Test func newDraft() {
    #expect(same(TaskForm.newDraft(date: "2026-09-30", viewer: "member-aoi", audience: .household), JSON.load("newTaskDraft")))
  }

  @Test(arguments: JSON.cases("taskDraftChecks"))
  func checks(_ vector: JSONCase) throws {
    let draft: TaskDraft = try JSON.decode(vector.input["draft"])
    let name = vector.input["name"]
    #expect(TaskForm.problem(draft, recurrenceEditable: true) == vector.expected["problem"].string, "\(name)")
    #expect(TaskForm.problem(draft, recurrenceEditable: false) == vector.expected["locked"].string, "\(name)")
    #expect(same(TaskForm.createInput(draft), vector.expected["create"]), "\(name)")
  }

  @Test(arguments: JSON.cases("taskUpdates"))
  func updates(_ vector: JSONCase) throws {
    let original = try #require(S3Fixtures.todo(vector.input["id"].string!))
    let draft: TaskDraft = try JSON.decode(vector.input["draft"])
    let name = vector.input["name"]
    #expect(same(TaskForm.updateInput(draft, original: original, recurrenceEditable: true), vector.expected["plain"]), "\(original.id) \(name)")
    #expect(same(TaskForm.updateInput(draft, original: original, recurrenceEditable: false), vector.expected["locked"]), "\(original.id) \(name)")
  }

  @Test(arguments: JSON.cases("taskPeople"))
  func people(_ vector: JSONCase) throws {
    let draft: TaskDraft = try JSON.decode(vector.input["draft"])
    let creator = vector.input["creator"].string!
    #expect(same(TaskForm.peopleOutsideVisibility(draft, memberships: S3Fixtures.memberships, creatorId: creator).map(\.id), vector.expected["outside"]))
  }

  @Test(arguments: JSON.cases("assignablePeople"))
  func assignable(_ vector: JSONCase) throws {
    var gone = try #require(S3Fixtures.memberships.dropFirst().first)
    gone.id = "member-gone"; gone.status = MembershipStatus(rawValue: "removed")
    let keep = vector.input.array.compactMap(\.string)
    #expect(same(TaskForm.assignablePeople(S3Fixtures.memberships + [gone], keep: keep).map(\.id), vector.expected))
  }

  @Test(arguments: JSON.cases("audienceText"))
  func audience(_ vector: JSONCase) throws {
    let kind = try #require(SharedKind(rawValue: vector.input["kind"].string!))
    let visibility: VisibilityPolicy = try JSON.decode(vector.input["visibility"])
    #expect(Visibility.text(kind, visibility) { memberName(S3Fixtures.memberships, $0) } == vector.expected.string)
  }

  @Test(arguments: JSON.cases("restoreWindow"))
  func restore(_ vector: JSONCase) {
    #expect(RestoreWindow.daysLeft(deletedAt: vector.input.string!, now: S3Fixtures.asOf) == vector.expected.int)
  }
}

struct MemoVectorTests {
  @Test(arguments: JSON.cases("memoSort"))
  func sort(_ vector: JSONCase) throws {
    let sort = try #require(MemoSort(rawValue: vector.input.string!))
    #expect(same(MemoList.sort(S3Fixtures.memos, sort).map(\.id), vector.expected))
  }

  @Test(arguments: JSON.cases("memoDateKeys"))
  func dateKeys(_ vector: JSONCase) throws {
    #expect(MemoList.dateKey(try #require(S3Fixtures.memo(vector.input.string!))) == vector.expected.string)
  }

  @Test(arguments: JSON.cases("memoSortParse"))
  func sortParse(_ vector: JSONCase) {
    #expect(MemoSort.parse(vector.input.string).rawValue == vector.expected.string)
  }

  @Test(arguments: JSON.cases("memoSearch"))
  func search(_ vector: JSONCase) {
    #expect(same(S3Fixtures.memos.filter { MemoList.matches($0, query: vector.input.string!) }.map(\.id), vector.expected), "\(vector.input)")
  }

  @Test(arguments: JSON.cases("memoTags"))
  func tags(_ vector: JSONCase) {
    #expect(same(MemoForm.parseTags(vector.input.string!), vector.expected))
  }

  @Test(arguments: JSON.cases("memoDrafts"))
  func drafts(_ vector: JSONCase) throws {
    let memo = try #require(S3Fixtures.memo(vector.input.string!))
    let draft = MemoForm.draft(from: memo)
    #expect(same(draft, vector.expected["draft"]), "\(memo.id)")
    #expect(MemoForm.problem(draft) == vector.expected["problem"].string)
    #expect(same(MemoForm.createInput(draft), vector.expected["create"]), "\(memo.id)")
  }

  @Test func newDraft() {
    #expect(same(MemoForm.newDraft(date: "2026-09-30", audience: .household), JSON.load("newMemoDraft")))
  }

  @Test(arguments: JSON.cases("memoDraftChecks"))
  func checks(_ vector: JSONCase) throws {
    let draft: MemoDraft = try JSON.decode(vector.input["draft"])
    #expect(MemoForm.problem(draft) == vector.expected["problem"].string, "\(vector.input["name"])")
    #expect(same(MemoForm.createInput(draft), vector.expected["create"]), "\(vector.input["name"])")
  }

  @Test(arguments: JSON.cases("memoUpdates"))
  func updates(_ vector: JSONCase) throws {
    let original = try #require(S3Fixtures.memo(vector.input["id"].string!))
    let draft: MemoDraft = try JSON.decode(vector.input["draft"])
    #expect(same(MemoForm.updateInput(draft, original: original), vector.expected), "\(original.id) \(vector.input["name"])")
  }

  @Test(arguments: JSON.cases("attachmentProblems"))
  func problems(_ vector: JSONCase) {
    let input = vector.input
    #expect(MemoAttachments.problem(name: input["name"].string!, type: input["type"].string!, size: input["size"].int!) == vector.expected.string, "\(input)")
  }

  @Test(arguments: JSON.cases("fileSizes"))
  func sizes(_ vector: JSONCase) {
    #expect(MemoAttachments.formatSize(vector.input.int!) == vector.expected.string, "\(vector.input)")
  }

  @Test func small() {
    let small = JSON.load("attachmentSmall")
    #expect(MemoAttachments.limitsText == small["limits"].string)
    for pair in small["kinds"].array { #expect(AttachmentViewerKind(mimeType: pair[0].string!).rawValue == pair[1].string, "\(pair)") }
    for pair in small["links"].array { #expect(MemoAttachments.safeLinkURL(pair[0].string!) == pair[1].string, "\(pair)") }
  }

  @Test func ocrInput() {
    #expect(sameRaw(JSON.value(MemoForm.ocrInput("  ")), .object(["ocrText": .null])))
    #expect(sameRaw(JSON.value(MemoForm.ocrInput(" 教材 ")), .object(["ocrText": .string(" 教材 ")])))
  }
}
