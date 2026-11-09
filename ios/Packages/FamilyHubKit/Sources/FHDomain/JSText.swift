import Foundation

// JS の正規表現と文字列の操作を、同じ結果になるように Swift で行う道具。シフト表の読み取り（src/domain/shift）の移植で使う。
// - 位置と長さは JS と同じく UTF-16 で数える（NSString と NSRegularExpression を使う）。
// - \s と \d は JS の意味に直す（ICU の \d はほかの文字の数字も含み、\s は少し範囲が違う）。
// - $ は文字列の最後だけ（ICU の $ は最後の改行の前にも当たる）。
// - 文字の集まり（[...]）の中の [ は、ICU では入れ子の始まりになるので、文字として扱うように直す。

/// JS の \s に当たる文字（ECMAScript の WhiteSpace と LineTerminator）。
let jsWhitespaceSet = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

struct JSRegex: @unchecked Sendable {
  let regex: NSRegularExpression

  init(_ pattern: String, ignoreCase: Bool = false) {
    // 書いた正規表現が間違っていれば、試験ですぐに分かるように止める。
    regex = try! NSRegularExpression(pattern: JSRegex.translate(pattern), options: ignoreCase ? [.caseInsensitive] : [])
  }

  static func translate(_ pattern: String) -> String {
    var output = ""
    var inClass = false
    var characters = Array(pattern)
    var index = 0
    while index < characters.count {
      let character = characters[index]
      if character == "\\", index + 1 < characters.count {
        let next = characters[index + 1]
        switch next {
        case "s": output += inClass ? jsWhitespaceSet : "[\(jsWhitespaceSet)]"
        case "S": output += inClass ? "" : "[^\(jsWhitespaceSet)]"
        case "d": output += inClass ? "0-9" : "[0-9]"
        case "D": output += "[^0-9]"
        default: output.append(character); output.append(next)
        }
        index += 2
        continue
      }
      if inClass {
        if character == "]" { inClass = false; output.append(character) }
        else if "[&{}:".contains(character) { output += "\\\(character)" }
        else { output.append(character) }
      } else {
        if character == "[" {
          inClass = true
          output.append(character)
          // [^ と、最初の ] は文字として扱う JS の書き方には対応しない（使っていない）。
          if index + 1 < characters.count, characters[index + 1] == "^" { output.append("^"); index += 1 }
        } else if character == "$" {
          output += "(?!(?s:.))"
        } else {
          output.append(character)
        }
      }
      index += 1
    }
    characters.removeAll()
    return output
  }

  struct Match {
    let range: NSRange
    let groups: [String?]
    let source: NSString
    var index: Int { range.location }
    var length: Int { range.length }
    var text: String { groups[0] ?? "" }
    subscript(_ group: Int) -> String? { group < groups.count ? groups[group] : nil }
  }

  private func match(_ result: NSTextCheckingResult, in source: NSString) -> Match {
    let groups = (0..<result.numberOfRanges).map { number -> String? in
      let range = result.range(at: number)
      return range.location == NSNotFound ? nil : source.substring(with: range)
    }
    return Match(range: result.range, groups: groups, source: source)
  }

  /// JS の exec（g なし）。
  func exec(_ text: String) -> Match? {
    let source = text as NSString
    return regex.firstMatch(in: text, range: NSRange(location: 0, length: source.length)).map { match($0, in: source) }
  }

  func test(_ text: String) -> Bool { exec(text) != nil }

  /// JS の matchAll。
  func matches(_ text: String) -> [Match] {
    let source = text as NSString
    return regex.matches(in: text, range: NSRange(location: 0, length: source.length)).map { match($0, in: source) }
  }

