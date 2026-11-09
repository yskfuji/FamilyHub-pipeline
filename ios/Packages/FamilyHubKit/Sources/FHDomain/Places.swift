import Foundation
import FHModel
import FHCopy

// 場所。元: src/domain/places.ts、src/features/place/geo.ts、src/content/ja.ts の placeDistanceLabel・placeCategoryLabel。

public enum Places {
  static let whitespace = JSRegex("\\s+")

  static func normalize(_ value: String) -> String { whitespace.replaceAll(value.nfkc, with: "").jsLowercased }

  /// 名前と住所から作る安定したキー（FNV-1a 32bit）。外部のデータに ID がないため、表示と操作に使う。
  public static func key(name: String, address: String = "") -> String {
    var hash: UInt32 = 0x811c9dc5
    for scalar in "\(normalize(name))|\(normalize(address))".unicodeScalars {
      hash ^= scalar.value
      hash = hash &* 0x01000193
    }
    let hex = String(hash, radix: 16)
    return String(repeating: "0", count: max(0, 8 - hex.count)) + hex
  }

  public static func key(of place: PlaceRef) -> String { key(name: place.name, address: place.address ?? "") }

  public struct Use: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable { case expense, memo }
    public var kind: Kind
    public var id: Id
    public var title: String
    public var date: String
    public var amountJpy: Int?
  }

  public struct Summary: Codable, Sendable, Hashable, Identifiable {
    public var key: String
    public var place: PlaceRef
    public var uses: [Use]
    public var expenseCount: Int
    public var memoCount: Int
    public var expenseTotalJpy: Int
    public var lastUsedOn: String
    public var id: String { key }
  }

  public enum Sort: String, CaseIterable, Sendable, Codable {
    case recent, amount, frequency
    public var label: String { switch self { case .recent: "最近使った順"; case .amount: "支出が多い順"; case .frequency: "よく使う順" } }
  }

  /// 支出とメモに記録した場所を、同じ名前・住所ごとにまとめる。収入と削除した記録は除く。
  public static func aggregate(expenses: [Expense], memos: [Memo]) -> [Summary] {
    var order: [String] = []
    var groups: [String: Summary] = [:]
    func add(_ place: PlaceRef, _ use: Use) {
      let key = key(of: place)
      var group = groups[key] ?? Summary(key: key, place: place, uses: [], expenseCount: 0, memoCount: 0, expenseTotalJpy: 0, lastUsedOn: use.date)
      if groups[key] == nil { order.append(key) }
      group.uses.append(use)
      if use.kind == .expense { group.expenseCount += 1; group.expenseTotalJpy += use.amountJpy ?? 0 } else { group.memoCount += 1 }
      if use.date >= group.lastUsedOn { group.lastUsedOn = use.date; group.place = place }
      groups[key] = group
    }
    for expense in expenses where expense.kind != .income {
      if let place = expense.place, expense.deletedAt == nil { add(place, Use(kind: .expense, id: expense.id, title: expense.title, date: expense.incurredOn, amountJpy: expense.amountJpy)) }
    }
    for memo in memos {
      if let place = memo.place, memo.deletedAt == nil { add(place, Use(kind: .memo, id: memo.id, title: memo.title, date: String(memo.updatedAt.prefix(10)), amountJpy: nil)) }
    }
    return order.map { key in
      var group = groups[key]!
      group.uses = group.uses.stableSorted { a, b in
        let byDate = jsLocaleCompare(b.date, a.date)
        return byDate != 0 ? byDate < 0 : jsLocaleCompare(a.title, b.title, locale: "ja") < 0
      }
      return group
    }
  }

  public static func sort(_ items: [Summary], _ sort: Sort) -> [Summary] {
    let byName = { (a: Summary, b: Summary) in jsLocaleCompare(a.place.name, b.place.name, locale: "ja") }
    let recent = { (a: Summary, b: Summary) in jsLocaleCompare(b.lastUsedOn, a.lastUsedOn) }
    let compare: (Summary, Summary) -> Int = switch sort {
    case .amount: { a, b in a.expenseTotalJpy != b.expenseTotalJpy ? b.expenseTotalJpy - a.expenseTotalJpy : (recent(a, b) != 0 ? recent(a, b) : byName(a, b)) }
    case .frequency: { a, b in a.uses.count != b.uses.count ? b.uses.count - a.uses.count : (recent(a, b) != 0 ? recent(a, b) : byName(a, b)) }
    case .recent: { a, b in recent(a, b) != 0 ? recent(a, b) : byName(a, b) }
    }
    return items.stableSorted { compare($0, $1) < 0 }
  }

  /// 距離の表示。30m 未満は「すぐ近く」。
  public static func distanceLabel(_ meters: Double) -> String {
    if meters < 30 { return "すぐ近く" }
    let tens = Int(floor(meters / 10 + 0.5)) * 10
    if tens < 1000 { return "約\(tens)m" }
    return "約\(jsToFixed1(meters / 1000))km"
  }

  public static func categoryLabel(_ category: String?) -> String? {
    let labels = Copy.ja.ja.place.categories.self
    return switch category {
    case "restaurant": labels.restaurant
    case "bar_izakaya": labels.bar_izakaya
    case "cafe": labels.cafe
    case "bakery": labels.bakery
    case "grocery": labels.grocery
    case "supermarket": labels.supermarket
    case "convenience_store": labels.convenience_store
    case "drugstore": labels.drugstore
    case "pharmacy": labels.pharmacy
    case "retail_other": labels.retail_other
    case "service_other": labels.service_other
    case "medical": labels.medical
    case "public_facility": labels.public_facility
    case "education": labels.education
    case "tourism": labels.tourism
    default: nil
    }
  }

  public static func recordedVia(_ source: PlaceCaptureSource) -> String {
    let labels = Copy.ja.ja.place.recordedVia.self
    return switch source { case .device: labels.device; case .photo: labels.photo; case .search: labels.search; default: labels.manual }
  }

  /// 「住所 · 種類 · 選び方」。
  public static func meta(_ place: PlaceRef) -> String {
    [place.address, categoryLabel(place.category), recordedVia(place.capturedVia)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
  }
}

