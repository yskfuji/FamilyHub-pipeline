import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 設定の「家族」（Web の SettingsPage.tsx の Household、ColorLists.tsx、MemberActions.tsx）。
struct HouseholdSettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var householdName = ""
  @State private var renaming = false
  @State private var inviteRole: MembershipRole = .adult
  @State private var invite: HouseholdInvite?
  @State private var invites: [HouseholdInvite] = []
  @State private var member: HouseholdMembership?
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      if let snapshot = model.snapshot {
        let canManage = model.can(.membersManage)
        let canInvite = model.can(.invitesManage)
        let people = snapshot.memberships.filter { $0.status != .left }
        let active = HouseholdLimits.activeMemberCount(snapshot.memberships)
        let renamesLeft = HouseholdLimits.nameChangesLeft(snapshot.household.nameChanges, now: snapshot.context.asOf)
        if let error { SettingsBlock { SettingsError(message: error) } }
        if canManage {
          SettingsBlock {
            LabeledContent("名前", value: snapshot.household.name)
            Button(busy ? Copy.ja.ja.actions.saving : "名前を変更") { householdName = snapshot.household.name; renaming = true }
              .disabled(renamesLeft == 0 || busy)
              .accessibilityIdentifier("settings.household.name-edit")
              .alert("家族グループの名前", isPresented: $renaming) {
                TextField("名前", text: $householdName).accessibilityIdentifier("settings.household.name")
                Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
                Button("名前を保存") { Task { await rename() } }.accessibilityIdentifier("settings.household.name-save")
              } message: { Text("40文字以内で入力してください。") }
            SettingsNote(renamesLeft > 0 ? "あと\(renamesLeft)回変更できます。名前の変更は24時間で\(HouseholdLimits.maxNameChangesPerDay)回までです。" : "名前の変更は24時間で\(HouseholdLimits.maxNameChangesPerDay)回までです。時間をおいてお試しください。")
          } header: { SettingsHeader("家族グループの名前") }
        }
        SettingsBlock {
          SettingsNote("利用中 \(active)人 / \(HouseholdLimits.maxMembers)人まで・日時は日本時間で表示します\(canManage ? "" : "。メンバーの権限変更と招待は、管理者だけが行えます")。")
          ForEach(people) { person in
            HStack(spacing: TokenSpace.space3) {
              MemberMark(member: person)
              VStack(alignment: .leading, spacing: 2) {
                Text(person.displayName).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
                Text("\(roleText(person.role))・\(statusText(person.status))").font(.footnote).foregroundStyle(colors.inkSoft.color)
              }
              Spacer(minLength: 0)
              if canManage {
                Button("権限を設定") { member = person }
                  .fhButton(.secondary)
                  .accessibilityLabel("\(person.displayName)さんの権限を設定")
                  .accessibilityIdentifier("settings.member.permissions.\(person.id)")
              }
            }
            .accessibilityElement(children: canManage ? .contain : .combine)
          }
        } header: {
          SettingsHeader(snapshot.household.name)
        }
        if canInvite { inviteSection(atCapacity: active >= HouseholdLimits.maxMembers) }
        ColorListSection()
        LeaveHouseholdSection()
      }
    }
    .task { await loadInvites() }
    .sheet(item: $member) { MemberPermissionsSheet(member: $0) }
  }

  @ViewBuilder private func inviteSection(atCapacity: Bool) -> some View {
    let colors = theme.colors
    SettingsBlock {
      Text("招待コードは24時間以内に1回だけ使えます。招待された人は、サインイン後に共有された情報を表示できます。").font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
      if atCapacity { SettingsError(message: "家族グループは\(HouseholdLimits.maxMembers)人までです。招待するには、先にメンバーを一時停止するか外してください。") }
      Picker("役割", selection: $inviteRole) {
        ForEach(RoleCapabilities.inviteRoles, id: \.self) { Text(roleText($0)).tag($0) }
      }
      .accessibilityIdentifier("settings.invite.role")
      Button { Task { await createInvite() } } label: { Label("招待コードを作成", systemImage: "person.badge.plus") }
        .disabled(atCapacity || busy)
        .accessibilityIdentifier("settings.invite.create")
      SettingsNote("有効期間：24時間・使用回数：1回・管理者はいつでも無効にできます")
      if let invite, let token = invite.token {
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          Text("この画面でのみ表示する招待コード").font(.callout.weight(.bold)).foregroundStyle(colors.ink.color)
          Text(token).font(.title3.monospaced().weight(.semibold)).foregroundStyle(colors.ink.color).textSelection(.enabled).accessibilityIdentifier("settings.invite.token")
          Text("有効期限：\(settingsDateTime(invite.expiresAt))・残り\(invite.remainingUses)回").font(.footnote).foregroundStyle(colors.inkSoft.color)
          Button("招待コードをコピー") { copyToClipboard(token); model.announce("招待コードをコピーしました。") }
            .fhButton(.secondary)
            .accessibilityIdentifier("settings.invite.copy")
        }
        .padding(.vertical, TokenSpace.space1)
      }
    } header: { SettingsHeader("家族を招待") }
    SettingsBlock {
      if invites.isEmpty { SettingsNote("使用できる招待コードはありません。") }
      ForEach(invites) { item in
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text("\(roleText(item.role))として招待").foregroundStyle(colors.ink.color)
            Text(item.revokedAt != nil ? "無効" : "残り\(item.remainingUses)回・\(settingsDateTime(item.expiresAt))まで").font(.footnote).foregroundStyle(colors.inkSoft.color)
          }
          Spacer(minLength: 0)
          if item.revokedAt == nil {
            Button("無効にする") { Task { await revoke(item) } }
              .fhButton(.danger)
              .accessibilityIdentifier("settings.invite.revoke.\(item.id)")
          }
        }
      }
    } header: { SettingsHeader("作成した招待") }
  }

  private func loadInvites() async {
    guard model.can(.invitesManage) else { return }
    switch await model.run({ [gateway = model.gateway] in await gateway.listInvites() }) {
    case .success(let list): invites = list
    case .failure(let failure): error = failure.message
    }
  }

  private func rename() async {
    guard !busy else { return }
    if let problem = HouseholdLimits.nameProblem(householdName) { error = problem; return }
    busy = true; error = nil
    let input = HouseholdProfileInput(name: Account.jsTrim(householdName))
    let result = await model.mutate { await $0.updateHouseholdProfile(input) }
    busy = false
    switch result {
    case .success(let household): householdName = household.name; model.announce("家族グループの名前を「\(household.name)」にしました。")
    case .failure(let failure): error = failure.message
    }
  }

  private func createInvite() async {
    guard !busy else { return }
    busy = true; error = nil
    let role = inviteRole
    let result = await model.run { [gateway = model.gateway] in await gateway.createInvite(role: role) }
    busy = false
    switch result {
    case .success(let created): invite = created; await loadInvites(); model.announce("招待コードを作成しました。")
    case .failure(let failure): error = failure.message
    }
  }

  private func revoke(_ item: HouseholdInvite) async {
    switch await model.run({ [gateway = model.gateway] in await gateway.revokeInvite(id: item.id) }) {
    case .success:
      if invite?.id == item.id { invite = nil }
      await loadInvites(); model.announce("招待コードを無効にしました。")
    case .failure(let failure): error = failure.message
    }
  }
}

