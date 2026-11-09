import SwiftUI
import PhotosUI
import CoreLocation
import ImageIO
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 場所の欄（Web の PlaceField.tsx）。支出とメモに付ける。外部の検索の前に、送る内容を示して同意を得る。
struct PlaceFieldSection: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Binding var value: PlaceRef?
  @State private var picking = false

  var body: some View {
    let copy = Copy.ja.ja.place.self
    Section(copy.legend) {
      if let value {
        VStack(alignment: .leading, spacing: 2) {
          Text(value.name).foregroundStyle(theme.colors.ink.color)
          let meta = Places.meta(value)
          if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(theme.colors.inkSoft.color) }
        }
        .accessibilityElement(children: .combine)
        // Form の Section に付けた sheet は効かないので、行に付ける（値があるときとないときで、どちらか1つだけ）。
        .sheet(isPresented: $picking) { PlacePickerSheet(current: value) { self.value = $0 } }
        Button(copy.change) { picking = true }
        Button(copy.remove, role: .destructive) { self.value = nil; model.announce(copy.removed) }
      } else {
        Button { picking = true } label: { Label(copy.add, systemImage: "mappin.and.ellipse") }
          .accessibilityIdentifier("place.add")
          .sheet(isPresented: $picking) { PlacePickerSheet(current: nil) { value = $0 } }
      }
    }
  }
}

/// 場所の選び方。
enum PlaceSourceKind: String, CaseIterable, Identifiable {
  case device, photo, search, manual
  var id: String { rawValue }
  var label: String {
    let labels = Copy.ja.ja.place.sources.self
    return switch self { case .device: labels.device; case .photo: labels.photo; case .search: labels.search; case .manual: labels.manual }
  }
}

