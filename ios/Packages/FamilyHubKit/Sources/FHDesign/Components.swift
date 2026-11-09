import SwiftUI

// 画面の部品。元: src/design-system/components.tsx と global.css（色の役割と形を同じにする）。

extension RGBA {
  /// CSS の color-mix(in srgb, self fraction, other)。
  public func mixed(_ fraction: Double, with other: RGBA) -> RGBA {
    func channel(_ a: Int, _ b: Int) -> Int { Int((Double(a) * fraction + Double(b) * (1 - fraction)).rounded()) }
    return RGBA(channel(red, other.red), channel(green, other.green), channel(blue, other.blue), alpha * fraction + other.alpha * (1 - fraction))
  }
}

/// 見出しの上の小さな文字（.eyebrow）。
public struct Eyebrow: View {
  @Environment(\.theme) private var theme
  private let text: String
  public init(_ text: String) { self.text = text }
  public var body: some View {
    Text(text).font(.caption.weight(.heavy)).kerning(1.2).foregroundStyle(theme.colors.brand.color)
  }
}

/// 状態の印（.badge）。
public struct StatusBadge: View {
  public enum Tone: Sendable { case neutral, success, attention, danger, info }
  @Environment(\.theme) private var theme
  private let text: String
  private let tone: Tone
  private let systemImage: String?
  public init(_ text: String, tone: Tone = .neutral, systemImage: String? = nil) { self.text = text; self.tone = tone; self.systemImage = systemImage }
  public var body: some View {
    let colors = theme.colors
    let (fore, back): (RGBA, RGBA) = switch tone {
    case .neutral: (colors.inkSoft, colors.paperDeep)
    case .success: (colors.success, colors.successSoft)
    case .attention: (colors.attention, colors.attentionSoft)
    case .danger: (colors.danger, colors.dangerSoft)
    case .info: (colors.info, colors.infoSoft)
    }
    HStack(spacing: TokenSpace.space1) {
      if let systemImage { Image(systemName: systemImage).imageScale(.small) }
      Text(text)
    }
    .font(.caption.weight(.bold))
    .fixedSize(horizontal: false, vertical: true)
    .padding(.horizontal, TokenSpace.space2)
    .padding(.vertical, TokenSpace.space1)
    .foregroundStyle(fore.color)
    .background(back.color, in: Capsule())
    .overlay { if theme.isHighContrast { Capsule().stroke(fore.color) } }
  }
}

extension ThemeName {
  /// 強い対比のテーマ（印に枠を付ける。global.css の forced-colors と高対比のテーマ）。
  public var isHighContrast: Bool { rawValue.contains("contrast") }
}

/// カード（.card）。accent は上に柿色の線を引く（要確認のとき）。
public struct Card<Content: View>: View {
  @Environment(\.theme) private var theme
  private let accent: Bool
  private let content: Content
  public init(accent: Bool = false, @ViewBuilder content: () -> Content) { self.accent = accent; self.content = content() }
  public var body: some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space3) { content }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusMd))
      .overlay(alignment: .top) {
        if accent { UnevenRoundedRectangle(topLeadingRadius: TokenRadius.radiusMd, topTrailingRadius: TokenRadius.radiusMd).fill(colors.brand.color).frame(height: 4) }
      }
      .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusMd).stroke(colors.line.color))
  }
}

/// カードの見出し（.section-head）。
public struct SectionHeader<Trailing: View>: View {
  @Environment(\.theme) private var theme
  private let eyebrow: String
  private let title: String
  private let trailing: Trailing
  public init(eyebrow: String, title: String, @ViewBuilder trailing: () -> Trailing) {
    self.eyebrow = eyebrow; self.title = title; self.trailing = trailing()
  }
  public var body: some View {
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: TokenSpace.space1) {
        Eyebrow(eyebrow)
        Text(title).font(.title3.weight(.bold)).fontDesign(.serif).foregroundStyle(theme.colors.ink.color).accessibilityAddTraits(.isHeader)
      }
      Spacer(minLength: TokenSpace.space2)
      trailing
    }
  }
}

