import Foundation
import Observation
import FHModel
import FHDomain
import FHGateway
import FHDesign

/// 画面全体の状態。Web の src/app/AppContext.tsx と同じ流れ:
/// - サーバーのときは、まずセッションの段階を確かめ、active なら家族の記録（snapshot）を取る。
/// - 変更のあとは記録を取り直す。
/// - 本人確認が要る応答（REAUTH_REQUIRED・SESSION_EXPIRED）を受けたら、入力中の画面の上で確認し、同じ操作をやり直す（src/app/reauth.tsx）。
@MainActor
@Observable
public final class AppModel {
  public enum Stage: Equatable, Sendable { case restoring, unreachable, signedOut, householdSetup, suspended, paywall, ready }

  public struct ReauthPrompt: Identifiable, Equatable, Sendable {
    public enum Reason: Sendable { case reauth, expired }
    public let id = UUID()
    public let reason: Reason
  }

  public let gateway: any FamilyHubGateway
  public let preferences: Preferences
  public var isSample: Bool { gateway.mode == .sample }

  public private(set) var session: SessionInfo?
  private var unreachable = false
  public private(set) var snapshot: HouseholdSnapshot?
  public private(set) var privacy: PrivacySettings?
  /// 最初の読み込みの間（画面全体を待機の表示にする）。
  public private(set) var loading = true
  /// 2回目からの読み直しの間（画面はそのまま）。
  public private(set) var refreshing = false
  /// 使っている途中の失敗。最後に取れた内容を残したまま知らせる。
  public var error: GatewayError?
  /// 短い知らせ（読み上げにも伝える）。
  public var toast: String?
  public var reauth: ReauthPrompt?
  /// はじめに（家族グループの設定）を進めている間は、段階が active になっても最後まで見せる。
  public var onboarding = false
  public private(set) var notifications: [HouseholdNotification] = []
  /// 通知を一度でも読んだか（画面ごとに取り直さない）。
  public private(set) var notificationsLoaded = false
  public private(set) var notificationsError: String?
  /// 無操作の期限まであと何秒か（60秒を切ったときだけ）。
  public private(set) var idleRemaining: Int?

  /// 接続先を選び直す（見本をやめる・別のサーバーにする）。FamilyHubRoot が渡す。
  @ObservationIgnored public var onLeave: @MainActor () -> Void = {}
  @ObservationIgnored private var firstLoad = true
  @ObservationIgnored private var reauthWaiters: [CheckedContinuation<Bool, Never>] = []
  @ObservationIgnored private var lastActivity = Date()
  @ObservationIgnored private var lastPing = Date()
  @ObservationIgnored private let clock: @Sendable () -> Date

  public init(gateway: any FamilyHubGateway, preferences: Preferences, clock: @escaping @Sendable () -> Date = { Date() }) {
    self.gateway = gateway
    self.preferences = preferences
    self.clock = clock
    // 見本は最初からサインインしている（Web の見本と同じ）。
    if gateway.mode == .sample { session = SessionInfo(stage: .active, idleTimeoutMinutes: 30) }
  }

  public var stage: Stage {
    if unreachable { return .unreachable }
    guard let session else { return .restoring }
    switch session.stage {
    case .active: return .ready
    case .householdSetup: return .householdSetup
    case .suspended: return .suspended
    case .paywall: return .paywall
    default: return .signedOut
    }
  }

  public func can(_ capability: Capability) -> Bool {
    guard let viewer = snapshot?.viewer else { return false }
    return viewer.status == .active && viewer.capabilities.contains(capability)
  }

  // MARK: 読み込み

  /// 最新の内容を読み直す。読み直せなかったときは false。
  @discardableResult
  public func refresh() async -> Bool {
    let blocking = firstLoad
    firstLoad = false
    if blocking { loading = true } else { refreshing = true }
    defer { if blocking { loading = false } else { refreshing = false } }
    error = nil
    if !isSample {
      let current = await gateway.getSession()
      switch current {
      case .failure(let failure):
        // 使っている途中で接続が切れたら、画面を残したまま知らせる。全画面の案内は最初の読み込みのときだけ。
        if !blocking { error = failure; return false }
        unreachable = true
        return false
      case .success(let value):
        unreachable = false
        session = value
        if value.stage == .householdSetup { onboarding = true }
        guard value.stage == .active else { return true }
      }
    }
    // 最初の読み込みでは、プライバシーの設定も並べて取る。
    let privacyTask: Task<GatewayResult<PrivacySettings>, Never>? = (blocking || privacy == nil) ? Task { [gateway] in await gateway.getPrivacySettings() } : nil
    switch await gateway.getSnapshot() {
    case .success(let value):
      snapshot = value
      if let privacyTask, value.viewer.capabilities.contains(.settingsOwn), case .success(let settings) = await privacyTask.value { privacy = settings }
      return true
    case .failure(let failure):
      privacyTask?.cancel()
      error = failure
      return false
    }
  }

  /// サインインの後に、段階と家族の記録を読み直す。
  public func finishSignIn() async {
    firstLoad = true
    session = nil
    await refresh()
    recordActivity()
  }

  /// サインアウト。force のときは、送れなくてもこの端末の状態を消す（無操作の期限など）。
  public func signOut(force: Bool = false) async {
    if isSample { onLeave(); return }
    let result = await gateway.signOut()
    if case .failure(let failure) = result, !force { toast = failure.message; return }
    clearHousehold()
    session = SessionInfo(stage: .signedOut, idleTimeoutMinutes: session?.idleTimeoutMinutes ?? 30)
  }

