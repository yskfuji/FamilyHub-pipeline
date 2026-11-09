import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 設定の「共有とプライバシー」（Web の Privacy）。保存は AppModel の updatePrivacy で、別の画面の変更を上書きしない。
struct PrivacySettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  /// 操作をすぐ画面に映す。保存に失敗したら保存済みの値へ戻す。
  @State private var draftAudience: VisibilityAudience?
  @State private var draftHide: Bool?
  @State private var saving = false

  var body: some View {
    @Bindable var preferences = preferences
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      if let saved = model.privacy {
        SettingsBlock {
          let current = draftAudience ?? saved.defaultAudience
          ForEach([VisibilityAudience.household, .creator], id: \.self) { value in
            Button {
              guard value != current else { return }
              draftAudience = value
              Task { await save({ $0.defaultAudience = value }, "共有範囲の初期値を「\(value == .household ? Copy.ja.ja.visibility.household : "作成した本人だけ")」にしました。") }
            } label: {
              HStack(alignment: .firstTextBaseline, spacing: TokenSpace.space2) {
                Image(systemName: value == current ? "largecircle.fill.circle" : "circle").foregroundStyle(colors.brand.color).accessibilityHidden(true)
                Text(value == .household ? "\(Copy.ja.ja.visibility.household)（子どもメンバーとゲストには、本人に関係するものだけ）" : "作成した本人だけ")
                  .foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
              }
              .frame(minHeight: 44)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(saving)
            .accessibilityAddTraits(value == current ? .isSelected : [])
            .accessibilityIdentifier("settings.privacy.audience.\(value.rawValue)")
          }
          SettingsNote("あとから作るものに使う初期値です。作成済みのものは変わりません。")
        } header: { SettingsHeader("新しく作る予定・タスク・メモの共有範囲") }
        SettingsGroup("通知の内容") {
          SettingToggle(title: "通知の題名と内容を表示しない", detail: "ほかの人に画面を見られても、予定やタスクの中身が分からないようにします。開いたときだけ表示します。", isOn: Binding(get: { draftHide ?? saved.hideNotificationContent }, set: { value in
            draftHide = value
            Task { await save({ $0.hideNotificationContent = value }, value ? "通知の題名と内容を表示しないようにしました。" : "通知の題名と内容を表示するようにしました。") }
          }), identifier: "settings.privacy.hide-notification-content")
          .disabled(saving)
        }
      } else {
        SettingsBlock { ProgressView() }
      }
      SettingsBlock {
        SettingToggle(title: "隠れている間は画面をぼかす", detail: "アプリの切り替えの画面や、ほかのアプリに移っている間、画面の内容をぼかします。戻るとすぐ元に戻ります。", isOn: Binding(get: { preferences.privacyBlur }, set: { value in
          preferences.privacyBlur = value
          model.announce(value ? "隠れている間は画面をぼかすようにしました。" : "画面をぼかさないようにしました。")
        }), identifier: "settings.privacy.blur-hidden")
        SettingToggle(title: "写真の撮影場所を残す", detail: "アルバムに追加するときの初期値です。オフなら撮影場所を取り除いて保存します。追加の画面で1回ごとに変えられます。", isOn: Binding(get: { preferences.keepPhotoLocation }, set: { value in
          preferences.keepPhotoLocation = value
          model.announce(value ? "写真の撮影場所を残すようにしました。" : "写真の撮影場所を取り除くようにしました。")
        }), identifier: "settings.privacy.keep-photo-location")
        SettingsNote("この端末だけの設定です。別の端末には反映されません。")
      } header: { SettingsHeader("この端末での扱い") }
    }
  }

  private func save(_ change: @escaping @Sendable (inout PrivacySettings) -> Void, _ message: String) async {
    saving = true
    let result = await model.updatePrivacy(change)
    saving = false
    draftAudience = nil
    draftHide = nil
    switch result {
    case .success: model.announce(message)
    case .failure(let failure): model.announce(failure.message)
    }
  }
}

