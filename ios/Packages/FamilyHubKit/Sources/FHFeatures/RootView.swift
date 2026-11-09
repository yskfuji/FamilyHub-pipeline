import SwiftUI
import UserNotifications
import FHModel
import FHGateway
import FHDesign
import FHCopy

/// アプリの一番外側。接続先（見本・サーバー）を選び、選んだ接続先の AppModel を作る。
public struct FamilyHubRoot: View {
  @State private var preferences: Preferences
  @State private var model: AppModel?
  @State private var startupError: String?
  private let configuration: LaunchConfiguration

  public init(configuration: LaunchConfiguration) {
    self.configuration = configuration
    if configuration.resetPreferences {
      // 試験のための「はじめから」。設定と、サーバーのセッションの cookie を消す（前の試験のサインインを持ち越さない）。
      if let domain = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: domain) }
      HTTPCookieStorage.shared.removeCookies(since: .distantPast)
    }
    let preferences = Preferences()
    if configuration.forceSample { preferences.connection = .sample }
    if preferences.connection == .server, configuration.serverURL == nil { preferences.connection = nil }
    _preferences = State(initialValue: preferences)
  }

  public var body: some View {
    ThemedRoot(choice: preferences.themeChoice) {
      Group {
        if let model {
          // 接続先を変えたら、新しい AppModel で最初から読み込む。
          AppStageView().environment(model).id(ObjectIdentifier(model))
        } else if preferences.connection == nil {
          WelcomeView(serverURL: configuration.serverURL) { preferences.connection = $0 }
        } else if let startupError {
          StageMessage(title: "見本のデータを読み込めませんでした", message: startupError, illustration: .emptyError) {
            Button("はじめの画面に戻る") { preferences.connection = nil }.fhButton(.primary)
          }
        } else {
          RestoringView(slow: false, retry: nil)
        }
      }
      .environment(preferences)
      .environment(\.compactDensity, preferences.density == .compact)
      .densityListSpacing(preferences.density == .compact)
      .modifier(MotionAndPrivacy(preferences: preferences))
    }
    .task(id: preferences.connection) { connect() }
  }

  private func connect() {
    model = nil
    startupError = nil
    guard let kind = preferences.connection else { return }
    let gateway: any FamilyHubGateway
    switch kind {
    case .sample:
      do { gateway = try SampleGateway() } catch { startupError = "\(error)"; return }
    case .server:
      guard let url = configuration.serverURL else { preferences.connection = nil; return }
      gateway = HTTPGateway(baseURL: url, userAgent: configuration.userAgent)
    }
    let next = AppModel(gateway: gateway, preferences: preferences)
    next.onLeave = { [preferences] in preferences.connection = nil }
    NotificationOpener.shared.model = next
    UNUserNotificationCenter.current().delegate = NotificationOpener.shared
    model = next
  }
}

/// 「動きを減らす」と「隠れている間はぼかす」（この端末の設定）。
struct MotionAndPrivacy: ViewModifier {
  let preferences: Preferences
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
  @Environment(\.scenePhase) private var scenePhase

  func body(content: Content) -> some View {
    let reduce = preferences.reducedMotion || systemReduceMotion
    let hidden = preferences.privacyBlur && scenePhase != .active
    content
      // 動きを減らすときは、画面の切り替えや開閉の動きを止める。
      .transaction { if reduce { $0.disablesAnimations = true } }
      .environment(\.fhReduceMotion, reduce)
      .blur(radius: hidden ? 24 : 0)
      .overlay { if hidden { Color.black.opacity(0.25).ignoresSafeArea().accessibilityHidden(true) } }
      .accessibilityHidden(hidden)
  }
}

private struct ReduceMotionKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
  /// 動きを減らすか（端末の設定か、この端末のアプリの設定）。
  var fhReduceMotion: Bool {
    get { self[ReduceMotionKey.self] }
    set { self[ReduceMotionKey.self] = newValue }
  }
}

