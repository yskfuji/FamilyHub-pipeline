// 操作の記録と読み取りの補助の型。元: src/domain/auditLog.ts、src/domain/assistant.ts

/// 記録の主。member（家族の人）、operator（運営者）、former（もういない人）、self（本人）。
public struct AuditActor: Codable, Sendable, Hashable {
  public var kind: String
  public var membershipId: Id?
  public var displayName: String?
}

public struct AuditTarget: Codable, Sendable, Hashable {
  public var kind: AuditTargetKind
  @Nullable public var id: Id?
  public var hidden: Bool
}

public struct AuditDetail: Codable, Sendable, Hashable {
  public var fields: [String]
}

public struct AuditEntry: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var at: Rfc3339
  public var actor: AuditActor
  public var action: String
  public var group: AuditGroup
  @Nullable public var target: AuditTarget?
  @Nullable public var detail: AuditDetail?
}

public struct AuditChainStatus: Codable, Sendable, Hashable {
  public var state: String
  @Nullable public var checkedAt: Rfc3339?
}

public struct AuditPage: Codable, Sendable, Hashable {
  public var items: [AuditEntry]
  @Nullable public var nextCursor: String?
  public var chain: AuditChainStatus
}

public struct AccountAuditEntry: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var at: Rfc3339
  public var actor: AuditActor
  public var action: String
  public var group: AuditGroup
  @Nullable public var detail: AuditDetail?
}

public struct AccountAuditPage: Codable, Sendable, Hashable {
  public var items: [AccountAuditEntry]
  @Nullable public var nextCursor: String?
}

public struct AssistantStatus: Codable, Sendable, Hashable {
  public var available: Bool
  public var sample: Bool?
}

public struct ReceiptProposal: Codable, Sendable, Hashable {
  @Nullable public var amountJpy: Int?
  @Nullable public var date: IsoDate?
  @Nullable public var merchant: String?
  public var category: ExpenseCategory
}

public struct EventCandidate: Codable, Sendable, Hashable {
  public var title: String
  public var date: IsoDate
  @Nullable public var startTime: String?
  @Nullable public var endTime: String?
  public var allDay: Bool
  @Nullable public var location: String?
}

public struct AssistantJob: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var kind: AssistantJobKind
  public var status: AssistantJobStatus
  public var receipt: ReceiptProposal?
  public var events: [EventCandidate]?
  public var message: String?
  public var sample: Bool?
}

/// 応答の形 { ok: true, value } / { ok: false, error }。
public struct WireResult<Value: Decodable & Sendable>: Decodable, Sendable {
  public let result: Result<Value, GatewayError>

  private enum Keys: String, CodingKey { case ok, value, error }
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    if try container.decode(Bool.self, forKey: .ok) {
      if Value.self == Empty.self, !container.contains(.value) { result = .success(Empty() as! Value) }
      else { result = .success(try container.decode(Value.self, forKey: .value)) }
    } else {
      result = .failure(try container.decode(GatewayError.self, forKey: .error))
    }
  }
}
