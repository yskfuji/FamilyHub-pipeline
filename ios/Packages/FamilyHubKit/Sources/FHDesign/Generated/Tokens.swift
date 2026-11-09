// 生成したファイル。手で書き換えない。node scripts/ios/export-tokens.mjs で作り直す。
// 元: src/design-system/tokens.css、src/design-system/themes.css、src/domain/theme.ts

/// sRGB の色（0〜255）と不透明度（0〜1）。
public struct RGBA: Sendable, Hashable {
  public let red: Int
  public let green: Int
  public let blue: Int
  public let alpha: Double
  public init(_ red: Int, _ green: Int, _ blue: Int, _ alpha: Double) {
    self.red = red; self.green = green; self.blue = blue; self.alpha = alpha
  }
}

/// data-theme の値。
public enum ThemeName: String, CaseIterable, Sendable {
  case light = "light"
  case dusk = "dusk"
  case matcha = "matcha"
  case matchaNight = "matcha-night"
  case sakura = "sakura"
  case sakuraNight = "sakura-night"
  case warm = "warm"
  case warmNight = "warm-night"
  case modern = "modern"
  case modernNight = "modern-night"

  public var isNight: Bool { self == .dusk || rawValue.hasSuffix("-night") }
}

/// 配色の組。standard が既定。
public enum ThemePalette: String, CaseIterable, Sendable {
  case standard
  case matcha
  case sakura
  case warm
  case modern

  public var label: String {
    switch self {
    case .standard: "標準"
    case .matcha: "抹茶"
    case .sakura: "桜"
    case .warm: "紅葉"
    case .modern: "川"
    }
  }

  public func theme(night: Bool) -> ThemeName {
    switch self {
    case .standard: night ? .dusk : .light
    case .matcha: night ? .matchaNight : .matcha
    case .sakura: night ? .sakuraNight : .sakura
    case .warm: night ? .warmNight : .warm
    case .modern: night ? .modernNight : .modern
    }
  }
}

/// テーマごとの色の役割。名前は CSS の変数（--paper など）を camelCase にしたもの。
public struct ThemeColors: Sendable, Hashable {
  public let paper: RGBA
  public let paperDeep: RGBA
  public let sheet: RGBA
  public let sheetRaised: RGBA
  public let ink: RGBA
  public let inkSoft: RGBA
  public let inkFaint: RGBA
  public let line: RGBA
  public let lineStrong: RGBA
  public let accent: RGBA
  public let accentStrong: RGBA
  public let onAccent: RGBA
  public let brand: RGBA
  public let brandSoft: RGBA
  public let onBrand: RGBA
  public let attention: RGBA
  public let attentionSoft: RGBA
  public let info: RGBA
  public let infoSoft: RGBA
  public let danger: RGBA
  public let dangerSoft: RGBA
  public let success: RGBA
  public let successSoft: RGBA
  public let moss: RGBA
  public let mossSoft: RGBA
  public let gold: RGBA
  public let focus: RGBA
  public let chart1: RGBA
  public let chart2: RGBA
  public let chart3: RGBA
  public let chart4: RGBA
  public let chart5: RGBA
  public let chart6: RGBA
  public let kaki: RGBA
  public let kakiSoft: RGBA
  public let kakiStem: RGBA
  public let artGround: RGBA
  public let scrim: RGBA
  public let scrimSoft: RGBA
  public let mediaBackdrop: RGBA
}

