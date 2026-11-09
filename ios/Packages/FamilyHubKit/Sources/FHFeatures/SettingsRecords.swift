import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 設定の「最近削除」（Web の RecentlyDeleted.tsx）。読み込めないときは「ない」と言わず、もう一度読めるようにする。
struct RecentlyDeletedSettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var items: [TrashItem]?
  @State private var error: String?
  @State private var busy: String?

  var body: some View {
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      if let error, items == nil {
        SettingsBlock {
          SettingsError(message: error)
          Button(Copy.ja.ja.actions.retry) { Task { await load() } }.accessibilityIdentifier("settings.recently-deleted.retry")
        }
      } else if let items {
        if items.isEmpty {
          SettingsBlock { EmptyStateView(title: "最近削除したものはありません", message: "削除した記録は、ここから\(RestoreWindow.days)日以内に元に戻せます。", illustration: .emptySearch, compact: true) }
        } else {
          SettingsBlock {
            ForEach(items, id: \.self) { item in
              let key = Trash.key(item)
              HStack(spacing: TokenSpace.space3) {
                VStack(alignment: .leading, spacing: 2) {
                  StatusBadge(Trash.kindLabel(item.kind))
                  Text(item.title).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
                  Text("\(settingsDateTime(item.deletedAt))に削除 · あと\(RestoreWindow.daysLeft(deletedAt: item.deletedAt, now: model.snapshot?.context.asOf ?? item.deletedAt))日").font(.footnote).foregroundStyle(colors.inkSoft.color)
                }
                Spacer(minLength: 0)
                Button(busy == key ? "戻しています…" : Copy.ja.ja.actions.restore) { Task { await restore(item) } }
                  .fhButton(.secondary)
                  .disabled(busy != nil)
                  .accessibilityLabel("「\(item.title)」を元に戻す")
                  .accessibilityIdentifier("settings.recently-deleted.restore.\(key)")
              }
              .accessibilityElement(children: .contain)
            }
            SettingsNote("削除から\(RestoreWindow.days)日以内なら元に戻せます。\(RestoreWindow.retentionDays)日を過ぎると完全に消えます。自分が削除できる記録だけを表示します。")
          }
        }
      } else {
        SettingsBlock { ProgressView() }
      }
    }
    .task { await load() }
  }

  private func load() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.listTrash() }) {
    case .success(let list): items = list; error = nil
    case .failure(let failure): error = failure.message
    }
  }

  private func restore(_ item: TrashItem) async {
    guard busy == nil else { return }
    busy = Trash.key(item)
    let result: GatewayResult<Empty> = await model.mutate { gateway in
      switch item.kind {
      case .event: return await gateway.restoreEvent(id: item.id, occurrenceDate: nil).map { _ in Empty() }
      case .occurrence: return await gateway.restoreEvent(id: item.id, occurrenceDate: item.occurrenceDate).map { _ in Empty() }
      case .task: return await gateway.restoreTodo(id: item.id).map { _ in Empty() }
      case .memo: return await gateway.restoreMemo(id: item.id).map { _ in Empty() }
      case .expense: return await gateway.restoreExpense(id: item.id).map { _ in Empty() }
      case .album: return await gateway.restoreAlbum(id: item.id).map { _ in Empty() }
      default: return await gateway.restoreItem(albumId: item.parentId ?? "", itemId: item.id).map { _ in Empty() }
      }
    }
    busy = nil
    switch result {
    case .success: await load(); model.announce("「\(item.title)」を元に戻しました。")
    case .failure(let failure): model.announce(failure.message)
    }
  }
}

/// 読み込み中・失敗・読めた分。続きの読み込みに失敗したときは、読めた分を残して知らせる。
enum PagedState<Item: Sendable & Hashable>: Equatable {
  case loading
  case failed(String)
  case ready(items: [Item], next: String?, chain: AuditChainStatus?)
}

/// 日付ごとの記録の並び（Web の Timeline）。新しい順。
struct AuditTimeline<Item: Sendable & Hashable, Row: View>: View {
  @Environment(\.theme) private var theme
  let items: [Item]
  let at: (Item) -> String
  @ViewBuilder let row: (Item) -> Row