/// 段階ごとの画面と、どの画面の上にも出すもの（本人確認・無操作の予告・短い知らせ）。
struct AppStageView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.theme) private var theme
  @State private var showingPending = false

  var body: some View {
    @Bindable var model = model
    content
      .task { await model.refresh() }
      .task(id: model.stage == .ready) {
        guard model.stage == .ready else { return }
        model.recordActivity()
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(1))
          model.idleTick()
        }
      }
      .onChange(of: scenePhase) { _, phase in
        // 裏にいる間は数えない（端末が止める）。前に戻ったときに、期限を過ぎていればサインアウトする。
        if phase == .active { model.idleTick() }
      }
      .sheet(item: $model.reauth) { prompt in
        ReauthSheet(prompt: prompt).interactiveDismissDisabled()
      }
      .overlay(alignment: .bottom) { bottomNotices }
      .sheet(isPresented: $showingPending) { PendingChangesSheet() }
      #if os(iOS)
      .background(ActivityTracker { model.recordActivity() })
      #endif
  }

  @ViewBuilder private var content: some View {
    switch model.stage {
    case _ where model.onboarding && (model.stage == .householdSetup || model.stage == .ready): OnboardingView()
    case .restoring: RestoringView(slow: false) { Task { await model.refresh() } }
    case .unreachable: UnreachableView()
    case .signedOut: AuthFlowView()
    case .householdSetup: OnboardingView()
    case .suspended:
      StageMessage(title: "参加が一時停止されています", message: "家族グループの管理者に確認してください。") {
        Button("サインアウト") { Task { await model.signOut() } }.fhButton(.secondary)
      }
    case .paywall:
      StageMessage(title: "利用期間が終わりました", message: "記録は残っています。続けて使うには、運営者へ利用の延長を依頼してください。") {
        Button("サインアウト") { Task { await model.signOut() } }.fhButton(.secondary)
      }
    case .ready: ShellView()
    }
  }

  @ViewBuilder private var bottomNotices: some View {
    VStack(spacing: TokenSpace.space2) {
      if model.stage == .ready, !model.pendingCommands.isEmpty {
        PendingCard(count: model.pendingCommands.count) { showingPending = true }
      }
      if let remaining = model.idleRemaining {
        IdleCard(remaining: remaining) { model.recordActivity() }
      }
      if let toast = model.toast {
        ToastView(message: toast)
          .task(id: toast) {
            announce(toast)
            try? await Task.sleep(for: .seconds(4.2))
            if model.toast == toast { model.toast = nil }
          }
      }
    }
    .padding(.horizontal, TokenSpace.space4)
    .padding(.bottom, 72)
  }
}

/// 未送信の変更があることの知らせ（Web の上部の「未送信の変更」）。
struct PendingCard: View {
  @Environment(\.theme) private var theme
  let count: Int
  let open: () -> Void
  var body: some View {
    let colors = theme.colors
    HStack(spacing: TokenSpace.space3) {
      Image(systemName: "icloud.slash").foregroundStyle(colors.attention.color).accessibilityHidden(true)
      Text("未送信の変更が\(count)件あります").font(.callout.weight(.semibold)).foregroundStyle(colors.ink.color)
      Spacer(minLength: 0)
      Button("確認する", action: open).fhButton(.secondary).accessibilityIdentifier("queue.open")
    }
    .padding(.horizontal, TokenSpace.space4)
    .padding(.vertical, TokenSpace.space2)
    .background(colors.sheetRaised.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusMd))
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusMd).stroke(colors.attention.color))
    .accessibilityElement(children: .contain)
  }
}

