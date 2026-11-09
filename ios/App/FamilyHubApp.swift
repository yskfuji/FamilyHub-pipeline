import SwiftUI
import UIKit
import FHFeatures

/// よりどころの iOS アプリ（iPhone と iPad）。見本の家族（サーバーなし）か、手元の開発サーバーにつなぐ。
@main
struct FamilyHubApp: App {
  private let configuration: LaunchConfiguration

  init() {
    let info = Bundle.main.infoDictionary ?? [:]
    let version = info["CFBundleShortVersionString"] as? String ?? "0"
    // Local.xcconfig の FH_DEV_SERVER_URL。空なら見本だけを使う。
    let server = (info["FHDevServerURL"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
    let device = UIDevice.current
    let idiom = device.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
    let arguments = ProcessInfo.processInfo.arguments
    configuration = LaunchConfiguration(
      serverURL: server,
      // サーバーはこの印で、サインイン中の端末の一覧に「iPhone アプリ」と出す（server/auth/deviceLabel.ts）。
      userAgent: "Yoridokoro/\(version) (\(idiom); iOS \(device.systemVersion)) FamilyHubApp/\(version)",
      forceSample: arguments.contains("-FHSampleMode"),
      resetPreferences: arguments.contains("-FHResetPreferences")
    )
  }

  var body: some Scene {
    WindowGroup {
      FamilyHubRoot(configuration: configuration)
    }
  }
}