func roleText(_ role: MembershipRole) -> String { Copy.ja.roleLabels.table[role.rawValue] ?? role.rawValue }
func statusText(_ status: MembershipStatus) -> String { Copy.ja.membershipStatusLabels.table[status.rawValue] ?? status.rawValue }

/// メンバーの色の印。名前は隣に書くので、印は飾りとして読み上げない。
struct MemberMark: View {
  @Environment(\.theme) private var theme
  let member: HouseholdMembership
  var body: some View {
    Circle()
      .fill(Color(hex: member.color) ?? theme.colors.line.color)
      .frame(width: 20, height: 20)
      .accessibilityHidden(true)
  }
}

extension RGBA {
  /// #rrggbb だけを読む。
  init?(hex: String) {
    guard hex.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil, let value = Int(hex.dropFirst(), radix: 16) else { return nil }
    self.init((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF, 1)
  }
}

/// 1人の権限（役割と個別設定）と、メンバーの管理。
struct MemberPermissionsSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let member: HouseholdMembership
  @State private var role: MembershipRole
  @State private var overrides: [PermissionOverride] = []
  @State private var loaded: [PermissionOverride] = []
  @State private var saving = false
  @State private var error: String?
  @State private var asking = false

  init(member: HouseholdMembership) {
    self.member = member
    _role = State(initialValue: member.role)
  }

