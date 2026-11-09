import Foundation
import CryptoKit
import Security
import FHModel

// 送れなかった変更の待ち行列（Web の src/offline/queue.ts）。
// - 予定・タスク・メモの追加と変更だけを入れる。家計・精算・削除は、つながっているときだけ行う。
// - 中身（何をどう変えるか）は AES-GCM で暗号にし、鍵は Keychain に「この端末だけ・ロック中は読めない」で置く。
// - 誰の・どの家族の・どの権限の版の変更かは暗号の追加データ（AAD）にして、書き換えると読めなくする。
// - 50件まで、24時間で消える。接続が戻っても自動では送らない（利用者が確かめて送る）。

/// 待ち行列に入れられる変更。
public enum QueueableCommand: Codable, Sendable, Hashable {
  case eventCreate(input: EventInput)
  case eventUpdate(id: Id, scope: RecurrenceScope, input: EventUpdateInput, expectedVersion: Int, occurrenceDate: IsoDate?)
  case taskCreate(input: TodoInput)
  case taskUpdate(id: Id, scope: RecurrenceScope, input: TodoUpdateInput, expectedVersion: Int)
  case memoCreate(input: MemoInput)
  case memoUpdate(id: Id, input: MemoUpdateInput, expectedVersion: Int)

  /// Web の operation の名前。
  public var operation: String {
    switch self {
    case .eventCreate: "event.create"
    case .eventUpdate: "event.update"
    case .taskCreate: "task.create"
    case .taskUpdate: "task.update"
    case .memoCreate: "memo.create"
    case .memoUpdate: "memo.update"
    }
  }
}

public enum QueueState: String, Codable, Sendable { case pending, conflicted, blocked }

/// 読み戻した1件。
public struct QueuedCommand: Sendable, Hashable, Identifiable {
  public var id: String
  public var clientOperationId: String
  public var actorUserId: Id
  public var householdId: Id
  public var permissionRevision: Int
  public var createdAt: Double
  public var expiresAt: Double
  public var state: QueueState
  public var summary: String
  public var command: QueueableCommand
}

/// 端末に置く1件。中身は sealed（nonce・暗号・認証タグをつないだもの）。
public struct StoredQueueRecord: Codable, Sendable, Hashable {
  public var id: String
  public var clientOperationId: String
  public var actorUserId: Id
  public var householdId: Id
  public var permissionRevision: Int
  public var operation: String
  public var schemaVersion: Int
  public var createdAt: Double
  public var expiresAt: Double
  public var state: QueueState
  public var sealed: Data

  /// 暗号の追加データ。中身以外の項目を固定の順で JSON にする。
  var additionalData: Data {
    struct Meta: Encodable {
      var id: String, clientOperationId: String, actorUserId: Id, householdId: Id, permissionRevision: Int, operation: String, schemaVersion: Int, createdAt: Double, expiresAt: Double
    }
    return (try? stableEncoder.encode(Meta(id: id, clientOperationId: clientOperationId, actorUserId: actorUserId, householdId: householdId, permissionRevision: permissionRevision, operation: operation, schemaVersion: schemaVersion, createdAt: createdAt, expiresAt: expiresAt))) ?? Data()
  }
}

/// 鍵と記録の置き場所。試験では記憶の中に置く。
public protocol QueueStore: Sendable {
  func key() throws -> SymmetricKey?
  func setKey(_ key: SymmetricKey) throws
  func load() throws -> [StoredQueueRecord]
  func save(_ records: [StoredQueueRecord]) throws
  func clear() throws
}

public enum QueueFailure: Error, Equatable, LocalizedError {
  case full, unreadable, storage
  public var errorDescription: String? {
    switch self {
    case .full: "未送信の変更は50件まで保存できます。不要な項目を削除してください。"
    case .unreadable: "未送信の変更を読み込めませんでした。"
    case .storage: "未送信の変更をこの端末に保存できませんでした。"
    }
  }
}

