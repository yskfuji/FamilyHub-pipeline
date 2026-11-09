import SwiftUI
import FHModel
import FHDomain
import FHCopy
import FHDesign

/// サインインの流れ（Web の AuthPage・SignUpPage・ResetPasswordPage）。
/// パスキーは、登録できるドメインと apple-app-site-association の準備ができるまで出さない（docs/ios/README.md）。
struct AuthFlowView: View {
  enum Route: Hashable { case signUp, reset }
  @State private var path: [Route] = []

  var body: some View {
    NavigationStack(path: $path) {
      SignInView(open: { path.append($0) })
        .navigationDestination(for: Route.self) { route in
          switch route {
          case .signUp: SignUpView(back: { path.removeAll() })
          case .reset: ResetPasswordView(back: { path.removeAll() })
          }
        }
    }
  }
}

/// サインインの画面の枠。
struct AuthCard<Content: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  var lede: String?
  @ViewBuilder var content: Content

  var body: some View {
    let colors = theme.colors
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        BrandLockup()
        Text(title).font(.largeTitle.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        if let lede { Text(lede).foregroundStyle(colors.inkSoft.color) }
        content
      }
      .padding(TokenSpace.space5)
      .frame(maxWidth: 520, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .background(colors.paper.color.ignoresSafeArea())
  }
}

private let passwordHelp = "15〜64文字で入力してください。文字種の指定はありません。"

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let open: (AuthFlowView.Route) -> Void
  @State private var email = ""
  @State private var password = ""
  @State private var code = ""
  @State private var totpChallenge: Id?
  @State private var error: String?
  @State private var busy = false

  var body: some View {
    AuthCard(title: "おかえりなさい", lede: totpChallenge == nil ? "メールアドレスとパスワードでサインインします。" : "確認コードを入力してください。") {
      if totpChallenge != nil {
        Field("確認コード", help: "認証アプリの6桁のコード、または回復コードを入力してください。") {
          TextField("", text: $code).oneTimeCodeInput().accessibilityIdentifier("auth.totp")
        }
        Button(busy ? "確認中…" : "続ける", action: verify).fhButton(.primary, fullWidth: true).disabled(busy || code.isEmpty)
        Button("パスワードの入力に戻る") { totpChallenge = nil; code = ""; error = nil }.fhButton(.secondary, fullWidth: true)
      } else {
        Field("メールアドレス") { TextField("", text: $email).emailInput().accessibilityIdentifier("auth.email") }
        Field("パスワード", help: passwordHelp) {
          SecureField("", text: $password).passwordInput(new: false).submitLabel(.go).onSubmit(signIn).accessibilityIdentifier("auth.password")
        }
        Button(busy ? "確認中…" : "サインイン", action: signIn).fhButton(.primary, fullWidth: true).disabled(busy).accessibilityIdentifier("auth.sign-in")
        Button("はじめての方") { open(.signUp) }.fhButton(.secondary, fullWidth: true)
        Button("パスワードを忘れた場合") { open(.reset) }.fhLink()
      }
      if let error { ErrorNotice(error) }
      ConnectionFooter()
    }
  }

  private func signIn() {
    error = nil
    if let message = PasswordPolicy.currentPasswordMessage(password) { error = message; return }
    busy = true
    Task {
      defer { busy = false }
      switch await model.gateway.signInWithPassword(email: email.trimmingCharacters(in: .whitespaces), password: password) {
      case .failure(let failure): error = failure.message
      case .success(.needsTotp(let challenge)): totpChallenge = challenge
      case .success(.signedIn):
        password = ""
        await model.finishSignIn()
      }
    }
  }

  private func verify() {
    guard let totpChallenge else { return }
    error = nil
    busy = true
    Task {
      defer { busy = false }
      switch await model.gateway.verifyTotp(challengeId: totpChallenge, code: code.trimmingCharacters(in: .whitespaces)) {
      case .failure(let failure): error = failure.message
      case .success:
        password = ""
        await model.finishSignIn()
      }
    }
  }
}

