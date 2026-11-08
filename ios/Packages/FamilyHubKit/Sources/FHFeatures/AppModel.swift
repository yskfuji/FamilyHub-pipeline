import Foundation
import Observation
import FHModel
import FHGateway
import FHDesign

/// 画面全体の状態。家族の記録（snapshot）を持ち、変更のあとは取り直す（Web の src/app/AppContext.tsx と同じ流れ）。
@MainActor
@Observable
public final class AppModel {
  public private(set) var snapshot: HouseholdSnapshot?
  public private(set) var lastError: GatewayError?
  public private(set) var isRefreshing = false
  public var themeChoice = ThemeChoice()
  public let gateway: any FamilyHubGateway

  public init(gateway: any FamilyHubGateway) {
    self.gateway = gateway
  }

  public func refresh() async {
    isRefreshing = true
    defer { isRefreshing = false }
    switch await gateway.getSnapshot() {
    case .success(let value): snapshot = value; lastError = nil
    case .failure(let error): lastError = error
    }
  }

  /// タスクの状態を変える。成功したら記録を取り直す。版が古ければ取り直して知らせる。
  public func transition(_ todo: Todo, to status: TodoStatus) async {
    switch await gateway.updateTodoStatus(id: todo.id, status: status, expectedVersion: todo.version, note: nil) {
    case .success: lastError = nil
    case .failure(let error): lastError = error
    }
    await refresh()
  }
}