  private var dirty: Bool { role != member.role || overrides != loaded }

  var body: some View {
    let colors = theme.colors
    NavigationStack {
      Form {
        SettingsBlock {
          Text("役割の標準設定を基準に、必要な項目だけを個別に変更できます。").font(.callout).foregroundStyle(colors.inkSoft.color)
          Picker("メンバーの役割", selection: $role) {
            ForEach([MembershipRole.owner, .adult, .child, .guest], id: \.self) { Text(roleText($0)).tag($0) }
          }
          .disabled(saving)
          .onChange(of: role) { _, _ in overrides = [] }
          .accessibilityIdentifier("settings.member.role.\(member.id)")
          if role != member.role {
            VStack(alignment: .leading, spacing: 2) {
              Text("役割を変更すると、個別設定の確認が必要です。").font(.callout.weight(.bold)).foregroundStyle(colors.ink.color)
              Text("まず役割を保存し、もう一度この画面を開いて個別設定を確認してください。").font(.footnote).foregroundStyle(colors.inkSoft.color)
            }
          }
        }
        SettingsGroup("個別設定") {
          let defaults = Set(RoleCapabilities.defaults(role))
          ForEach(RoleCapabilities.editable(role), id: \.self) { capability in
            let name = Copy.ja.ja.capability[capability.rawValue] ?? capability.rawValue
            Picker(selection: Binding(get: { value(capability) }, set: { change(capability, $0) })) {
              Text("役割の標準").tag("default")
              Text("利用を許可").tag("allow")
              Text("利用を制限").tag("deny")
            } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(name).foregroundStyle(colors.ink.color)
                Text("標準：\(defaults.contains(capability) ? "利用できる" : "利用できない")").font(.footnote).foregroundStyle(colors.inkSoft.color)
              }
            }
            .accessibilityLabel("\(name)の個別設定")
            .accessibilityIdentifier("settings.member.permission.\(member.id).\(capability.rawValue)")
          }
        }
        .disabled(role != member.role || saving)
        MemberActionsSection(member: member) { dismiss() }
        if let error { SettingsBlock { SettingsError(message: error) } }
        SettingsBlock {
          if role == member.role {
            Button(saving ? Copy.ja.ja.actions.saving : "個別設定を保存") { Task { await saveOverrides() } }
              .fhButton(.primary, fullWidth: true)
              .disabled(saving)
              .accessibilityIdentifier("settings.member.save-overrides.\(member.id)")
            Button("標準に戻す") { Task { await reset() } }
              .fhButton(.secondary, fullWidth: true)
              .disabled(saving || overrides.isEmpty)
              .accessibilityIdentifier("settings.member.reset.\(member.id)")
          } else {
            Button(saving ? Copy.ja.ja.actions.saving : "役割を保存") { Task { await saveRole() } }
              .fhButton(.primary, fullWidth: true)
              .disabled(saving)
              .accessibilityIdentifier("settings.member.save-role.\(member.id)")
          }
        }
        .listRowBackground(Color.clear)
      }
      .navigationTitle("\(member.displayName)さんの権限")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(Copy.ja.ja.actions.cancel) { if dirty { asking = true } else { dismiss() } }
            .disabled(saving)
            .accessibilityIdentifier("settings.member.cancel.\(member.id)")
        }
      }
    }
    .modifier(UnsavedGuard(dirty: dirty, asking: $asking) { dismiss() })
    .task { await load() }
  }

  private func value(_ capability: Capability) -> String { overrides.first { $0.capability == capability }?.effect ?? "default" }
  private func change(_ capability: Capability, _ effect: String) {
    overrides = RoleCapabilities.change(overrides, membershipId: member.id, capability: capability, effect: effect)
  }

  private func load() async {
    switch await model.run({ [gateway = model.gateway, id = member.id] in await gateway.getPermissionOverrides(membershipId: id) }) {
    case .success(let list): overrides = list; loaded = list
    case .failure(let failure): error = failure.message
    }
  }

  private func saveRole() async {
    guard !saving else { return }
    saving = true; error = nil
    let (id, next, version) = (member.id, role, member.version)
    let result = await model.mutate { await $0.updateMembershipRole(id: id, role: next, expectedVersion: version) }
    saving = false
    switch result {
    case .success(let updated): dismiss(); model.announce("\(updated.displayName)さんの役割を「\(roleText(updated.role))」に変更しました。")
    case .failure(let failure): error = failure.message
    }
  }

  private func saveOverrides() async {
    guard !saving, let revision = model.snapshot?.viewer.permissionRevision else { return }
    saving = true; error = nil
    let (id, list, name) = (member.id, overrides, member.displayName)
    let result = await model.mutate { await $0.updatePermissionOverrides(membershipId: id, overrides: list, expectedPermissionRevision: revision) }
    saving = false
    switch result {
    case .success: dismiss(); model.announce("\(name)さんの個別設定を保存しました。")
    case .failure(let failure): error = failure.message
    }
  }

  private func reset() async {
    guard !saving, let revision = model.snapshot?.viewer.permissionRevision else { return }
    saving = true; error = nil
    let id = member.id
    let result = await model.mutate { await $0.resetPermissionOverrides(membershipId: id, expectedPermissionRevision: revision) }
    saving = false
    switch result {
    case .success: overrides = []; loaded = []; model.announce("役割の標準設定に戻しました。")
    case .failure(let failure): error = failure.message
    }
  }
}