/// 接続先の表示と、選び直す操作。
struct ConnectionFooter: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  var body: some View {
    VStack(alignment: .leading, spacing: TokenSpace.space1) {
      if case .server(let url) = model.gateway.mode {
        Text("接続先：\(url.host() ?? url.absoluteString)").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
      }
      Button("接続先を選び直す") { model.onLeave() }.fhLink(font: .footnote.weight(.semibold))
    }
    .padding(.top, TokenSpace.space3)
  }
}

struct SignUpView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let back: () -> Void
  @State private var displayName = ""
  @State private var email = ""
  @State private var password = ""
  @State private var birthdate = Calendar.tokyo.date(byAdding: .year, value: -30, to: Date()) ?? Date()
  @State private var guardianConsent = false
  @State private var error: String?
  @State private var busy = false
  @State private var showLegal = false

  private var birthdateKey: String { Calendar.tokyo.dateKey(birthdate) }
  private var minor: Bool { (Account.age(birthdate: birthdateKey, on: Calendar.tokyo.dateKey(Date())) ?? 99) < Account.adultAge }

  var body: some View {
    AuthCard(title: "はじめての方", lede: "アカウントを作ると、家族グループを作るか、招待コードで参加できます。") {
      Field("名前") { TextField("", text: $displayName).textContentType(nil) }
      Field("メールアドレス") { TextField("", text: $email).emailInput() }
      Field("パスワード", help: passwordHelp) { SecureField("", text: $password).passwordInput(new: true) }
      VStack(alignment: .leading, spacing: TokenSpace.space1) {
        DatePicker("誕生日", selection: $birthdate, in: ...Date(), displayedComponents: .date)
          .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
          .font(.subheadline.weight(.bold))
        Text("家族グループを作るには18歳以上である必要があります。").font(.caption).foregroundStyle(theme.colors.inkSoft.color)
      }
      if minor { Toggle("保護者の同意を得ています", isOn: $guardianConsent).font(.callout.weight(.semibold)) }
      Text("「アカウントを作る」を押すと、利用規約が運営者とあなたとの契約の内容になります。押す前に確認してください。\(Copy.legal.TRIAL_DAYS)日間は無料で、自動で有料に切り替わることはありません。")
        .font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
      Button("利用規約とプライバシーポリシーの草案を読む") { showLegal = true }.fhLink(font: .footnote.weight(.semibold))
      if let error { ErrorNotice(error) }
      Button(busy ? "作成中…" : "アカウントを作る", action: submit).fhButton(.primary, fullWidth: true).disabled(busy)
      Button("サインインに戻る", action: back).fhButton(.secondary, fullWidth: true)
    }
    .sheet(isPresented: $showLegal) { LegalView() }
  }

  private func submit() {
    error = nil
    let input = Account.SignUp(displayName: displayName, email: email, password: password, birthdate: birthdateKey, guardianConsent: minor && guardianConsent)
    let parsed: Account.SignUp
    switch Account.validate(input) {
    case .failure(let failure): error = failure.message; return
    case .success(let value): parsed = value
    }
    if let problem = PasswordPolicy.check(parsed.password, context: .init(email: parsed.email, displayName: parsed.displayName)) { error = problem; return }
    busy = true
    Task {
      defer { busy = false }
      let created = await model.gateway.signUp(SignUpInput(displayName: parsed.displayName, email: parsed.email, password: parsed.password, birthdate: parsed.birthdate, guardianConsent: parsed.guardianConsent))
      if case .failure(let failure) = created { error = failure.message; return }
      guard case .success(.signedIn) = await model.gateway.signInWithPassword(email: parsed.email, password: parsed.password) else { back(); return }
      await model.finishSignIn()
    }
  }
}