  var body: some View {
    ForEach(AuditView.groupByDay(items, at: at), id: \.day) { day in
      SettingsBlock {
        ForEach(day.items, id: \.self) { item in
          HStack(alignment: .firstTextBaseline, spacing: TokenSpace.space3) {
            Text(Format.time(at(item))).font(.callout.monospacedDigit().weight(.semibold)).foregroundStyle(theme.colors.ink.color)
            VStack(alignment: .leading, spacing: 2) { row(item) }
          }
        }
      } header: {
        SettingsHeader("\(Format.date("\(day.day)T12:00:00+09:00"))・\(day.items.count)件")
      }
    }
  }
}

/// 自分のアカウントの記録（サインインやパスワードの変更など）。「サインインとセキュリティ」と「変更の記録」に出す。
struct AccountActivityList: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var state: PagedState<AccountAuditEntry> = .loading
  @State private var more = false

  var body: some View {
    let copy = Copy.auditLabels.auditCopy.self
    Group {
      switch state {
      case .loading: ProgressView(copy.loadingMore)
      case .failed(let message):
        SettingsError(message: "\(copy.failed)\(message)")
        Button(copy.retry) { Task { await load(nil) } }.accessibilityIdentifier("settings.audit.retry.mine")
      case .ready(let items, let next, _):
        if items.isEmpty {
          Text(copy.emptyMine).font(.callout.weight(.semibold)).foregroundStyle(theme.colors.ink.color)
          SettingsNote(copy.emptyMineBody)
        }
        ForEach(AuditView.groupByDay(items, at: \.at), id: \.day) { day in
          Text("\(Format.date("\(day.day)T12:00:00+09:00"))・\(day.items.count)件").font(.footnote.weight(.bold)).foregroundStyle(theme.colors.inkSoft.color)
          ForEach(day.items) { entry in
            HStack(alignment: .firstTextBaseline, spacing: TokenSpace.space3) {
              Text(Format.time(entry.at)).font(.callout.monospacedDigit().weight(.semibold)).foregroundStyle(theme.colors.ink.color)
              VStack(alignment: .leading, spacing: 2) {
                Text(AuditView.actionLabel(entry.action)).foregroundStyle(theme.colors.ink.color)
                let fields = entry.detail?.fields ?? []
                Text([entry.actor.kind == "operator" ? copy.`operator` : copy.`self`, fields.isEmpty ? nil : "変えた項目：\(AuditView.fieldsText(fields))"].compactMap { $0 }.joined(separator: "・"))
                  .font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
              }
            }
            .accessibilityElement(children: .combine)
          }
        }
        if next != nil {
          Button(more ? copy.loadingMore : copy.more) { Task { await load(next) } }.disabled(more).accessibilityIdentifier("settings.audit.more.mine")
        }
      }
    }
    .task { await load(nil) }
  }

  private func load(_ cursor: String?) async {
    if cursor == nil { state = .loading } else { more = true }
    let query = AccountAuditQuery(cursor: cursor, limit: AuditView.pageSize)
    let result = await model.run { [gateway = model.gateway] in await gateway.listMyAudit(query) }
    more = false
    switch (result, state) {
    case (.success(let page), .ready(let items, _, _)) where cursor != nil: state = .ready(items: items + page.items, next: page.nextCursor, chain: nil)
    case (.success(let page), _): state = .ready(items: page.items, next: page.nextCursor, chain: nil)
    case (.failure(let failure), _) where cursor != nil: model.announce(failure.message)
    case (.failure(let failure), _): state = .failed(failure.message)
    }
  }
}

