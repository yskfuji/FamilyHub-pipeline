import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 設定の「サインインとセキュリティ」（Web の SettingsPage.tsx の Security）。
/// パスキー・パスワード・サインイン中の端末・この端末のサインアウトと、自分の操作の記録。iOS では接続先もここに置く。
struct SecuritySettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var overview: SecurityOverview?
  @State private var error: String?
  @State private var changingPassword = false
  @State private var revoking: DeviceSession?
  @State private var signingOut = false
  @State private var addingPasskey = false

  var body: some View {
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      if let error { SettingsBlock { SettingsError(message: error) } }
      SettingsBlock {
        Text("端末の画面ロックを使って本人確認します。パスワードのみを使うより、偽のサインイン画面に情報を入力するリスクを減らせます。").font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
        ForEach(overview?.authenticators ?? []) { item in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(item.label).foregroundStyle(colors.ink.color)
              Text(item.demo ? "デモ登録" : "登録済み").font(.footnote).foregroundStyle(colors.inkSoft.color)
            }
            Spacer(minLength: 0)
            StatusBadge("利用中", tone: .success)
          }
          .accessibilityElement(children: .combine)
        }
        if model.isSample || Passkeys.relyingParty != nil {
          Button(addingPasskey ? "登録しています…" : "別のパスキーを追加") { Task { await addPasskey() } }
            .disabled(addingPasskey)
            .accessibilityIdentifier("settings.passkey.add")
        }
        if model.isSample {
          SettingsNote("このデモでは実際のパスキーは登録されません。実際の利用時は、端末の本人確認の画面が開きます。")
        } else if Passkeys.relyingParty == nil {
          SettingsNote("このアプリでは、まだパスキーを追加できません（アプリとサーバーのドメインの設定が要ります）。Web の画面から追加したパスキーは、ここに表示します。")
        }
      } header: { SettingsHeader("パスキー（おすすめ）") }
      SettingsBlock {
        Text("15文字以上64文字以内で設定します。数字や記号を必ず混ぜる必要はありません。安全性が低いと判断されたパスワードは使用できません。").font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
        Button("パスワードを変更") { changingPassword = true }.accessibilityIdentifier("settings.password.open")
      } header: { SettingsHeader("パスワード") }
      SettingsGroup("サインイン中の端末") {
        if overview == nil && error == nil { ProgressView() }
        ForEach(overview?.sessions ?? []) { session in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(session.label).foregroundStyle(colors.ink.color)
              Text("\(session.location) · \(session.current ? "この端末" : "最終利用：\(Format.relative(session.lastSeenAt, asOf: model.snapshot?.context.asOf ?? session.lastSeenAt))")").font(.footnote).foregroundStyle(colors.inkSoft.color)
            }
            Spacer(minLength: 0)
            if session.current { StatusBadge("利用中", tone: .success) } else {
              Button("サインアウト") { revoking = session }
                .fhButton(.danger)
                .accessibilityLabel("\(session.label)をサインアウト")
                .accessibilityIdentifier("settings.session.revoke-open.\(session.id)")
            }
          }
          .accessibilityElement(children: session.current ? .combine : .contain)
        }
      }
      SettingsBlock {
        Text("共用の端末や、しばらく使わない端末では、使い終わったらサインアウトしてください。次回の利用時には、もう一度本人確認が必要です。").font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
        Button("この端末からサインアウト", role: .destructive) { signingOut = true }.fhButton(.danger).accessibilityIdentifier("settings.session.sign-out-current")
        SettingsNote("紛失した端末は、「サインイン中の端末」の一覧から個別にサインアウトできます。")
      } header: { SettingsHeader("この端末からサインアウト") }
      SettingsBlock {
        switch model.gateway.mode {
        case .sample: LabeledContent("接続先", value: "見本（森さんち）")
        case .server(let url): LabeledContent("接続先", value: url.host() ?? url.absoluteString)
        }
        Button("接続先を選び直す") { model.onLeave() }.accessibilityIdentifier("settings.connection.change")
        if let sample = model.gateway as? SampleGateway {
          // 見本だけ: 通信が切れたときの動き（未送信の変更）を試す。次に家族の記録を読み込むと元に戻る。
          Button("通信が切れた状態を試す") {
            Task { await sample.simulateOffline(); model.announce("見本の通信を止めました。追加や変更は未送信の変更として残ります。") }
          }
          .accessibilityIdentifier("settings.connection.simulate-offline")
        }
        SettingsNote(model.isSample ? "見本の変更は、この端末の記憶の中だけに残ります。接続先を選び直すと、見本ははじめの状態に戻ります。" : "別のサーバーを使うときや、見本を試すときに選び直します。")
      } header: { SettingsHeader("接続先") }
      SettingsBlock {
        SettingsNote(Copy.auditLabels.auditCopy.mineDescription)
        AccountActivityList()
      } header: { SettingsHeader(Copy.auditLabels.auditCopy.mineHeading) }
    }
    .task { await load() }
    .sheet(isPresented: $changingPassword) { PasswordChangeSheet() }
    .alert("この端末からサインアウトしますか", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), presenting: revoking) { session in
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
      Button("サインアウト", role: .destructive) { Task { await revoke(session) } }
    } message: { _ in Text("現在使用中の端末はサインアウトされません。") }
    .alert("この端末からサインアウトしますか", isPresented: $signingOut) {
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
      Button("サインアウト", role: .destructive) { Task { await model.signOut() } }
    } message: { Text("未送信の変更があれば、この端末に残ります。もう一度サインインすると送信できます。") }
  }

  private func load() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.getSecurityOverview() }) {
    case .success(let value): overview = value; error = nil
    case .failure(let failure): error = failure.message
    }
  }

  private func addPasskey() async {
    guard !addingPasskey else { return }
    addingPasskey = true
    defer { addingPasskey = false }
    let gateway = model.gateway
    let begun = await model.run { await gateway.beginPasskeyRegistration() }
    guard case .success(let start) = begun else { if case .failure(let failure) = begun { model.announce(failure.message) }; return }
    let credential = await Passkeys.create(start, sample: model.isSample)
    guard case .success(let value) = credential else { if case .failure(let failure) = credential { model.announce(failure.message) }; return }
    switch await model.run({ await gateway.finishPasskeyRegistration(challengeId: start.challengeId, credential: value) }) {
    case .success:
      await load()
      model.announce(model.isSample ? "この端末のパスキーをデモ登録しました。" : "この端末のパスキーを登録しました。")
    case .failure(let failure): model.announce(failure.message)
    }
  }

  private func revoke(_ session: DeviceSession) async {
    switch await model.run({ [gateway = model.gateway] in await gateway.revokeSession(id: session.id) }) {
    case .success: await load(); model.announce("指定した端末からサインアウトしました。")
    case .failure(let failure): error = failure.message
    }
  }
}

