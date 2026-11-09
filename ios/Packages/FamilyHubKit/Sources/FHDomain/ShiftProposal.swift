import Foundation
import FHModel

/// 確認の表の1行。id は同じ行を読み直しても変わらない。元: src/domain/shift/proposal.ts。
public struct ShiftProposal: Sendable, Hashable, Identifiable {
  public var row: RosterRow
  public var id: String
  /// すでに同じ予定があるとき。
  public var duplicate: Bool
}

public struct ShiftSaveTarget: Sendable, Hashable {
  public var memberId: Id
  public var workLabelId: String
  public var offLabelId: String
  public var audience: VisibilityAudience
  public var selectedIds: [Id]
  public init(memberId: Id, workLabelId: String, offLabelId: String, audience: VisibilityAudience, selectedIds: [Id] = []) {
    self.memberId = memberId; self.workLabelId = workLabelId; self.offLabelId = offLabelId; self.audience = audience; self.selectedIds = selectedIds
  }
}

public enum ShiftProposals {
  static func times(_ row: RosterRow) -> (startsAt: String, endsAt: String, allDay: Bool) {
    guard row.kind == .work, let start = row.startTime, let end = row.endTime else {
      return ("\(row.date)T00:00:00+09:00", "\(row.date)T23:59:00+09:00", true)
    }
    return ("\(row.date)T\(start):00+09:00", "\(row.endsNextDay ? CalendarLayout.add(row.date, 1) : row.date)T\(end):00+09:00", false)
  }

  public static func make(_ rows: [RosterRow], events: [CalendarEvent], memberId: Id) -> [ShiftProposal] {
    rows.map { row in
      let startsAt = TodayDigest.milliseconds(times(row).startsAt)
      let duplicate = row.kind != .unknown && events.contains { $0.title == row.title && TodayDigest.milliseconds($0.startsAt) == startsAt && $0.participantMembershipIds.contains(memberId) }
      return ShiftProposal(row: row, id: "\(row.date)|\(row.title)|\(row.startTime ?? "")", duplicate: duplicate)
    }
  }

  /// 最初から保存の対象にする行。分からない記号と、すでにある予定は外しておく。
  public static func includedByDefault(_ proposal: ShiftProposal) -> Bool { proposal.row.kind != .unknown && !proposal.duplicate }

  /// 確認した行を予定の入力にする。形は通常の予定の追加と同じ。
  public static func eventInput(_ row: RosterRow, target: ShiftSaveTarget) -> EventInput {
    let span = times(row)
    let label = row.kind == .off ? target.offLabelId : target.workLabelId
    return EventInput(title: row.title, startsAt: span.startsAt, endsAt: span.endsAt, participantMembershipIds: [target.memberId],
                      allDay: span.allDay ? true : nil, colorLabelId: label.isEmpty ? nil : label,
                      visibility: VisibilityInput(audience: target.audience, selectedMembershipIds: target.selectedIds))
  }

  public static func timeText(_ row: RosterRow) -> String {
    if row.kind == .off { return "終日" }
    guard row.kind != .unknown, let start = row.startTime else { return "規則なし" }
    return "\(start)〜\(row.endsNextDay ? "翌" : "")\(row.endTime ?? "")"
  }
}
