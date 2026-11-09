import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 設定（Web の src/features/settings/SettingsPage.tsx）。12のタブを、iPhone は一覧から押して進み、iPad は左の一覧と右の中身の2列で出す。
/// タブの名前・説明・表示に要る能力は Web の settingsTabs.ts と同じ（Copy/settingsTabs.settingsTabs.json）。
struct SettingsScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.theme) private var theme
  /// iPhone で開いている項目。
  @State private var pushed: SettingsTab?
  /// iPad で右に出している項目。
  @State private var selected: String = "household"

  private var tabs: [SettingsTab] { SettingsTab.all.filter { model.can($0.capability) } }

  var body: some View {
    Group {
      if sizeClass == .compact {
        list
          .navigationDestination(item: $pushed) { tab in
            SettingsSectionView(tab: tab, open: open).navigationTitle(tab.label).inlineNavigationTitle()
          }
      } else {
        HStack(spacing: 0) {
          list.frame(width: 320)
          Divider()
          if let tab = tabs.first(where: { $0.key == selected }) ?? tabs.first {
            SettingsSectionView(tab: tab, open: open).id(tab.key).frame(maxWidth: .infinity)
          }
        }
      }
    }
    .onAppear(perform: takeFocus)
    .onChange(of: model.focus) { _, _ in takeFocus() }
  }

  private var list: some View {
    settingsList.modifier(SettingsFormStyle())
  }

  private var settingsList: some View {
    List {
      Section {
        ForEach(tabs) { tab in
          Button { open(tab.key) } label: {
            HStack {
              Label(tab.label, systemImage: Self.icon(tab.key)).foregroundStyle(theme.colors.ink.color)
              Spacer()
              if sizeClass == .compact { Image(systemName: "chevron.forward").font(.footnote.weight(.semibold)).foregroundStyle(theme.colors.inkSoft.color).accessibilityHidden(true) }
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .listRowBackground(sizeClass != .compact && selected == tab.key ? theme.colors.brandSoft.color : nil)
          .accessibilityAddTraits(sizeClass != .compact && selected == tab.key ? .isSelected : [])
          .accessibilityIdentifier("settings.section.\(tab.key)")
        }
      } header: {
        SettingsHeader("設定項目")
      }
    }
  }

  /// 項目を開く。ヘルプの「関連する設定」などからも使う。
  private func open(_ key: String) {
    guard let tab = tabs.first(where: { $0.key == key }) else { return }
    if sizeClass == .compact {
      if pushed == nil { pushed = tab } else {
        // 開いている項目から別の項目へ移るときは、いったん戻してから開く。
        pushed = nil
        Task { try? await Task.sleep(for: .milliseconds(450)); pushed = tab }
      }
    } else {
      selected = key
    }
  }

  private func takeFocus() {
    guard case .settings(let key)? = model.focus else { return }
    model.focus = nil
    open(key)
  }

  static func icon(_ key: String) -> String {
    switch key {
    case "household": "person.3"
    case "security": "lock.shield"
    case "account": "person.crop.circle"
    case "privacy": "hand.raised"
    case "notifications": "bell"
    case "location": "location"
    case "accessibility": "textformat.size"
    case "resources": "link"
    case "recently-deleted": "trash"
    case "audit": "list.bullet.rectangle"
    case "help": "questionmark.circle"
    default: "doc.text"
    }
  }
}

/// 1つのタブの中身。上に説明を置く（Web の PageHeader の description）。
struct SettingsSectionView: View {
  let tab: SettingsTab
  let open: (String) -> Void

  var body: some View {
    content.modifier(SettingsFormStyle())
  }

  @ViewBuilder private var content: some View {
    switch tab.key {
    case "household": HouseholdSettings(tab: tab)
    case "security": SecuritySettings(tab: tab)
    case "account": AccountSettings(tab: tab)
    case "privacy": PrivacySettingsView(tab: tab)
    case "notifications": NotificationSettings(tab: tab)
    case "location": LocationSettings(tab: tab)
    case "accessibility": AccessibilitySettings(tab: tab)
    case "resources": ResourceSettings(tab: tab)
    case "recently-deleted": RecentlyDeletedSettings(tab: tab)
    case "audit": AuditSettings(tab: tab)
    case "help": HelpSettings(tab: tab, open: open)
    default: LegalSettings(tab: tab)
    }
  }
}

/// 項目の上の説明。
/// 設定のタブの中身。カードを縦に並べる（アプリのほかの画面と同じ形）。
/// 一覧（Form）で作ったときは、アクセシビリティの監査が、最初に流した一覧の画面の中ほどの行の文字の大きさと濃さを測り損ねた。
struct SettingsPage<Content: View>: View {
  @ViewBuilder let content: Content
  init(@ViewBuilder content: () -> Content) { self.content = content() }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) { content }
        .padding(TokenSpace.space4)
        .frame(maxWidth: 900, alignment: .leading)
        .frame(maxWidth: .infinity)
    }
    .environment(\.settingsCards, true)
  }
}