/// メンバーの管理（管理者を渡す・一時停止・外す）。本人と管理者には出さない。
struct MemberActionsSection: View {
  enum Action: String, Identifiable {
    case transfer, suspend, resume, remove
    var id: String { rawValue }
    func title(_ name: String) -> String {
      switch self {
      case .transfer: "\(name)さんに管理者を渡しますか"
      case .suspend: "\(name)さんを一時停止しますか"
      case .resume: "\(name)さんの一時停止を解除しますか"
      case .remove: "\(name)さんを家族グループから外しますか"
      }
    }
    var detail: String {
      switch self {
      case .transfer: "渡すと、あなたは大人のメンバーになり、メンバーの管理はできなくなります。元に戻すには、新しい管理者に渡し直してもらいます。"
      case .suspend: "一時停止の間は、この人は家族の情報を表示できません。記録は残ります。"
      case .resume: "もう一度、家族の情報を表示できるようになります。"
      case .remove: "この人は家族の情報を表示できなくなります。作った記録は残ります。もう一度参加するには、新しい招待コードが必要です。"
      }
    }
    var confirm: String { switch self { case .transfer: "管理者を渡す"; case .suspend: "一時停止する"; case .resume: "解除する"; case .remove: "外す" } }
    func done(_ name: String) -> String {
      switch self {
      case .transfer: "\(name)さんに管理者を渡しました。"
      case .suspend: "\(name)さんを一時停止しました。"
      case .resume: "\(name)さんの一時停止を解除しました。"
      case .remove: "\(name)さんを家族グループから外しました。"
      }
    }
  }

