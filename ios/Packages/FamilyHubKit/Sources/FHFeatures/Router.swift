import Foundation
import FHModel

/// Web の行き先（ヒント・検索・通知の destination）を、アプリの画面と開く記録にする。
enum Router {
  static func route(_ destination: String) -> (ShellTab, AppModel.Focus?)? {
    guard let components = URLComponents(string: destination) else { return nil }
    let parts = components.path.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
    guard let head = parts.first else { return (.today, nil) }
    let id = parts.count > 1 ? parts[1] : nil
    switch head {
    case "tasks": return (.tasks, id.map(AppModel.Focus.task))
    case "notes": return (.notes, id.map(AppModel.Focus.memo))
    case "budget": return (.budget, id.map(AppModel.Focus.expense))
    case "places": return (.places, id.map(AppModel.Focus.place))
    case "albums": return (.albums, id.map(AppModel.Focus.album))
    case "calendar": return (.calendar, nil)
    case "insights": return (.insights, nil)
    case "settings": return (.settings, nil)
    case "today": return (.today, nil)
    default: return nil
    }
  }
}