struct SettingsIntro: View {
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  var body: some View {
    SettingsBlock {
      Text(tab.description).font(.callout).foregroundStyle(theme.colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// 設定の中の失敗の文。
struct SettingsError: View {
  @Environment(\.theme) private var theme
  let message: String
  var body: some View {
    Text(message).font(.callout.weight(.semibold)).foregroundStyle(theme.colors.danger.color).fixedSize(horizontal: false, vertical: true)
  }
}

/// 設定の中の補足の文（小さく、薄く）。
struct SettingsNote: View {
  @Environment(\.theme) private var theme
  let text: String
  init(_ text: String) { self.text = text }
  var body: some View {
    Text(text).font(.footnote).foregroundStyle(theme.colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
  }
}

/// 名前と説明のあるスイッチ（Web の setting-row と toggle）。
struct SettingToggle: View {
  @Environment(\.theme) private var theme
  let title: String
  let detail: String
  @Binding var isOn: Bool
  var identifier: String

  var body: some View {
    Toggle(isOn: $isOn) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).foregroundStyle(theme.colors.ink.color)
        Text(detail).font(.footnote).foregroundStyle(theme.colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityIdentifier(identifier)
  }
}

/// 日時の表示（formatDate と formatTime を並べる）。
func settingsDateTime(_ value: Rfc3339) -> String { "\(Format.date(value)) \(Format.time(value))" }

/// 設定の節の見出し。テーマの文字の色で、端末の文字の大きさに合わせて大きくなる。
struct SettingsHeader: View {
  @Environment(\.theme) private var theme
  let text: String
  init(_ text: String) { self.text = text }
  var body: some View {
    Text(text)
      .font(.subheadline.weight(.bold))
      .foregroundStyle(theme.colors.ink.color)
      .textCase(nil)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
  }
}

/// 設定の節の下の補足。
struct SettingsFooter: View {
  @Environment(\.theme) private var theme
  let text: String
  init(_ text: String) { self.text = text }
  var body: some View {
    Text(text).font(.footnote).foregroundStyle(theme.colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
  }
}

/// 見出しのある設定の節。
struct SettingsGroup<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content
  init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
  var body: some View {
    SettingsBlock { content } header: { SettingsHeader(title) }
  }
}

/// 設定の一覧の背景をテーマの紙の色にする（節の見出しと補足の文字の濃さを、テーマの色どうしで保つ）。
struct SettingsFormStyle: ViewModifier {
  @Environment(\.theme) private var theme
  func body(content: Content) -> some View {
    content.scrollContentBackground(.hidden).background(theme.colors.paper.color)
  }
}

private struct SettingsCardsKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
  /// 設定の節を、一覧（Form の Section）ではなくカードで出すか。
  var settingsCards: Bool {
    get { self[SettingsCardsKey.self] }
    set { self[SettingsCardsKey.self] = newValue }
  }
}

/// 設定の節。一覧の中では Section、カードを並べる画面ではカードにする（行の間は線で分ける）。
struct SettingsBlock<Content: View, Header: View>: View {
  @Environment(\.settingsCards) private var cards
  private let content: Content
  private let header: Header

  init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Header) {
    self.content = content(); self.header = header()
  }

  var body: some View {
    if cards {
      VStack(alignment: .leading, spacing: TokenSpace.space2) {
        header
        Card { content }
      }
    } else {
      Section { content } header: { header }
    }
  }
}

extension SettingsBlock where Header == EmptyView {
  init(@ViewBuilder content: () -> Content) { self.init(content: content) { EmptyView() } }
}

/// カードの中の入力欄。枠を付け、文字を大きくしても欄が伸びるようにする。
struct SettingsField: ViewModifier {
  @Environment(\.theme) private var theme
  func body(content: Content) -> some View {
    content
      .padding(TokenSpace.space3)
      .frame(minHeight: 44)
      .background(theme.colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
      .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(theme.colors.lineStrong.color))
  }
}

extension View {
  func settingsField() -> some View { modifier(SettingsField()) }
}
