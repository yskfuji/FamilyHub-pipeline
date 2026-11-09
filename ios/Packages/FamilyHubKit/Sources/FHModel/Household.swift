// 家族の記録の型。元: src/domain/types.ts。欄の名前と、省ける欄（?）・null になる欄は Web と同じにする。

public struct GatewayError: Codable, Sendable, Hashable, Error {
  public var code: GatewayErrorCode
  public var message: String
  public var retryable: Bool
  public var fieldErrors: [String: String]?
  public var reason: GatewayErrorReason?
  public init(code: GatewayErrorCode, message: String, retryable: Bool, fieldErrors: [String: String]? = nil, reason: GatewayErrorReason? = nil) {
    self.code = code; self.message = message; self.retryable = retryable; self.fieldErrors = fieldErrors; self.reason = reason
  }
}

public struct User: Codable, Sendable, Hashable {
  public var id: Id
  public var displayName: String
  public var email: String
  public var avatarTone: AvatarTone
}

public struct Household: Codable, Sendable, Hashable {
  public var id: Id
  public var name: String
  public var timezone: String
  public var nameChanges: [Rfc3339]?
}

public struct PermissionOverride: Codable, Sendable, Hashable {
  public var membershipId: Id
  public var capability: Capability
  public var effect: String
}

public struct ViewerContext: Codable, Sendable, Hashable {
  public var userId: Id
  public var membershipId: Id
  public var role: MembershipRole
  public var status: MembershipStatus
  public var capabilities: [Capability]
  public var permissionRevision: Int
}

public struct VisibilityPolicy: Codable, Sendable, Hashable {
  public var audience: VisibilityAudience
  public var creatorMembershipId: Id
  public var selectedMembershipIds: [Id]
  public init(audience: VisibilityAudience, creatorMembershipId: Id, selectedMembershipIds: [Id] = []) {
    self.audience = audience; self.creatorMembershipId = creatorMembershipId; self.selectedMembershipIds = selectedMembershipIds
  }
}

public struct HouseholdMembership: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var userId: Id
  public var displayName: String
  public var role: MembershipRole
  public var status: MembershipStatus
  public var color: String
  public var version: Int
}

public struct RecurrenceRule: Codable, Sendable, Hashable {
  public var rrule: String
  public var timezone: String
  public var exceptions: [IsoDate]
  public init(rrule: String, timezone: String = "Asia/Tokyo", exceptions: [IsoDate] = []) {
    self.rrule = rrule; self.timezone = timezone; self.exceptions = exceptions
  }
}

public struct CalendarEvent: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var title: String
  public var startsAt: Rfc3339
  public var endsAt: Rfc3339
  public var timezone: String
  public var allDay: Bool?
  public var colorLabelId: Id?
  public var reminderMinutesBefore: Int?
  public var ownerMembershipId: Id
  public var participantMembershipIds: [Id]
  public var location: String?
  public var recurrence: RecurrenceRule?
  public var resourceIds: [Id]?
  public var note: String?
  public var weatherSensitive: Bool?
  public var version: Int
  public var visibility: VisibilityPolicy
  public var deletedAt: Rfc3339?
}

public struct Todo: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var title: String
  public var dueAt: Rfc3339?
  public var dueStartAt: Rfc3339?
  public var status: TodoStatus
  public var priority: TodoPriority?
  public var colorLabelId: Id?
  public var handoffNote: String?
  public var completionNote: String?
  public var assigneeMembershipId: Id
  public var reviewerMembershipId: Id?
  public var creatorMembershipId: Id
  public var recurrence: RecurrenceRule?
  public var version: Int
  public var note: String?
  public var visibility: VisibilityPolicy
  public var deletedAt: Rfc3339?
}

public struct Attachment: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var memoId: Id
  public var originalName: String
  public var mimeType: String
  public var byteSize: Int
  public var status: AttachmentStatus
  public var statusMessage: String
}

