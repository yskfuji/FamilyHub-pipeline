import Foundation
import FHModel

/// 見本のモード。サーバーなしで、アプリに入れた見本の家族（森さんち）を動かす。変更は記憶の中だけに残る。
public final class SampleGateway: FamilyHubGateway {
  public let engine: SampleEngine
  public var mode: GatewayMode { .sample }

  public init(engine: SampleEngine) { self.engine = engine }
  public convenience init(actorId: Id = "member-aoi") throws { self.init(engine: try SampleEngine(actorId: actorId)) }

  /// port.method を呼ぶ。見本の仕組みが壊れていたときは UPSTREAM_FAILURE にする（画面は失敗として扱える）。
  func invoke<Value: Decodable & Sendable>(_ method: GatewayMethod, _ arguments: (any Encodable & Sendable)?..., as type: Value.Type = Value.self) async -> GatewayResult<Value> {
    let parts = method.rawValue.split(separator: ".", maxSplits: 1).map(String.init)
    do {
      let json = String(decoding: try JSONEncoder().encode(GatewayArgument.list(arguments)), as: UTF8.self)
      let data = try await engine.call(parts[0], parts[1], argumentsJSON: json)
      return try JSONDecoder().decode(WireResult<Value>.self, from: data).result
    } catch {
      return .failure(GatewayError(code: .upstreamFailure, message: "見本のデータを読み込めませんでした。アプリを開き直してください。", retryable: true))
    }
  }

  public func getSession() async -> GatewayResult<SessionInfo> { await invoke(.getSession) }
  public func getSnapshot() async -> GatewayResult<HouseholdSnapshot> { await invoke(.getSnapshot) }
  public func updateTodoStatus(id: Id, status: TodoStatus, expectedVersion: Int, note: String?) async -> GatewayResult<Todo> {
    await invoke(.updateTodoStatus, id, status, expectedVersion, note)
  }
}
