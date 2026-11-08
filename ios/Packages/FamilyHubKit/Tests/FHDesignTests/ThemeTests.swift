import Testing
@testable import FHDesign

/// 書き出した10のテーマの色が、Web と同じ濃さの比を満たすこと（src/design-system/themes.test.ts の主な組）。
/// 値は CSS から書き出したものなので、ここでは書き出しの取り違えと、iOS で使う主な組を確かめる。
struct ThemeTests {
  @Test func tenThemes() {
    #expect(ThemeName.allCases.count == 10)
    #expect(ThemeName.allCases.filter(\.isNight).count == 5)
    for palette in ThemePalette.allCases {
      #expect(!palette.theme(night: false).isNight)
      #expect(palette.theme(night: true).isNight)
    }
  }

  @Test(arguments: ThemeName.allCases)
  func textContrast(_ theme: ThemeName) {
    let c = theme.colors
    let surfaces = [c.paper, c.paperDeep, c.sheet, c.sheetRaised]
    for (name, text) in [("ink", c.ink), ("inkSoft", c.inkSoft), ("inkFaint", c.inkFaint), ("accent", c.accent)] {
      for surface in surfaces {
        #expect(text.contrast(with: surface) >= 4.5, "\(theme.rawValue) \(name)")
      }
    }
    #expect(c.onAccent.contrast(with: c.accentStrong) >= 4.5, "\(theme.rawValue) onAccent")
    #expect(c.onBrand.contrast(with: c.brand) >= 4.5, "\(theme.rawValue) onBrand")
    #expect(c.danger.contrast(with: c.sheet) >= 3, "\(theme.rawValue) danger")
    // 夜のテーマは地の方が暗い。
    #expect((c.paper.luminance < c.ink.luminance) == theme.isNight)
  }

  @Test func systemModeFollowsTheDevice() {
    let choice = ThemeChoice(palette: .matcha, mode: .system)
    #expect(choice.theme(systemIsDark: false) == .matcha)
    #expect(choice.theme(systemIsDark: true) == .matchaNight)
    #expect(ThemeChoice(palette: .standard, mode: .night).theme(systemIsDark: false) == .dusk)
  }
}