public struct PlaceProvenance: Codable, Sendable, Hashable {
  public var provider: String
  public var source: String
  public var licenses: [String]
  public var attributions: [String]
  public init(provider: String, source: String, licenses: [String], attributions: [String]) { self.provider = provider; self.source = source; self.licenses = licenses; self.attributions = attributions }
}

public struct Coordinates: Codable, Sendable, Hashable {
  public var lat: Double
  public var lng: Double
  public init(lat: Double, lng: Double) { self.lat = lat; self.lng = lng }
}

/// 利用者が選んだ場所。端末や写真から得た利用者自身の座標は含めない。
public struct PlaceRef: Codable, Sendable, Hashable {
  public var name: String
  public var address: String?
  public var coordinates: Coordinates?
  public var category: String?
  public var provenance: PlaceProvenance?
  public var capturedVia: PlaceCaptureSource
  public var selectedAt: Rfc3339
  public init(name: String, address: String? = nil, coordinates: Coordinates? = nil, category: String? = nil, provenance: PlaceProvenance? = nil, capturedVia: PlaceCaptureSource, selectedAt: Rfc3339) {
    self.name = name; self.address = address; self.coordinates = coordinates; self.category = category; self.provenance = provenance; self.capturedVia = capturedVia; self.selectedAt = selectedAt
  }
}

public struct Memo: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var title: String
  public var body: String
  public var updatedAt: Rfc3339
  public var memoDate: IsoDate?
  public var authorMembershipId: Id
  public var tags: [String]
  public var attachments: [Attachment]
  public var ocrText: String?
  public var place: PlaceRef?
  public var visibility: VisibilityPolicy
  public var deletedAt: Rfc3339?
  public var version: Int
}

public struct Album: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var title: String
  public var description: String?
  public var coverItemId: Id?
  public var place: PlaceRef?
  public var bgmPreset: BgmPreset?
  public var creatorMembershipId: Id
  public var visibility: VisibilityPolicy
  public var createdAt: Rfc3339
  public var version: Int
  public var deletedAt: Rfc3339?
}

public struct AlbumItem: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var albumId: Id
  public var householdId: Id
  public var kind: MediaKind
  public var originalName: String
  public var mimeType: String
  public var byteSize: Int
  public var width: Int?
  public var height: Int?
  public var takenAt: Rfc3339?
  public var takenAtSource: TakenAtSource?
  public var sha256: String?
  public var status: AlbumItemStatus
  public var statusMessage: String?
  public var locationKept: Bool
  public var hasThumbnail: Bool
  public var uploaderMembershipId: Id
  public var position: Int
  public var createdAt: Rfc3339
  public var deletedAt: Rfc3339?
}

/// アルバムの一覧の1件（Album に件数と表紙の URL を足したもの）。
public struct AlbumSummary: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var title: String
  public var description: String?
  public var coverItemId: Id?
  public var place: PlaceRef?
  public var bgmPreset: BgmPreset?
  public var creatorMembershipId: Id
  public var visibility: VisibilityPolicy
  public var createdAt: Rfc3339
  public var version: Int
  public var deletedAt: Rfc3339?
  public var itemCount: Int
  public var coverUrl: String?
}

public struct AlbumDetail: Codable, Sendable, Hashable {
  public var album: Album
  public var items: [AlbumItem]
}

public struct ExpenseShare: Codable, Sendable, Hashable {
  public var membershipId: Id
  public var amountJpy: Int
  public var settledJpy: Int
  public init(membershipId: Id, amountJpy: Int, settledJpy: Int) { self.membershipId = membershipId; self.amountJpy = amountJpy; self.settledJpy = settledJpy }
}

public struct SettlementRecord: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var amountJpy: Int
  public var fromMembershipId: Id
  public var toMembershipId: Id
  public var recordedAt: Rfc3339
  public var reversedAt: Rfc3339?
  public var reversalOfSettlementId: Id?
  public var batchId: Id?
}

public struct SettlementTransfer: Codable, Sendable, Hashable {
  public var from: Id
  public var to: Id
  public var amountJpy: Int
  public init(from: Id, to: Id, amountJpy: Int) { self.from = from; self.to = to; self.amountJpy = amountJpy }
}