/// 外部の検索に使う位置（geo.ts）。正確な位置は端末の外へ出さず、送るのは丸めた位置だけ。
public enum Geo {
  public static let coarseAccuracyMeters = 1000.0
  public static let approximateAccuracyMeters = 100.0
  public static let nearbyRadiusMeters = 380
  public static let maxVisibleCandidates = 8
  static let earthRadius = 6_371_008.8

  public struct Position: Sendable, Hashable, Codable { public var lat: Double; public var lng: Double; public init(lat: Double, lng: Double) { self.lat = lat; self.lng = lng } }

  /// JS の Math.round（.5 は大きい方へ）で、factor の桁に丸める。
  static func round(_ value: Double, _ factor: Double) -> Double { (value * factor + 0.5).rounded(.down) / factor }

  /// 小数第3位（日本の緯度で約110m×90m）に丸める。外部へ送る位置はすべてここを通す。
  public static func coarsen(_ position: Position) -> Position { Position(lat: round(position.lat, 1e3), lng: round(position.lng, 1e3)) }

  public static func haversine(_ a: Position, _ b: Position) -> Double {
    let rad = { (degrees: Double) in degrees * .pi / 180 }
    let dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
    let h = pow(sin(dLat / 2), 2) + cos(rad(a.lat)) * cos(rad(b.lat)) * pow(sin(dLng / 2), 2)
    return 2 * earthRadius * asin(min(1, sqrt(h)))
  }

  public struct Candidate: Sendable, Hashable, Codable, Identifiable {
    public var key: String
    public var name: String
    public var address: String
    public var lat: Double
    public var lng: Double
    public var category: String?
    public var source: String
    public var licenses: [String]
    public var attributions: [String]
    public var distanceMeters: Double?
    public var id: String { key }
    public init(key: String, name: String, address: String, lat: Double, lng: Double, category: String?, source: String, licenses: [String], attributions: [String], distanceMeters: Double? = nil) {
      self.key = key; self.name = name; self.address = address; self.lat = lat; self.lng = lng; self.category = category
      self.source = source; self.licenses = licenses; self.attributions = attributions; self.distanceMeters = distanceMeters
    }
  }

  /// 同じ名前・住所の重複は近いほうだけを残し、近い順に並べる。
  public static func rank(_ candidates: [Candidate], from: Position, limit: Int = maxVisibleCandidates) -> [Candidate] {
    var order: [String] = []
    var byKey: [String: Candidate] = [:]
    for candidate in candidates {
      var withDistance = candidate
      withDistance.distanceMeters = haversine(from, Position(lat: candidate.lat, lng: candidate.lng))
      if let existing = byKey[candidate.key] {
        if (withDistance.distanceMeters ?? .infinity) < (existing.distanceMeters ?? .infinity) { byKey[candidate.key] = withDistance }
      } else {
        order.append(candidate.key)
        byKey[candidate.key] = withDistance
      }
    }
    return Array(order.map { byKey[$0]! }.stableSorted { a, b in
      let difference = (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)
      return difference != 0 ? difference < 0 : jsLocaleCompare(a.name, b.name, locale: "ja") < 0
    }.prefix(limit))
  }

  /// 記録用の形。座標は小数第5位にそろえ、利用者自身の位置は含めない。
  public static func placeRef(_ candidate: Candidate, via: PlaceCaptureSource, now: Date) -> PlaceRef {
    PlaceRef(name: candidate.name, address: candidate.address.isEmpty ? nil : candidate.address,
             coordinates: Coordinates(lat: round(candidate.lat, 1e5), lng: round(candidate.lng, 1e5)),
             category: Places.categoryLabel(candidate.category) != nil ? candidate.category : nil,
             provenance: PlaceProvenance(provider: "openpoi", source: candidate.source, licenses: Array(candidate.licenses.prefix(10)), attributions: Array(candidate.attributions.prefix(20))),
             capturedVia: via, selectedAt: CalendarDate.toJstRfc3339(now))
  }
}

/// 検索の結果を種類ごとにまとめる（src/app/searchGroups.ts）。並びは決まった順。
public enum SearchGroups {
  public static let order = ["event", "task", "memo", "expense", "place", "resource", "album", "albumItem"]
  public static let labels = ["event": "予定", "task": "タスク", "memo": "メモ", "expense": "家計", "place": "場所", "resource": "関連リンク", "album": "アルバム", "albumItem": "写真・動画"]

  public struct Group: Sendable, Hashable, Identifiable {
    public var kind: String
    public var label: String
    public var items: [SearchResult]
    public var id: String { kind }
  }

  public static func group(_ results: [SearchResult]) -> [Group] {
    order.map { kind in Group(kind: kind, label: labels[kind] ?? kind, items: results.filter { $0.kind.rawValue == kind }) }.filter { !$0.items.isEmpty }
  }
}
