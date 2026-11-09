import Foundation
import Observation
import FHDesign

/// この端末だけに保存する設定。Web の src/app/devicePreferences.ts と同じ意味（保存は UserDefaults）。家族やアカウントとは共有しない。
@MainActor
@Observable
public final class Preferences {
  private enum Key {
    static let palette = "fh.palette"
    static let colorMode = "fh.colorMode"
    static let memberScope = "fh.memberScope"
    static let connection = "fh.connection"
  }

  @ObservationIgnored private let defaults: UserDefaults

  public var palette: ThemePalette { didSet { defaults.set(palette.rawValue, forKey: Key.palette) } }
  public var colorMode: ColorMode { didSet { defaults.set(colorMode.rawValue, forKey: Key.colorMode) } }
  /// 表示する人（"all"・"me"・メンバーの ID）。
  public var memberScope: String { didSet { defaults.set(memberScope, forKey: Key.memberScope) } }
  /// 最後に選んだ接続先。まだ選んでいなければ nil（はじめの画面を出す）。
  public var connection: ConnectionKind? { didSet { defaults.set(connection?.rawValue, forKey: Key.connection) } }

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    palette = ThemePalette(rawValue: defaults.string(forKey: Key.palette) ?? "") ?? .standard
    // まだ選んでいないときは、端末の昼と夜の設定に従う（Web と同じ）。
    colorMode = ColorMode(rawValue: defaults.string(forKey: Key.colorMode) ?? "") ?? .system
    memberScope = defaults.string(forKey: Key.memberScope).flatMap { $0.isEmpty ? nil : $0 } ?? "all"
    connection = ConnectionKind(rawValue: defaults.string(forKey: Key.connection) ?? "")
  }

  public var themeChoice: ThemeChoice { ThemeChoice(palette: palette, mode: colorMode) }
}

/// 接続先の種類。
public enum ConnectionKind: String, Sendable {
  case sample
  case server
}

/// アプリの起動の設定（Info.plist と起動の引数から決める。FamilyHubApp が渡す）。
public struct LaunchConfiguration: Sendable {
  /// 手元の開発サーバー（Local.xcconfig の FH_DEV_SERVER_URL）。なければ見本だけを使う。
  public var serverURL: URL?
  /// サーバーに送る User-Agent。`FamilyHubApp/<版>` を含める（サーバーが「iPhone アプリ」と表示する）。
  public var userAgent: String
  /// UI の試験: 見本ですぐに始める（-FHSampleMode）。
  public var forceSample: Bool
  /// UI の試験: 保存した設定を消して始める（-FHResetPreferences）。
  public var resetPreferences: Bool

  public init(serverURL: URL?, userAgent: String, forceSample: Bool = false, resetPreferences: Bool = false) {
    self.serverURL = serverURL; self.userAgent = userAgent; self.forceSample = forceSample; self.resetPreferences = resetPreferences
  }
}