  /// JS の replace（g あり）。置き換えの文字は関数で作る。
  func replaceAll(_ text: String, _ make: (Match) -> String) -> String {
    let source = text as NSString
    var output = ""
    var cursor = 0
    for result in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
      output += source.substring(with: NSRange(location: cursor, length: result.range.location - cursor))
      output += make(match(result, in: source))
      cursor = result.range.location + result.range.length
    }
    output += source.substring(from: cursor)
    return output
  }

  func replaceAll(_ text: String, with replacement: String) -> String { replaceAll(text) { _ in replacement } }

  /// JS の replace（g なし）。最初の1つだけを置き換える。
  func replaceFirst(_ text: String, with replacement: String) -> String {
    guard let first = exec(text) else { return text }
    let source = text as NSString
    return source.substring(to: first.index) + replacement + source.substring(from: first.index + first.length)
  }

  /// JS の split（正規表現。区切りに括弧を使わない形だけ）。
  func split(_ text: String) -> [String] {
    let source = text as NSString
    if source.length == 0 { return exec("") == nil ? [""] : [] }
    var parts: [String] = []
    var cursor = 0
    for result in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
      // 空の一致は、JS と同じく文字の間で分ける（先頭と末尾では分けない）。
      if result.range.length == 0 && (result.range.location == 0 || result.range.location >= source.length) { continue }
      if result.range.length == 0 && result.range.location == cursor && cursor == 0 { continue }
      parts.append(source.substring(with: NSRange(location: cursor, length: result.range.location - cursor)))
      cursor = result.range.location + result.range.length
    }
    parts.append(source.substring(from: cursor))
    return parts
  }
}

extension String {
  /// UTF-16 の長さ（JS の length）。
  var jsLength: Int { (self as NSString).length }

  /// JS の slice（UTF-16 の位置）。負の数は後ろから数える。
  func jsSlice(_ start: Int, _ end: Int? = nil) -> String {
    let source = self as NSString
    let length = source.length
    func clamp(_ value: Int) -> Int { value < 0 ? max(0, length + value) : min(value, length) }
    let from = clamp(start), to = clamp(end ?? length)
    return from < to ? source.substring(with: NSRange(location: from, length: to - from)) : ""
  }

  /// JS の indexOf（UTF-16 の位置）。なければ -1。
  func jsIndexOf(_ needle: String) -> Int {
    if needle.isEmpty { return 0 }
    let range = (self as NSString).range(of: needle, options: .literal)
    return range.location == NSNotFound ? -1 : range.location
  }

  /// JS の replace（文字列。最初の1つだけ）。
  func jsReplaceFirst(_ needle: String, with replacement: String) -> String {
    let source = self as NSString
    let range = needle.isEmpty ? NSRange(location: 0, length: 0) : source.range(of: needle, options: .literal)
    guard range.location != NSNotFound else { return self }
    return source.replacingCharacters(in: range, with: replacement)
  }

  /// JS の includes（UTF-16 の並びとして）。
  func jsIncludes(_ needle: String) -> Bool { needle.isEmpty || jsIndexOf(needle) >= 0 }

  /// JS の String.prototype.split（文字列の区切り）。
  func jsSplit(_ separator: String) -> [String] { components(separatedBy: separator) }

  var jsTrimmed: String { Account.jsTrim(self) }

  /// JS の toLowerCase（言語に依らない小文字）。
  var jsLowercased: String { lowercased() }

  /// JS の normalize('NFKC')。
  var nfkc: String { precomposedStringWithCompatibilityMapping }

  /// JS の toUpperCase（言語に依らない大文字）。
  var jsUpper: String { uppercased(with: Locale(identifier: "en_US_POSIX")) }

  /// JS の Number(文字列) を整数で（数字だけの文字列に使う）。
  var jsInt: Int { Int(self) ?? 0 }
}

extension Array where Element: Hashable {
  /// JS の [...new Set(list)]。最初に出た順を保つ。
  func uniqued() -> [Element] {
    var seen = Set<Element>()
    return filter { seen.insert($0).inserted }
  }
}

/// String.prototype.localeCompare。ICU の照合で比べる（V8 も ICU）。locale を省くと node の既定（en-US）。
public func jsLocaleCompare(_ a: String, _ b: String, locale: String = "en-US") -> Int {
  switch a.compare(b, options: [], range: nil, locale: Locale(identifier: locale)) {
  case .orderedAscending: -1
  case .orderedDescending: 1
  case .orderedSame: 0
  }
}
