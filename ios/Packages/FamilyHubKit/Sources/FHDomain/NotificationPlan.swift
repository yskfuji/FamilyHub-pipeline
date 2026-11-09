import Foundation
import FHModel

/// これから知らせる通知（src/domain/notificationPlan.ts）。端末の通知（ローカル）の予定に使う。
/// ID は記録と回から決まるので、何度作っても同じ通知は増えない。好み・夜間・内容を隠す設定はここでは見ない。
public enum NotificationPlan {
  static let taskLead = 30.0 * 60
  static let horizon = 36.0 * 3600

  /// 9:30、18:00（日本時間。時は0で埋めない）。
  static func clock(_ value: String) -> String {
    guard let date = Tokyo.parse(value) else { return value }
    let parts = Tokyo.components(of: date)
    return "\(parts.hour):\(String(format: "%02d", parts.minute))"
  }

  public static func plan(_ snapshot: HouseholdSnapshot, now nowIso: Rfc3339) -> [HouseholdNotification] {
    guard let now = Tokyo.parse(nowIso), let today = CalendarDate.dateKey(fromRfc3339: nowIso) else { return [] }
    let me = snapshot.viewer.membershipId
    let until = CalendarDate.addDays(today, 2) ?? today
    let inWindow = { (at: Date) in at >= now && at <= now.addingTimeInterval(horizon) }
    var plans: [HouseholdNotification] = []
    for todo in snapshot.todos {
      guard let dueAt = todo.dueAt, todo.status != .done, todo.assigneeMembershipId == me, let due = Tokyo.parse(dueAt) else { continue }
      let remind = due.addingTimeInterval(-taskLead)
      guard inWindow(remind) else { continue }
      plans.append(HouseholdNotification(id: "todoDue:\(todo.id):\(dueAt)", kind: .todoDue, destination: "/tasks/\(todo.id)", title: todo.title, body: "\(clock(dueAt))まで", remindAt: CalendarDate.toJstRfc3339(remind), read: false, status: .active))
    }
    for event in snapshot.events {
      guard let minutes = event.reminderMinutesBefore, event.ownerMembershipId == me || event.participantMembershipIds.contains(me),
            let seriesStart = CalendarDate.dateKey(fromRfc3339: event.startsAt) else { continue }
      let dates = event.recurrence.map { Recurrence.occurrenceDates(start: seriesStart, recurrence: $0, from: today, to: until) } ?? [seriesStart]
      for date in dates {
        let startsAt = Recurrence.occurrenceStartsAt(event.startsAt, on: date)
        guard let start = Tokyo.parse(startsAt) else { continue }
        let remind = start.addingTimeInterval(-Double(minutes) * 60)
        guard inWindow(remind) else { continue }
        plans.append(HouseholdNotification(id: "eventDeparture:\(event.id):\(date)", kind: .eventDeparture, destination: "/calendar/\(event.id)?on=\(date)", title: event.title,
                                           body: "\(clock(startsAt))開始\(event.location.map { $0.isEmpty ? "" : "・\($0)" } ?? "")", remindAt: CalendarDate.toJstRfc3339(remind), read: false, status: .active))
      }
    }
    return plans
  }

  /// 夜間（21時〜翌7時）の通知を7時に寄せる（サーバーの notifications.list と同じ規則）。
  public static func quietHours(_ remindAt: Rfc3339) -> Rfc3339 {
    guard let date = Tokyo.parse(remindAt), let today = CalendarDate.dateKey(fromRfc3339: remindAt) else { return remindAt }
    let hour = Tokyo.components(of: date).hour
    guard hour < 7 || hour >= 21 else { return remindAt }
    let day = hour >= 21 ? (CalendarDate.addDays(today, 1) ?? today) : today
    return "\(day)T07:00:00+09:00"
  }
}
