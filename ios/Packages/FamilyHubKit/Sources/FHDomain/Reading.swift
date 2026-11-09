import Foundation
import FHModel

// 読み取りの補助（チラシ・ページの URL から予定の候補）。元: src/domain/assistant.ts。
// 読み取りの結果は提案で、利用者が確かめて保存するまで何も追加しない。

public enum Reading {
  public static let imageMaxBytes = 10_000_000
  /// 結果を問い合わせる間隔と、待つ時間。
  public static let pollInterval: Duration = .milliseconds(1200)
  public static let waitLimit: Duration = .seconds(120)
  public static let waitedTooLong = "時間内に読み取れませんでした。少し待ってからお試しください。"

  static func plusHour(_ time: String) -> String {
    let hour = (Int(time.prefix(2)) ?? 0) + 1
    return hour > 23 ? "23:59" : String(format: "%02d", hour) + time.dropFirst(2)
  }

  /// 候補を予定の下書きに入れる。日付と時刻、題名、場所だけを変える。
  public static func apply(_ candidate: EventCandidate, to draft: EventDraft) -> EventDraft {
    var next = draft
    next.title = candidate.title
    next.allDay = candidate.allDay
    next.location = candidate.location ?? ""
    if candidate.allDay || candidate.startTime == nil {
      next.allDay = true
      next.start = "\(candidate.date)T00:00"
      next.end = "\(candidate.date)T23:59"
    } else if let startTime = candidate.startTime {
      next.start = "\(candidate.date)T\(startTime)"
      next.end = "\(candidate.date)T\(candidate.endTime ?? plusHour(startTime))"
    }
    return next
  }

  /// 読み取りに送るページの URL の形を確かめる。問題がなければ nil。接続先の確認はサーバーが行う。
  public static func urlProblem(_ text: String) -> String? {
    if text.utf16.count > 2048 { return "URL が長すぎます。" }
    guard let url = WebURL.parse(Account.jsTrim(text)) else { return "URL の形を確認してください。" }
    if url.scheme != "https" { return "https で始まる URL を入力してください。" }
    if url.hasCredentials { return "名前やパスワードを含む URL は使えません。" }
    return nil
  }

  /// 送っても受け付けられない画像の理由。問題がなければ nil。
  public static func imageProblem(name: String, type: String, size: Int) -> String? {
    let lower = name.lowercased()
    let kind = !type.isEmpty ? type : (lower.hasSuffix(".jpg") || lower.hasSuffix(".jpeg")) ? "image/jpeg" : lower.hasSuffix(".png") ? "image/png" : ""
    if kind != "image/jpeg" && kind != "image/png" { return "読み取れるのはJPEGとPNGの画像です。" }
    return size > imageMaxBytes ? "画像は\(imageMaxBytes / 1_000_000)MB以内にしてください。" : nil
  }
}

/// URL の読み方を WHATWG URL（JS の new URL）に近づけた最小の確認。スキームと、名前・パスワードの有無だけを見る。
enum WebURL {
  struct Parts { var scheme: String; var hasCredentials: Bool }

  static func parse(_ text: String) -> Parts? {
    guard let colon = text.firstIndex(of: ":") else { return nil }
    let scheme = text[..<colon].lowercased()
    guard let first = scheme.first, first.isASCII, first.isLetter,
          scheme.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "+-.".contains($0)) }) else { return nil }
    let rest = text[text.index(after: colon)...]
    // 特別なスキーム（http・https など）は、/ と \ をいくつ続けても authority として読む。
    guard ["http", "https", "ws", "wss", "ftp"].contains(scheme) else { return Parts(scheme: scheme, hasCredentials: false) }
    let authorityStart = rest.drop { $0 == "/" || $0 == "\\" }
    let authority = authorityStart.prefix { !"/\\?#".contains($0) }
    let host = authority.split(separator: "@", omittingEmptySubsequences: false).last ?? ""
    guard !host.isEmpty, !host.hasPrefix(":") else { return nil }
    guard var components = URLComponents(string: "\(scheme)://\(host)") , components.host?.isEmpty == false else { return nil }
    components.path = ""
    return Parts(scheme: scheme, hasCredentials: authority.contains("@") && authority.split(separator: "@", omittingEmptySubsequences: false).first.map { !$0.isEmpty } == true)
  }
}