/// 大きな数字（.metric）。
public struct Metric: View {
  @Environment(\.theme) private var theme
  private let text: String
  public init(_ text: String) { self.text = text }
  public var body: some View {
    Text(text).font(.largeTitle.weight(.bold)).fontDesign(.serif).monospacedDigit().foregroundStyle(theme.colors.ink.color)
  }
}

/// 知らせの帯（.callout）。info は青の地。
public struct Callout<Action: View>: View {
  public enum Tone: Sendable { case brand, info, plain }
  @Environment(\.theme) private var theme
  private let systemImage: String
  private let title: String
  private let detail: String?
  private let tone: Tone
  private let action: Action
  public init(systemImage: String, title: String, detail: String? = nil, tone: Tone = .brand, @ViewBuilder action: () -> Action) {
    self.systemImage = systemImage; self.title = title; self.detail = detail; self.tone = tone; self.action = action()
  }
  public var body: some View {
    let colors = theme.colors
    let (back, border): (RGBA, RGBA) = switch tone {
    case .brand: (colors.brandSoft.mixed(0.48, with: colors.sheet), colors.brand.mixed(0.45, with: colors.line))
    case .info: (colors.infoSoft, colors.info.mixed(0.45, with: colors.line))
    case .plain: (colors.sheet, colors.line)
    }
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      HStack(alignment: .top, spacing: TokenSpace.space3) {
        Image(systemName: systemImage).foregroundStyle(colors.ink.color).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          // 狭い幅でも途中で切らずに折り返す。
          Text(title).font(.body.weight(.bold)).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
          if let detail { Text(detail).font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true) }
        }
        Spacer(minLength: 0)
      }
      action
    }
    .padding(TokenSpace.space4)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(back.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(border.color))
  }
}

/// 空の状態（.empty）。挿絵・見出し・説明・操作。
public struct EmptyStateView<Action: View>: View {
  @Environment(\.theme) private var theme
  private let title: String
  private let message: String
  private let illustration: Illustration?
  private let compact: Bool
  private let action: Action
  public init(title: String, message: String, illustration: Illustration? = nil, compact: Bool = false, @ViewBuilder action: () -> Action) {
    self.title = title; self.message = message; self.illustration = illustration; self.compact = compact; self.action = action()
  }
  public var body: some View {
    let colors = theme.colors
    VStack(spacing: TokenSpace.space3) {
      if let illustration {
        IllustrationView(illustration, lineWidth: compact ? 1.75 : 2).frame(maxWidth: compact ? 120 : 180)
      }
      Text(title).font(compact ? .headline : .title3.weight(.bold)).fontDesign(.serif).multilineTextAlignment(.center).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
      Text(message).font(.callout).multilineTextAlignment(.center).foregroundStyle(colors.inkSoft.color)
      action
    }
    .frame(maxWidth: .infinity)
    .padding(compact ? TokenSpace.space3 : TokenSpace.space5)
  }
}

/// ボタンの形（.button、.button.primary）。高さは 44pt 以上。
public struct FHButtonStyle: ButtonStyle {
  public enum Kind: Sendable { case primary, secondary, danger }
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  private let kind: Kind
  private let fullWidth: Bool
  public init(_ kind: Kind = .secondary, fullWidth: Bool = false) { self.kind = kind; self.fullWidth = fullWidth }
  public func makeBody(configuration: Configuration) -> some View {
    let colors = theme.colors
    // 押せないボタンは薄くせず（文字が読みにくくなる）、控えめの色で示す。
    let styled: (RGBA, RGBA, RGBA) = switch kind {
    case .primary: (colors.onAccent, colors.accentStrong, colors.accentStrong)
    case .secondary: (colors.ink, colors.sheet, colors.lineStrong)
    case .danger: (colors.danger, colors.sheet, colors.danger.mixed(0.45, with: colors.line))
    }
    let (fore, back, border) = isEnabled ? styled : (colors.inkSoft, colors.sheet, colors.line)
    configuration.label
      .font(.body.weight(.bold))
      .padding(.horizontal, TokenSpace.space4)
      .padding(.vertical, TokenSpace.space2)
      .frame(minWidth: 44, maxWidth: fullWidth ? .infinity : nil, minHeight: 44)
      .foregroundStyle(fore.color)
      .background(back.color, in: Capsule())
      .overlay(Capsule().stroke(border.color))
      .opacity(configuration.isPressed ? 0.8 : 1)
      .contentShape(Capsule())
  }
}

