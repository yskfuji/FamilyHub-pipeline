import Foundation
import FHModel

/// サーバーとのやり取りの窓口。Web の FamilyHubGateway（src/data/gateway.ts）の写しで、
/// 見本（SampleGateway）とサーバー（HTTPGateway）が同じ形で応える。段階ごとに関数を足す。
public typealias GatewayResult<Value> = Result<Value, GatewayError>

public protocol FamilyHubGateway: Sendable {
  /// サーバーにつながっているか、見本か。
  var mode: GatewayMode { get }

  // auth
  func getSession() async -> GatewayResult<SessionInfo>
  func signInWithPassword(email: String, password: String) async -> GatewayResult<SignInResult>
  func verifyTotp(challengeId: Id, code: String) async -> GatewayResult<UserRef>
  func signUp(_ input: SignUpInput) async -> GatewayResult<UserRef>
  func requestPasswordReset(email: String) async -> GatewayResult<PasswordResetRequested>
  func confirmPasswordReset(_ input: PasswordResetConfirmation) async -> GatewayResult<Empty>
  func reauthenticate(password: String) async -> GatewayResult<Empty>
  func signOut() async -> GatewayResult<Empty>

  // household
  func getSnapshot() async -> GatewayResult<HouseholdSnapshot>
  func createHousehold(name: String) async -> GatewayResult<HouseholdRef>
  func acceptInvite(code: String) async -> GatewayResult<HouseholdRef>
  func getPrivacySettings() async -> GatewayResult<PrivacySettings>
  func savePrivacySettings(_ settings: PrivacySettings) async -> GatewayResult<PrivacySettings>

  // todos
  func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo>

  // notifications
  func listNotifications() async -> GatewayResult<[HouseholdNotification]>
  func markNotificationRead(id: Id) async -> GatewayResult<HouseholdNotification>
}

public enum GatewayMode: Sendable, Hashable {
  case sample
  case server(URL)
}

/// 関数の名前（port.method）。Web の FamilyHubGateway の関数と照らす（GatewayParityTests）。
public enum GatewayMethod: String, CaseIterable, Sendable {
  case getSession = "auth.getSession"
  case signInWithPassword = "auth.signInWithPassword"
  case verifyTotp = "auth.verifyTotp"
  case signUp = "auth.signUp"
  case requestPasswordReset = "auth.requestPasswordReset"
  case confirmPasswordReset = "auth.confirmPasswordReset"
  case reauthenticate = "auth.reauthenticate"
  case signOut = "auth.signOut"
  case getSnapshot = "household.getSnapshot"
  case createHousehold = "household.createHousehold"
  case acceptInvite = "household.acceptInvite"
  case getPrivacySettings = "household.getPrivacySettings"
  case savePrivacySettings = "household.savePrivacySettings"
  case updateTodoStatus = "todos.updateTodoStatus"
  case listNotifications = "notifications.list"
  case markNotificationRead = "notifications.markRead"
}

/// JSON の引数。末尾の nil は渡さない（JS の省略と同じにする）。
public enum GatewayArgument: Encodable, Sendable {
  case value(any Encodable & Sendable)
  case absent

  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .value(let value): try value.encode(to: encoder)
    case .absent:
      var container = encoder.singleValueContainer()
      try container.encodeNil()
    }
  }

  static func list(_ values: [(any Encodable & Sendable)?]) -> [GatewayArgument] {
    var arguments = values.map { $0.map(GatewayArgument.value) ?? .absent }
    while case .absent? = arguments.last { arguments.removeLast() }
    return arguments
  }
}

/// 失敗の文言。Web の httpGateway.ts と同じ。
public enum GatewayFailure {
  public static let offline = GatewayError(code: .offline, message: "ネットワークに接続できません。", retryable: true)
  public static let response = GatewayError(code: .upstreamFailure, message: "応答を受け取れませんでした。少し待ってからお試しください。", retryable: true)
}
