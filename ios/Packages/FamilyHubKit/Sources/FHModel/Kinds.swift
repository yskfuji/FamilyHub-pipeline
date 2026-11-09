// 文字列の値の集まり。元: src/domain/types.ts、src/domain/auditLog.ts、src/domain/assistant.ts、src/domain/captureTime.ts

public struct GatewayErrorCode: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let unauthenticated: Self = "UNAUTHENTICATED"
  public static let forbidden: Self = "FORBIDDEN"
  public static let notFound: Self = "NOT_FOUND"
  public static let reauthRequired: Self = "REAUTH_REQUIRED"
  public static let invalidInput: Self = "INVALID_INPUT"
  public static let conflict: Self = "CONFLICT"
  public static let offline: Self = "OFFLINE"
  public static let rateLimited: Self = "RATE_LIMITED"
  public static let upstreamFailure: Self = "UPSTREAM_FAILURE"
  public static let attachmentRejected: Self = "ATTACHMENT_REJECTED"
}

public struct GatewayErrorReason: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let capabilityMissing: Self = "CAPABILITY_MISSING"
  public static let scopeDenied: Self = "SCOPE_DENIED"
  public static let membershipInactive: Self = "MEMBERSHIP_INACTIVE"
  public static let ownerRequired: Self = "OWNER_REQUIRED"
  public static let version: Self = "VERSION"
  public static let permissionRevision: Self = "PERMISSION_REVISION"
  public static let idempotency: Self = "IDEMPOTENCY"
  public static let csrf: Self = "CSRF"
  public static let reauthFailed: Self = "REAUTH_FAILED"
  public static let sessionExpired: Self = "SESSION_EXPIRED"
}

public struct MembershipRole: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let owner: Self = "owner"
  public static let adult: Self = "adult"
  public static let child: Self = "child"
  public static let guest: Self = "guest"
}

public struct MembershipStatus: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let active: Self = "active"
  public static let invited: Self = "invited"
  public static let suspended: Self = "suspended"
  public static let left: Self = "left"
}

public struct Capability: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let membersRead: Self = "household.members.read"
  public static let membersManage: Self = "household.members.manage"
  public static let invitesManage: Self = "household.invites.manage"
  public static let eventRead: Self = "event.read"
  public static let eventCreate: Self = "event.create"
  public static let eventUpdate: Self = "event.update"
  public static let eventDelete: Self = "event.delete"
  public static let taskRead: Self = "task.read"
  public static let taskCreate: Self = "task.create"
  public static let taskUpdate: Self = "task.update"
  public static let taskDelete: Self = "task.delete"
  public static let taskTransition: Self = "task.transition"
  public static let memoRead: Self = "memo.read"
  public static let memoCreate: Self = "memo.create"
  public static let memoUpdate: Self = "memo.update"
  public static let memoDelete: Self = "memo.delete"
  public static let memoAttach: Self = "memo.attach"
  public static let expenseRead: Self = "expense.read"
  public static let expenseCreate: Self = "expense.create"
  public static let expenseUpdate: Self = "expense.update"
  public static let expenseDelete: Self = "expense.delete"
  public static let expenseSettle: Self = "expense.settle"
  public static let albumRead: Self = "album.read"
  public static let albumCreate: Self = "album.create"
  public static let albumUpdate: Self = "album.update"
  public static let albumDelete: Self = "album.delete"
  public static let linkManage: Self = "link.manage"
  public static let assistantUse: Self = "assistant.use"
  public static let placeRead: Self = "place.read"
  public static let insightRead: Self = "insight.read"
  public static let resourceRead: Self = "resource.read"
  public static let settingsOwn: Self = "settings.own"
  public static let notificationManage: Self = "notification.manage"
  public static let auditRead: Self = "audit.read"
}

public struct VisibilityAudience: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let household: Self = "household"
  public static let adults: Self = "adults"
  public static let participants: Self = "participants"
  public static let creator: Self = "creator"
  public static let selected: Self = "selected"
}

public struct RecurrenceScope: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let this: Self = "this"
  public static let future: Self = "future"
  public static let series: Self = "series"
}

