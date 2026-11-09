import Foundation
import Testing
@testable import FHDomain

/// Web の TS の関数が出した答え（scripts/ios/export-vectors.ts）と、Swift の移植が同じになること。
struct Vector<Input: Decodable & Sendable, Expected: Decodable & Sendable>: Decodable, Sendable {
  let input: Input
  let expected: Expected
}

enum Vectors {
  static func load<Input, Expected>(_ name: String, _: Input.Type, _: Expected.Type) -> [Vector<Input, Expected>] {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Vectors"),
          let data = try? Data(contentsOf: url),
          let cases = try? JSONDecoder().decode([Vector<Input, Expected>].self, from: data) else { return [] }
    return cases
  }
}

struct DateKeys: Decodable, Sendable { let date: String; let month: String }
struct DayShift: Decodable, Sendable { let date: String; let delta: Int }
struct MonthShift: Decodable, Sendable { let month: String; let delta: Int }
struct YenText: Decodable, Sendable { let yen: String; let signed: String }
struct TimeText: Decodable, Sendable { let time: String; let date: String }

/// [日付, 日, 今月か] の組。
struct GridCell: Decodable, Sendable, Equatable {
  let date: String
  let day: Int
  let inCurrentMonth: Bool
  init(from decoder: any Decoder) throws {
    var container = try decoder.unkeyedContainer()
    date = try container.decode(String.self)
    day = try container.decode(Int.self)
    inCurrentMonth = try container.decode(Bool.self)
  }
}

struct VectorTests {
  @Test func everyVectorFileLoads() {
    #expect(Vectors.load("holidays", Int.self, [[String]].self).count == 96)
    #expect(Vectors.load("monthGrid", String.self, [GridCell].self).count == 192)
  }

  @Test(arguments: Vectors.load("holidays", Int.self, [[String]].self))
  func holidays(_ vector: Vector<Int, [[String]]>) {
    #expect(Holidays.of(year: vector.input).map { [$0.date, $0.name] } == vector.expected, "\(vector.input)年")
  }

  @Test(arguments: Vectors.load("dateKeys", String.self, DateKeys.self))
  func dateKeys(_ vector: Vector<String, DateKeys>) {
    #expect(CalendarDate.dateKey(fromRfc3339: vector.input) == vector.expected.date)
    #expect(CalendarDate.monthKey(fromRfc3339: vector.input) == vector.expected.month)
  }

  @Test(arguments: Vectors.load("toJst", String.self, String.self))
  func toJst(_ vector: Vector<String, String>) throws {
    #expect(CalendarDate.toJstRfc3339(try #require(Tokyo.parse(vector.input))) == vector.expected)
  }

  @Test(arguments: Vectors.load("addDays", DayShift.self, String.self))
  func addDays(_ vector: Vector<DayShift, String>) {
    #expect(CalendarDate.addDays(vector.input.date, vector.input.delta) == vector.expected)
  }

  @Test(arguments: Vectors.load("shiftMonth", MonthShift.self, String.self))
  func shiftMonth(_ vector: Vector<MonthShift, String>) {
    #expect(CalendarDate.shiftMonth(vector.input.month, vector.input.delta) == vector.expected)
  }

  @Test(arguments: Vectors.load("isMonthKey", String.self, Bool.self))
  func isMonthKey(_ vector: Vector<String, Bool>) {
    #expect(CalendarDate.isMonthKey(vector.input) == vector.expected, "\(vector.input)")
  }

  @Test(arguments: Vectors.load("monthGrid", String.self, [GridCell].self))
  func monthGrid(_ vector: Vector<String, [GridCell]>) {
    let grid = CalendarDate.monthGrid(vector.input)
    #expect(grid.map(\.date) == vector.expected.map(\.date), "\(vector.input)")
    #expect(grid.map(\.day) == vector.expected.map(\.day))
    #expect(grid.map(\.inCurrentMonth) == vector.expected.map(\.inCurrentMonth))
  }

  @Test(arguments: Vectors.load("weekDates", String.self, [String].self))
  func weekDates(_ vector: Vector<String, [String]>) {
    #expect(CalendarDate.weekDates(vector.input) == vector.expected)
  }

  @Test(arguments: Vectors.load("formatYen", Int.self, YenText.self))
  func formatYen(_ vector: Vector<Int, YenText>) {
    #expect(Format.yen(vector.input) == vector.expected.yen)
    #expect(Format.signedYen(vector.input) == vector.expected.signed)
  }

  @Test(arguments: Vectors.load("formatTime", String.self, TimeText.self))
  func formatTime(_ vector: Vector<String, TimeText>) {
    #expect(Format.time(vector.input) == vector.expected.time)
    #expect(Format.date(vector.input) == vector.expected.date)
  }

  @Test(arguments: Vectors.load("formatDateOnly", String.self, String.self))
  func formatDateOnly(_ vector: Vector<String, String>) {
    #expect(Format.dateOnly(vector.input) == vector.expected)
  }

  @Test(arguments: Vectors.load("formatDue", String?.self, String.self))
  func formatDue(_ vector: Vector<String?, String>) {
    #expect(Format.due(vector.input, asOf: "2026-09-30T07:30:00+09:00") == vector.expected)
  }

  @Test(arguments: Vectors.load("formatRelative", String.self, String.self))
  func formatRelative(_ vector: Vector<String, String>) {
    #expect(Format.relative(vector.input, asOf: "2026-09-30T07:30:00+09:00") == vector.expected)
  }
}