  @Environment(AppModel.self) private var model
  let member: HouseholdMembership
  let onDone: () -> Void
  @State private var action: Action?
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    if let snapshot = model.snapshot, member.id != snapshot.viewer.membershipId, member.role != .owner {
      let suspended = member.status == .suspended
      SettingsGroup("メンバーの管理") {
        if snapshot.viewer.role == .owner && member.role == .adult && member.status == .active {
          Button("管理者を渡す") { error = nil; action = .transfer }.accessibilityIdentifier("settings.member.transfer.\(member.id)")
        }
        Button(suspended ? "一時停止を解除" : "一時停止") { error = nil; action = suspended ? .resume : .suspend }
          .accessibilityIdentifier("settings.member.status.\(member.id)")
        Button("家族グループから外す", role: .destructive) { error = nil; action = .remove }
          .accessibilityIdentifier("settings.member.remove.\(member.id)")
          .alert(action?.title(member.displayName) ?? "", isPresented: Binding(get: { action != nil }, set: { if !$0 { action = nil } }), presenting: action) { current in
            Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
            Button(current.confirm, role: current == .resume ? nil : .destructive) { Task { await run(current) } }
          } message: { Text($0.detail) }
        if let error { SettingsError(message: error) }
      }
      .disabled(busy)
    }
  }

  private func run(_ current: Action) async {
    guard !busy else { return }
    busy = true; error = nil
    let (id, version) = (member.id, member.version)
    let result: GatewayResult<Empty> = await model.mutate { gateway in
      switch current {
      case .transfer: return await gateway.transferOwnership(toMembershipId: id, expectedVersion: version).map { _ in Empty() }
      case .remove: return await gateway.removeMember(membershipId: id, expectedVersion: version)
      case .suspend, .resume: return await gateway.setMemberStatus(membershipId: id, status: current == .suspend ? .suspended : .active, expectedVersion: version).map { _ in Empty() }
      }
    }
    busy = false
    switch result {
    case .success: onDone(); model.announce(current.done(member.displayName))
    case .failure(let failure): error = failure.message
    }
  }
}

/// 色のリスト（予定とタスクの色）。追加には予定の作成、変更と削除には予定の変更の権限が要る。
struct ColorListSection: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var editing: ColorListEditing?
  @State private var removing: ColorLabel?
  @State private var error: String?

  var body: some View {
    let colors = theme.colors
    let labels = model.snapshot?.colorLabels ?? []
    SettingsBlock {
      // Form の節に付けた sheet と alert は開かないので、いつもある1行目に付ける。
      SettingsNote(labels.isEmpty ? "リストはまだありません。" : "予定とタスクに付ける色と名前です。")
        .sheet(item: $editing) { ColorListForm(editing: $0) }
        .alert("リスト「\(removing?.name ?? "")」を削除しますか", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing) { label in
          Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
          Button(Copy.ja.ja.actions.delete, role: .destructive) { Task { await remove(label) } }
        } message: { _ in Text("使っていた予定とタスクからは色だけが外れます。記録は消えません。") }
      ForEach(labels) { label in
        HStack(spacing: TokenSpace.space3) {
          Circle().fill(Color(hex: label.color) ?? colors.line.color).frame(width: 20, height: 20).accessibilityHidden(true)
          Text(label.name).foregroundStyle(colors.ink.color)
          Spacer(minLength: 0)
          if model.can(.eventUpdate) {
            Button("編集") { editing = ColorListEditing(label: label) }
              .fhButton(.secondary)
              .accessibilityLabel("リスト「\(label.name)」を編集")
              .accessibilityIdentifier("settings.color-list.edit.\(label.id)")
            Button("削除") { error = nil; removing = label }
              .fhButton(.danger)
              .accessibilityLabel("リスト「\(label.name)」を削除")
              .accessibilityIdentifier("settings.color-list.delete.\(label.id)")
          }
        }
      }
      if model.can(.eventCreate) {
        Button { editing = ColorListEditing(label: nil) } label: { Label("リストを追加", systemImage: "plus") }
          .accessibilityIdentifier("settings.color-list.create")
      }
      if let error { SettingsError(message: error) }
    } header: { SettingsHeader("予定とタスクの色") }
  }

  private func remove(_ label: ColorLabel) async {
    switch await model.mutate({ await $0.deleteColorLabel(id: label.id) }) {
    case .success: model.announce("リスト「\(label.name)」を削除しました。")
    case .failure(let failure): error = failure.message
    }
  }
}

struct ColorListEditing: Identifiable {
  let id = UUID()
  let label: ColorLabel?
}