/// 設定の「変更の記録」（Web の AuditLog.tsx）。管理者だけのタブ（audit.read）。
struct AuditSettings: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  @State private var filters = AuditView.Filters()
  @State private var state: PagedState<AuditEntry> = .loading
  @State private var more = false

  var body: some View {
    let copy = Copy.auditLabels.auditCopy.self
    let colors = theme.colors
    let people = model.snapshot?.memberships.filter { $0.status != .left } ?? []
    SettingsPage {
      SettingsIntro(tab: tab)
      SettingsBlock {
        Picker(copy.tab, selection: $filters.view) {
          Text(copy.views.household).tag(AuditView.Filters.View.household)
          Text(copy.views.mine).tag(AuditView.Filters.View.mine)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("settings.audit.view")
        if filters.view == .household {
          Picker(copy.filterPerson, selection: $filters.membershipId) {
            Text(copy.everyone).tag(Id?.none)
            ForEach(people) { Text($0.displayName).tag(Id?.some($0.id)) }
          }
          .accessibilityIdentifier("settings.audit.filter.person")
          Picker(copy.filterKind, selection: $filters.group) {
            Text(copy.everyKind).tag(AuditGroup?.none)
            ForEach(AuditView.groups, id: \.self) { Text(AuditView.groupLabel($0)).tag(AuditGroup?.some($0)) }
          }
          .accessibilityIdentifier("settings.audit.filter.kind")
          Picker(copy.filterPeriod, selection: $filters.period) {
            ForEach(AuditView.Period.allCases, id: \.self) { Text(AuditView.periodLabel($0)).tag($0) }
          }
          .accessibilityIdentifier("settings.audit.filter.period")
        }
      }
      if filters.view == .mine {
        SettingsBlock {
          SettingsNote(copy.mineDescription)
          AccountActivityList()
        } header: { SettingsHeader(copy.mineHeading) }
      } else {
        switch state {
        case .loading: SettingsBlock { ProgressView(copy.loadingMore) }
        case .failed(let message):
          SettingsBlock {
            SettingsError(message: copy.failed)
            SettingsNote(message)
            Button(copy.retry) { Task { await load(nil) } }.accessibilityIdentifier("settings.audit.retry.household")
          }
        case .ready(let items, let next, let chain):
          if let chain { chainSection(chain) }
          if items.isEmpty {
            let filtered = filters.membershipId != nil || filters.group != nil || filters.period != .all
            SettingsBlock { EmptyStateView(title: filtered ? copy.emptyFiltered : copy.empty, message: filtered ? copy.emptyFilteredBody : copy.emptyBody, illustration: filtered ? .emptySearch : nil, compact: true) }
          }
          AuditTimeline(items: items, at: \.at) { entry in
            Text(AuditView.actionLabel(entry.action)).foregroundStyle(colors.ink.color)
            Text([AuditView.actorText(entry.actor), entry.group == "operator" ? nil : AuditView.groupLabel(entry.group)].compactMap { $0 }.joined(separator: "・"))
              .font(.footnote).foregroundStyle(colors.inkSoft.color)
            if let fields = entry.detail?.fields, !fields.isEmpty {
              Text("変えた項目：\(AuditView.fieldsText(fields))").font(.footnote).foregroundStyle(colors.inkSoft.color)
            }
            if let target = entry.target {
              if target.hidden {
                Text(copy.hiddenTarget).font(.footnote).foregroundStyle(colors.inkSoft.color).accessibilityHint(copy.hiddenHelp)
              } else if let destination = AuditView.destination(target) {
                Button("\(AuditView.targetLabel(target.kind))を開く") { model.open(destination: destination) }
                  .fhLink(font: .footnote.weight(.semibold))
                  .accessibilityIdentifier("settings.audit.target.\(entry.id)")
              }
            }
          }
          if next != nil {
            SettingsBlock {
              Button(more ? copy.loadingMore : copy.more) { Task { await load(next) } }.disabled(more).accessibilityIdentifier("settings.audit.more.household")
            }
          }
        }
      }
    }
    .task(id: filters) { if filters.view == .household { await load(nil) } }
  }

  private func chainSection(_ chain: AuditChainStatus) -> some View {
    let copy = Copy.auditLabels.auditCopy.self
    let (tone, badge, text): (StatusBadge.Tone, String, String) = switch chain.state {
    case "ok": (.success, "正常", copy.chainOk)
    case "problem": (.danger, "要確認", copy.chainProblem)
    default: (.neutral, "未確認", copy.chainUnchecked)
    }
    return SettingsBlock {
      HStack(alignment: .firstTextBaseline) {
        StatusBadge(badge, tone: tone)
        Text(text).foregroundStyle(theme.colors.ink.color).fixedSize(horizontal: false, vertical: true)
      }
      if let checkedAt = chain.checkedAt { SettingsNote("最後に確かめた日時：\(settingsDateTime(checkedAt))") }
    } header: { SettingsHeader(copy.chainHeading) }
  }

  private func load(_ cursor: String?) async {
    guard let asOf = model.snapshot?.context.asOf else { return }
    if cursor == nil { state = .loading } else { more = true }
    let query = AuditView.query(filters, asOf: asOf, cursor: cursor)
    let result = await model.run { [gateway = model.gateway] in await gateway.listAudit(query) }
    more = false
    switch (result, state) {
    case (.success(let page), .ready(let items, _, _)) where cursor != nil: state = .ready(items: items + page.items, next: page.nextCursor, chain: page.chain)
    case (.success(let page), _): state = .ready(items: page.items, next: page.nextCursor, chain: page.chain)
    case (.failure(let failure), _) where cursor != nil: model.announce(failure.message)
    case (.failure(let failure), _): state = .failed(failure.message)
    }
  }
}

