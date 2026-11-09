import Foundation
import FHModel

/// 送るファイル（写真や動画）。大きいので記憶には読み込まず、端末の中のファイルを少しずつ読む。
public struct UploadSource: Sendable, Hashable {
  public var name: String
  public var type: String
  public var size: Int
  public var url: URL
  public init(name: String, type: String, size: Int, url: URL) { self.name = name; self.type = type; self.size = size; self.url = url }

  /// offset から最大 length バイト。
  func chunk(at offset: Int, length: Int) throws -> Data {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    try handle.seek(toOffset: UInt64(offset))
    return try handle.read(upToCount: length) ?? Data()
  }
}

/// 送信の続き。途切れたときは同じ枠の続きから送る（枠を作り直すと、同時に送れる3件を使い切る）。
public actor UploadTicket {
  public private(set) var albumId: Id?
  public private(set) var uploadId: Id?
  public private(set) var itemId: Id?
  public init() {}
  func open(albumId: Id, uploadId: Id, itemId: Id) { self.albumId = albumId; self.uploadId = uploadId; self.itemId = itemId }
  func close() { albumId = nil; uploadId = nil; itemId = nil }
}

/// 写真や動画の種類（Web の mediaUrl の variant）。
public enum MediaVariant: String, Sendable { case thumbnail, file }

/// 写真や動画のある場所。
public enum MediaSource: Sendable, Hashable {
  /// サーバーの道（同じセッションの cookie で取る）。
  case server(path: String)
  /// 見本の写真（アプリが同じ色を描く）。id は項目の ID。
  case sampleArt(id: Id)
  /// この端末の中のファイル（見本で送ったもの）。
  case local(URL)
}

public typealias UploadProgress = @Sendable (_ sent: Int, _ total: Int) -> Void