/// 設定の「通知」（Web の Notifications）。受け取る通知と夜間、通知の表示例、この端末への通知。
struct NotificationSettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var preferences: NotificationPreferences?
  @State private var error: String?
  @State private var device = DeviceNotifications.enabled

  private static let rows: [(WritableKeyPath<NotificationPreferences, Bool>, String, String, String)] = [
    (\.todoDue, "タスクの期限", "期限の30分前に通知", "todo-due"),
    (\.eventDeparture, "予定の出発時刻", "移動時間を含めた出発時刻を通知", "event-departure"),
    (\.quietHours, "夜間は通知しない", "21:00から翌朝7:00までの通知は、7:00にまとめて届けます", "quiet-hours"),
  ]

  var body: some View {
    let colors = theme.colors
    let hidden = model.privacy?.hideNotificationContent ?? true
    SettingsPage {
      SettingsIntro(tab: tab)
      if let error { SettingsBlock { SettingsError(message: error) } }
      SettingsBlock {
        if let preferences {
          ForEach(Self.rows, id: \.3) { row in
            SettingToggle(title: row.1, detail: row.2, isOn: Binding(get: { preferences[keyPath: row.0] }, set: { value in Task { await toggle(row.0, value) } }), identifier: "settings.notifications.\(row.3)")
          }
        } else if error == nil { ProgressView() }
        SettingsNote("通知を受け取ったら、上部のベルから既読・延期・停止を選べます。")
      } header: { SettingsHeader("通知する内容") }
      SettingsBlock {
        Toggle("この端末にも通知する", isOn: Binding(get: { device }, set: { on in
          Task {
            if on { device = await DeviceNotifications.enable(); if device { await DeviceNotifications.sync(model) } }
            else { DeviceNotifications.disable(); device = false }
          }
        }))
        .accessibilityIdentifier("settings.notifications.device")
        SettingsNote("オンにすると、タスクの期限や予定の出発時刻をこの端末に通知します。夜間（21:00〜翌7:00）の分は7:00にまとめ、内容を隠す設定なら題名を出しません。サインアウトすると、予約した通知は消えます。")
      }
      SettingsBlock {
        SettingsNote("見本です。実際の通知は変わりません。")
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          StatusBadge("18:00", tone: .success)
          Text(hidden ? "タスクのお知らせ" : "図書館の本を返す").font(.headline).foregroundStyle(colors.ink.color)
          Text(hidden ? "内容は表示しない設定です。開くと題名と内容を確認できます。" : "18:00まで・担当：碧さん").font(.callout).foregroundStyle(colors.inkSoft.color)
        }
        .padding(TokenSpace.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.paperDeep.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("通知の見本")
        SettingsNote("題名や内容を表示するかどうかは「共有とプライバシー」で変えられます。")
      } header: { SettingsHeader("通知の表示例") }
    }
    .task { await load() }
  }

  private func load() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.getNotificationPreferences() }) {
    case .success(let value): preferences = value
    case .failure(let failure): error = failure.message
    }
  }

  private func toggle(_ key: WritableKeyPath<NotificationPreferences, Bool>, _ value: Bool) async {
    guard var next = preferences else { return }
    next[keyPath: key] = value
    let input = next
    switch await model.run({ [gateway = model.gateway] in await gateway.updateNotificationPreferences(input) }) {
    case .success(let saved):
      preferences = saved; error = nil
      model.announce("通知設定を保存しました。")
      await model.loadNotifications()
    case .failure(let failure): error = failure.message
    }
  }
}

/// 設定の「位置情報」（Web の LocationPrivacy）。外部の検索サービスへの送信の説明と、同意の切り替え。
struct LocationSettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var saving = false

  static let rows: [[String]] = {
    guard let url = Bundle.copyResources.url(forResource: "ja.ja.place.settings.rows", withExtension: "json", subdirectory: "Copy"), let data = try? Data(contentsOf: url) else { return [] }
    return (try? JSONDecoder().decode([[String]].self, from: data)) ?? []
  }()
  static let terms = URL(string: "https://docs.openpoiapi.com/legal.html")!
  static let attribution = URL(string: "https://openpoiapi.com/attribution.html")!

  var body: some View {
    let colors = theme.colors
    let copy = Copy.ja.ja.place.settings.self
    let granted = model.privacy?.placeLookupConsent?.noticeVersion == OpenPoiLookup.noticeVersion
    SettingsPage {
      SettingsIntro(tab: tab)
      SettingsGroup(copy.title) {
        ForEach(Self.rows, id: \.self) { row in
          VStack(alignment: .leading, spacing: 2) {
            Text(row.first ?? "").font(.callout.weight(.bold)).foregroundStyle(colors.ink.color)
            Text(row.dropFirst().first ?? "").font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
          }
          .accessibilityElement(children: .combine)
        }
      }
      SettingsBlock {
        SettingToggle(title: copy.consentLabel, detail: "\(granted ? copy.consentOn : copy.consentOff)。\(copy.revokeNote)", isOn: Binding(get: { granted }, set: { value in Task { await toggle(value) } }), identifier: "settings.location.lookup-consent")
          .disabled(saving || model.privacy == nil)
        Button { openURL(Self.terms) } label: { Label(copy.terms, systemImage: "arrow.up.forward.square") }
          .accessibilityLabel(Self.external(copy.terms))
          .accessibilityIdentifier("settings.location.terms")
        Button { openURL(Self.attribution) } label: { Label(copy.attribution, systemImage: "arrow.up.forward.square") }
          .accessibilityLabel(Self.external(copy.attribution))
          .accessibilityIdentifier("settings.location.attribution")
      } header: { SettingsHeader(copy.consentLabel) }
    }
  }

  /// 外のサイトを開くリンクの読み上げ（ja.externalLinkLabel）。
  static func external(_ label: String) -> String { "\(label)を開く（ブラウザで開きます）" }

  private func toggle(_ on: Bool) async {
    guard !saving else { return }
    saving = true
    let now = CalendarDate.toJstRfc3339(Date())
    let result = await model.updatePrivacy { $0.placeLookupConsent = on ? PlaceLookupConsent(noticeVersion: OpenPoiLookup.noticeVersion, grantedAt: now) : nil }
    saving = false
    let copy = Copy.ja.ja.place.settings.self
    switch result {
    case .success: model.announce(on ? copy.consentGranted : copy.consentRevoked)
    case .failure: model.announce(Copy.ja.ja.place.failures["consent-failed"] ?? "")
    }
  }
}