/// 設定の「ヘルプ」（Web の HelpSection.tsx）。語と分類で絞り、関わる設定を開ける。
struct HelpSettings: View {
  @Environment(\.theme) private var theme
  let tab: SettingsTab
  let open: (String) -> Void
  @State private var query = ""
  @State private var category: String?
  @State private var expanded: Set<String> = []

  var body: some View {
    let colors = theme.colors
    let results = Help.filter(Help.items, query: query, category: category)
    SettingsPage {
      SettingsIntro(tab: tab)
      SettingsBlock {
        TextField("ヘルプを検索", text: $query).settingsField().accessibilityIdentifier("settings.help.search")
        Picker("質問の分類", selection: $category) {
          Text("すべて").tag(String?.none)
          ForEach(Help.categories) { Text($0.label).tag(String?.some($0.id)) }
        }
        .accessibilityIdentifier("settings.help.category")
        Text("\(results.count)件の質問").font(.footnote.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
      }
      if results.isEmpty {
        SettingsBlock {
          EmptyStateView(title: "一致する質問はありません", message: "語を短くするか、分類を「すべて」に戻してください。", illustration: .emptySearch, compact: true) {
            Button("条件を消す") { query = ""; category = nil }.fhButton(.secondary).accessibilityIdentifier("settings.help.clear")
          }
        }
      }
      ForEach(results) { item in
        let open = expanded.contains(item.id)
        SettingsBlock {
          Button {
            if open { expanded.remove(item.id) } else { expanded.insert(item.id) }
          } label: {
            HStack(alignment: .firstTextBaseline) {
              Text(item.question).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
              Spacer(minLength: 0)
              Image(systemName: open ? "chevron.up" : "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(colors.inkSoft.color).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityValue(open ? "開いています" : "閉じています")
          .accessibilityIdentifier("settings.help.item.\(item.id)")
          if open {
            ForEach(item.answer, id: \.self) { Text($0).font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true) }
            if let related = item.related {
              Button(related.label) { self.open(String(related.href.split(separator: "/").last ?? "")) }
                .accessibilityIdentifier("settings.help.related.\(item.id)")
            }
          }
        }
      }
    }
  }
}

/// 設定の「規約（草案）」（Web の LegalSection.tsx）。空欄の印（【…】）だけを目立たせる。
struct LegalSettings: View {
  @Environment(\.theme) private var theme
  let tab: SettingsTab

  var body: some View {
    let colors = theme.colors
    SettingsPage {
      SettingsIntro(tab: tab)
      SettingsBlock {
        Label { Text(Legal.notice).font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true) } icon: {
          Image(systemName: "exclamationmark.triangle").foregroundStyle(colors.attention.color)
        }
      } header: { SettingsHeader("草案") }
      ForEach(Legal.documents) { document in
        SettingsBlock {
          Text(document.title).font(.title3.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          legalText(document.intro)
          ForEach(document.sections, id: \.heading) { section in
            VStack(alignment: .leading, spacing: TokenSpace.space2) {
              Text(section.heading).font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
              ForEach(section.paragraphs, id: \.self) { legalText($0) }
              ForEach(section.items ?? [], id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: TokenSpace.space2) {
                  Text("・").foregroundStyle(colors.ink.color).accessibilityHidden(true)
                  legalText(item)
                }
              }
            }
            .padding(.vertical, TokenSpace.space1)
          }
        }
      }
    }
  }

  private func legalText(_ text: String) -> some View {
    let colors = theme.colors
    var attributed = AttributedString()
    for part in Legal.parts(text) {
      var piece = AttributedString(part.text)
      if part.placeholder {
        piece.backgroundColor = colors.attentionSoft.color
        piece.font = .callout.weight(.bold)
      }
      attributed += piece
    }
    return Text(attributed).font(.callout).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
  }
}