extension ThemeName {
  public var colors: ThemeColors {
    switch self {
    case .light:
      return ThemeColors(
      paper: RGBA(246, 240, 229, 1),
      paperDeep: RGBA(238, 227, 209, 1),
      sheet: RGBA(255, 253, 248, 1),
      sheetRaised: RGBA(255, 255, 255, 1),
      ink: RGBA(32, 43, 51, 1),
      inkSoft: RGBA(81, 96, 105, 1),
      inkFaint: RGBA(90, 103, 108, 1),
      line: RGBA(215, 205, 188, 1),
      lineStrong: RGBA(140, 128, 108, 1),
      accent: RGBA(37, 78, 112, 1),
      accentStrong: RGBA(23, 57, 81, 1),
      onAccent: RGBA(255, 255, 255, 1),
      brand: RGBA(168, 70, 47, 1),
      brandSoft: RGBA(241, 213, 197, 1),
      onBrand: RGBA(255, 255, 255, 1),
      attention: RGBA(134, 63, 48, 1),
      attentionSoft: RGBA(241, 213, 197, 1),
      info: RGBA(37, 78, 112, 1),
      infoSoft: RGBA(233, 236, 234, 1),
      danger: RGBA(152, 47, 47, 1),
      dangerSoft: RGBA(244, 217, 213, 1),
      success: RGBA(53, 98, 69, 1),
      successSoft: RGBA(215, 232, 220, 1),
      moss: RGBA(89, 102, 67, 1),
      mossSoft: RGBA(220, 226, 207, 1),
      gold: RGBA(139, 91, 2, 1),
      focus: RGBA(173, 76, 34, 1),
      chart1: RGBA(171, 119, 20, 1),
      chart2: RGBA(36, 137, 188, 1),
      chart3: RGBA(24, 146, 108, 1),
      chart4: RGBA(0, 114, 178, 1),
      chart5: RGBA(209, 96, 21, 1),
      chart6: RGBA(184, 103, 149, 1),
      kaki: RGBA(168, 70, 47, 1),
      kakiSoft: RGBA(241, 213, 197, 1),
      kakiStem: RGBA(23, 57, 81, 1),
      artGround: RGBA(238, 227, 209, 1),
      scrim: RGBA(12, 22, 29, 0.58),
      scrimSoft: RGBA(18, 27, 34, 0.24),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .dusk:
      return ThemeColors(
      paper: RGBA(16, 30, 43, 1),
      paperDeep: RGBA(11, 23, 33, 1),
      sheet: RGBA(23, 42, 57, 1),
      sheetRaised: RGBA(28, 50, 68, 1),
      ink: RGBA(247, 241, 232, 1),
      inkSoft: RGBA(203, 214, 220, 1),
      inkFaint: RGBA(170, 185, 193, 1),
      line: RGBA(64, 88, 105, 1),
      lineStrong: RGBA(113, 133, 148, 1),
      accent: RGBA(159, 200, 225, 1),
      accentStrong: RGBA(211, 233, 246, 1),
      onAccent: RGBA(16, 36, 51, 1),
      brand: RGBA(237, 158, 123, 1),
      brandSoft: RGBA(84, 51, 41, 1),
      onBrand: RGBA(16, 36, 51, 1),
      attention: RGBA(240, 179, 150, 1),
      attentionSoft: RGBA(84, 51, 41, 1),
      info: RGBA(159, 200, 225, 1),
      infoSoft: RGBA(39, 61, 77, 1),
      danger: RGBA(255, 176, 167, 1),
      dangerSoft: RGBA(83, 45, 46, 1),
      success: RGBA(165, 215, 177, 1),
      successSoft: RGBA(40, 66, 54, 1),
      moss: RGBA(189, 203, 154, 1),
      mossSoft: RGBA(52, 66, 53, 1),
      gold: RGBA(237, 198, 126, 1),
      focus: RGBA(255, 185, 130, 1),
      chart1: RGBA(230, 159, 0, 1),
      chart2: RGBA(86, 180, 233, 1),
      chart3: RGBA(0, 158, 115, 1),
      chart4: RGBA(29, 127, 192, 1),
      chart5: RGBA(213, 94, 0, 1),
      chart6: RGBA(204, 121, 167, 1),
      kaki: RGBA(237, 158, 123, 1),
      kakiSoft: RGBA(84, 51, 41, 1),
      kakiStem: RGBA(211, 233, 246, 1),
      artGround: RGBA(39, 61, 77, 1),
      scrim: RGBA(2, 6, 10, 0.7),
      scrimSoft: RGBA(2, 6, 10, 0.4),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .matcha:
      return ThemeColors(
      paper: RGBA(244, 249, 245, 1),
      paperDeep: RGBA(232, 244, 235, 1),
      sheet: RGBA(251, 253, 252, 1),
      sheetRaised: RGBA(255, 255, 255, 1),
      ink: RGBA(20, 28, 40, 1),
      inkSoft: RGBA(61, 74, 92, 1),
      inkFaint: RGBA(92, 101, 112, 1),
      line: RGBA(212, 211, 202, 1),
      lineStrong: RGBA(100, 116, 139, 1),
      accent: RGBA(47, 92, 59, 1),
      accentStrong: RGBA(39, 73, 53, 1),
      onAccent: RGBA(255, 255, 255, 1),
      brand: RGBA(58, 112, 71, 1),
      brandSoft: RGBA(223, 232, 226, 1),
      onBrand: RGBA(255, 255, 255, 1),
      attention: RGBA(49, 91, 63, 1),
      attentionSoft: RGBA(223, 232, 226, 1),
      info: RGBA(47, 92, 59, 1),
      infoSoft: RGBA(231, 237, 233, 1),
      danger: RGBA(180, 35, 24, 1),
      dangerSoft: RGBA(246, 229, 227, 1),
      success: RGBA(31, 111, 85, 1),
      successSoft: RGBA(224, 235, 231, 1),
      moss: RGBA(31, 111, 85, 1),
      mossSoft: RGBA(224, 235, 231, 1),
      gold: RGBA(138, 90, 0, 1),
      focus: RGBA(58, 112, 71, 1),
      chart1: RGBA(182, 127, 20, 1),
      chart2: RGBA(47, 146, 197, 1),
      chart3: RGBA(26, 156, 115, 1),
      chart4: RGBA(0, 114, 178, 1),
      chart5: RGBA(213, 94, 0, 1),
      chart6: RGBA(193, 111, 157, 1),
      kaki: RGBA(168, 70, 47, 1),
      kakiSoft: RGBA(241, 213, 197, 1),
      kakiStem: RGBA(23, 57, 81, 1),
      artGround: RGBA(232, 244, 235, 1),
      scrim: RGBA(12, 22, 29, 0.58),
      scrimSoft: RGBA(18, 27, 34, 0.24),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .matchaNight:
      return ThemeColors(
      paper: RGBA(19, 29, 45, 1),
      paperDeep: RGBA(14, 23, 35, 1),
      sheet: RGBA(34, 48, 62, 1),
      sheetRaised: RGBA(45, 58, 72, 1),
      ink: RGBA(248, 250, 252, 1),
      inkSoft: RGBA(226, 232, 240, 1),
      inkFaint: RGBA(168, 180, 196, 1),
      line: RGBA(58, 78, 90, 1),
      lineStrong: RGBA(148, 163, 184, 1),
      accent: RGBA(123, 192, 143, 1),
      accentStrong: RGBA(123, 191, 142, 1),
      onAccent: RGBA(15, 31, 20, 1),
      brand: RGBA(110, 178, 130, 1),
      brandSoft: RGBA(46, 69, 73, 1),
      onBrand: RGBA(15, 31, 20, 1),
      attention: RGBA(145, 196, 161, 1),
      attentionSoft: RGBA(46, 69, 73, 1),
      info: RGBA(123, 192, 143, 1),
      infoSoft: RGBA(45, 65, 72, 1),
      danger: RGBA(252, 165, 165, 1),
      dangerSoft: RGBA(73, 69, 81, 1),
      success: RGBA(111, 211, 174, 1),
      successSoft: RGBA(48, 77, 82, 1),
      moss: RGBA(111, 195, 173, 1),
      mossSoft: RGBA(43, 66, 75, 1),
      gold: RGBA(242, 194, 92, 1),
      focus: RGBA(106, 174, 126, 1),
      chart1: RGBA(230, 159, 0, 1),
      chart2: RGBA(86, 180, 233, 1),
      chart3: RGBA(0, 158, 115, 1),
      chart4: RGBA(42, 137, 202, 1),
      chart5: RGBA(215, 96, 5, 1),
      chart6: RGBA(204, 121, 167, 1),
      kaki: RGBA(237, 158, 123, 1),
      kakiSoft: RGBA(84, 51, 41, 1),
      kakiStem: RGBA(211, 233, 246, 1),
      artGround: RGBA(45, 65, 72, 1),
      scrim: RGBA(2, 6, 10, 0.7),
      scrimSoft: RGBA(2, 6, 10, 0.4),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .sakura:
      return ThemeColors(
      paper: RGBA(254, 245, 248, 1),
      paperDeep: RGBA(252, 232, 240, 1),
      sheet: RGBA(255, 252, 253, 1),
      sheetRaised: RGBA(255, 255, 255, 1),
      ink: RGBA(20, 28, 40, 1),
      inkSoft: RGBA(61, 74, 92, 1),
      inkFaint: RGBA(92, 101, 112, 1),
      line: RGBA(224, 206, 206, 1),
      lineStrong: RGBA(100, 116, 139, 1),
      accent: RGBA(148, 50, 86, 1),
      accentStrong: RGBA(110, 43, 72, 1),
      onAccent: RGBA(255, 255, 255, 1),
      brand: RGBA(176, 64, 112, 1),
      brandSoft: RGBA(242, 224, 232, 1),
      onBrand: RGBA(255, 255, 255, 1),
      attention: RGBA(137, 55, 94, 1),
      attentionSoft: RGBA(242, 224, 232, 1),
      info: RGBA(148, 50, 86, 1),
      infoSoft: RGBA(244, 232, 236, 1),
      danger: RGBA(180, 35, 24, 1),
      dangerSoft: RGBA(246, 229, 227, 1),
      success: RGBA(31, 111, 85, 1),
      successSoft: RGBA(224, 235, 231, 1),
      moss: RGBA(31, 111, 85, 1),
      mossSoft: RGBA(224, 235, 231, 1),
      gold: RGBA(138, 90, 0, 1),
      focus: RGBA(176, 64, 112, 1),
      chart1: RGBA(180, 125, 15, 1),
      chart2: RGBA(44, 143, 195, 1),
      chart3: RGBA(19, 153, 112, 1),
      chart4: RGBA(0, 114, 178, 1),
      chart5: RGBA(213, 94, 0, 1),
      chart6: RGBA(191, 109, 155, 1),
      kaki: RGBA(168, 70, 47, 1),
      kakiSoft: RGBA(241, 213, 197, 1),
      kakiStem: RGBA(23, 57, 81, 1),
      artGround: RGBA(252, 232, 240, 1),
      scrim: RGBA(12, 22, 29, 0.58),
      scrimSoft: RGBA(18, 27, 34, 0.24),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .sakuraNight:
      return ThemeColors(
      paper: RGBA(23, 27, 47, 1),
      paperDeep: RGBA(17, 21, 36, 1),
      sheet: RGBA(40, 45, 65, 1),
      sheetRaised: RGBA(51, 56, 74, 1),
      ink: RGBA(248, 250, 252, 1),
      inkSoft: RGBA(226, 232, 240, 1),
      inkFaint: RGBA(168, 180, 196, 1),
      line: RGBA(72, 73, 95, 1),
      lineStrong: RGBA(148, 163, 184, 1),
      accent: RGBA(242, 144, 186, 1),
      accentStrong: RGBA(234, 146, 183, 1),
      onAccent: RGBA(31, 11, 20, 1),
      brand: RGBA(229, 133, 175, 1),
      brandSoft: RGBA(71, 59, 83, 1),
      onBrand: RGBA(31, 11, 20, 1),
      attention: RGBA(234, 162, 194, 1),
      attentionSoft: RGBA(71, 59, 83, 1),
      info: RGBA(242, 144, 186, 1),
      infoSoft: RGBA(64, 57, 80, 1),
      danger: RGBA(252, 165, 165, 1),
      dangerSoft: RGBA(78, 67, 83, 1),
      success: RGBA(111, 211, 174, 1),
      successSoft: RGBA(53, 75, 85, 1),
      moss: RGBA(111, 195, 173, 1),
      mossSoft: RGBA(49, 63, 78, 1),
      gold: RGBA(242, 194, 92, 1),
      focus: RGBA(224, 128, 170, 1),
      chart1: RGBA(230, 159, 0, 1),
      chart2: RGBA(86, 180, 233, 1),
      chart3: RGBA(0, 158, 115, 1),
      chart4: RGBA(42, 137, 202, 1),
      chart5: RGBA(215, 96, 5, 1),
      chart6: RGBA(204, 121, 167, 1),
      kaki: RGBA(237, 158, 123, 1),
      kakiSoft: RGBA(84, 51, 41, 1),
      kakiStem: RGBA(211, 233, 246, 1),
      artGround: RGBA(64, 57, 80, 1),
      scrim: RGBA(2, 6, 10, 0.7),
      scrimSoft: RGBA(2, 6, 10, 0.4),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .warm:
      return ThemeColors(
      paper: RGBA(255, 248, 245, 1),
      paperDeep: RGBA(254, 240, 232, 1),
      sheet: RGBA(255, 253, 252, 1),
      sheetRaised: RGBA(255, 255, 255, 1),
      ink: RGBA(20, 28, 40, 1),
      inkSoft: RGBA(61, 74, 92, 1),
      inkFaint: RGBA(92, 101, 112, 1),
      line: RGBA(226, 206, 196, 1),
      lineStrong: RGBA(100, 116, 139, 1),
      accent: RGBA(168, 56, 10, 1),
      accentStrong: RGBA(124, 48, 19, 1),
      onAccent: RGBA(255, 255, 255, 1),
      brand: RGBA(168, 56, 10, 1),
      brandSoft: RGBA(245, 225, 216, 1),
      onBrand: RGBA(255, 255, 255, 1),
      attention: RGBA(131, 49, 18, 1),
      attentionSoft: RGBA(245, 225, 216, 1),
      info: RGBA(168, 56, 10, 1),
      infoSoft: RGBA(246, 233, 228, 1),
      danger: RGBA(180, 35, 24, 1),
      dangerSoft: RGBA(246, 229, 227, 1),
      success: RGBA(31, 111, 85, 1),
      successSoft: RGBA(224, 235, 231, 1),
      moss: RGBA(31, 111, 85, 1),
      mossSoft: RGBA(224, 235, 231, 1),
      gold: RGBA(138, 90, 0, 1),
      focus: RGBA(194, 65, 12, 1),
      chart1: RGBA(184, 128, 22, 1),
      chart2: RGBA(49, 147, 199, 1),
      chart3: RGBA(0, 158, 115, 1),
      chart4: RGBA(0, 114, 178, 1),
      chart5: RGBA(213, 94, 0, 1),
      chart6: RGBA(195, 113, 158, 1),
      kaki: RGBA(168, 70, 47, 1),
      kakiSoft: RGBA(241, 213, 197, 1),
      kakiStem: RGBA(23, 57, 81, 1),
      artGround: RGBA(254, 240, 232, 1),
      scrim: RGBA(12, 22, 29, 0.58),
      scrimSoft: RGBA(18, 27, 34, 0.24),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .warmNight:
      return ThemeColors(
      paper: RGBA(24, 28, 44, 1),
      paperDeep: RGBA(18, 22, 34, 1),
      sheet: RGBA(40, 46, 61, 1),
      sheetRaised: RGBA(51, 56, 71, 1),
      ink: RGBA(248, 250, 252, 1),
      inkSoft: RGBA(226, 232, 240, 1),
      inkFaint: RGBA(168, 180, 196, 1),
      line: RGBA(74, 75, 86, 1),
      lineStrong: RGBA(148, 163, 184, 1),
      accent: RGBA(249, 153, 98, 1),
      accentStrong: RGBA(245, 165, 116, 1),
      onAccent: RGBA(31, 13, 4, 1),
      brand: RGBA(240, 145, 90, 1),
      brandSoft: RGBA(74, 63, 66, 1),
      onBrand: RGBA(31, 13, 4, 1),
      attention: RGBA(242, 171, 131, 1),
      attentionSoft: RGBA(74, 63, 66, 1),
      info: RGBA(249, 153, 98, 1),
      infoSoft: RGBA(65, 59, 65, 1),
      danger: RGBA(252, 165, 165, 1),
      dangerSoft: RGBA(78, 67, 80, 1),
      success: RGBA(111, 211, 174, 1),
      successSoft: RGBA(53, 76, 81, 1),
      moss: RGBA(111, 195, 173, 1),
      mossSoft: RGBA(49, 64, 74, 1),
      gold: RGBA(242, 194, 92, 1),
      focus: RGBA(251, 146, 60, 1),
      chart1: RGBA(230, 159, 0, 1),
      chart2: RGBA(86, 180, 233, 1),
      chart3: RGBA(0, 158, 115, 1),
      chart4: RGBA(42, 137, 202, 1),
      chart5: RGBA(214, 95, 2, 1),
      chart6: RGBA(204, 121, 167, 1),
      kaki: RGBA(237, 158, 123, 1),
      kakiSoft: RGBA(84, 51, 41, 1),
      kakiStem: RGBA(211, 233, 246, 1),
      artGround: RGBA(65, 59, 65, 1),
      scrim: RGBA(2, 6, 10, 0.7),
      scrimSoft: RGBA(2, 6, 10, 0.4),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .modern:
      return ThemeColors(
      paper: RGBA(240, 247, 255, 1),
      paperDeep: RGBA(221, 238, 255, 1),
      sheet: RGBA(250, 252, 255, 1),
      sheetRaised: RGBA(255, 255, 255, 1),
      ink: RGBA(20, 28, 40, 1),
      inkSoft: RGBA(61, 74, 92, 1),
      inkFaint: RGBA(92, 101, 112, 1),
      line: RGBA(206, 212, 214, 1),
      lineStrong: RGBA(100, 116, 139, 1),
      accent: RGBA(0, 95, 163, 1),
      accentStrong: RGBA(6, 75, 126, 1),
      onAccent: RGBA(255, 255, 255, 1),
      brand: RGBA(0, 95, 163, 1),
      brandSoft: RGBA(214, 233, 245, 1),
      onBrand: RGBA(255, 255, 255, 1),
      attention: RGBA(5, 78, 132, 1),
      attentionSoft: RGBA(214, 233, 245, 1),
      info: RGBA(0, 95, 163, 1),
      infoSoft: RGBA(225, 236, 246, 1),
      danger: RGBA(180, 35, 24, 1),
      dangerSoft: RGBA(246, 229, 227, 1),
      success: RGBA(31, 111, 85, 1),
      successSoft: RGBA(224, 235, 231, 1),
      moss: RGBA(31, 111, 85, 1),
      mossSoft: RGBA(224, 235, 231, 1),
      gold: RGBA(138, 90, 0, 1),
      focus: RGBA(0, 119, 194, 1),
      chart1: RGBA(179, 124, 12, 1),
      chart2: RGBA(43, 143, 194, 1),
      chart3: RGBA(19, 153, 112, 1),
      chart4: RGBA(0, 114, 178, 1),
      chart5: RGBA(213, 94, 0, 1),
      chart6: RGBA(190, 108, 154, 1),
      kaki: RGBA(168, 70, 47, 1),
      kakiSoft: RGBA(241, 213, 197, 1),
      kakiStem: RGBA(23, 57, 81, 1),
      artGround: RGBA(221, 238, 255, 1),
      scrim: RGBA(12, 22, 29, 0.58),
      scrimSoft: RGBA(18, 27, 34, 0.24),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    case .modernNight:
      return ThemeColors(
      paper: RGBA(18, 29, 49, 1),
      paperDeep: RGBA(14, 23, 38, 1),
      sheet: RGBA(33, 47, 67, 1),
      sheetRaised: RGBA(44, 57, 76, 1),
      ink: RGBA(248, 250, 252, 1),
      inkSoft: RGBA(226, 232, 240, 1),
      inkFaint: RGBA(168, 180, 196, 1),
      line: RGBA(56, 78, 101, 1),
      lineStrong: RGBA(148, 163, 184, 1),
      accent: RGBA(111, 185, 235, 1),
      accentStrong: RGBA(116, 184, 230, 1),
      onAccent: RGBA(4, 14, 28, 1),
      brand: RGBA(96, 170, 220, 1),
      brandSoft: RGBA(44, 68, 93, 1),
      onBrand: RGBA(4, 14, 28, 1),
      attention: RGBA(134, 190, 228, 1),
      attentionSoft: RGBA(44, 68, 93, 1),
      info: RGBA(111, 185, 235, 1),
      infoSoft: RGBA(42, 64, 87, 1),
      danger: RGBA(252, 165, 165, 1),
      dangerSoft: RGBA(72, 68, 85, 1),
      success: RGBA(111, 211, 174, 1),
      successSoft: RGBA(47, 77, 86, 1),
      moss: RGBA(111, 195, 173, 1),
      mossSoft: RGBA(42, 65, 80, 1),
      gold: RGBA(242, 194, 92, 1),
      focus: RGBA(96, 170, 220, 1),
      chart1: RGBA(230, 159, 0, 1),
      chart2: RGBA(86, 180, 233, 1),
      chart3: RGBA(0, 158, 115, 1),
      chart4: RGBA(42, 137, 202, 1),
      chart5: RGBA(214, 95, 2, 1),
      chart6: RGBA(204, 121, 167, 1),
      kaki: RGBA(237, 158, 123, 1),
      kakiSoft: RGBA(84, 51, 41, 1),
      kakiStem: RGBA(211, 233, 246, 1),
      artGround: RGBA(42, 64, 87, 1),
      scrim: RGBA(2, 6, 10, 0.7),
      scrimSoft: RGBA(2, 6, 10, 0.4),
      mediaBackdrop: RGBA(10, 16, 22, 1)
      )
    }
  }
}

/// --textsize の値（pt。1rem = 16pt）。
public enum TokenTextSize {
  public static let textXs: Double = 12
  public static let textSm: Double = 14
  public static let textMd: Double = 16
  public static let textLg: Double = 18
  public static let textXl: Double = 22
  public static let text2xl: Double = 28
  public static let text3xl: Double = 36
  public static let text4xl: Double = 44
}

/// --leading の値（pt。1rem = 16pt）。
public enum TokenLeading {
  public static let leadingBody: Double = 1.75
  public static let leadingUi: Double = 1.5
  public static let leadingHeading: Double = 1.3
  public static let leadingCompact: Double = 1.25
}

/// --weight の値（pt。1rem = 16pt）。
public enum TokenWeight {
  public static let weightRegular: Double = 400
  public static let weightMedium: Double = 600
  public static let weightBold: Double = 700
  public static let weightHeavy: Double = 800
}

/// --space の値（pt。1rem = 16pt）。
public enum TokenSpace {
  public static let space1: Double = 4
  public static let space2: Double = 8
  public static let space3: Double = 12
  public static let space4: Double = 16
  public static let space5: Double = 24
  public static let space6: Double = 32
  public static let space7: Double = 48
  public static let space8: Double = 64
}

/// --radius の値（pt。1rem = 16pt）。
public enum TokenRadius {
  public static let radiusXs: Double = 6
  public static let radiusSm: Double = 10
  public static let radiusMd: Double = 18
  public static let radiusLg: Double = 28
  public static let radiusPill: Double = 999
}

/// --layout の値（pt。1rem = 16pt）。
public enum TokenLayout {
  public static let layoutPageEnd: Double = 120
  public static let layoutTopbar: Double = 84
  public static let layoutTopbarCompact: Double = 70.4
  public static let layoutBottomNav: Double = 73.6
  public static let layoutFab: Double = 52
  public static let layoutFabBottom: Double = 88
  public static let layoutTarget: Double = 44
  public static let layoutTargetPrimary: Double = 48
  public static let layoutSeasonNarrow: Double = 76
  public static let layoutChartShare: Double = 128
  public static let layoutChartYen: Double = 80
  public static let layoutChartCount: Double = 48
  public static let layoutChartName: Double = 48
  public static let layoutChartNameWide: Double = 88
  public static let layoutChartSeries: Double = 44
}

/// --duration の値（pt。1rem = 16pt）。
public enum TokenDuration {
  public static let duration1: Double = 100
  public static let duration2: Double = 150
  public static let duration3: Double = 200
  public static let duration4: Double = 250
  public static let duration5: Double = 300
}
