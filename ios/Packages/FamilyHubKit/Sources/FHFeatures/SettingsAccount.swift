import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers
import CoreImage
import CoreImage.CIFilterBuiltins
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 設定の「アカウント」（Web の AccountSection.tsx）。名前・アイコン・誕生日・メールアドレス・自動サインアウト・確認コード・削除。
struct AccountSettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var account: AccountProfile?
  @State private var error: String?
  @State private var name = ""
  @State private var email = ""
  @State private var birthdate = Calendar.current.date(byAdding: .year, value: -20, to: Date()) ?? Date()
  @State private var picked: PhotosPickerItem?
  @State private var enrollment: TotpEnrollment?
  @State private var recovery: RecoveryCodes?
  @State private var deleting = false
  @State private var busy = false

  var body: some View {
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      if let error { SettingsBlock { SettingsError(message: error) } }
      if let account {
        SettingsGroup("プロフィール") {
          TextField("名前", text: $name, axis: .vertical).settingsField().accessibilityIdentifier("settings.account.name")
          Button("名前を保存") { Task { await update(AccountUpdateInput(displayName: name), "名前を変更しました。") } }
            .disabled(busy)
            .accessibilityIdentifier("settings.account.name-save")
          VStack(alignment: .leading, spacing: TokenSpace.space2) {
            Text("アイコン").foregroundStyle(colors.ink.color)
            HStack(spacing: TokenSpace.space2) {
              avatarChoice("頭文字", label: "頭文字", selected: account.avatar == .initial, id: "initial") { .initial }
              ForEach(AvatarPresets.all, id: \.preset) { item in
                avatarChoice(item.glyph, label: "\(item.glyph)のアイコン", selected: account.avatar == .preset(item.preset), id: "preset.\(item.preset)") { .preset(item.preset) }
              }
            }
            PhotosPicker(selection: $picked, matching: .images) {
              Label("画像を選ぶ", systemImage: "photo")
            }
            .accessibilityIdentifier("settings.account.avatar-image")
            if case .image = account.avatar { SettingsNote("今は選んだ画像を使っています。画像は端末の中で192pxに縮めてから送ります。") }
          }
          .padding(.vertical, TokenSpace.space1)
        }
        if !account.birthdateDeclared {
          SettingsBlock {
            DatePicker("誕生日", selection: $birthdate, in: ...Date(), displayedComponents: .date)
              .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
              .accessibilityIdentifier("settings.account.birthdate")
            Button("誕生日を記録") { Task { await update(AccountUpdateInput(birthdate: Tokyo.components(of: birthdate).date.key), "誕生日を記録しました。") } }
              .disabled(busy)
              .accessibilityIdentifier("settings.account.birthdate-save")
          } header: { SettingsHeader("誕生日（一度だけ記録できます）") }
        }
        SettingsBlock {
          TextField("メールアドレス", text: $email, axis: .vertical).emailInput().settingsField().accessibilityIdentifier("settings.account.email")
          Button("メールアドレスを保存") { Task { await changeEmail() } }
            .disabled(busy)
            .accessibilityIdentifier("settings.account.email-save")
          Picker("操作がないときに自動でサインアウトする", selection: Binding(get: { account.idleTimeoutMinutes }, set: { minutes in
            Task { await update(AccountUpdateInput(idleTimeoutMinutes: minutes), "自動サインアウトの時間を変更しました。") }
          })) {
            ForEach(Account.idleTimeoutChoices, id: \.self) { Text("\($0)分").tag($0) }
          }
          .accessibilityIdentifier("settings.account.idle")
          SettingsNote("メールアドレスを変更すると、前のアドレスにもお知らせを送ります。")
        } header: { SettingsHeader("サインイン") }
        SettingsBlock {
          Text("パスワードに加えて、認証アプリの6桁のコードを求めます。").font(.callout).foregroundStyle(colors.ink.color)
          if account.totpUnavailable {
            VStack(alignment: .leading, spacing: 2) {
              Text(Copy.ja.ja.totp.unavailableTitle).font(.callout.weight(.bold)).foregroundStyle(colors.danger.color)
              Text(Copy.ja.ja.totp.unavailableBody).font(.footnote).foregroundStyle(colors.ink.color)
            }
          }
          if account.totpEnabled {
            Button("確認コードを解除") { Task { await disableTotp() } }.disabled(busy).accessibilityIdentifier("settings.account.totp-disable")
          } else {
            Button("確認コードを設定") { Task { await beginTotp() } }.disabled(busy).accessibilityIdentifier("settings.account.totp-begin")
          }
          if model.isSample { SettingsNote("このデモでは実際のコードは発行されません。") }
        } header: { SettingsHeader("確認コード") }
        LeaveHouseholdSection()
        SettingsBlock {
          SettingsNote("削除すると、この端末からサインアウトし、元に戻せません。\(model.can(.membersManage) ? "管理者は、先に別の大人へ役割を渡してください。" : "")")
          Button("アカウントを削除", role: .destructive) { deleting = true }.fhButton(.danger).accessibilityIdentifier("settings.account.delete")
        } header: { SettingsHeader("アカウントの削除") }
      } else if error == nil {
        SettingsBlock { ProgressView("読み込んでいます。") }
      }
    }
    .task { await load() }
    .onChange(of: picked) { _, item in Task { await pick(item) } }
    .sheet(item: $enrollment) { TotpEnrollmentSheet(enrollment: $0) { codes in recovery = codes; Task { await load() } } }
    .sheet(item: $recovery) { RecoveryCodesSheet(codes: $0) }
    .alert("アカウントを削除しますか", isPresented: $deleting) {
      Button("やめる", role: .cancel) {}
      Button("削除する", role: .destructive) { Task { await deleteAccount() } }
    } message: { Text("名前は「退会したメンバー」に置き換わります。この操作は取り消せません。") }
  }

  private func avatarChoice(_ text: String, label: String, selected: Bool, id: String, avatar: @escaping () -> Avatar) -> some View {
    let colors = theme.colors
    return Button { Task { await update(AccountUpdateInput(avatar: avatar()), "アイコンを変更しました。") } } label: {
      Text(text)
        .font(.callout.weight(.bold))
        .foregroundStyle(selected ? colors.onBrand.color : colors.ink.color)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .frame(minWidth: 44, minHeight: 44)
        .background(selected ? colors.brand.color : colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.lineStrong.color))
    }
    .buttonStyle(.plain)
    .disabled(busy)
    .accessibilityLabel(label)
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityIdentifier("settings.account.avatar-\(id)")
  }

  private func load() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.getAccount() }) {
    case .success(let value):
      account = value; error = nil
      if name.isEmpty { name = value.displayName }
      if email.isEmpty { email = value.email }
    case .failure(let failure): error = failure.message
    }
  }

  private func update(_ input: AccountUpdateInput, _ message: String) async {
    guard !busy else { return }
    busy = true; error = nil
    let result = await model.run { [gateway = model.gateway] in await gateway.updateAccount(input) }
    busy = false
    switch result {
    case .success(let value):
      account = value; name = value.displayName
      model.announce(message)
      await model.refresh()
    case .failure(let failure): error = failure.message
    }
  }

  private func changeEmail() async {
    guard !busy else { return }
    let next = Account.jsTrim(email)
    guard Account.isEmail(next) else { error = "メールアドレスを確認してください。"; return }
    busy = true; error = nil
    let result = await model.run { [gateway = model.gateway] in await gateway.changeEmail(next) }
    busy = false
    switch result {
    case .success(let value): account = value; email = value.email; model.announce("メールアドレスを変更しました。")
    case .failure(let failure): error = failure.message
    }
  }

  private func pick(_ item: PhotosPickerItem?) async {
    guard let item else { return }
    picked = nil
    guard let data = try? await item.loadTransferable(type: Data.self), let dataUrl = AvatarImage.dataURL(from: data) else {
      error = "画像を読み込めませんでした。JPEG か PNG の写真を選んでください。"
      return
    }
    await update(AccountUpdateInput(avatar: .image(dataUrl: dataUrl)), "アイコンを変更しました。")
  }

  private func beginTotp() async {
    error = nil
    switch await model.run({ [gateway = model.gateway] in await gateway.beginTotpEnrollment() }) {
    case .success(let value): enrollment = value
    case .failure(let failure): error = failure.message
    }
  }

  private func disableTotp() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.disableTotp() }) {
    case .success: model.announce("確認コードの設定を解除しました。"); await load()
    case .failure(let failure): error = failure.message
    }
  }

  private func deleteAccount() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.deleteAccount() }) {
    case .success: await model.signOut(force: true)
    case .failure(let failure): error = failure.message
    }
  }
}