/// 設定の「表示・操作」（Web の Accessibility）。この端末だけの見え方と、データの更新。
struct AccessibilitySettings: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var refreshing = false

  var body: some View {
    @Bindable var preferences = preferences
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      SettingsBlock {
        ForEach(ThemePalette.allCases, id: \.self) { palette in
          Button { preferences.palette = palette } label: {
            HStack(spacing: TokenSpace.space3) {
              HStack(spacing: 0) {
                Rectangle().fill(palette.theme(night: false).colors.brand.color)
                Rectangle().fill(palette.theme(night: false).colors.accent.color)
                Rectangle().fill(palette.theme(night: true).colors.paper.color)
              }
              .frame(width: 48, height: 24)
              .clipShape(RoundedRectangle(cornerRadius: 6))
              .overlay(RoundedRectangle(cornerRadius: 6).stroke(colors.line.color))
              .accessibilityHidden(true)
              Text(palette.label).foregroundStyle(colors.ink.color)
              Spacer()
              if preferences.palette == palette { Image(systemName: "checkmark").foregroundStyle(colors.brand.color).accessibilityHidden(true) }
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(preferences.palette == palette ? .isSelected : [])
          .accessibilityIdentifier("settings.theme.palette.\(palette.rawValue)")
        }
        SettingsNote("この端末だけの設定です。")
      } header: { SettingsHeader("表示テーマ") }
      SettingsGroup("昼と夜") {
        Picker("昼と夜", selection: $preferences.colorMode) {
          ForEach(ColorMode.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("settings.theme.mode")
      }
      SettingsGroup("表示の密度") {
        Picker("表示の密度", selection: Binding(get: { preferences.density }, set: { value in
          preferences.density = value
          model.announce("表示の密度を「\(value.label)」にしました。")
        })) {
          ForEach(Density.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("settings.density")
        SettingToggle(title: "動きを減らす", detail: "端末の設定で視差効果を減らしている場合にも適用されます。", isOn: $preferences.reducedMotion, identifier: "settings.motion.reduce")
      }
      SettingsBlock {
        SettingsNote("別の端末で変えた内容を、すぐに確かめたいときに使います。")
        if let sync = model.snapshot?.context.sync {
          Text("最後に更新した日時：\(settingsDateTime(sync.lastSyncedAt))").font(.callout).foregroundStyle(colors.ink.color)
        }
        Button(refreshing ? "読み込んでいます…" : "最新の内容を読み込む") {
          Task {
            refreshing = true
            let ok = await model.refresh()
            refreshing = false
            model.announce(ok ? "最新の内容を読み込みました。" : "読み込めませんでした。通信の状態を確かめてください。")
          }
        }
        .disabled(refreshing)
        .accessibilityIdentifier("settings.sync.refresh")
      } header: { SettingsHeader("データの更新") }
      SettingsGroup("操作と読みやすさ") {
        Text("文字を大きくした場合も、項目が重なったり、操作ボタンが隠れたりしないように調整しています。文字の大きさは、端末の「設定」の「画面表示と明るさ」で変えられます。").font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
        SettingsNote("色だけで状態を区別せず、VoiceOver でも同じ内容を読み上げます。")
      }
    }
  }
}

/// 設定の「関連リンク」（Web の Resources）。https のリンクだけを開く。
struct ResourceSettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @Environment(\.theme) private var theme
  let tab: SettingsTab

  var body: some View {
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      let resources = model.snapshot?.resources ?? []
      if resources.isEmpty { SettingsBlock { SettingsNote("関連リンクはまだありません。") } }
      ForEach(resources) { resource in
        SettingsBlock {
          HStack {
            Text(resource.label).font(.headline).foregroundStyle(colors.ink.color)
            Spacer(minLength: 0)
            StatusBadge(Copy.ja.ja.resourceKinds.table[resource.kind.rawValue] ?? "")
          }
          Text(resource.url).font(.footnote).foregroundStyle(colors.inkSoft.color).textSelection(.enabled)
            .accessibilityHidden(true)
          if let url = ResourceLinks.safeURL(resource.url) {
            Button { openURL(url) } label: { Label("\(resource.label)を開く", systemImage: "arrow.up.forward.square") }
              .accessibilityLabel(LocationSettings.external(resource.label))
              .accessibilityIdentifier("settings.resource.open.\(resource.id)")
          } else {
            SettingsError(message: "このリンクは開けません。管理者にリンク先の確認を依頼してください。")
          }
        }
      }
    }
  }
}