struct PlacePickerSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let current: PlaceRef?
  let onPick: (PlaceRef) -> Void

  enum Panel: Equatable {
    case idle
    case consent(resume: PlaceSourceKind)
    case busy(String)
    case results(origin: PlaceSourceKind, candidates: [Geo.Candidate], notice: String?)
    case empty(PlaceSourceKind)
    case failed(String, retry: Bool)
  }

  @State private var source: PlaceSourceKind = .search
  @State private var panel: Panel = .idle
  @State private var query = ""
  @State private var manualName = ""
  @State private var manualAddress = ""
  @State private var manualError = ""
  @State private var exact: Geo.Position?
  @State private var photo: PhotosPickerItem?
  @State private var running: Task<Void, Never>?
  private let lookup: any PlaceLookup = OpenPoiLookup()

  private var consented: Bool { model.privacy?.placeLookupConsent?.noticeVersion == OpenPoiLookup.noticeVersion }

  var body: some View {
    let colors = theme.colors
    let copy = Copy.ja.ja.place.self
    NavigationStack {
      Form {
        Section {
          Picker(copy.sourceSwitcher, selection: $source) { ForEach(PlaceSourceKind.allCases) { Text($0.label).tag($0) } }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("place.source")
        } footer: {
          if source != .manual { Text(copy.transmission) }
        }
        sourceSection
        panelSection
      }
      .navigationTitle(copy.legend)
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button(current == nil ? copy.collapse.skip : copy.collapse.keep) { running?.cancel(); dismiss() } } }
      .onChange(of: source) { _, next in
        running?.cancel()
        panel = .idle
        if next != .search { exact = nil }
      }
      .onChange(of: photo) { _, item in if let item { start(.photo) { await readPhoto(item) } } }
    }
    .tint(colors.accent.color)
  }

  @ViewBuilder
  private var sourceSection: some View {
    let copy = Copy.ja.ja.place.self
    switch source {
    case .device:
      Section {
        Button(copy.device.action) { start(.device) { await findNearby() } }.disabled(model.privacy == nil)
      } footer: { Text(copy.device.help) }
    case .photo:
      Section {
        PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .current) { Text(copy.photo.action) }.disabled(model.privacy == nil)
      } footer: { Text(copy.photo.help) }
    case .search:
      Section {
        TextField(copy.search.label, text: limited($query, 60)).onSubmit { search() }.submitLabel(.search).accessibilityIdentifier("place.search.query")
        Button(copy.search.submit) { search() }.disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
      } footer: { Text(copy.search.help) }
    case .manual:
      Section {
        TextField(copy.manual.name, text: limited($manualName, 120)).accessibilityIdentifier("place.manual.name")
        TextField(copy.manual.address, text: limited($manualAddress, 200)).accessibilityIdentifier("place.manual.address")
        if !manualError.isEmpty { Text(manualError).foregroundStyle(theme.colors.danger.color) }
        Button(copy.manual.apply) { applyManual() }.accessibilityIdentifier("place.manual.apply")
      }
    }
  }

  @ViewBuilder
  private var panelSection: some View {
    let colors = theme.colors
    let copy = Copy.ja.ja.place.self
    switch panel {
    case .idle:
      EmptyView()
    case .consent(let resume):
      Section(copy.consent.title) {
        ForEach(copy.consent.points, id: \.self) { Text($0).font(.callout) }
        Text(copy.consent.revokeHint).font(.footnote).foregroundStyle(colors.inkSoft.color)
        Button(copy.consent.accept) { Task { await grant(resume) } }.accessibilityIdentifier("place.consent.accept")
        Button(copy.consent.decline) { source = .manual }
      }
    case .busy(let message):
      Section { HStack { ProgressView(); Text(message) } }
    case .results(let origin, let candidates, let notice):
      Section {
        Text(origin == .search ? "\(candidates.count)件の候補があります。" : "\(candidates.count)件の候補があります。近い順に並べています。").font(.footnote)
        if let notice { Text(notice).font(.footnote).foregroundStyle(colors.inkSoft.color) }
        ForEach(candidates) { candidate in
          Button { pick(candidate, via: origin) } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(candidate.name).foregroundStyle(colors.ink.color)
              let meta = [candidate.address.isEmpty ? nil : candidate.address, candidate.distanceMeters.map(Places.distanceLabel), Places.categoryLabel(candidate.category)].compactMap { $0 }.joined(separator: " · ")
              if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(colors.inkSoft.color) }
            }
          }
        }
      } footer: { Text("\(copy.attributionPrefix): \(copy.attributionLabel)") }
    case .empty(let origin):
      Section {
        Text(origin == .device ? copy.empty.device : origin == .photo ? copy.empty.photo : copy.empty.search)
        fallbackButtons(origin)
      }
    case .failed(let message, let retry):
      Section {
        Text(message).foregroundStyle(colors.danger.color)
        if retry { Button(copy.retry) { retryLast() } }
        fallbackButtons(source)
      }
    }
  }

  @ViewBuilder
  private func fallbackButtons(_ origin: PlaceSourceKind) -> some View {
    let copy = Copy.ja.ja.place.self
    if origin != .search { Button(copy.switchToSearch) { source = .search } }
    Button(copy.switchToManual) { source = .manual }
  }

  // MARK: 手順

  @State private var last: (() async -> Void)?

  /// 外部へ送る前に同意を確かめる。同意がなければ、送る内容を示して同意を求める。
  private func start(_ origin: PlaceSourceKind, _ work: @escaping () async -> Void) {
    guard consented else { panel = .consent(resume: origin); last = work; return }
    last = work
    running?.cancel()
    running = Task { await work() }
  }

  private func retryLast() { if let last { start(source, last) } }

  private func grant(_ resume: PlaceSourceKind) async {
    let now = CalendarDate.toJstRfc3339(Date())
    switch await model.updatePrivacy({ $0.placeLookupConsent = PlaceLookupConsent(noticeVersion: OpenPoiLookup.noticeVersion, grantedAt: now) }) {
    case .success:
      if let last { running = Task { await last() } } else { panel = .idle }
    case .failure:
      panel = .failed(Copy.ja.ja.place.failures["consent-failed"] ?? "", retry: false)
    }
  }

  private func failure(_ key: String, retry: Bool = false) { panel = .failed(Copy.ja.ja.place.failures[key] ?? key, retry: retry) }

  private func failure(_ error: GatewayError) {
    let key = [GatewayErrorCode.offline, .rateLimited].contains(error.code) ? error.code.rawValue : "UPSTREAM_FAILURE"
    failure(key, retry: error.retryable)
  }

  private func candidates(_ rows: [PlaceRow]) -> [Geo.Candidate] {
    rows.map { Geo.Candidate(key: Places.key(name: $0.name, address: $0.address), name: $0.name, address: $0.address, lat: $0.lat, lng: $0.lng, category: $0.category, source: $0.source, licenses: $0.licenses, attributions: $0.attributions) }
  }

  private func findNearby() async {
    panel = .busy(Copy.ja.ja.place.device.busy)
    switch await LocationOnce().request() {
    case .failure(let problem): failure(problem.key, retry: problem.key != "geo-denied")
    case .success(let location):
      if location.horizontalAccuracy > Geo.coarseAccuracyMeters {
        exact = Geo.Position(lat: location.coordinate.latitude, lng: location.coordinate.longitude)
        source = .search
        failure("geo-coarse")
        return
      }
      await showNearby(Geo.Position(lat: location.coordinate.latitude, lng: location.coordinate.longitude), origin: .device, approximate: location.horizontalAccuracy > Geo.approximateAccuracyMeters)
    }
  }

  private func showNearby(_ position: Geo.Position, origin: PlaceSourceKind, approximate: Bool) async {
    exact = position
    let center = Geo.coarsen(position)
    switch await lookup.nearby(lat: center.lat, lng: center.lng, radius: Geo.nearbyRadiusMeters) {
    case .failure(let error): failure(error)
    case .success(let rows):
      let ranked = Geo.rank(candidates(rows), from: position)
      panel = ranked.isEmpty ? .empty(origin) : .results(origin: origin, candidates: ranked, notice: approximate ? Copy.ja.ja.place.approximate : nil)
    }
  }

  private func readPhoto(_ item: PhotosPickerItem) async {
    panel = .busy(Copy.ja.ja.place.photo.busy)
    photo = nil
    guard let data = try? await item.loadTransferable(type: Data.self) else { failure("photo-malformed"); return }
    guard data.count <= 30 * 1024 * 1024 else { failure("photo-too-large"); return }
    switch PhotoLocation.read(data) {
    case .failure(let problem): failure(problem.key)
    case .success(let position): await showNearby(position, origin: .photo, approximate: false)
    }
  }

  private func search() {
    let text = query.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return }
    start(.search) {
      panel = .busy(Copy.ja.ja.place.search.busy)
      let center = exact.map(Geo.coarsen)
      switch await lookup.search(text, lat: center?.lat, lng: center?.lng) {
      case .failure(let error): failure(error)
      case .success(let result):
        var found = candidates(result.rows)
        if let exact { found = found.map { var item = $0; item.distanceMeters = Geo.haversine(exact, Geo.Position(lat: $0.lat, lng: $0.lng)); return item } }
        panel = found.isEmpty ? .empty(.search) : .results(origin: .search, candidates: found, notice: result.nationwide ? Copy.ja.ja.place.nationwide : nil)
      }
    }
  }

  private func applyManual() {
    let name = Account.jsTrim(manualName), address = Account.jsTrim(manualAddress)
    if name.isEmpty { manualError = "場所の名前を入力してください。"; return }
    onPick(PlaceRef(name: name, address: address.isEmpty ? nil : address, capturedVia: .manual, selectedAt: CalendarDate.toJstRfc3339(Date())))
    model.announce("「\(name)」を場所に設定しました。")
    dismiss()
  }

  private func pick(_ candidate: Geo.Candidate, via origin: PlaceSourceKind) {
    let via: PlaceCaptureSource = origin == .device ? .device : origin == .photo ? .photo : .search
    onPick(Geo.placeRef(candidate, via: via, now: Date()))
    model.announce("「\(candidate.name)」を場所に設定しました。")
    dismiss()
  }
}