/// 未送信の変更の一覧。接続が戻っても自動では送らない。確かめてから送るか、削除する。
struct PendingChangesSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var busy = false
  @State private var clearing = false

  var body: some View {
    let colors = theme.colors
    NavigationStack {
      List {
        Section {
          Text("送信する内容を確認してください。接続が戻っても自動では送信しません。").font(.callout).foregroundStyle(colors.inkSoft.color)
        }
        if model.pendingCommands.isEmpty {
          Text("未送信の変更はありません。").foregroundStyle(colors.inkSoft.color)
        }
        ForEach(model.pendingCommands) { item in
          VStack(alignment: .leading, spacing: TokenSpace.space2) {
            HStack {
              StatusBadge(item.state == .pending ? "未送信" : item.state == .conflicted ? "内容の確認が必要" : "権限の確認が必要", tone: item.state == .pending ? .attention : .danger)
              Spacer()
              Text("保存後24時間まで").font(.footnote).foregroundStyle(colors.inkSoft.color)
            }
            Text(item.summary).font(.headline).foregroundStyle(colors.ink.color)
            HStack(spacing: TokenSpace.space2) {
              Button("この変更を送信") { Task { busy = true; await model.retryQueued(item.id); busy = false } }
                .fhButton(.primary)
                .accessibilityIdentifier("queue.retry.\(item.id)")
              Button("削除") { Task { await model.discardQueued(item.id) } }
                .fhButton(.secondary)
                .accessibilityIdentifier("queue.discard.\(item.id)")
            }
            .buttonStyle(.borderless)
          }
          .padding(.vertical, TokenSpace.space1)
        }
        if !model.pendingCommands.isEmpty {
          Section {
            Button(busy ? "送信しています…" : "すべて送信") { Task { busy = true; await model.retryQueued(); busy = false } }
              .disabled(busy)
              .accessibilityIdentifier("queue.retry-all")
            Button { clearing = true } label: { Text("すべて削除").foregroundStyle(colors.danger.color) }.disabled(busy)
          }
        }
      }
      .disabled(busy)
      .navigationTitle("未送信の変更")
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dismiss() } } }
      .alert("未送信の変更をすべて削除しますか", isPresented: $clearing) {
        Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
        Button("すべて削除", role: .destructive) { Task { await model.clearQueued() } }
      } message: { Text("この端末に保存した変更は送信されずに消えます。") }
    }
  }
}

/// 無操作の予告（Web の .idle-card）。
struct IdleCard: View {
  @Environment(\.theme) private var theme
  let remaining: Int
  let resume: () -> Void
  var body: some View {
    let colors = theme.colors
    HStack(spacing: TokenSpace.space3) {
      Text("操作がないため、あと\(remaining)秒でサインアウトします。").font(.callout.weight(.semibold)).foregroundStyle(colors.ink.color)
      Spacer(minLength: 0)
      Button("続ける", action: resume).fhButton(.primary)
    }
    .padding(TokenSpace.space4)
    .background(colors.sheetRaised.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusMd))
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusMd).stroke(colors.attention.color))
    .accessibilityElement(children: .contain)
    .onAppear { announce("操作がないため、あと\(remaining)秒でサインアウトします。") }
  }
}

struct ToastView: View {
  @Environment(\.theme) private var theme
  let message: String
  var body: some View {
    let colors = theme.colors
    Text(message)
      .font(.callout.weight(.semibold))
      .foregroundStyle(colors.paper.color)
      .padding(.horizontal, TokenSpace.space4)
      .padding(.vertical, TokenSpace.space3)
      .background(colors.ink.color, in: Capsule())
      .accessibilityAddTraits(.updatesFrequently)
  }
}

/// 本人確認（Web の ReauthDialog）。入力中の画面はそのまま残る。
struct ReauthSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let prompt: AppModel.ReauthPrompt
  @State private var password = ""
  @State private var error: String?
  @State private var busy = false

  var body: some View {
    let expired = prompt.reason == .expired
    NavigationStack {
      Form {
        Section {
          Text(expired ? "時間がたったため、サインインし直す必要があります。入力中の内容はそのまま残ります。" : "この操作を続けるには、パスワードを入力してください。")
            .foregroundStyle(theme.colors.inkSoft.color)
          SecureField("パスワード", text: $password).passwordInput(new: false).submitLabel(.go).onSubmit(submit)
          if let error { Text(error).foregroundStyle(theme.colors.danger.color).font(.callout.weight(.semibold)) }
        }
      }
      .navigationTitle(expired ? "もう一度サインインしてください" : "本人確認")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("やめる") { model.cancelReauth() } }
        ToolbarItem(placement: .confirmationAction) { Button(busy ? "確認中…" : "続ける", action: submit).disabled(busy || password.isEmpty) }
      }
    }
  }

  private func submit() {
    busy = true
    error = nil
    Task {
      error = await model.submitReauth(password: password)
      busy = false
    }
  }
}
