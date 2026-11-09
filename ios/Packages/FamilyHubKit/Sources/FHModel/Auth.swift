import Foundation

// 認証の入力と応答。元: src/data/gateway.ts の AuthPort と HouseholdPort、src/domain/account.ts。

/// パスワードでのサインインの結果。確認コードを設定している人は totpChallengeId を受け取り、確認コードで完了する。
public enum SignInResult: Decodable, Sendable, Hashable {
  case signedIn(userId: Id)
  case needsTotp(challengeId: Id)

  private enum Keys: String, CodingKey { case userId, totpChallengeId }
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    if let challenge = try container.decodeIfPresent(Id.self, forKey: .totpChallengeId) { self = .needsTotp(challengeId: challenge) }
    else { self = .signedIn(userId: try container.decode(Id.self, forKey: .userId)) }
  }
}

public struct SignUpInput: Codable, Sendable, Hashable {
  public var displayName: String
  public var email: String
  public var password: String
  public var birthdate: IsoDate
  public var guardianConsent: Bool
  public init(displayName: String, email: String, password: String, birthdate: IsoDate, guardianConsent: Bool) {
    self.displayName = displayName; self.email = email; self.password = password; self.birthdate = birthdate; self.guardianConsent = guardianConsent
  }
}

/// パスワードの再設定。メールのコードなら email と code、メールのリンクなら token。
public struct PasswordResetConfirmation: Codable, Sendable, Hashable {
  public var email: String?
  public var code: String?
  public var token: String?
  public var newPassword: String
  public init(email: String? = nil, code: String? = nil, token: String? = nil, newPassword: String) {
    self.email = email; self.code = code; self.token = token; self.newPassword = newPassword
  }
}

public struct PasswordResetRequested: Codable, Sendable, Hashable {
  public var resendAfterSeconds: Int
}

public struct UserRef: Codable, Sendable, Hashable {
  public var userId: Id
}

public struct HouseholdRef: Codable, Sendable, Hashable {
  public var householdId: Id
}