/// 写真に記録された位置（Web の exif.ts）。端末の中で読むだけで、写真は送らない。
enum PhotoLocation {
  static func read(_ data: Data) -> Result<Geo.Position, PlaceFailure> {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return .failure(PlaceFailure("photo-unsupported")) }
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return .failure(PlaceFailure("photo-malformed")) }
    guard let gps = properties[kCGImagePropertyGPSDictionary] as? [CFString: Any],
          var lat = gps[kCGImagePropertyGPSLatitude] as? Double, var lng = gps[kCGImagePropertyGPSLongitude] as? Double else { return .failure(PlaceFailure("photo-no-gps")) }
    if (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" { lat = -lat }
    if (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" { lng = -lng }
    guard abs(lat) <= 90, abs(lng) <= 180, lat != 0 || lng != 0 else { return .failure(PlaceFailure("photo-malformed")) }
    return .success(Geo.Position(lat: lat, lng: lng))
  }
}

/// 現在地を1度だけ確かめる。正確な位置は端末の中だけで使う。
@MainActor
final class LocationOnce: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var continuation: CheckedContinuation<Result<CLLocation, PlaceFailure>, Never>?

  func request() async -> Result<CLLocation, PlaceFailure> {
    guard CLLocationManager.locationServicesEnabled() else { return .failure(PlaceFailure("geo-unsupported")) }
    return await withCheckedContinuation { continuation in
      self.continuation = continuation
      manager.delegate = self
      manager.desiredAccuracy = kCLLocationAccuracyBest
      switch manager.authorizationStatus {
      case .notDetermined: manager.requestWhenInUseAuthorization()
      case .denied, .restricted: finish(.failure(PlaceFailure("geo-denied")))
      default: manager.requestLocation()
      }
      Task { try? await Task.sleep(for: .seconds(15)); self.finish(.failure(PlaceFailure("geo-timeout"))) }
    }
  }

  private func finish(_ result: Result<CLLocation, PlaceFailure>) {
    guard let continuation else { return }
    self.continuation = nil
    continuation.resume(returning: result)
  }

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    Task { @MainActor in
      switch status {
      case .denied, .restricted: self.finish(.failure(PlaceFailure("geo-denied")))
      case .notDetermined: break
      default: self.manager.requestLocation()
      }
    }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    Task { @MainActor in self.finish(.success(location)) }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let denied = (error as? CLError)?.code == .denied
    Task { @MainActor in self.finish(.failure(PlaceFailure(denied ? "geo-denied" : "geo-unavailable"))) }
  }
}

/// 場所を探せなかった理由（Copy の place.failures の鍵）。
struct PlaceFailure: Error, Equatable {
  let key: String
  init(_ key: String) { self.key = key }
}