public struct TodoStatus: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let open: Self = "open"
  public static let doing: Self = "doing"
  public static let review: Self = "review"
  public static let waiting: Self = "waiting"
  public static let done: Self = "done"
}

public struct TodoPriority: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let low: Self = "low"
  public static let normal: Self = "normal"
  public static let high: Self = "high"
}

public struct AttachmentStatus: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let selected: Self = "selected"
  public static let validating: Self = "validating"
  public static let quarantined: Self = "quarantined"
  public static let clean: Self = "clean"
  public static let rejected: Self = "rejected"
}

public struct PlaceCaptureSource: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let device: Self = "device"
  public static let photo: Self = "photo"
  public static let search: Self = "search"
  public static let manual: Self = "manual"
}

public struct BgmPreset: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let calm: Self = "calm"
  public static let bright: Self = "bright"
  public static let gentle: Self = "gentle"
}

public struct AlbumItemStatus: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let uploading: Self = "uploading"
  public static let processing: Self = "processing"
  public static let ready: Self = "ready"
  public static let rejected: Self = "rejected"
}

public struct MediaKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let photo: Self = "photo"
  public static let video: Self = "video"
}

public struct TakenAtSource: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let exifOffset: Self = "exif-offset"
  public static let exifLocal: Self = "exif-local"
  public static let quicktimeKey: Self = "quicktime-key"
  public static let mvhd: Self = "mvhd"
}

public struct ExpenseKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let expense: Self = "expense"
  public static let income: Self = "income"
}

/// 支出の分類（SpendingCategory）と収入の分類（IncomeCategory、income_ で始まる）。
public struct ExpenseCategory: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public var isIncome: Bool { rawValue.hasPrefix("income_") }
  public static let spending: [Self] = ["food", "dining", "transport", "utilities", "home", "education", "health", "entertainment", "shopping", "savings", "other"]
  public static let income: [Self] = ["income_salary", "income_bonus", "income_side", "income_investment", "income_gift", "income_other"]
}

public struct ResourceKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let school: Self = "school"
  public static let municipality: Self = "municipality"
  public static let document: Self = "document"
  public static let other: Self = "other"
}

public struct LinkedItemKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let event: Self = "event"
  public static let task: Self = "task"
  public static let memo: Self = "memo"
  public static let expense: Self = "expense"
}

public struct WeatherCondition: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let sunny: Self = "sunny"
  public static let rain: Self = "rain"
  public static let storm: Self = "storm"
}

public struct SyncState: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let synced: Self = "synced"
  public static let offline: Self = "offline"
  public static let syncing: Self = "syncing"
}

public struct Confidence: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let high: Self = "high"
  public static let medium: Self = "medium"
  public static let low: Self = "low"
}

public struct NotificationKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let todoDue: Self = "todoDue"
  public static let eventDeparture: Self = "eventDeparture"
}

public struct NotificationStatus: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let active: Self = "active"
  public static let snoozed: Self = "snoozed"
  public static let stopped: Self = "stopped"
}

public struct SessionStage: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let signedOut: Self = "signed-out"
  public static let householdSetup: Self = "household-setup"
  public static let suspended: Self = "suspended"
  public static let paywall: Self = "paywall"
  public static let active: Self = "active"
}

public struct TrashKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let event: Self = "event"
  public static let task: Self = "task"
  public static let memo: Self = "memo"
  public static let expense: Self = "expense"
  public static let album: Self = "album"
  public static let photo: Self = "photo"
  public static let occurrence: Self = "occurrence"
}

public struct AvatarTone: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let persimmon: Self = "persimmon"
  public static let indigo: Self = "indigo"
  public static let moss: Self = "moss"
  public static let plum: Self = "plum"
}

public struct AuditGroup: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
}

public struct AuditTargetKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
}

public struct AssistantJobKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let receipt: Self = "receipt"
  public static let event: Self = "event"
}

public struct AssistantJobStatus: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let queued: Self = "queued"
  public static let running: Self = "running"
  public static let done: Self = "done"
  public static let failed: Self = "failed"
}

public struct SearchResultKind: OpenValue {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
}
