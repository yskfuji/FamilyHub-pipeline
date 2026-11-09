// 設定（段階 S7）の入力と応答の型。元: src/domain/account.ts、src/domain/schemas.ts、src/domain/auditLog.ts、src/data/gateway.ts

/// アカウントの変更（PATCH /v1/account）。送らない項目は変えない。
public struct AccountUpdateInput: Codable, Sendable, Hashable {
  public var displayName: String?
  public var avatar: Avatar?
  public var idleTimeoutMinutes: Int?
  /// 一度だけ申告できる誕生日。
  public var birthdate: IsoDate?
  public init(displayName: String? = nil, avatar: Avatar? = nil, idleTimeoutMinutes: Int? = nil, birthdate: IsoDate? = nil) {
    self.displayName = displayName; self.avatar = avatar; self.idleTimeoutMinutes = idleTimeoutMinutes; self.birthdate = birthdate
  }
}

/// 色のリスト（予定とタスクに付ける色と名前）。
public struct ColorLabelInput: Codable, Sendable, Hashable {
  public var name: String
  public var color: String
  public init(name: String, color: String) { self.name = name; self.color = color }
}

/// 家族グループの名前。
public struct HouseholdProfileInput: Codable, Sendable, Hashable {
  public var name: String
  public init(name: String) { self.name = name }
}

/// 変更の記録の条件。送らない項目は絞り込まない。
public struct AuditQuery: Codable, Sendable, Hashable {
  public var cursor: String?
  public var limit: Int?
  public var membershipId: Id?
  public var group: AuditGroup?
  public var action: String?
  public var from: IsoDate?
  public var to: IsoDate?
  public init(cursor: String? = nil, limit: Int? = nil, membershipId: Id? = nil, group: AuditGroup? = nil, action: String? = nil, from: IsoDate? = nil, to: IsoDate? = nil) {
    self.cursor = cursor; self.limit = limit; self.membershipId = membershipId; self.group = group; self.action = action; self.from = from; self.to = to
  }

  /// URL のクエリ（Web の queryOf と同じ: 空と送らない項目は除き、項目の順は宣言の順）。
  public var queryItems: [(String, String)] {
    [("cursor", cursor), ("limit", limit.map(String.init)), ("membershipId", membershipId), ("group", group?.rawValue), ("action", action), ("from", from), ("to", to)]
      .compactMap { key, value in value.flatMap { $0.isEmpty ? nil : (key, $0) } }
  }
}

public struct AccountAuditQuery: Codable, Sendable, Hashable {
  public var cursor: String?
  public var limit: Int?
  public init(cursor: String? = nil, limit: Int? = nil) { self.cursor = cursor; self.limit = limit }
  public var queryItems: [(String, String)] {
    [("cursor", cursor), ("limit", limit.map(String.init))].compactMap { key, value in value.flatMap { $0.isEmpty ? nil : (key, $0) } }
  }
}

/// 確認コードの設定を始めたときの応答。認証アプリに登録する文字列。
public struct TotpEnrollment: Codable, Sendable, Hashable {
  public var otpauthUri: String
}

/// 確認コードの設定を終えたときの回復コード（表示は1回だけ）。
public struct RecoveryCodes: Codable, Sendable, Hashable {
  public var recoveryCodes: [String]
}

/// パスキーの登録を始めたときの応答。publicKey は WebAuthn の作成の条件（base64url の JSON）。見本では null。
public struct PasskeyRegistrationStart: Codable, Sendable, Hashable {
  public var challengeId: Id
  @Nullable public var publicKey: JSONValue?
}

