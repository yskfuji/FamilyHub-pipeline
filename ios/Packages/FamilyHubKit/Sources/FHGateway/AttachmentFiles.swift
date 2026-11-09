import Foundation
import FHModel

/// 開くために取った添付のファイルの置き場所。端末の Caches の中の fh-attachments に、ファイルの保護をかけて置く。
/// サインアウトとアプリの起動のときに消す（家族の記録を、使い終わった後まで端末に残さない）。
public enum AttachmentFiles {
  public static let unavailable = GatewayError(code: .notFound, message: "ファイルを開けませんでした。閉じてから、もう一度開いてください。", retryable: true)

  public static var directory: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("fh-attachments", isDirectory: true)
  }

  /// ファイルの名前を、そのまま置ける形にする。道の区切りや見えない文字は外し、元の名前が分かるように残す。
  public static func safeName(_ name: String) -> String {
    let cleaned = String(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && $0 != "/" && $0 != ":" && $0 != "\\" })
      .trimmingCharacters(in: .whitespaces)
    let trimmed = cleaned.hasPrefix(".") ? String(cleaned.drop { $0 == "." }) : cleaned
    return trimmed.isEmpty ? "file" : String(trimmed.prefix(200))
  }

  /// 取るたびに別の小さな入れ物を作り、同じ名前のファイルが重ならないようにする。
  public static func destination(for name: String) -> URL {
    directory.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent(safeName(name))
  }

  static func place(_ file: URL, at destination: URL) throws {
    let manager = FileManager.default
    let folder = destination.deletingLastPathComponent()
    try manager.createDirectory(at: folder, withIntermediateDirectories: true, attributes: protection)
    if manager.fileExists(atPath: destination.path) { try manager.removeItem(at: destination) }
    try manager.moveItem(at: file, to: destination)
    if let protection { try? manager.setAttributes(protection, ofItemAtPath: destination.path) }
  }

  private static var protection: [FileAttributeKey: Any]? {
    #if os(iOS)
    [.protectionKey: FileProtectionType.completeUnlessOpen]
    #else
    nil
    #endif
  }

  /// 取ったファイルをすべて消す。
  public static func clear() {
    try? FileManager.default.removeItem(at: directory)
  }
}
