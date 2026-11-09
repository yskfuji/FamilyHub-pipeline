import SwiftUI
import FHCopy

extension RGBA {
  public var color: Color { Color(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255, opacity: alpha) }

  /// WCAG 2.2 の相対輝度。
  public var luminance: Double {
    func channel(_ value: Int) -> Double {
      let c = Double(value) / 255
      return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  }

  /// 2色の濃さの比（WCAG 2.2）。
  public func contrast(with other: RGBA) -> Double {
    let (a, b) = (luminance, other.luminance)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)
  }
}

/// 端末ごとの見た目の設定。Web の src/app/devicePreferences.ts と同じ意味（保存は UserDefaults）。
public enum ColorMode: String, CaseIterable, Sendable {
  case day, night, system
  public var label: String {
    switch self {
    case .day: "昼"
    case .night: "夜"
    case .system: "端末に合わせる"
    }
  }
}

public struct ThemeChoice: Equatable, Sendable {
  public var palette: ThemePalette
  public var mode: ColorMode
  public init(palette: ThemePalette = .standard, mode: ColorMode = .system) {
    self.palette = palette; self.mode = mode
  }

  public func theme(systemIsDark: Bool) -> ThemeName {
    switch mode {
    case .day: palette.theme(night: false)
    case .night: palette.theme(night: true)
    case .system: palette.theme(night: systemIsDark)
    }
  }
}

private struct CompactDensityKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// 表示の密度が「コンパクト」か（カードの余白を詰める）。
  public var compactDensity: Bool {
    get { self[CompactDensityKey.self] }
    set { self[CompactDensityKey.self] = newValue }
  }
}

private struct ThemeKey: EnvironmentKey {
  static let defaultValue: ThemeName = .light
}

extension EnvironmentValues {
  /// 今の画面のテーマ。色は `theme.colors` から取る。
  public var theme: ThemeName {
    get { self[ThemeKey.self] }
    set { self[ThemeKey.self] = newValue }
  }
}

/// テーマを決めて、下の画面に渡す。端末の昼と夜に合わせるときは colorScheme を見る。
public struct ThemedRoot<Content: View>: View {
  @Environment(\.colorScheme) private var scheme
  private let choice: ThemeChoice
  private let content: Content

  public init(choice: ThemeChoice, @ViewBuilder content: () -> Content) {
    self.choice = choice
    self.content = content()
  }

  public var body: some View {
    let theme = choice.theme(systemIsDark: scheme == .dark)
    content
      .environment(\.theme, theme)
      .tint(theme.colors.accent.color)
      .preferredColorScheme(choice.mode == .system ? nil : (theme.isNight ? .dark : .light))
  }
}

/// 柿の印。どのテーマでも柿の色（--kaki）。
public struct BrandMark: View {
  @Environment(\.theme) private var theme
  public init() {}
  public var body: some View {
    let colors = theme.colors
    ZStack {
      BrandFruitShape().fill(colors.kakiSoft.color)
      BrandFruitShape().stroke(colors.kaki.color, lineWidth: 2 / 48 * 44)
      BrandStemShape().stroke(colors.kakiStem.color, style: StrokeStyle(lineWidth: 2 / 48 * 44, lineCap: .round))
    }
    .aspectRatio(1, contentMode: .fit)
    .accessibilityElement()
    .accessibilityLabel(Copy.ja.ja.brand.markLabel)
  }
}

/// ブランドの名前「よりどころ」。字形は Web と同じ（Noto Serif JP Bold から書き出した形）。
public struct Wordmark: View {
  @Environment(\.theme) private var theme
  public init() {}
  public var body: some View {
    WordmarkShape()
      .fill(theme.colors.ink.color)
      .aspectRatio(WordmarkShape.size.width / WordmarkShape.size.height, contentMode: .fit)
      .accessibilityElement()
      .accessibilityLabel(Copy.ja.ja.brand.name)
      .accessibilityAddTraits(.isHeader)
  }
}
