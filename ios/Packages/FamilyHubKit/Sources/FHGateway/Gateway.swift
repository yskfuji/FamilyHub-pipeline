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

  // household
  func getSnapshot() async -> GatewayResult<HouseholdSnapshot>

  // todos
  func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo>
}

public enum GatewayMode: Sendable, Hashable {
  case sample
  case server(URL)
}

/// 関数の名前（port.method）。Web の FamilyHubGateway の関数と照らす（試験）。
public enum GatewayMethod: String, CaseIterable, Sendable {
  case getSession = "auth.getSession"
  case getSnapshot = "household.getSnapshot"
  case updateTodoStatus = "todos.updateTodoStatus"
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