extension TotpEnrollment: Identifiable { public var id: String { otpauthUri } }
extension RecoveryCodes: Identifiable { public var id: String { recoveryCodes.joined() } }

/// 確認コードの設定。認証アプリに登録する QR コードと文字列を出し、表示された6桁のコードで確かめる。
struct TotpEnrollmentSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.theme) private var theme
  let enrollment: TotpEnrollment
  let done: (RecoveryCodes) -> Void
  @State private var code = ""
  @State private var error: String?
  @State private var busy = false

  var body: some View {
    let colors = theme.colors
    NavigationStack {
      Form {
        SettingsBlock {
          SettingsNote("認証アプリに次の設定を登録し、表示された6桁のコードを入力してください。")
          if let image = QRCode.image(enrollment.otpauthUri) {
            Image(decorative: image, scale: 1)
              .interpolation(.none)
              .resizable()
              .frame(width: 200, height: 200)
              .padding(TokenSpace.space2)
              .background(Color.white)
              .frame(maxWidth: .infinity)
              .accessibilityLabel("設定用の QR コード")
          }
          Text(enrollment.otpauthUri).font(.footnote.monospaced()).foregroundStyle(colors.ink.color).textSelection(.enabled).accessibilityIdentifier("settings.account.totp-uri")
          Button("設定用の文字列をコピー") { copyToClipboard(enrollment.otpauthUri); model.announce("設定用の文字列をコピーしました。") }
          if let url = URL(string: enrollment.otpauthUri), url.scheme == "otpauth" {
            Button("この端末の認証アプリで開く") { openURL(url) }
          }
        }
        SettingsBlock {
          TextField("6桁のコード", text: $code).numberPadInput().accessibilityIdentifier("settings.account.totp-code")
          if let error { SettingsError(message: error) }
        }
      }
      .navigationTitle("確認コードの設定")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "確認しています…" : "設定する") { Task { await confirm() } }.disabled(busy || code.isEmpty).accessibilityIdentifier("settings.account.totp-confirm")
        }
      }
    }
  }

  private func confirm() async {
    busy = true; error = nil
    let value = Account.jsTrim(code)
    let result = await model.run { [gateway = model.gateway] in await gateway.confirmTotpEnrollment(code: value) }
    busy = false
    switch result {
    case .success(let codes):
      dismiss()
      // 閉じる動きが終わってから、回復コードを出す。
      Task { try? await Task.sleep(for: .milliseconds(450)); done(codes) }
    case .failure(let failure): error = failure.message
    }
  }
}

