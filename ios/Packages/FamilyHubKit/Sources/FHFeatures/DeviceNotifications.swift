import Foundation
import UserNotifications
import FHModel
import FHDomain

/// この端末の通知（ローカル）。家族の通知の一覧と、記録から作った予定（NotificationPlan）を合わせて、端末に予約する。
/// - 利用者が「この端末にも通知する」を選んだときだけ、許可を求めて予約する（Web にはない。ブラウザは通知を出さない）。
/// - 通知の好み（タスク・予定）と夜間（21時〜翌7時は7時にまとめる）に従い、止めた通知は予約しない。
/// - 内容を隠す設定なら、題名と内容を出さない。
/// - サインアウトで、予約も届いた分もすべて消す。
@MainActor
enum DeviceNotifications {
  static let key = "fh.deviceNotifications"
  static let prefix = "fh."
  static var enabled: Bool {
    get { UserDefaults.standard.bool(forKey: key) }
    set { UserDefaults.standard.set(newValue, forKey: key) }
  }

  /// 許可を求めて、使うことにする。許可されなければ false。
  static func enable() async -> Bool {
    let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    enabled = granted
    return granted
  }

  static func disable() {
    enabled = false
    clear()
  }

  static func clear() {
    let center = UNUserNotificationCenter.current()
    center.removeAllPendingNotificationRequests()
    center.removeAllDeliveredNotifications()
  }

  /// 予約するもの。一覧にあるものを優先し、一覧にない予定は記録から作る。
  nonisolated static func schedule(listed: [HouseholdNotification], snapshot: HouseholdSnapshot?, preferences: NotificationPreferences?, now: Rfc3339) -> [HouseholdNotification] {
    let planned = snapshot.map { NotificationPlan.plan($0, now: now) } ?? []
    let listedIds = Set(listed.map(\.id))
    let wanted = { (item: HouseholdNotification) in
      guard let preferences else { return true }
      return item.kind == .todoDue ? preferences.todoDue : item.kind == .eventDeparture ? preferences.eventDeparture : true
    }
    let all = listed + planned.filter { !listedIds.contains($0.id) && wanted($0) }
    return all.filter { $0.status != .stopped }.map { item in
      var next = item
      if preferences?.quietHours ?? true { next.remindAt = NotificationPlan.quietHours(item.remindAt) }
      return next
    }
  }

  /// 予約をし直す。
  static func sync(_ model: AppModel) async {
    guard enabled, model.can(.notificationManage) else { return }
    let center = UNUserNotificationCenter.current()
    guard await center.notificationSettings().authorizationStatus == .authorized else { return }
    let preferences = try? await model.gateway.getNotificationPreferences().get()
    let now = CalendarDate.toJstRfc3339(Date())
    let items = schedule(listed: model.notifications, snapshot: model.snapshot, preferences: preferences, now: now)
    let hide = model.privacy?.hideNotificationContent ?? true
    center.removeAllPendingNotificationRequests()
    for item in items {
      guard let at = Tokyo.parse(item.remindAt), at > Date() else { continue }
      let content = UNMutableNotificationContent()
      if hide {
        content.title = item.kind == .todoDue ? "タスクのお知らせ" : "予定のお知らせ"
        content.body = "内容は表示しない設定です。開くと題名と内容を確認できます。"
      } else {
        content.title = item.title
        content.body = item.body
      }
      content.sound = .default
      content.userInfo = ["destination": item.destination]
      let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, at.timeIntervalSinceNow), repeats: false)
      try? await center.add(UNNotificationRequest(identifier: prefix + item.id, content: content, trigger: trigger))
    }
  }
}

/// 端末の通知を押したとき、その記録を開く。
final class NotificationOpener: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
  static let shared = NotificationOpener()
  @MainActor weak var model: AppModel?

  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    guard let destination = response.notification.request.content.userInfo["destination"] as? String else { return }
    await MainActor.run { model?.open(destination: destination) }
  }

  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound] }
}
