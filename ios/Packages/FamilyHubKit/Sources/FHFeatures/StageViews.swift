import SwiftUI
import FHDesign

/// 本編に入る前の画面の枠（Web の .stage-screen）。印・見出し・説明・操作。
struct StageMessage<Actions: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  let message: String
  var illustration: Illustration?
  @ViewBuilder var actions: Actions

  var body: some View {
    ScrollView {
      VStack(spacing: TokenSpace.space5) {
        BrandLockup()
        EmptyStateView(title: title, message: message, illustration: illustration) {
          VStack(spacing: TokenSpace.space2) { actions }
        }
      }
      .padding(TokenSpace.space5)
      .frame(maxWidth: 560)
      .frame(maxWidth: .infinity)
    }
    .background(theme.colors.paper.color.ignoresSafeArea())
  }
}

/// 読み込み中（Web の RestoringScreen）。15秒たっても終わらなければ、もう一度読み込めるようにする。
struct RestoringView: View {
  @Environment(\.theme) private var theme
  @State var slow: Bool
  let retry: (() -> Void)?

  var body: some View {
    VStack(spacing: TokenSpace.space4) {
      BrandLockup()
      ProgressView()
      Text(slow ? "読み込みに時間がかかっています。接続を確認してください。" : "読み込んでいます。").foregroundStyle(theme.colors.inkSoft.color)
      if slow, let retry { Button("もう一度読み込む", action: retry).fhButton(.primary) }
    }
    .padding(TokenSpace.space5)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(theme.colors.paper.color.ignoresSafeArea())
    .task {
      try? await Task.sleep(for: .seconds(15))
      slow = true
    }
  }
}

/// サーバーにつながらない（Web の「接続できません」）。
struct UnreachableView: View {
  @Environment(AppModel.self) private var model
  var body: some View {
    StageMessage(title: "接続できません", message: "インターネットの接続を確認してください。", illustration: .emptyOffline) {
      Button("もう一度試す") { Task { await model.finishSignIn() } }.fhButton(.primary, fullWidth: true)
      Button("接続先を選び直す") { model.onLeave() }.fhButton(.secondary, fullWidth: true)
    }
  }
}

/// はじめの画面。見本で試すか、サーバーにつなぐかを選ぶ（Web の WelcomePage）。
struct WelcomeView: View {
  @Environment(\.theme) private var theme
  let serverURL: URL?
  let choose: (ConnectionKind) -> Void

  var body: some View {
    let colors = theme.colors
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space5) {
        BrandLockup()
        IllustrationView(.onboardingWelcome, lineWidth: 2.25).frame(maxWidth: 280).frame(maxWidth: .infinity)
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          Eyebrow("家族の予定やタスクを、ひとつに。")
          Text("今日の予定が、\nひと目でわかる。").font(.largeTitle.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("家族の予定、タスク、メモ、家計をまとめて確認できます。担当する人や共有する相手も設定できます。").foregroundStyle(colors.inkSoft.color)
        }
        VStack(alignment: .leading, spacing: TokenSpace.space3) {
          Button { choose(.sample) } label: { Label("見本の家族で試す", systemImage: "arrow.right") }
            .fhButton(.primary, fullWidth: true)
            .accessibilityIdentifier("welcome.sample")
          Text("東京の架空の家族（森さんち）のデータで、サーバーなしで試せます。変更はこの端末の中だけに残ります。").font(.footnote).foregroundStyle(colors.inkSoft.color)
          if let serverURL {
            Button { choose(.server) } label: { Label("サーバーにつなぐ", systemImage: "network") }
              .fhButton(.secondary, fullWidth: true)
              .accessibilityIdentifier("welcome.server")
            Text("接続先：\(serverURL.host() ?? serverURL.absoluteString)").font(.footnote).foregroundStyle(colors.inkSoft.color)
          }
        }
      }
      .padding(TokenSpace.space5)
      .frame(maxWidth: 560, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(colors.paper.color.ignoresSafeArea())
  }
}