/// 回復コード（表示はこの1回だけ）。
struct RecoveryCodesSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let codes: RecoveryCodes

  var body: some View {
    NavigationStack {
      Form {
        SettingsBlock {
          SettingsNote("端末をなくしたときに使います。安全な場所に控えてください。表示はこの1回だけです。")
          ForEach(codes.recoveryCodes, id: \.self) { Text($0).font(.body.monospaced()).foregroundStyle(theme.colors.ink.color).textSelection(.enabled) }
          Button("回復コードをコピー") { copyToClipboard(codes.recoveryCodes.joined(separator: "\n")); model.announce("回復コードをコピーしました。") }
        }
      }
      .navigationTitle("回復コード")
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("控えました") { dismiss() }.accessibilityIdentifier("settings.account.recovery-close") } }
    }
    .interactiveDismissDisabled()
  }
}

/// アイコンの画像。端末の中で 192px の正方形に縮め、元の写真（位置情報を含むことがある）は送らない。
enum AvatarImage {
  static func dataURL(from data: Data) -> String? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 768] as CFDictionary) else { return nil }
    let side = min(image.width, image.height)
    guard side > 0, let square = image.cropping(to: CGRect(x: (image.width - side) / 2, y: (image.height - side) / 2, width: side, height: side)) else { return nil }
    guard let context = CGContext(data: nil, width: 192, height: 192, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    context.interpolationQuality = .high
    context.draw(square, in: CGRect(x: 0, y: 0, width: 192, height: 192))
    guard let resized = context.makeImage() else { return nil }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, resized, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    let url = "data:image/jpeg;base64,\((output as Data).base64EncodedString())"
    return url.count <= 200_000 ? url : nil
  }
}

/// QR コード（認証アプリの設定用）。
enum QRCode {
  static func image(_ text: String) -> CGImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
    return CIContext().createCGImage(output, from: output.extent)
  }
}
