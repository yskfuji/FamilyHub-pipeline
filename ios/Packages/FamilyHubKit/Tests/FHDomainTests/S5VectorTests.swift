import Foundation
import Testing
import FHModel
@testable import FHDomain

/// 段階 S5（アルバム）の計算が、Web の TS の関数の答え（scripts/ios/export-vectors.ts）と同じになること。
struct AlbumVectorTests {
  static let items: [AlbumItem] = (try? JSON.decode(JSON.load("albumItems"))) ?? []
  static func ids(_ items: [AlbumItem]) -> JSONValue { .array(items.map { .string($0.id) }) }

  @Test func view() {
    let expected = JSON.load("albumView")
    #expect(Self.items.count == 43)
    for pair in expected["filters"].array {
      #expect(sameRaw(Self.ids(AlbumView.grid(Self.items, AlbumFilter(rawValue: pair[0].string!)!)), pair[1]))
    }
    let counts = AlbumView.counts(Self.items)
    #expect(sameRaw(.object(Dictionary(uniqueKeysWithValues: counts.map { ($0.key.rawValue, JSONValue.number(Double($0.value))) })), expected["counts"]))
    #expect(sameRaw(Self.ids(AlbumView.rejected(Self.items)), expected["rejected"]))
    #expect(sameRaw(Self.ids(AlbumView.ready(Self.items)), expected["ready"]))
    #expect(AlbumView.hasProcessing(Self.items) == expected["processing"].bool)
    for pair in expected["sorted"].array {
      #expect(sameRaw(Self.ids(AlbumView.sort(AlbumView.grid(Self.items, .all), AlbumSort(rawValue: pair[0].string!)!)), pair[1]), "\(pair[0])")
    }
    for pair in expected["covers"].array {
      #expect(sameRaw(AlbumView.cover(pair[0].string, Self.items).map { .string($0.id) } ?? .null, pair[1]), "\(pair[0])")
    }
    for row in expected["slideshow"].array {
      let result = AlbumView.slideshow(Self.items, includeVideos: row[0].bool!)
      #expect(sameRaw(Self.ids(result.items), row[1]))
      #expect(result.keptVideos == row[2].bool)
    }
    let videos = AlbumView.slideshow(Self.items.filter { $0.kind == .video }, includeVideos: false)
    #expect(sameRaw(Self.ids(videos.items), expected["videosOnly"][0]))
    #expect(videos.keptVideos == expected["videosOnly"][1].bool)
    for pair in expected["neighbors"].array {
      #expect(sameRaw(AlbumView.neighbor(afterRemoving: pair[0].string!, in: Self.items).map { .string($0.id) } ?? .null, pair[1]), "\(pair[0])")
    }
    for pair in expected["parse"][0].array { #expect(AlbumFilter.parse(pair[0].string).rawValue == pair[1].string) }
    for pair in expected["parse"][1].array { #expect(AlbumSort.parse(pair[0].string).rawValue == pair[1].string) }
  }

  @Test(arguments: JSON.cases("albumMoves"))
  func moves(_ vector: JSONCase) {
    let order = Self.items.map(\.id)
    let visible = AlbumView.grid(Self.items, .photos).map(\.id)
    #expect(same(AlbumView.move(order, visible: visible, id: vector.input["id"].string!, step: vector.input["step"].int!), vector.expected))
  }

  @Test(arguments: JSON.cases("albumSteps"))
  func steps(_ vector: JSONCase) {
    #expect(AlbumView.step(vector.input[0].int!, length: vector.input[1].int!, by: vector.input[2].int!) == vector.expected.int)
  }

  @Test(arguments: JSON.cases("albumSwipes"))
  func swipes(_ vector: JSONCase) {
    #expect(AlbumView.swipe(Double(vector.input[0].int!), Double(vector.input[1].int!)) == vector.expected.int)
  }

  @Test(arguments: JSON.cases("albumFiles"))
  func files(_ vector: JSONCase) {
    let input = vector.input
    #expect(AlbumUpload.problem(name: input["name"].string!, type: input["type"].string!, size: input["size"].int!) == vector.expected.string, "\(input)")
  }

  @Test(arguments: JSON.cases("uploadQueues"))
  func queues(_ vector: JSONCase) {
    let states = vector.input.array.compactMap { $0.string.flatMap(UploadState.init(rawValue:)) }
    #expect(same(AlbumUpload.nextToSend(states), vector.expected["next"]), "\(vector.input)")
    #expect(same(AlbumUpload.summarize(states), vector.expected["summary"]), "\(vector.input)")
  }

  @Test(arguments: JSON.cases("stagedMoves"))
  func staged(_ vector: JSONCase) {
    let keys = ["a", "b", "c", "d", "e"]
    let states: [UploadState] = [.staged, .staged, .waiting, .staged, .staged]
    let albums = ["x", "y", "x", "x", "x"]
    let index = keys.firstIndex(of: vector.input["key"].string!)!
    let order = AlbumUpload.moveStaged(states: states, albums: albums, index: index, step: vector.input["step"].int!)
    #expect(same(order.map { keys[$0] }, vector.expected), "\(vector.input)")
  }

  @Test(arguments: JSON.cases("uploadPercents"))
  func percents(_ vector: JSONCase) {
    #expect(AlbumUpload.percent(sent: vector.input[0].int!, total: vector.input[1].int!) == vector.expected.int)
  }

  @Test(arguments: JSON.cases("albumDrafts"))
  func drafts(_ vector: JSONCase) throws {
    let draft: AlbumDraft = try JSON.decode(vector.input["draft"])
    let album: Album = try JSON.decode(JSON.load("albumOriginal"))
    #expect(AlbumForm.problem(draft) == vector.expected["problem"].string)
    #expect(same(AlbumForm.createInput(draft), vector.expected["create"]), "\(vector.input["name"])")
    #expect(same(AlbumForm.updateInput(draft, original: album), vector.expected["update"]), "\(vector.input["name"])")
  }

  @Test func toDraft() throws {
    let album: Album = try JSON.decode(JSON.load("albumOriginal"))
    #expect(same(AlbumForm.draft(from: album), JSON.load("albumToDraft")))
  }

  @Test(arguments: JSON.cases("bgmNotes"))
  func notes(_ vector: JSONCase) {
    let preset = BgmPreset(rawValue: vector.input["preset"].string!)
    let notes = BgmSound.barNotes(preset, bar: vector.input["bar"].int!)
    let expected = vector.expected["notes"].array
    #expect(notes.count == expected.count)
    for (note, want) in zip(notes, expected) {
      // 周波数は 2 の累乗の計算なので、最後の桁の違いを許す。
      guard case .number(let frequency) = want["frequency"], case .number(let beat) = want["beat"], case .number(let beats) = want["beats"], case .number(let level) = want["level"] else { Issue.record("形が違う"); return }
      #expect(abs(note.frequency - frequency) < 1e-9 && abs(note.beat - beat) < 1e-12 && abs(note.beats - beats) < 1e-12 && note.level == level && note.wave.rawValue == want["wave"].string)
    }
    guard case .number(let seconds) = vector.expected["seconds"] else { return }
    #expect(abs(BgmSound.barSeconds(preset) - seconds) < 1e-12)
  }
}
