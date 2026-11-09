import Foundation
import Testing
@testable import FHGateway
import FHModel

private let agent = "Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1"
private func fixture(_ name: String) -> String { (try? String(contentsOf: fixtureURL(name), encoding: .utf8)) ?? "{}" }

/// 設定（段階 S7）の経路と本文が、Web の httpGateway.ts と同じこと。
struct SettingsRouteTests {
  @Test func routesAndBodies() async throws {
    let member = ##"{"id":"member-ren","householdId":"house-mori","userId":"user-ren","displayName":"蓮","role":"adult","status":"active","color":"#2f6db5","version":2}"##
    let label = ##"{"id":"label-1","householdId":"house-mori","name":"学校","color":"#315c80"}"##
    let server = StubServer { request, _ in
      let path = request.url?.path ?? ""
      let method = request.httpMethod ?? "GET"
      if path == "/v1/auth/csrf" { return (200, #"{"token":"t"}"#, [:]) }
      if method == "DELETE" && !path.contains("household-invites") && !path.hasSuffix("permission-overrides") { return (204, "", [:]) }
      switch path {
      case "/v1/account", "/v1/account/email": return (200, fixture("account"), [:])
      case "/v1/account/totp": return (200, #"{"otpauthUri":"otpauth://totp/x?secret=ABC"}"#, [:])
      case "/v1/account/totp/confirm": return (200, #"{"recoveryCodes":["A-1","B-2"]}"#, [:])
      case "/v1/auth/security": return (200, fixture("security"), [:])
      case "/v1/auth/passkeys/registration": return (200, #"{"challengeId":"c-1","publicKey":{"challenge":"AQID","rp":{"id":"example.test","name":"よりどころ"},"user":{"id":"dXNlcg","name":"a@example.test","displayName":"碧"}}}"#, [:])
      case "/v1/auth/passkeys/registration/complete": return (201, #"{"id":"pk-1","label":"iPhone","createdAt":"2026-09-30T07:30:00+09:00","kind":"passkey","demo":false}"#, [:])
      case "/v1/auth/password/change", "/v1/households/current/leave": return (204, "", [:])
      case "/v1/households/current": return (200, #"{"id":"house-mori","name":"森の家","timezone":"Asia/Tokyo"}"#, [:])
      case "/v1/household-invites": return (200, method == "GET" ? fixture("invites") : #"{"id":"invite-2","householdId":"house-mori","role":"child","token":"ABC-123","expiresAt":"2026-10-01T07:30:00+09:00","remainingUses":1}"#, [:])
      case "/v1/household-invites/invite-2": return (200, #"{"id":"invite-2","householdId":"house-mori","role":"child","expiresAt":"2026-10-01T07:30:00+09:00","remainingUses":0,"revokedAt":"2026-09-30T07:31:00+09:00"}"#, [:])
      case "/v1/household-memberships/member-ren/permission-overrides": return (200, method == "GET" ? #"[{"membershipId":"member-ren","capability":"expense.settle","effect":"deny"}]"# : fixture("snapshot.member-aoi"), [:])
      case "/v1/color-labels", "/v1/color-labels/label-1": return (200, label, [:])
      case "/v1/recently-deleted": return (200, fixture("trash"), [:])
      case "/v1/audit-events": return (200, fixture("audit"), [:])
      case "/v1/account/audit-events": return (200, fixture("auditMine"), [:])
      default: return (200, member, [:])
      }
    }
    let gateway = HTTPGateway(baseURL: server.baseURL, userAgent: agent, session: server.session())
    func body() throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: try #require(server.seen.last?.body)) }
    func last() -> (method: String, path: String, query: String?) {
      let seen = server.seen.last!
      return (seen.method, seen.path, seen.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.percentEncodedQuery })
    }

    _ = try await gateway.getAccount().get()
    _ = try await gateway.updateAccount(AccountUpdateInput(displayName: "碧", avatar: .preset("leaf"))).get()
    #expect(last().method == "PATCH" && last().path == "/v1/account")
    #expect(try body() == .object(["displayName": .string("碧"), "avatar": .object(["kind": .string("preset"), "preset": .string("leaf")])]))
    _ = try await gateway.changeEmail("b@example.test").get()
    #expect(try body() == .object(["email": .string("b@example.test")]))
    #expect(try await gateway.beginTotpEnrollment().get().otpauthUri.hasPrefix("otpauth://"))
    #expect(last().method == "POST")
    #expect(try await gateway.confirmTotpEnrollment(code: "123456").get().recoveryCodes.count == 2)
    #expect(try body() == .object(["code": .string("123456")]))
    _ = try await gateway.disableTotp().get()
    #expect(last() == ("DELETE", "/v1/account/totp", nil))
    _ = try await gateway.deleteAccount().get()
    #expect(last() == ("DELETE", "/v1/account", nil))

    #expect(try await gateway.getSecurityOverview().get().sessions.count >= 1)
    let start = try await gateway.beginPasskeyRegistration().get()
    #expect(start.challengeId == "c-1")
    guard case .object(let options)? = start.publicKey, case .object(let rp)? = options["rp"] else { Issue.record("publicKey を読めない"); return }
    #expect(rp["id"] == .string("example.test"))
    _ = try await gateway.finishPasskeyRegistration(challengeId: "c-1", credential: .object(["id": .string("x")])).get()
    #expect(try body() == .object(["challengeId": .string("c-1"), "credential": .object(["id": .string("x")])]))
    _ = try await gateway.changePassword(current: "old", new: "new").get()
    #expect(try body() == .object(["currentPassword": .string("old"), "newPassword": .string("new")]))
    _ = try await gateway.revokeSession(id: "s/1").get()
    #expect(last().path == "/v1/auth/sessions/s/1" && server.seen.last?.url?.absoluteString.hasSuffix("/v1/auth/sessions/s%2F1") == true)

    #expect(try await gateway.updateHouseholdProfile(HouseholdProfileInput(name: "森の家")).get().name == "森の家")
    #expect(try body() == .object(["name": .string("森の家")]))
    _ = try await gateway.updateMembershipRole(id: "member-ren", role: .child, expectedVersion: 2).get()
    #expect(last().method == "PATCH" && last().path == "/v1/household-memberships/member-ren")
    #expect(try body() == .object(["role": .string("child"), "expectedVersion": .number(2)]))
    #expect(try await gateway.createInvite(role: .child).get().token == "ABC-123")
    #expect(try body() == .object(["role": .string("child")]))
    #expect(try await gateway.listInvites().get().count == 1)
    #expect(try await gateway.revokeInvite(id: "invite-2").get().revokedAt != nil)
    #expect(last().method == "DELETE")
    #expect(try await gateway.getPermissionOverrides(membershipId: "member-ren").get().first?.effect == "deny")
    _ = try await gateway.updatePermissionOverrides(membershipId: "member-ren", overrides: [PermissionOverride(membershipId: "member-ren", capability: .expenseSettle, effect: "allow")], expectedPermissionRevision: 7).get()
    #expect(last().method == "PUT")
    #expect(try body() == .object(["overrides": .array([.object(["membershipId": .string("member-ren"), "capability": .string("expense.settle"), "effect": .string("allow")])]), "expectedPermissionRevision": .number(7)]))
    _ = try await gateway.resetPermissionOverrides(membershipId: "member-ren", expectedPermissionRevision: 7).get()
    #expect(last() == ("DELETE", "/v1/household-memberships/member-ren/permission-overrides", "expectedPermissionRevision=7"))

    _ = try await gateway.transferOwnership(toMembershipId: "member-ren", expectedVersion: 2).get()
    #expect(last().path == "/v1/households/current/ownership")
    #expect(try body() == .object(["toMembershipId": .string("member-ren"), "expectedVersion": .number(2)]))
    _ = try await gateway.setMemberStatus(membershipId: "member-ren", status: .suspended, expectedVersion: 2).get()
    #expect(last().method == "PUT" && last().path == "/v1/household-memberships/member-ren/status")
    #expect(try body() == .object(["status": .string("suspended"), "expectedVersion": .number(2)]))
    _ = try await gateway.removeMember(membershipId: "member-ren", expectedVersion: 3).get()
    #expect(last() == ("DELETE", "/v1/household-memberships/member-ren", "expectedVersion=3"))
    _ = try await gateway.leaveHousehold().get()
    #expect(last() == ("POST", "/v1/households/current/leave", nil))
    _ = try await gateway.createColorLabel(ColorLabelInput(name: "学校", color: "#315c80")).get()
    #expect(try body() == .object(["name": .string("学校"), "color": .string("#315c80")]))
    _ = try await gateway.updateColorLabel(id: "label-1", input: ColorLabelInput(name: "学校", color: "#2f6db5")).get()
    #expect(last().method == "PUT")
    _ = try await gateway.deleteColorLabel(id: "label-1").get()
    #expect(last() == ("DELETE", "/v1/color-labels/label-1", nil))

    #expect(try await gateway.listTrash().get().count >= 1)
    _ = try await gateway.listAudit(AuditQuery(cursor: "", limit: 20, group: "tasks", from: "2026-09-24", to: "2026-09-30")).get()
    #expect(last() == ("GET", "/v1/audit-events", "limit=20&group=tasks&from=2026-09-24&to=2026-09-30"))
    _ = try await gateway.listMyAudit(AccountAuditQuery(cursor: "12", limit: 20)).get()
    #expect(last() == ("GET", "/v1/account/audit-events", "cursor=12&limit=20"))
  }
}

/// 見本で、設定の操作が規則どおりに動くこと（管理者の碧さん）。
struct SampleSettingsTests {
  let gateway: SampleGateway
  init() throws { gateway = SampleGateway(engine: try SampleEngine(timeScale: 0.01)) }

  @Test func accountAndSecurity() async throws {
    let account = try await gateway.updateAccount(AccountUpdateInput(displayName: "あおい", avatar: .preset("sun"), idleTimeoutMinutes: 15)).get()
    #expect(account.displayName == "あおい" && account.avatar == .preset("sun") && account.idleTimeoutMinutes == 15)
    #expect(try await gateway.getSnapshot().get().memberships.contains { $0.displayName == "あおい" })
    guard case .failure = await gateway.updateAccount(AccountUpdateInput(idleTimeoutMinutes: 7)) else { Issue.record("選べない時間は断られるはず"); return }
    #expect(try await gateway.changeEmail("new@example.test").get().email == "new@example.test")
    let enrollment = try await gateway.beginTotpEnrollment().get()
    #expect(enrollment.otpauthUri.hasPrefix("otpauth://"))
    #expect(try await gateway.confirmTotpEnrollment(code: "000000").get().recoveryCodes.isEmpty == false)
    #expect(try await gateway.getAccount().get().totpEnabled)
    _ = try await gateway.disableTotp().get()
    #expect(try await gateway.getAccount().get().totpEnabled == false)
    guard case .failure(let refused) = await gateway.deleteAccount() else { Issue.record("見本では削除できないはず"); return }
    #expect(refused.code == .conflict)

    let before = try await gateway.getSecurityOverview().get()
    let start = try await gateway.beginPasskeyRegistration().get()
    #expect(start.publicKey == nil)
    let added = try await gateway.finishPasskeyRegistration(challengeId: start.challengeId, credential: .object(["id": .string("sample"), "demo": .bool(true)])).get()
    #expect(added.demo)
    #expect(try await gateway.getSecurityOverview().get().authenticators.count == before.authenticators.count + 1)
    let other = try #require(before.sessions.first { !$0.current })
    _ = try await gateway.revokeSession(id: other.id).get()
    #expect(try await gateway.getSecurityOverview().get().sessions.contains { $0.id == other.id } == false)
    guard case .failure(let current) = await gateway.revokeSession(id: try #require(before.sessions.first { $0.current }).id) else { Issue.record("この端末は外せないはず"); return }
    #expect(current.code == .forbidden)
    guard case .failure(let wrong) = await gateway.changePassword(current: "short", new: "correct horse battery staple") else { Issue.record("短い今のパスワードは断られるはず"); return }
    #expect(wrong.code == .unauthenticated)
    #expect((try? await gateway.changePassword(current: "a-long-enough-password", new: "sunset ladder quietly lantern").get()) != nil)
  }

  @Test func householdManagement() async throws {
    var snapshot = try await gateway.getSnapshot().get()
    #expect(snapshot.viewer.role == .owner)
    let renamed = try await gateway.updateHouseholdProfile(HouseholdProfileInput(name: "森の家")).get()
    #expect(renamed.name == "森の家")
    let invite = try await gateway.createInvite(role: .child).get()
    #expect(invite.token?.isEmpty == false)
    #expect(try await gateway.listInvites().get().contains { $0.id == invite.id })
    #expect(try await gateway.revokeInvite(id: invite.id).get().revokedAt != nil)

    let ren = try #require(snapshot.memberships.first { $0.id == "member-ren" })
    let overrides = [PermissionOverride(membershipId: ren.id, capability: .expenseSettle, effect: "deny")]
    snapshot = try await gateway.updatePermissionOverrides(membershipId: ren.id, overrides: overrides, expectedPermissionRevision: snapshot.viewer.permissionRevision).get()
    #expect(try await gateway.getPermissionOverrides(membershipId: ren.id).get() == overrides)
    snapshot = try await gateway.resetPermissionOverrides(membershipId: ren.id, expectedPermissionRevision: snapshot.viewer.permissionRevision).get()
    #expect(try await gateway.getPermissionOverrides(membershipId: ren.id).get().isEmpty)
    guard case .failure(let stale) = await gateway.resetPermissionOverrides(membershipId: ren.id, expectedPermissionRevision: 0) else { Issue.record("古い版は断られるはず"); return }
    #expect(stale.code == .conflict)

    let suspended = try await gateway.setMemberStatus(membershipId: ren.id, status: .suspended, expectedVersion: ren.version).get()
    #expect(suspended.status == .suspended)
    let resumed = try await gateway.setMemberStatus(membershipId: ren.id, status: .active, expectedVersion: suspended.version).get()
    let child = try await gateway.updateMembershipRole(id: ren.id, role: .child, expectedVersion: resumed.version).get()
    #expect(child.role == .child)
    guard case .failure = await gateway.leaveHousehold() else { Issue.record("ただ1人の管理者は退出できないはず"); return }

    let label = try await gateway.createColorLabel(ColorLabelInput(name: "習い事", color: "#2e7d4f")).get()
    #expect(try await gateway.updateColorLabel(id: label.id, input: ColorLabelInput(name: "習い事", color: "#b0487a")).get().color == "#b0487a")
    _ = try await gateway.deleteColorLabel(id: label.id).get()
    #expect(try await gateway.getSnapshot().get().colorLabels.contains { $0.id == label.id } == false)
  }

  @Test func trashAndAudit() async throws {
    let memo = try #require(try await gateway.getSnapshot().get().memos.first { $0.authorMembershipId == "member-aoi" })
    _ = try await gateway.deleteMemo(id: memo.id).get()
    let trash = try await gateway.listTrash().get()
    #expect(trash.contains { $0.kind == .memo && $0.id == memo.id })
    _ = try await gateway.restoreMemo(id: memo.id).get()
    #expect(try await gateway.listTrash().get().contains { $0.id == memo.id } == false)

    let page = try await gateway.listAudit(AuditQuery(limit: 2)).get()
    #expect(page.items.count <= 2)
    #expect(page.chain.state == "ok")
    if let cursor = page.nextCursor {
      let next = try await gateway.listAudit(AuditQuery(cursor: cursor, limit: 2)).get()
      #expect(Set(next.items.map(\.id)).isDisjoint(with: page.items.map(\.id)))
    }
    let tasks = try await gateway.listAudit(AuditQuery(limit: 20, group: "tasks")).get()
    #expect(tasks.items.allSatisfy { $0.group == "tasks" })
    _ = try await gateway.listMyAudit(AccountAuditQuery(limit: 20)).get()
  }
}

/// パスキーの登録の形が、Web の browserPasskeyOptions と serializeRegistration と同じこと。
struct PasskeyWireTests {
  @Test func base64url() {
    #expect(Base64URL.encode(Data([0xfb, 0xff, 0xfe])) == "-__-")
    #expect(Base64URL.decode("-__-") == Data([0xfb, 0xff, 0xfe]))
    #expect(Base64URL.decode("AQID") == Data([1, 2, 3]))
    #expect(Base64URL.decode("AQ") == Data([1]))
  }

  @Test func optionsAndResponse() throws {
    let json = #"{"challenge":"AQID","rp":{"id":"example.test","name":"よりどころ"},"user":{"id":"dXNlcg","name":"a@example.test","displayName":"碧"},"excludeCredentials":[{"id":"BAU","type":"public-key"}]}"#
    let options = try #require(PasskeyWire.options(try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))))
    #expect(options == PasskeyWire.CreationOptions(challenge: Data([1, 2, 3]), relyingParty: "example.test", userId: Data("user".utf8), userName: "a@example.test", excluded: [Data([4, 5])]))
    #expect(PasskeyWire.options(nil) == nil)
    #expect(PasskeyWire.options(.object(["challenge": .string("AQID")])) == nil)
    let response = PasskeyWire.registrationJSON(credentialId: Data([0xfb, 0xff]), clientDataJSON: Data("{}".utf8), attestationObject: Data([0]))
    #expect(response == .object([
      "id": .string("-_8"), "type": .string("public-key"), "rawId": .string("-_8"), "authenticatorAttachment": .string("platform"),
      "clientExtensionResults": .object([:]),
      "response": .object(["clientDataJSON": .string("e30"), "attestationObject": .string("AA"), "transports": .array([.string("internal"), .string("hybrid")])]),
    ]))
  }
}
