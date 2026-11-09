import Foundation
import Testing
@testable import FHModel

/// Web の見本の応答（scripts/ios/export-fixtures.mjs が書き出す）を読み、書き戻して、同じ JSON になること。
/// 欄の名前の違い、Swift の型にない欄、null と省略の違いを見つける。
struct FixtureRoundTripTests {
  static func data(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
  }

  /// 読んで書き戻した JSON が、元と同じ値か。
  static func roundTrip<T: Codable>(_ type: T.Type, _ name: String) throws {
    let original = try data(name)
    let decoded = try JSONDecoder().decode(T.self, from: original)
    let encoded = try JSONEncoder().encode(decoded)
    let before = try JSONSerialization.jsonObject(with: original, options: [.fragmentsAllowed]) as AnyObject
    let after = try JSONSerialization.jsonObject(with: encoded, options: [.fragmentsAllowed]) as AnyObject
    #expect(before.isEqual(after), "\(name) の書き戻しが元と違う:\n\(String(decoding: encoded, as: UTF8.self))")
  }

  @Test(arguments: ["member-aoi", "member-ren", "member-hana", "member-yui"])
  func snapshot(actor: String) throws {
    try Self.roundTrip(HouseholdSnapshot.self, "snapshot.\(actor)")
  }

  @Test func otherResponses() throws {
    try Self.roundTrip([AlbumSummary].self, "albums")
    try Self.roundTrip(AlbumDetail.self, "album.album-sports")
    try Self.roundTrip([HouseholdNotification].self, "notifications")
    try Self.roundTrip(NotificationPreferences.self, "notificationPreferences")
    try Self.roundTrip(PrivacySettings.self, "privacy")
    try Self.roundTrip(SecurityOverview.self, "security")
    try Self.roundTrip([HouseholdInvite].self, "invites")
    try Self.roundTrip(AccountProfile.self, "account")
    try Self.roundTrip(SessionInfo.self, "session")
    try Self.roundTrip([Insight].self, "insights")
    try Self.roundTrip([SearchResult].self, "search")
    try Self.roundTrip(AuditPage.self, "audit")
    try Self.roundTrip(AccountAuditPage.self, "auditMine")
    try Self.roundTrip(AssistantStatus.self, "assistantStatus")
    try Self.roundTrip([TrashItem].self, "trash")
    try Self.roundTrip(GatewayError.self, "error.version")
  }

  /// 段階 S3: タスクとメモの変更の応答。
  @Test func contentResponses() throws {
    for name in ["todo.created", "todo.waiting", "todo.recurringDone"] { try Self.roundTrip(Todo.self, name) }
    for name in ["memo.created", "memo.attached", "memo.ocr"] { try Self.roundTrip(Memo.self, name) }
    try Self.roundTrip(AttachmentLink.self, "attachment.link")
  }

  /// 段階 S4: 家計の変更の応答。
  @Test func budgetResponses() throws {
    for name in ["expense.created", "expense.settled"] { try Self.roundTrip(Expense.self, name) }
    for name in ["settlementBatch", "settlementBatch.reversed"] { try Self.roundTrip(SettlementBatch.self, name) }
    try Self.roundTrip(HouseholdSnapshot.self, "snapshot.afterBatch")
  }

  @Test func viewersSeeDifferentRecords() throws {
    let owner = try JSONDecoder().decode(HouseholdSnapshot.self, from: Self.data("snapshot.member-aoi"))
    let child = try JSONDecoder().decode(HouseholdSnapshot.self, from: Self.data("snapshot.member-hana"))
    #expect(owner.viewer.role == .owner)
    #expect(child.viewer.role == .child)
    #expect(child.expenses.count < owner.expenses.count || !child.can(.expenseRead))
    #expect(owner.can(.auditRead))
    #expect(!child.can(.auditRead))
  }

  /// この確かめ方が、Swift の型にない欄を見落とさないこと。
  @Test func roundTripNoticesDroppedFields() throws {
    let original = Data(#"{"todoDue":true,"eventDeparture":false,"quietHours":true,"newField":1}"#.utf8)
    let encoded = try JSONEncoder().encode(try JSONDecoder().decode(NotificationPreferences.self, from: original))
    let before = try JSONSerialization.jsonObject(with: original) as AnyObject
    let after = try JSONSerialization.jsonObject(with: encoded) as AnyObject
    #expect(!before.isEqual(after))
  }

  @Test func unknownValuesSurvive() throws {
    let json = Data(#"{"code":"SOMETHING_NEW","message":"新しい失敗","retryable":false,"reason":"NEW_REASON"}"#.utf8)
    let error = try JSONDecoder().decode(GatewayError.self, from: json)
    #expect(error.code.rawValue == "SOMETHING_NEW")
    #expect(error.reason?.rawValue == "NEW_REASON")
  }

  @Test func wireResult() throws {
    let success = try JSONDecoder().decode(WireResult<SessionInfo>.self, from: Data(#"{"ok":true,"value":{"stage":"active","idleTimeoutMinutes":30}}"#.utf8))
    #expect(try success.result.get().stage == .active)
    let empty = try JSONDecoder().decode(WireResult<Empty>.self, from: Data(#"{"ok":true}"#.utf8))
    #expect((try? empty.result.get()) != nil)
    let failure = try JSONDecoder().decode(WireResult<SessionInfo>.self, from: Data(#"{"ok":false,"error":{"code":"OFFLINE","message":"x","retryable":true}}"#.utf8))
    if case .failure(let error) = failure.result { #expect(error.code == .offline) } else { Issue.record("失敗のはず") }
  }
}
