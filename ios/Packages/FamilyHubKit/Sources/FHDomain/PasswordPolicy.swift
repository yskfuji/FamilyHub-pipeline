import Foundation
import FHCopy

/// 新しいパスワードの規則。元: src/domain/passwordPolicy.ts（NIST SP 800-63B-4 3.1.1.2）。
/// 長さは JS の length と同じく UTF-16 の数で数え、並びの確かめは JS の `[...文字列]` と同じく Unicode のコードポイントで数える。
/// サーバーも保存の前に同じ規則で確かめる。ここは入力中に早く知らせるためのもの。
public enum PasswordPolicy {
  public static let minLength = 15
  public static let maxLength = 64

  public enum Problem: String, Sendable, Codable {
    case tooShort, tooLong, common, context, pattern

    public var message: String {
      switch self {
      case .tooShort: Copy.passwordMessages.passwordMessages.tooShort
      case .tooLong: Copy.passwordMessages.passwordMessages.tooLong
      case .common: Copy.passwordMessages.passwordMessages.common
      case .context: Copy.passwordMessages.passwordMessages.context
      case .pattern: Copy.passwordMessages.passwordMessages.pattern
      }
    }
  }

  public struct Context: Sendable, Decodable {
    public var email: String?
    public var displayName: String?
    public var householdName: String?
    public var memberNames: [String]?
    public init(email: String? = nil, displayName: String? = nil, householdName: String? = nil, memberNames: [String]? = nil) {
      self.email = email; self.displayName = displayName; self.householdName = householdName; self.memberNames = memberNames
    }
  }

  /// NFKC と小文字。
  public static func normalize(_ value: String) -> String { value.precomposedStringWithCompatibilityMapping.lowercased() }

  /// JS の \s。
  static func isJSWhitespace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }

  /// 数字・記号・空白を除いた形（\p{N}\p{P}\p{S}\p{Z}\s）。
  static func lettersOnly(_ value: String) -> String {
    var out = String.UnicodeScalarView()
    for scalar in normalize(value).unicodeScalars {
      if isJSWhitespace(scalar) { continue }
      switch scalar.properties.generalCategory {
      case .decimalNumber, .letterNumber, .otherNumber,
           .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation,
           .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol,
           .spaceSeparator, .lineSeparator, .paragraphSeparator:
        continue
      default: out.append(scalar)
      }
    }
    return String(out)
  }

  private static let sequences = [
    "01234567890", "abcdefghijklmnopqrstuvwxyz", "`1234567890-=", "~!@#$%^&*()_+", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./",
    "qwertyuiopasdfghjklzxcvbnm", "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,9ol.0p;/", "qazwsxedcrfvtgbyhnujmikolp",
    "1q2w3e4r5t6y7u8i9o0p", "q1w2e3r4t5y6u7i8o9p0", "a1s2d3f4g5h6j7k8l9", "z1x2c3v4b5n6m7",
  ]
  private struct Pair: Hashable { let a: Unicode.Scalar; let b: Unicode.Scalar }
  private static let neighbours: Set<Pair> = {
    var set = Set<Pair>()
    for sequence in sequences {
      let characters = Array(sequence.unicodeScalars)
      for index in 0..<(characters.count - 1) {
        set.insert(Pair(a: characters[index], b: characters[index + 1]))
        set.insert(Pair(a: characters[index + 1], b: characters[index]))
      }
    }
    return set
  }()

  private static func repeatsShortUnit(_ characters: [Unicode.Scalar]) -> Bool {
    let limit = min(8, characters.count / 2)
    guard limit >= 1 else { return false }
    for size in 1...limit where characters.indices.allSatisfy({ characters[$0] == characters[$0 % size] }) { return true }
    return false
  }

  private static func followsSequences(_ characters: [Unicode.Scalar]) -> Bool {
    var breaks = 0
    for index in 0..<max(0, characters.count - 1) {
      let (a, b) = (characters[index], characters[index + 1])
      if a != b, !neighbours.contains(Pair(a: a, b: b)) { breaks += 1 }
      if breaks > 1 { return false }
    }
    return true
  }

  public static func hasWeakPattern(_ value: String) -> Bool {
    let characters = normalize(value).unicodeScalars.filter { !isJSWhitespace($0) }
    if characters.isEmpty { return false }
    let list = Array(characters)
    return repeatsShortUnit(list) || followsSequences(list)
  }

  public static func contextWords(_ context: Context) -> [String] {
    let local = context.email.map { String($0.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first ?? "") } ?? ""
    let words = Copy.passwordMessages.passwordMessages.serviceWords + [local, context.displayName ?? "", context.householdName ?? ""] + (context.memberNames ?? [])
    return words.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  }

  public static func matchesContext(_ value: String, _ context: Context) -> Bool {
    let normalized = normalize(value)
    let letters = lettersOnly(value)
    return contextWords(context).contains { word in
      if normalized == normalize(word) { return true }
      let base = lettersOnly(word)
      guard !base.isEmpty, !letters.isEmpty else { return false }
      let (count, unit) = (letters.utf16.count, base.utf16.count)
      return count % unit == 0 && letters == String(repeating: base, count: count / unit)
    }
  }

  /// 頻出の一覧（src/domain/commonPasswords.json の写し。scripts/ios/export-vectors.ts が入れる）。
  public static let commonPasswords: Set<String> = {
    guard let url = Bundle.module.url(forResource: "commonPasswords", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let list = try? JSONDecoder().decode([String].self, from: data) else { return [] }
    return Set(list)
  }()

  /// common を nil にすると、一覧と比べない（Web の commonPasswords を省いたときと同じ）。
  public static func problem(_ value: String, common: Set<String>? = PasswordPolicy.commonPasswords, context: Context = Context()) -> Problem? {
    let length = value.utf16.count
    if length < minLength { return .tooShort }
    if length > maxLength { return .tooLong }
    if let common, common.contains(normalize(value)) { return .common }
    if matchesContext(value, context) { return .context }
    if hasWeakPattern(value) { return .pattern }
    return nil
  }

  /// サインインのときのパスワード（currentPasswordSchema）。長さだけを見る。
  /// zod の長さはコードポイントで数える（problem の長さは UTF-16 で数える。Web でも同じ違いがある）。
  public static func currentPasswordMessage(_ value: String) -> String? {
    let length = value.unicodeScalars.count
    if length < minLength { return Problem.tooShort.message }
    if length > maxLength { return Problem.tooLong.message }
    return nil
  }

  /// 新しいパスワードを、一覧・文脈・並びのすべてで確かめる（checkNewPassword）。問題がなければ nil。
  public static func check(_ value: String, context: Context = Context()) -> String? {
    problem(value, context: context)?.message
  }
}