extension View {
  public func fhButton(_ kind: FHButtonStyle.Kind = .secondary, fullWidth: Bool = false) -> some View { buttonStyle(FHButtonStyle(kind, fullWidth: fullWidth)) }
}

/// 入力欄の組（.field）。見出し・入力・説明・誤り。
public struct Field<Content: View>: View {
  @Environment(\.theme) private var theme
  private let label: String
  private let help: String?
  private let content: Content
  public init(_ label: String, help: String? = nil, @ViewBuilder content: () -> Content) { self.label = label; self.help = help; self.content = content() }
  public var body: some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space1) {
      Text(label).font(.subheadline.weight(.bold)).foregroundStyle(colors.ink.color)
      content
        .padding(.horizontal, TokenSpace.space3)
        .frame(minHeight: 44)
        .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.lineStrong.color))
      if let help { Text(help).font(.caption).foregroundStyle(colors.inkSoft.color) }
    }
  }
}

/// 失敗の知らせ（.notice.error）。読み上げにも伝える。
public struct ErrorNotice: View {
  @Environment(\.theme) private var theme
  private let message: String
  public init(_ message: String) { self.message = message }
  public var body: some View {
    let colors = theme.colors
    Text(message)
      .font(.callout.weight(.semibold))
      .foregroundStyle(colors.danger.color)
      .padding(.horizontal, TokenSpace.space4)
      .padding(.vertical, TokenSpace.space3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(colors.dangerSoft.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
      .onAppear { announce(message) }
      .onChange(of: message) { _, next in announce(next) }
  }
}

/// 読み上げに知らせる。
@MainActor public func announce(_ message: String) {
  #if os(iOS)
  AccessibilityNotification.Announcement(message).post()
  #endif
}

/// 柿の印と名前を並べた印（Web の Brand）。
public struct BrandLockup: View {
  private let compact: Bool
  public init(compact: Bool = false) { self.compact = compact }
  public var body: some View {
    HStack(spacing: TokenSpace.space2) {
      BrandMark().frame(width: compact ? 28 : 40, height: compact ? 28 : 40)
      Wordmark().frame(height: compact ? 16 : 22)
    }
    .accessibilityElement(children: .combine)
  }
}

extension SectionHeader where Trailing == EmptyView {
  public init(eyebrow: String, title: String) { self.init(eyebrow: eyebrow, title: title) { EmptyView() } }
}
extension Callout where Action == EmptyView {
  public init(systemImage: String, title: String, detail: String? = nil, tone: Tone = .brand) { self.init(systemImage: systemImage, title: title, detail: detail, tone: tone) { EmptyView() } }
}
extension EmptyStateView where Action == EmptyView {
  public init(title: String, message: String, illustration: Illustration? = nil, compact: Bool = false) { self.init(title: title, message: message, illustration: illustration, compact: compact) { EmptyView() } }
}

/// 文字だけのボタン（Web の .link-button・.standalone-link）。触れる範囲は 44pt 以上にする。
public struct FHLinkButtonStyle: ButtonStyle {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  private let font: Font
  public init(font: Font = .callout.weight(.semibold)) { self.font = font }
  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(font)
      .foregroundStyle(theme.colors.accent.color)
      .underline(configuration.isPressed)
      .frame(minWidth: 44, minHeight: 44)
      .contentShape(Rectangle())
      .opacity(isEnabled ? 1 : 0.5)
  }
}

extension View {
  public func fhLink(font: Font = .callout.weight(.semibold)) -> some View { buttonStyle(FHLinkButtonStyle(font: font)) }
}