struct ResetPasswordView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let back: () -> Void
  enum Step { case request, confirm, done }
  @State private var step = Step.request
  @State private var email = ""
  @State private var code = ""
  @State private var password = ""
  @State private var error: String?
  @State private var wait = 0
  @State private var busy = false

  var body: some View {
    AuthCard(title: "パスワードの再設定") {
      switch step {
      case .request:
        Text("登録したメールアドレスにコードを送ります。").foregroundStyle(theme.colors.inkSoft.color)
        Field("メールアドレス") { TextField("", text: $email).emailInput() }
        if let error { ErrorNotice(error) }
        Button("コードを送る", action: request).fhButton(.primary, fullWidth: true).disabled(busy || email.isEmpty)
      case .confirm:
        Text("メールが届くまで少しかかることがあります。登録のないアドレスには届きません。").foregroundStyle(theme.colors.inkSoft.color)
        Field("6桁のコード") { TextField("", text: $code).oneTimeCodeInput() }
        Field("新しいパスワード", help: passwordHelp) { SecureField("", text: $password).passwordInput(new: true) }
        if let error { ErrorNotice(error) }
        Button("再設定する", action: confirm).fhButton(.primary, fullWidth: true).disabled(busy)
        Button(wait > 0 ? "あと\(wait)秒で再送できます" : "コードを再送する", action: request).fhButton(.secondary, fullWidth: true).disabled(wait > 0 || busy)
      case .done:
        Text("再設定しました。新しいパスワードでサインインしてください。").font(.body.weight(.semibold)).foregroundStyle(theme.colors.success.color)
      }
      Button("サインインに戻る", action: back).fhButton(.secondary, fullWidth: true)
    }
    .task(id: wait) {
      guard wait > 0 else { return }
      try? await Task.sleep(for: .seconds(1))
      wait -= 1
    }
  }

  private func request() {
    error = nil
    busy = true
    Task {
      defer { busy = false }
      switch await model.gateway.requestPasswordReset(email: email) {
      case .failure(let failure): error = failure.message
      case .success(let value): wait = value.resendAfterSeconds; step = .confirm
      }
    }
  }

  private func confirm() {
    error = nil
    if let message = Account.newPasswordMessage(password) { error = message; return }
    if let problem = PasswordPolicy.check(password, context: .init(email: email)) { error = problem; return }
    busy = true
    Task {
      defer { busy = false }
      switch await model.gateway.confirmPasswordReset(PasswordResetConfirmation(email: email, code: code.trimmingCharacters(in: .whitespaces), newPassword: password)) {
      case .failure(let failure): error = failure.message
      case .success: password = ""; step = .done
      }
    }
  }
}

/// 規約の草案（src/content/legal.ts を書き出した JSON）。
struct LegalView: View {
  struct Document: Decodable, Identifiable { let id: String; let title: String; let intro: String?; let sections: [Part] }
  struct Part: Decodable, Hashable { let heading: String; let paragraphs: [String] }
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  private var documents: [Document] {
    guard let url = Bundle.copyResources.url(forResource: "legal.legalDocuments", withExtension: "json", subdirectory: "Copy"),
          let data = try? Data(contentsOf: url) else { return [] }
    return (try? JSONDecoder().decode([Document].self, from: data)) ?? []
  }

  var body: some View {
    NavigationStack {
      List {
        Section { Text(Copy.legal.legalNotice).font(.callout.weight(.semibold)).foregroundStyle(theme.colors.attention.color) }
        ForEach(documents) { document in
          Section(document.title) {
            if let intro = document.intro { Text(intro) }
            ForEach(document.sections, id: \.self) { section in
              VStack(alignment: .leading, spacing: TokenSpace.space2) {
                Text(section.heading).font(.headline).accessibilityAddTraits(.isHeader)
                ForEach(section.paragraphs, id: \.self) { Text($0).font(.callout) }
              }
            }
          }
        }
      }
      .navigationTitle("利用規約とプライバシーポリシー")
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dismiss() } } }
    }
  }
}

extension Calendar {
  /// 日本時間の暦。
  static var tokyo: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
    return calendar
  }
  func dateKey(_ date: Date) -> String {
    let parts = dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }
}
