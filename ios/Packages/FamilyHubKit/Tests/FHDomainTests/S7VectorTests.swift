import Foundation
import Testing
import FHModel
@testable import FHDomain

/// 段階 S7（設定）の規則が、Web の TS の関数の答えと同じになること。
struct HouseholdLimitVectorTests {
  @Test(arguments: JSON.cases("nameChangesLeft"))
  func nameChanges(_ vector: JSONCase) throws {
    let changes: [String] = try JSON.decode(vector.input)
    let now = "2026-09-30T07:30:00+09:00"
    #expect(same(HouseholdLimits.nameChangesLeft(changes, now: now), vector.expected["left"]), "\(changes)")
    #expect(same(HouseholdLimits.recentNameChanges(changes, now: now), vector.expected["recent"]), "\(changes)")
  }

  @Test(arguments: JSON.cases("leaveStates"))
  func leave(_ vector: JSONCase) throws {
    let members: [HouseholdMembership] = try JSON.decode(JSON.load("leaveMembers")[vector.input["name"].string!])
    let viewer = vector.input["viewer"].string!
    #expect(HouseholdLimits.leaveState(members, viewer: viewer).rawValue == vector.expected["state"].string, "\(vector.input)")
    #expect(same(HouseholdLimits.activeMemberCount(members), vector.expected["active"]))
    #expect(same(HouseholdLimits.activeOwners(members).map(\.id), vector.expected["owners"]))
  }

  @Test(arguments: JSON.cases("householdNames"))
  func names(_ vector: JSONCase) {
    #expect(HouseholdLimits.nameProblem(vector.input.string!) == vector.expected.string, "\(vector.input)")
  }
}

struct RoleCapabilityVectorTests {
  @Test(arguments: JSON.cases("roleCapabilities"))
  func roles(_ vector: JSONCase) {
    let role = MembershipRole(rawValue: vector.input.string!)
    #expect(same(RoleCapabilities.ceiling(role), vector.expected["ceiling"]), "\(role)")
    #expect(same(RoleCapabilities.defaults(role), vector.expected["defaults"]), "\(role)")
  }

  @Test(arguments: JSON.cases("capabilityOverrides"))
  func overrides(_ vector: JSONCase) throws {
    let overrides: [PermissionOverride] = try JSON.decode(vector.input["overrides"])
    let role = MembershipRole(rawValue: vector.input["role"].string!)
    #expect(same(RoleCapabilities.capabilities(role, overrides: overrides), vector.expected), "\(vector.input)")
  }
}

struct AuditViewVectorTests {
  @Test(arguments: JSON.cases("auditQueries"))
  func queries(_ vector: JSONCase) throws {
    let filters: AuditView.Filters = try JSON.decode(vector.input["filters"])
    let query = AuditView.query(filters, asOf: vector.input["asOf"].string!, cursor: vector.input["cursor"].string)
    #expect(same(query, vector.expected), "\(vector.input)")
  }

  @Test(arguments: JSON.cases("auditTargets"))
  func targets(_ vector: JSONCase) throws {
    let target: AuditTarget? = vector.input == .null ? nil : try JSON.decode(vector.input)
    #expect(AuditView.destination(target) == vector.expected.string, "\(vector.input)")
  }

  @Test(arguments: JSON.cases("auditFields"))
  func fields(_ vector: JSONCase) throws {
    #expect(AuditView.fieldsText(try JSON.decode(vector.input)) == vector.expected.string, "\(vector.input)")
  }

  @Test(arguments: JSON.cases("auditActions"))
  func actions(_ vector: JSONCase) {
    #expect(AuditView.actionLabel(vector.input.string!) == vector.expected.string, "\(vector.input)")
  }

  @Test func days() throws {
    let data = JSON.load("auditDays")
    let items: [AuditEntry] = try JSON.decode(data["input"])
    let days = AuditView.groupByDay(items, at: \.at).map { ["day": JSONValue.string($0.day), "ids": .array($0.items.map { .string($0.id) })] }
    #expect(same(days, data["expected"]))
  }
}

struct HelpAndListVectorTests {
  @Test func helpLoads() {
    #expect(Help.items.count > 10)
    #expect(Help.categories.count == 4)
    #expect(Legal.documents.count >= 2)
    #expect(!Legal.notice.isEmpty)
  }

  @Test(arguments: JSON.cases("helpFilters"))
  func help(_ vector: JSONCase) {
    let ids = Help.filter(Help.items, query: vector.input["query"].string!, category: vector.input["category"].string).map(\.id)
    #expect(same(ids, vector.expected), "\(vector.input)")
  }

  @Test(arguments: JSON.cases("colorLabelInputs"))
  func colorLabels(_ vector: JSONCase) {
    switch ColorLabels.input(name: vector.input["name"].string!, color: vector.input["color"].string!) {
    case .success(let input): #expect(same(input, vector.expected["ok"]), "\(vector.input)")
    case .failure(let problem): #expect(problem.message == vector.expected["message"].string, "\(vector.input)")
    }
  }

  @Test func legalPlaceholders() {
    let parts = Legal.parts("この規約は、【運営者名：公開前に記入】が提供する【サービス】です。")
    #expect(parts.map(\.placeholder) == [false, true, false, true, false])
    #expect(parts.map(\.text).joined() == "この規約は、【運営者名：公開前に記入】が提供する【サービス】です。")
  }
}

struct SettingsTabTests {
  @Test func twelveTabs() {
    #expect(SettingsTab.all.map(\.key) == ["household", "security", "account", "privacy", "notifications", "location", "accessibility", "resources", "recently-deleted", "audit", "help", "legal"])
    #expect(SettingsTab.named("audit")?.capability.rawValue == "audit.read")
    // ヘルプの「関連する設定」は、どれも設定のタブを指す。
    #expect(Help.items.compactMap(\.related).allSatisfy { $0.href.hasPrefix("/settings/") && SettingsTab.named(String($0.href.dropFirst("/settings/".count))) != nil })
  }
}