  private func clearHousehold() {
    snapshot = nil
    privacy = nil
    notifications = []
    notificationsLoaded = false
    error = nil
    idleRemaining = nil
    firstLoad = true
  }

  // MARK: 本人確認

  /// 操作を流し、本人確認が要る応答なら確認してからもう一度流す。
  public func run<Value: Sendable>(_ operation: @escaping @Sendable () async -> GatewayResult<Value>) async -> GatewayResult<Value> {
    let result = await operation()
    guard case .failure(let failure) = result else { return result }
    let reason: ReauthPrompt.Reason? = failure.code == .reauthRequired ? .reauth : failure.reason == .sessionExpired ? .expired : nil
    guard let reason, await ask(reason) else { return result }
    return await operation()
  }

  /// 同時に複数の操作が確認を求めても、確認は1回にまとめる。
  private func ask(_ reason: ReauthPrompt.Reason) async -> Bool {
    if reauth == nil { reauth = ReauthPrompt(reason: reason) }
    return await withCheckedContinuation { reauthWaiters.append($0) }
  }

  /// 確認のパスワードを送る。失敗したら文言を返す。
  public func submitReauth(password: String) async -> String? {
    guard let prompt = reauth else { return nil }
    if prompt.reason == .expired {
      let email = snapshot?.user.email ?? ""
      switch await gateway.signInWithPassword(email: email, password: password) {
      case .failure(let failure): return failure.message
      case .success(.needsTotp):
        // 確認コードを設定している人は、サインインの画面からやり直す。
        cancelReauth()
        return nil
      case .success(.signedIn): break
      }
    } else if case .failure(let failure) = await gateway.reauthenticate(password: password) {
      return failure.message
    }
    finishReauth(true)
    return nil
  }

  public func cancelReauth() {
    if reauth?.reason == .expired {
      clearHousehold()
      session = SessionInfo(stage: .signedOut, idleTimeoutMinutes: session?.idleTimeoutMinutes ?? 30)
    }
    finishReauth(false)
  }

  private func finishReauth(_ confirmed: Bool) {
    reauth = nil
    let waiters = reauthWaiters
    reauthWaiters = []
    for waiter in waiters { waiter.resume(returning: confirmed) }
  }

  // MARK: 無操作の期限（サーバーのときだけ）

  /// 画面に触れたとき。サーバーの期限も延ばすため、続けて触っている間は1分に1回だけ知らせる（Web の IdleGuard と同じ）。
  public func recordActivity() {
    let now = clock()
    lastActivity = now
    idleRemaining = nil
    guard !isSample, stage == .ready, now.timeIntervalSince(lastPing) > 60 else { return }
    lastPing = now
    Task { [gateway] in
      if case .success(let current) = await gateway.getSession(), current.stage == .signedOut { self.expireLocally() }
    }
  }

  /// 1秒ごと、またはアプリが前に戻ったときに呼ぶ。期限を過ぎていればサインアウトする。
  /// 判定そのものはサーバーが行い、ここは案内と、この端末の表示を消すことにとどまる。
  public func idleTick() {
    guard !isSample, stage == .ready else { idleRemaining = nil; return }
    let limit = Double((session?.idleTimeoutMinutes ?? 30) * 60)
    let left = limit - clock().timeIntervalSince(lastActivity)
    if left <= 0 {
      idleRemaining = nil
      Task { await signOut(force: true); toast = "操作がなかったため、サインアウトしました。" }
      return
    }
    idleRemaining = left <= 60 ? Int(left.rounded(.up)) : nil
  }

  private func expireLocally() {
    clearHousehold()
    session = SessionInfo(stage: .signedOut, idleTimeoutMinutes: session?.idleTimeoutMinutes ?? 30)
  }

  // MARK: 家族の記録の変更

  public func announce(_ message: String) { toast = message }

  /// 共有範囲などを、最新の設定を取り直してから、変えた項目だけ変えて保存する（別の画面での変更を上書きしない）。
  public func updatePrivacy(_ change: @escaping @Sendable (inout PrivacySettings) -> Void) async -> GatewayResult<PrivacySettings> {
    let result: GatewayResult<PrivacySettings> = await run { [gateway] () async -> GatewayResult<PrivacySettings> in
      switch await gateway.getPrivacySettings() {
      case .failure(let failure): return .failure(failure)
      case .success(var latest):
        change(&latest)
        return await gateway.savePrivacySettings(latest)
      }
    }
    if case .success(let saved) = result { privacy = saved }
    return result
  }

  // MARK: 通知

  public func loadNotifications() async {
    guard can(.notificationManage) else { notifications = []; return }
    switch await gateway.listNotifications() {
    case .success(let list): notifications = list; notificationsError = nil; notificationsLoaded = true
    case .failure(let failure): notificationsError = failure.message
    }
  }

  public func markNotificationRead(_ id: Id) async {
    switch await run({ [gateway] in await gateway.markNotificationRead(id: id) }) {
    case .success: await loadNotifications(); announce("通知を既読にしました。")
    case .failure(let failure): notificationsError = failure.message
    }
  }

  public var unreadNotifications: Int { notifications.filter { !$0.read }.count }
}
