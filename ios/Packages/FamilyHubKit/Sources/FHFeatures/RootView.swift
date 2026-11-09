import SwiftUI
import FHModel
import FHGateway
import FHDesign

/// アプリの一番外側。接続先（見本・サーバー）を選び、選んだ接続先の AppModel を作る。
public struct FamilyHubRoot: View {
  @State private var preferences: Preferences
  @State private var model: AppModel?
  @State private var startupError: String?
  private let configuration: LaunchConfiguration

  public init(configuration: LaunchConfiguration) {
    self.configuration = configuration
    if configuration.resetPreferences, let domain = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: domain) }
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
    model = next
  }
}

/// 段階ごとの画面と、どの画面の上にも出すもの（本人確認・無操作の予告・短い知らせ）。
struct AppStageView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.theme) private var theme

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
