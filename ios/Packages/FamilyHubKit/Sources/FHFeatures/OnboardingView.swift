import SwiftUI
import FHModel
import FHCopy
import FHDesign

/// はじめに（Web の OnboardingPage）。1. 家族グループを作るか招待で参加する 2. 共有範囲 3. ようこそ。
struct OnboardingView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  enum Mode: Hashable { case create, join }
  @State private var step = 1
  @State private var mode = Mode.create
  @State private var householdName = ""
  @State private var inviteCode = ""
  @State private var householdOnly = true
  @State private var hideNotificationContent = true
  @State private var error: String?
  @State private var busy = false

  private let householdShare = "\(Copy.ja.ja.visibility.household)に共有する"

  var body: some View {
    let colors = theme.colors
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        BrandLockup()
        Eyebrow("初期設定 · \(step)/3")
        stepper
        switch step {
        case 1: household
        case 2: sharing
        default: welcome
        }
        if let error { ErrorNotice(error) }
        HStack {
          if step > 1 { Button("戻る") { step -= 1; error = nil }.fhButton(.secondary) }
          Spacer()
          Button { next() } label: { Label(step < 3 ? "次へ" : "今日の画面を開く", systemImage: "arrow.right") }
            .fhButton(.primary).disabled(busy)
            .accessibilityIdentifier("onboarding.next")
        }
      }
      .padding(TokenSpace.space5)
      .frame(maxWidth: 560, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(colors.paper.color.ignoresSafeArea())
  }

  private var stepper: some View {
    HStack(spacing: TokenSpace.space2) {
      ForEach(1...3, id: \.self) { value in
        Capsule().fill((value <= step ? theme.colors.brand : theme.colors.line).color).frame(height: 6)
      }
    }
    .accessibilityElement()
    .accessibilityLabel("初期設定の進み具合")
    .accessibilityValue("\(step)/3")
  }

  private func heading(_ text: String) -> some View {
    Text(text).font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(theme.colors.ink.color).accessibilityAddTraits(.isHeader)
  }

  @ViewBuilder private var household: some View {
    IllustrationView(.onboardingHousehold, lineWidth: 2.25).frame(maxWidth: 240).frame(maxWidth: .infinity)
    heading("家族グループの設定")
    Picker("家族グループ", selection: $mode) {
      Text("新しく作る").tag(Mode.create)
      Text("招待コードで参加").tag(Mode.join)
    }
    .pickerStyle(.segmented)
    if mode == .create {
      Field("家族グループの名前") { TextField("", text: $householdName) }
      Text("日時は日本時間で表示します。").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
    } else {
      Field("招待コード", help: "招待した人から受け取ったコードを入力します。有効期限と利用回数を確認してから受け付けます。") {
        TextField("", text: $inviteCode).plainTextInput()
      }
    }
  }

  @ViewBuilder private var sharing: some View {
    IllustrationView(.onboardingSharing, lineWidth: 2.25).frame(maxWidth: 240).frame(maxWidth: .infinity)
    heading("共有範囲")
    Toggle(isOn: $householdOnly) {
      VStack(alignment: .leading) {
        Text(householdShare).font(.body.weight(.bold))
        Text("オフにすると、作成した本人だけに表示します").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
      }
    }
    Toggle(isOn: $hideNotificationContent) {
      VStack(alignment: .leading) {
        Text("通知の題名と内容を表示しない").font(.body.weight(.bold))
        Text("ほかの人に画面を見られても、予定やタスクの中身が分からないようにします").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
      }
    }
    Text("共有範囲と通知の表示は、あとから「設定」の「共有とプライバシー」で変更できます。").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
  }

  @ViewBuilder private var welcome: some View {
    IllustrationView(.onboardingWelcome, lineWidth: 2.25).frame(maxWidth: 240).frame(maxWidth: .infinity)
    heading("ようこそ、よりどころへ")
    Text("最初に「今日」の画面を開きます。次にすること、今日の予定、期限のあるタスク、天気、家計をひと目で確認できます。").foregroundStyle(theme.colors.inkSoft.color)
  }

  private func next() {
    error = nil
    busy = true
    Task {
      defer { busy = false }
      if step == 1 {
        let result = mode == .join ? await model.gateway.acceptInvite(code: inviteCode.trimmingCharacters(in: .whitespaces)) : await model.gateway.createHousehold(name: householdName.trimmingCharacters(in: .whitespaces))
        if case .failure(let failure) = result { error = failure.message; return }
        await model.finishSignIn()
      }
      if step == 2 {
        // 共有範囲と通知の表示だけを変え、ほかの設定（外部検索への同意など）は保存済みの値のまま残す。
        let audience: VisibilityAudience = householdOnly ? "household" : "creator"
        let hide = hideNotificationContent
        switch await model.updatePrivacy({ $0.defaultAudience = audience; $0.hideNotificationContent = hide }) {
        case .failure(let failure): error = failure.message; return
        case .success(let saved): model.announce("共有範囲を「\(saved.defaultAudience == "household" ? Copy.ja.ja.visibility.household : "作成した本人だけ")」に設定しました。")
        }
      }
      if step < 3 { step += 1 } else { model.onboarding = false }
    }
  }
}