public struct SettlementBatchItem: Codable, Sendable, Hashable {
  public var expenseId: Id
  public var membershipId: Id
  public var amountJpy: Int
  public var settlementId: Id
}

public struct SettlementBatch: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var recordedAt: Rfc3339
  public var recordedByMembershipId: Id
  public var transfers: [SettlementTransfer]
  public var items: [SettlementBatchItem]
  public var reversedAt: Rfc3339?
}

public struct Expense: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var kind: ExpenseKind
  public var title: String
  public var amountJpy: Int
  public var incurredOn: IsoDate
  public var payerMembershipId: Id
  public var creatorMembershipId: Id
  public var category: ExpenseCategory
  public var shares: [ExpenseShare]
  public var settlements: [SettlementRecord]
  public var note: String?
  public var place: PlaceRef?
  public var visibility: VisibilityPolicy
  public var version: Int
  public var deletedAt: Rfc3339?
}

public struct ResourceLink: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var label: String
  public var url: String
  public var kind: ResourceKind
  public var relatedEntityId: Id?
  public var visibility: VisibilityPolicy
}

public struct LinkedItemRef: Codable, Sendable, Hashable {
  public var kind: LinkedItemKind
  public var id: Id
}

public struct ItemLink: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var from: LinkedItemRef
  public var to: LinkedItemRef
  public var createdByMembershipId: Id
  public var createdAt: Rfc3339
}

public struct ColorLabel: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var name: String
  public var color: String
}

public struct Weather: Codable, Sendable, Hashable {
  public var location: String
  public var condition: WeatherCondition
  public var temperatureC: Double
  public var precipitationPercent: Double
  public var alert: String?
  public var unavailable: Bool?
}

public struct Holiday: Codable, Sendable, Hashable {
  public var date: IsoDate
  public var name: String
}

public struct SyncStatus: Codable, Sendable, Hashable {
  public var state: SyncState
  public var lastSyncedAt: Rfc3339
}

public struct ContextSnapshot: Codable, Sendable, Hashable {
  public var asOf: Rfc3339
  public var timezone: String
  public var weather: Weather
  public var holidays: [Holiday]
  public var sync: SyncStatus
}

/// 見る人ごとにサーバーが絞った、家族の記録の全体（GET /v1/households/current/snapshot）。
public struct HouseholdSnapshot: Codable, Sendable, Hashable {
  public var viewer: ViewerContext
  public var permissionOverrides: [PermissionOverride]
  public var user: User
  public var household: Household
  public var memberships: [HouseholdMembership]
  public var events: [CalendarEvent]
  public var todos: [Todo]
  public var memos: [Memo]
  public var expenses: [Expense]
  public var settlementBatches: [SettlementBatch]
  public var resources: [ResourceLink]
  public var links: [ItemLink]
  public var colorLabels: [ColorLabel]
  public var context: ContextSnapshot

  public func can(_ capability: Capability) -> Bool { viewer.capabilities.contains(capability) }
  public func member(_ id: Id) -> HouseholdMembership? { memberships.first { $0.id == id } }
}

public struct Insight: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var title: String
  public var summary: String
  public var evidence: String
  public var actionLabel: String
  public var destination: String
  public var confidence: Confidence
}

public struct HouseholdInvite: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var householdId: Id
  public var role: MembershipRole
  public var token: String?
  public var expiresAt: Rfc3339
  public var remainingUses: Int
  public var revokedAt: Rfc3339?
}

public struct Authenticator: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var label: String
  public var createdAt: Rfc3339
  public var kind: String
  public var demo: Bool
}

public struct DeviceSession: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var label: String
  public var location: String
  public var lastSeenAt: Rfc3339
  public var current: Bool
}

public struct SecurityOverview: Codable, Sendable, Hashable {
  public var authenticators: [Authenticator]
  public var sessions: [DeviceSession]
}

