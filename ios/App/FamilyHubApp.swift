import SwiftUI
import FHDesign
import FHFeatures
import FHGateway

/// よりどころの iOS アプリ。段階 S0 は見本の家族（サーバーなし）で動く。
@main
struct FamilyHubApp: App {
  @State private var model: AppModel?
  @State private var startupError: String?

  init() {
    do {
      _model = State(initialValue: AppModel(gateway: try SampleGateway()))
    } catch {
      _startupError = State(initialValue: "見本のデータを読み込めませんでした。（\(error)）")
    }
  }

  var body: some Scene {
    WindowGroup {
      if let model {
        ThemedRoot(choice: model.themeChoice) {
          SampleTodayView()
        }
        .environment(model)
      } else {
        Text(startupError ?? "")
          .padding()
      }
    }
  }
}
