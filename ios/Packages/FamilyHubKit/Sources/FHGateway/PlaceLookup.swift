import Foundation
import FHModel

/// 外部の場所検索（OpenPOI API）への唯一の出口（Web の src/features/place/openPoi.ts）。
/// 送るのは丸めた位置と検索語だけ。cookie・リファラーは送らず、応答も残さない。家族のサーバーは通らない。
public protocol PlaceLookup: Sendable {
  /// center は「経度,緯度」を小数第3位に丸めたもの（Geo.coarsen を通したもの）。
  func nearby(lat: Double, lng: Double, radius: Int) async -> Result<[PlaceRow], GatewayError>
  func search(_ query: String, lat: Double?, lng: Double?) async -> Result<(rows: [PlaceRow], nationwide: Bool), GatewayError>
}

/// 外部の検索の1行。名前・住所・座標を確かめた後のもの。
public struct PlaceRow: Sendable, Hashable {
  public var name: String
  public var address: String
  public var lat: Double
  public var lng: Double
  public var category: String?
  public var source: String
  public var licenses: [String]
  public var attributions: [String]
}

public struct OpenPoiLookup: PlaceLookup {
  public static let origin = URL(string: "https://api.openpoiapi.com")!
  /// 外部送信の説明を変えたら更新し、全員に同意を取り直す（Web と同じ値）。
  public static let noticeVersion = "2026-10-03"
  static let nearbyLimit = 200
  static let searchLimit = 20
  static let searchRadius = 5000
  static let maxQuery = 60
  static let maxResponseBytes = 2_000_000

  let session: URLSession

  public init(session: URLSession? = nil) {
    if let session { self.session = session; return }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.timeoutIntervalForRequest = 8
    self.session = URLSession(configuration: configuration)
  }

  static func failure(_ code: GatewayErrorCode, retryable: Bool) -> GatewayError { GatewayError(code: code, message: code.rawValue, retryable: retryable) }

  func getJSON(_ path: String, _ items: [URLQueryItem]) async -> Result<Any, GatewayError> {
    var components = URLComponents(url: Self.origin.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
    components.queryItems = items
    var request = URLRequest(url: components.url!)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    do {
      let (data, response) = try await session.data(for: request)
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 429 { return .failure(Self.failure(.rateLimited, retryable: true)) }
      guard (200..<300).contains(status) else { return .failure(Self.failure(.upstreamFailure, retryable: status >= 500)) }
      guard data.count <= Self.maxResponseBytes, let value = try? JSONSerialization.jsonObject(with: data) else { return .failure(Self.failure(.upstreamFailure, retryable: false)) }
      return .success(value)
    } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed].contains(error.code) {
      return .failure(Self.failure(.offline, retryable: true))
    } catch {
      return .failure(Self.failure(.upstreamFailure, retryable: true))
    }
  }

  static func center(_ lat: Double, _ lng: Double) -> String { String(format: "%.3f,%.3f", lng, lat) }

  public func nearby(lat: Double, lng: Double, radius: Int) async -> Result<[PlaceRow], GatewayError> {
    let result = await getJSON("v1/search", [URLQueryItem(name: "center", value: Self.center(lat, lng)), URLQueryItem(name: "radius", value: String(max(1, radius))), URLQueryItem(name: "limit", value: String(Self.nearbyLimit))])
    return result.flatMap { value in
      guard let rows = (value as? [String: Any])?["results"] as? [Any], rows.count <= Self.nearbyLimit else { return .failure(Self.failure(.upstreamFailure, retryable: true)) }
      return .success(Self.rows(rows))
    }
  }

  public func search(_ query: String, lat: Double?, lng: Double?) async -> Result<(rows: [PlaceRow], nationwide: Bool), GatewayError> {
    let q = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxQuery))
    if q.isEmpty { return .success(([], false)) }
    var items = [URLQueryItem(name: "q", value: q), URLQueryItem(name: "limit", value: String(Self.searchLimit)), URLQueryItem(name: "fields", value: "full")]
    if let lat, let lng { items += [URLQueryItem(name: "center", value: Self.center(lat, lng)), URLQueryItem(name: "radius", value: String(Self.searchRadius))] }
    let result = await getJSON("v1/suggest", items)
    return result.flatMap { value in
      guard let object = value as? [String: Any], let rows = object["suggestions"] as? [Any], rows.count <= Self.searchLimit else { return .failure(Self.failure(.upstreamFailure, retryable: true)) }
      return .success((Self.rows(rows), lat != nil && (object["scope"] as? String) == "nationwide"))
    }
  }

  /// 応答の行を確かめる。名前のない行・座標の範囲の外の行は捨て、長さを切り詰める（Web の toCandidates）。
  static func rows(_ values: [Any]) -> [PlaceRow] {
    values.compactMap { value -> PlaceRow? in
      guard let row = value as? [String: Any] else { return nil }
      let number = { (key: String) -> Double? in
        if let value = row[key] as? Double { return value }
        if let value = row[key] as? String, !value.isEmpty { return Double(value) }
        return nil
      }
      let name = String((row["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
      guard !name.isEmpty, let lat = number("lat"), let lng = number("lng"), lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 else { return nil }
      let category = (row["category"] as? String).flatMap { $0.isEmpty || $0 == "unknown" ? nil : String($0.prefix(40)) }
      let source = String((row["source"] as? String ?? "").prefix(40))
      return PlaceRow(name: name, address: String((row["address"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)), lat: lat, lng: lng, category: category,
                      source: source.isEmpty ? "unknown" : source,
                      licenses: Array(((row["licenses"] as? [String]) ?? []).filter { !$0.isEmpty && $0.count <= 200 }.prefix(10)),
                      attributions: Array(((row["attributions"] as? [String]) ?? []).filter { !$0.isEmpty && $0.count <= 300 }.prefix(20)))
    }
  }
}