struct ColorListForm: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let editing: ColorListEditing
  @State private var name: String
  @State private var color: String
  @State private var busy = false
  @State private var error: String?
  @State private var asking = false
  private let initial: (String, String)

  init(editing: ColorListEditing) {
    self.editing = editing
    let start = (editing.label?.name ?? "", editing.label?.color ?? ColorLabels.defaultColor)
    initial = start
    _name = State(initialValue: start.0)
    _color = State(initialValue: start.1)
  }

  private var dirty: Bool { name != initial.0 || color != initial.1 }

  var body: some View {
    let colors = theme.colors
    NavigationStack {
      Form {
        SettingsBlock {
          SettingsNote("予定とタスクに付ける色と名前です。")
          TextField("名前", text: $name).accessibilityIdentifier("settings.color-list.name")
        }
        SettingsGroup("色") {
          let choices = ColorLabels.choices(current: initial.1)
          HStack(spacing: TokenSpace.space2) {
            ForEach(choices.prefix(7), id: \.color) { swatch($0) }
          }
          HStack(spacing: TokenSpace.space2) {
            ForEach(choices.dropFirst(7), id: \.color) { swatch($0) }
          }
        }
        if let error { SettingsBlock { SettingsError(message: error) } }
      }
      .navigationTitle(editing.label == nil ? "リストを追加" : "リストを編集")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if dirty { asking = true } else { dismiss() } }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? Copy.ja.ja.actions.saving : "保存する") { Task { await save() } }.disabled(busy).accessibilityIdentifier("settings.color-list.save")
        }
      }
      .tint(colors.brand.color)
    }
    .modifier(UnsavedGuard(dirty: dirty, asking: $asking) { dismiss() })
  }

  private func swatch(_ choice: (color: String, label: String)) -> some View {
    let selected = color == choice.color
    return Button { color = choice.color } label: {
      Circle()
        .fill(Color(hex: choice.color) ?? .gray)
        .frame(width: 36, height: 36)
        .overlay(Circle().stroke(theme.colors.ink.color, lineWidth: selected ? 3 : 0).padding(-4))
        .overlay { if selected { Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(.white) } }
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(choice.label)
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityIdentifier("settings.color-list.color.\(choice.color.dropFirst())")
  }

  private func save() async {
    guard !busy else { return }
    switch ColorLabels.input(name: name, color: color) {
    case .failure(let problem): error = problem.message
    case .success(let input):
      busy = true; error = nil
      let id = editing.label?.id
      let result = await model.mutate { gateway in
        if let id { return await gateway.updateColorLabel(id: id, input: input) }
        return await gateway.createColorLabel(input)
      }
      busy = false
      switch result {
      case .success(let saved): dismiss(); model.announce("リスト「\(saved.name)」を保存しました。")
      case .failure(let failure): error = failure.message
      }
    }
  }
}

/// 家族グループからの退出。ただ1人の管理者なら、先に管理者を引き継いでもらう。
struct LeaveHouseholdSection: View {
  @Environment(AppModel.self) private var model
  @State private var asking = false
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    if let snapshot = model.snapshot {
      let viewer = snapshot.viewer.membershipId
      let state = HouseholdLimits.leaveState(snapshot.memberships, viewer: viewer)
      let others = HouseholdLimits.otherOwners(snapshot.memberships, viewer: viewer)
      let copy = Copy.ja.leaveCopy.self
      SettingsBlock {
        switch state {
        case .soleOwner:
          SettingsNote(copy.soleOwner)
          SettingsNote(copy.handOverHelp)
        case .coOwner, .member:
          SettingsNote(state == .coOwner ? HouseholdLimits.coOwnerText(others) : copy.member)
          Button(copy.heading, role: .destructive) { error = nil; asking = true }
            .fhButton(.danger)
            .disabled(busy)
            .accessibilityIdentifier("settings.household.leave-open")
            .alert("家族グループから退出しますか", isPresented: $asking) {
              Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
              Button("退出する", role: .destructive) { Task { await leave(name: snapshot.household.name) } }
            } message: {
              Text(state == .coOwner ? HouseholdLimits.confirmOwnerText(snapshot.household.name, others) : "「\(snapshot.household.name)」の情報は表示できなくなります。")
            }
        }
        if let error { SettingsError(message: error) }
      } header: { SettingsHeader(copy.heading) }
    }
  }

  private func leave(name: String) async {
    guard !busy else { return }
    busy = true
    let result = await model.run { [gateway = model.gateway] in await gateway.leaveHousehold() }
    busy = false
    switch result {
    case .success:
      model.announce("「\(name)」から退出しました。")
      await model.finishSignIn()
    case .failure(let failure): error = failure.message
    }
  }
}