/// パスワードの変更。閉じると入力は消える（画面の状態ごと捨てる）。
struct PasswordChangeSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var current = ""
  @State private var next = ""
  @State private var confirm = ""
  @State private var error: String?
  @State private var busy = false

  var body: some View {
    NavigationStack {
      Form {
        SettingsBlock {
          SettingsNote("この画面を閉じると、入力中のパスワードは消去されます。")
          SecureField("現在のパスワード", text: $current).passwordInput(new: false).accessibilityIdentifier("settings.password.current")
          SecureField("新しいパスワード", text: $next).passwordInput(new: true).accessibilityIdentifier("settings.password.new")
          SecureField("新しいパスワード（確認）", text: $confirm).passwordInput(new: true).accessibilityIdentifier("settings.password.confirm")
        }
        if let error { SettingsBlock { SettingsError(message: error) } }
      }
      .navigationTitle("パスワードを変更")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { dismiss() }.disabled(busy).accessibilityIdentifier("settings.password.cancel") }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "変更しています…" : "変更する") { Task { await submit() } }
            .disabled(busy || current.isEmpty || next.isEmpty || confirm.isEmpty)
            .accessibilityIdentifier("settings.password.submit")
        }
      }
    }
    .interactiveDismissDisabled(busy)
  }

  private func submit() async {
    error = nil
    if next != confirm { error = "新しいパスワードと確認用の入力が一致しません。"; return }
    if let problem = Account.newPasswordMessage(next) { error = problem; return }
    if let snapshot = model.snapshot {
      let me = snapshot.memberships.first { $0.id == snapshot.viewer.membershipId }
      let context = PasswordPolicy.Context(email: snapshot.user.email, displayName: me?.displayName, householdName: snapshot.household.name, memberNames: snapshot.memberships.filter { $0.id != snapshot.viewer.membershipId }.map(\.displayName))
      if let problem = PasswordPolicy.check(next, context: context) { error = problem; return }
    }
    busy = true
    let (old, new) = (current, next)
    let result = await model.run { [gateway = model.gateway] in await gateway.changePassword(current: old, new: new) }
    busy = false
    switch result {
    case .success: dismiss(); model.announce("パスワードを変更しました。入力内容は残していません。")
    case .failure(let failure): error = failure.message
    }
  }
}
