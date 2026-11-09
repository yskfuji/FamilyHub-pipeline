import Foundation
import FHCopy

/// アカウントの入力。元: src/domain/account.ts と src/domain/schemas.ts（zod の検査と同じ順で、最初の1つの文言を返す）。
public enum Account {
  public static let adultAge = 18
  public static let idleTimeoutChoices = [1, 5, 15, 30, 60]

  /// 誕生日から満年齢を求める。日付は日本時間の YYYY-MM-DD。
  public static func age(birthdate: String, on today: String) -> Int? {
    guard let born = CivilDate(key: birthdate), let now = CivilDate(key: today) else { return nil }
    return now.year - born.year - ((now.month < born.month || (now.month == born.month && now.day < born.day)) ? 1 : 0)
  }

  /// zod の z.email() の正規表現（node_modules/zod/v4/core/regexes.js）。
  private static var emailPattern: Regex<Substring> { /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/ }

  public static func isEmail(_ value: String) -> Bool {
    value.unicodeScalars.count <= 254 && value.wholeMatch(of: emailPattern) != nil
  }

  /// JS の String.prototype.trim。
  public static func jsTrim(_ value: String) -> String {
    let scalars = Array(value.unicodeScalars)
    var start = 0, end = scalars.count
    while start < end, PasswordPolicy.isJSWhitespace(scalars[start]) { start += 1 }
    while end > start, PasswordPolicy.isJSWhitespace(scalars[end - 1]) { end -= 1 }
    var out = String.UnicodeScalarView()
    out.append(contentsOf: scalars[start..<end])
    return String(out)
  }

  /// z.iso.date()：実在する YYYY-MM-DD。
  public static func isIsoDate(_ value: String) -> Bool {
    guard value.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil, let date = CivilDate(key: value) else { return false }
    return (1...12).contains(date.month) && date.day >= 1 && CivilDate(daysSinceEpoch: date.daysSinceEpoch) == date
  }

  public struct SignUp: Sendable, Equatable {
    public var displayName: String
    public var email: String
    public var password: String
    public var birthdate: String
    public var guardianConsent: Bool
    public init(displayName: String, email: String, password: String, birthdate: String, guardianConsent: Bool) {
      self.displayName = displayName; self.email = email; self.password = password; self.birthdate = birthdate; self.guardianConsent = guardianConsent
    }
  }

  /// signUpSchema。成功なら名前の前後の空白を除いた入力、失敗なら最初の文言。
  public static func validate(_ input: SignUp) -> Result<SignUp, ValidationMessage> {
    let name = jsTrim(input.displayName)
    // zod の長さはコードポイントで数える。
    if name.unicodeScalars.count < 1 { return .failure(.init("名前を入力してください。")) }
    if name.unicodeScalars.count > 40 { return .failure(.init("40文字以内で入力してください。")) }
    if !isEmail(input.email) { return .failure(.init("メールアドレスを確認してください。")) }
    if let message = PasswordPolicy.currentPasswordMessage(input.password) { return .failure(.init(message)) }
    if PasswordPolicy.hasWeakPattern(input.password) { return .failure(.init(PasswordPolicy.Problem.pattern.message)) }
    if !isIsoDate(input.birthdate) { return .failure(.init("Invalid ISO date")) }
    var parsed = input
    parsed.displayName = name
    return .success(parsed)
  }

  /// 新しいパスワードの同期の検査（passwordSchema）。長さと並び。
  public static func newPasswordMessage(_ value: String) -> String? {
    PasswordPolicy.currentPasswordMessage(value) ?? (PasswordPolicy.hasWeakPattern(value) ? PasswordPolicy.Problem.pattern.message : nil)
  }
}

/// 入力の確かめの文言。
public struct ValidationMessage: Error, Equatable, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
}
