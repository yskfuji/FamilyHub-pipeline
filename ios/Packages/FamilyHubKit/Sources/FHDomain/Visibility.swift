import Foundation
import FHModel
import FHCopy

// 権限の判定と公開範囲の入力。元: src/authz/policy.ts、src/domain/visibilityForm.ts、src/content/ja.ts の audienceLabel など。
// 判定はサーバーが必ず行う。ここは、できない操作のボタンを出さないための写し。

public enum Policy {
  public enum Denial: String, Sendable { case membershipInactive = "MEMBERSHIP_INACTIVE", capabilityDenied = "CAPABILITY_DENIED", scopeDenied = "SCOPE_DENIED" }

  public static func authorize(_ viewer: ViewerContext, _ capability: Capability) -> Denial? {
    if viewer.status != .active { return .membershipInactive }
    return viewer.capabilities.contains(capability) ? nil : .capabilityDenied
  }

  /// 作った人の記録を変えられるか。管理者と大人は誰の記録でも、それ以外は自分の記録だけ。
  public static func canMutateOwned(_ viewer: ViewerContext, _ capability: Capability, ownerMembershipId: Id) -> Bool {
    guard authorize(viewer, capability) == nil else { return false }
    return viewer.role == .owner || viewer.role == .adult || ownerMembershipId == viewer.membershipId
  }

  /// 削除と復元。関わっている人だけができ、管理者でも関わりのない記録は消せない。
  public static func canDelete(_ viewer: ViewerContext, _ capability: Capability, stakeholders: [Id]) -> Bool {
    authorize(viewer, capability) == nil && stakeholders.contains(viewer.membershipId)
  }

  static let allAudiences: [VisibilityAudience] = [.household, .adults, .participants, .creator, .selected]

  /// 自分で選べる公開範囲。子どもメンバーは家族全体や大人向けの範囲を選べない。
  public static func allowedAudiences(_ role: MembershipRole) -> [VisibilityAudience] {
    role == .child ? [.participants, .creator, .selected] : allAudiences
  }
}

public enum SharedKind: String, Sendable { case event, task, memo, album, expense }

public enum Visibility {
  public static let maxSelectedMembers = 8

  static func chooseable(_ role: MembershipRole, _ kind: SharedKind) -> [VisibilityAudience] {
    Policy.allowedAudiences(role).filter { (kind != .memo && kind != .album) || $0 != .participants }
  }

  /// 選べる公開範囲。選べない範囲の記録でも、今の範囲は表示する（変えなければ送らない）。
  public static func choices(_ role: MembershipRole, _ kind: SharedKind, current: VisibilityAudience? = nil) -> [VisibilityAudience] {
    let allowed = chooseable(role, kind)
    if let current, !allowed.contains(current) { return [current] + allowed }
    return allowed
  }

  /// 新しい記録の公開範囲。本人の初期値を選べないときは、選べる最初の範囲にする。
  public static func defaultAudience(_ role: MembershipRole, _ kind: SharedKind, preferred: VisibilityAudience?) -> VisibilityAudience {
    let allowed = chooseable(role, kind)
    return allowed.first { $0 == preferred } ?? allowed[0]
  }

  public static func problem(_ audience: VisibilityAudience, _ selectedIds: [Id]) -> String? {
    if audience == .selected, selectedIds.isEmpty { return "公開する人を1人以上選んでください。" }
    if selectedIds.count > maxSelectedMembers { return "選べるのは\(maxSelectedMembers)人までです。" }
    return nil
  }

  /// 変えたときだけ公開範囲を送る（子どもが選べない範囲の記録を、ほかの項目だけ直せるようにするため）。
  public static func change(_ audience: VisibilityAudience, _ selectedIds: [Id], original: VisibilityPolicy) -> VisibilityInput? {
    let next = VisibilityInput(audience: audience, selectedMembershipIds: selectedIds)
    let before = original.selectedMembershipIds
    let same = audience == original.audience && next.selectedMembershipIds.count == before.count && next.selectedMembershipIds.allSatisfy(before.contains)
    return same ? nil : next
  }

  /// 公開範囲の名前（ja.ts の audienceLabel）。
  public static func label(_ kind: SharedKind, _ audience: VisibilityAudience) -> String {
    let base = Copy.ja.ja.visibility.self
    let fallback: String = switch audience {
    case .household: base.household
    case .adults: base.adults
    case .participants: base.participants
    case .creator: base.creator
    case .selected: base.selected
    default: audience.rawValue
    }
    return labelOverride(kind, audience) ?? fallback
  }

  /// 公開範囲の説明（ja.ts の audienceHelp）。
  public static func help(_ kind: SharedKind, _ audience: VisibilityAudience) -> String {
    let base = Copy.ja.ja.visibilityHelp.self
    let fallback: String = switch audience {
    case .household: base.household
    case .adults: base.adults
    case .participants: base.participants
    case .creator: base.creator
    case .selected: base.selected
    default: ""
    }
    return helpOverride(kind, audience) ?? fallback
  }

  /// 記録の種類ごとの言い換え（ja.visibilityFor）。予定には言い換えがない。
  static func labelOverride(_ kind: SharedKind, _ audience: VisibilityAudience) -> String? {
    let table = Copy.ja.ja.visibilityFor.self
    switch (kind, audience) {
    case (.task, .participants): return table.task.labels.participants
    case (.expense, .participants): return table.expense.labels.participants
    default: return nil
    }
  }

  static func helpOverride(_ kind: SharedKind, _ audience: VisibilityAudience) -> String? {
    let table = Copy.ja.ja.visibilityFor.self
    switch (kind, audience) {
    case (.task, .household): return table.task.help.household
    case (.task, .participants): return table.task.help.participants
    case (.memo, .household): return table.memo.help.household
    case (.album, .household): return table.album.help.household
    case (.expense, .household): return table.expense.help.household
    case (.expense, .participants): return table.expense.help.participants
    default: return nil
    }
  }
}
