import Foundation

/// 文字列で決まる値の集まり（役割・状態・種類など）。Web の型（src/domain/types.ts）の文字列の合併に当たる。
/// 知らない値も壊さずに読んで書き戻す（新しいサーバーが値を足しても、アプリは落ちない）。
public protocol OpenValue: RawRepresentable, Codable, Hashable, Sendable, ExpressibleByStringLiteral, CustomStringConvertible where RawValue == String {
  init(rawValue: String)
}

extension OpenValue {
  public init(stringLiteral value: String) { self.init(rawValue: value) }
  public init(from decoder: any Decoder) throws { self.init(rawValue: try decoder.singleValueContainer().decode(String.self)) }
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue)
  }
  public var description: String { rawValue }
}

/// Web の型で `T | null` の欄。値がないときも null として書き戻す（`?` の欄は書かずに省く）。
@propertyWrapper
public struct Nullable<Value: Codable & Sendable & Hashable>: Codable, Sendable, Hashable {
  public var wrappedValue: Value?
  public init(wrappedValue: Value?) { self.wrappedValue = wrappedValue }
  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    wrappedValue = container.decodeNil() ? nil : try container.decode(Value.self)
  }
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    if let wrappedValue { try container.encode(wrappedValue) } else { try container.encodeNil() }
  }
}

extension KeyedDecodingContainer {
  /// 欄そのものがないときも nil として読む。
  public func decode<Value>(_ type: Nullable<Value>.Type, forKey key: Key) throws -> Nullable<Value> {
    try decodeIfPresent(type, forKey: key) ?? Nullable(wrappedValue: nil)
  }
}

/// 形の決まっていない JSON（操作の記録の詳細など）。
public enum JSONValue: Codable, Sendable, Hashable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
    else { self = .object(try container.decode([String: JSONValue].self)) }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }
}

/// 値のない成功（Web の Result<void>）。
public struct Empty: Codable, Sendable, Hashable {
  public init() {}
}

public typealias Id = String
/// YYYY-MM-DD（家族の時間帯の日付）。
public typealias IsoDate = String
/// RFC 3339 の時刻（+09:00 付き）。
public typealias Rfc3339 = String