public actor OfflineQueue {
  public static let maxItems = 50
  public static let lifetime: Double = 24 * 60 * 60 * 1000

  private let store: any QueueStore
  private let now: @Sendable () -> Double

  public init(store: any QueueStore, now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
    self.store = store
    self.now = now
  }

  private func key() throws -> SymmetricKey {
    if let existing = try store.key() { return existing }
    let key = SymmetricKey(size: .bits256)
    try store.setKey(key)
    return key
  }

  /// 期限の切れた記録を除いて、残りを保存し直す。
  private func current() throws -> [StoredQueueRecord] {
    let time = now()
    let all = try store.load()
    let records = all.filter { $0.expiresAt > time }
    if records.count != all.count { try store.save(records) }
    return records
  }

  private struct Plain: Codable { var summary: String; var command: QueueableCommand }

  /// 入れる。clientOperationId を渡すと、それを送り直しの冪等の鍵にする（最初に送ったときと同じ鍵）。
  @discardableResult
  public func enqueue(_ command: QueueableCommand, summary: String, actorUserId: Id, householdId: Id, permissionRevision: Int, clientOperationId: String? = nil) throws -> String {
    let records = try current()
    if records.count >= Self.maxItems { throw QueueFailure.full }
    let created = now()
    var record = StoredQueueRecord(
      id: UUID().uuidString.lowercased(), clientOperationId: clientOperationId ?? UUID().uuidString.lowercased(),
      actorUserId: actorUserId, householdId: householdId, permissionRevision: permissionRevision,
      operation: command.operation, schemaVersion: 1, createdAt: created, expiresAt: created + Self.lifetime, state: .pending, sealed: Data())
    let plain = try JSONEncoder().encode(Plain(summary: summary, command: command))
    guard let sealed = try AES.GCM.seal(plain, using: key(), authenticating: record.additionalData).combined else { throw QueueFailure.storage }
    record.sealed = sealed
    try store.save(records + [record])
    return record.id
  }

  /// 読み戻す。書き換えられた記録や、鍵が合わない記録があれば読めないことを知らせる。
  public func list() throws -> [QueuedCommand] {
    let key = try key()
    return try current().map { record in
      guard let box = try? AES.GCM.SealedBox(combined: record.sealed),
            let plain = try? AES.GCM.open(box, using: key, authenticating: record.additionalData),
            let content = try? JSONDecoder().decode(Plain.self, from: plain) else { throw QueueFailure.unreadable }
      return QueuedCommand(id: record.id, clientOperationId: record.clientOperationId, actorUserId: record.actorUserId, householdId: record.householdId, permissionRevision: record.permissionRevision, createdAt: record.createdAt, expiresAt: record.expiresAt, state: record.state, summary: content.summary, command: content.command)
    }
  }

  public func remove(_ id: String) throws { try store.save(current().filter { $0.id != id }) }

  public func mark(_ id: String, _ state: QueueState) throws {
    try store.save(current().map { record in
      var next = record
      if record.id == id { next.state = state }
      return next
    })
  }

  /// 鍵ごと消す（別の人の記録だったときなど）。
  public func clear() throws { try store.clear() }
}

/// 記憶の中の置き場所（試験と、端末に置けないときの代わり）。
public final class MemoryQueueStore: QueueStore, @unchecked Sendable {
  private let lock = NSLock()
  private var stored: SymmetricKey?
  private var records: [StoredQueueRecord] = []
  public init() {}
  public func key() throws -> SymmetricKey? { lock.withLock { stored } }
  public func setKey(_ key: SymmetricKey) throws { lock.withLock { stored = key } }
  public func load() throws -> [StoredQueueRecord] { lock.withLock { records } }
  public func save(_ records: [StoredQueueRecord]) throws { lock.withLock { self.records = records } }
  public func clear() throws { lock.withLock { records = []; stored = nil } }
}

/// 端末の置き場所。鍵は Keychain（この端末だけ・ロック中は読めない・バックアップに入らない）、
/// 記録は Application Support のファイル（完全な保護・バックアップから外す）。
public final class DeviceQueueStore: QueueStore, @unchecked Sendable {
  private let service = "dev.familyhub.offline-queue"
  private let account = "aes-gcm-256"
  private let file: URL

  public init(folder: URL? = nil) {
    let base = folder ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("fh-offline", isDirectory: true)
    file = base.appendingPathComponent("queue.json")
  }

  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  public func key() throws -> SymmetricKey? {
    var item: CFTypeRef?
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(request as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else { throw QueueFailure.storage }
    return SymmetricKey(data: data)
  }

  public func setKey(_ key: SymmetricKey) throws {
    SecItemDelete(query as CFDictionary)
    var item = query
    item[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw QueueFailure.storage }
  }

  public func load() throws -> [StoredQueueRecord] {
    guard FileManager.default.fileExists(atPath: file.path) else { return [] }
    do { return try JSONDecoder().decode([StoredQueueRecord].self, from: Data(contentsOf: file)) } catch { throw QueueFailure.unreadable }
  }

  public func save(_ records: [StoredQueueRecord]) throws {
    do {
      var folder = file.deletingLastPathComponent()
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? folder.setResourceValues(values)
      #if os(iOS)
      try JSONEncoder().encode(records).write(to: file, options: [.atomic, .completeFileProtection])
      #else
      try JSONEncoder().encode(records).write(to: file, options: [.atomic])
      #endif
    } catch { throw QueueFailure.storage }
  }

  public func clear() throws {
    try? FileManager.default.removeItem(at: file)
    SecItemDelete(query as CFDictionary)
  }
}