public struct PlaceLookupConsent: Codable, Sendable, Hashable {
  public var noticeVersion: String
  public var grantedAt: Rfc3339
  public init(noticeVersion: String, grantedAt: Rfc3339) { self.noticeVersion = noticeVersion; self.grantedAt = grantedAt }
}

public struct PrivacySettings: Codable, Sendable, Hashable {
  public var defaultAudience: VisibilityAudience
  public var hideNotificationContent: Bool
  @Nullable public var placeLookupConsent: PlaceLookupConsent?
  public init(defaultAudience: VisibilityAudience, hideNotificationContent: Bool, placeLookupConsent: PlaceLookupConsent?) {
    self.defaultAudience = defaultAudience; self.hideNotificationContent = hideNotificationContent; self.placeLookupConsent = placeLookupConsent
  }
}

public struct NotificationPreferences: Codable, Sendable, Hashable {
  public var todoDue: Bool
  public var eventDeparture: Bool
  public var quietHours: Bool
}

public struct HouseholdNotification: Codable, Sendable, Hashable, Identifiable {
  public var id: Id
  public var kind: NotificationKind
  public var destination: String
  public var title: String
  public var body: String
  public var remindAt: Rfc3339
  public var read: Bool
  public var status: NotificationStatus
  public init(id: Id, kind: NotificationKind, destination: String, title: String, body: String, remindAt: Rfc3339, read: Bool, status: NotificationStatus) {
    self.id = id; self.kind = kind; self.destination = destination; self.title = title; self.body = body; self.remindAt = remindAt; self.read = read; self.status = status
  }
}

public struct SessionInfo: Codable, Sendable, Hashable {
  public var stage: SessionStage
  public var userId: Id?
  public var idleTimeoutMinutes: Int
  public init(stage: SessionStage, userId: Id? = nil, idleTimeoutMinutes: Int) {
    self.stage = stage; self.userId = userId; self.idleTimeoutMinutes = idleTimeoutMinutes
  }
}

/// 顔の印。initial（名前の頭文字）、preset（用意した絵）、image（画像の data URL）。
public enum Avatar: Codable, Sendable, Hashable {
  case initial
  case preset(String)
  case image(dataUrl: String)

  private enum Keys: String, CodingKey { case kind, preset, dataUrl }
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    switch try container.decode(String.self, forKey: .kind) {
    case "preset": self = .preset(try container.decode(String.self, forKey: .preset))
    case "image": self = .image(dataUrl: try container.decode(String.self, forKey: .dataUrl))
    default: self = .initial
    }
  }
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    switch self {
    case .initial: try container.encode("initial", forKey: .kind)
    case .preset(let preset): try container.encode("preset", forKey: .kind); try container.encode(preset, forKey: .preset)
    case .image(let dataUrl): try container.encode("image", forKey: .kind); try container.encode(dataUrl, forKey: .dataUrl)
    }
  }
}

public struct AccountProfile: Codable, Sendable, Hashable {
  public var displayName: String
  public var email: String
  public var avatar: Avatar
  public var idleTimeoutMinutes: Int
  public var birthdateDeclared: Bool
  public var adultDeclared: Bool
  public var totpEnabled: Bool
  public var totpUnavailable: Bool
}

public struct TrashItem: Codable, Sendable, Hashable {
  public var kind: TrashKind
  public var id: Id
  public var parentId: Id?
  public var occurrenceDate: IsoDate?
  public var title: String
  public var deletedAt: Rfc3339
}

public struct SearchResult: Codable, Sendable, Hashable {
  public var kind: SearchResultKind
  public var id: Id
  public var label: String
  public var detail: String?
  public var destination: String
}

public struct MutationContext: Codable, Sendable, Hashable {
  public var idempotencyKey: String
  public var expectedPermissionRevision: Int
  public init(idempotencyKey: String, expectedPermissionRevision: Int) {
    self.idempotencyKey = idempotencyKey; self.expectedPermissionRevision = expectedPermissionRevision
  }
}
