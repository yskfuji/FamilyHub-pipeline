import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 家計の画面（Web の src/features/budget/BudgetPage.tsx）。概要・一覧・メンバー別・精算。
/// iPhone は一覧から押して内容へ進む。iPad は本文と、右に内容を並べる。
struct BudgetScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass

  @AppStorage("fh.budgetView") private var storedView = BudgetViewKind.overview.rawValue
  @AppStorage("fh.budgetSort") private var storedSort = BudgetSort.dateNew.rawValue
  @State private var month: String?
  @State private var period: BudgetPeriod = .month
  @State private var from: String?
  @State private var to: String?
  @State private var category: ExpenseCategory?
  @State private var selection: Id?
  @State private var creating: ExpenseFormRequest?
  @State private var settlingAll: SettleAllInput?
  @State private var readingReceipt = false
  @State private var readingStatus: AssistantStatus?
  @State private var actions = BudgetActions()

  private var view: BudgetViewKind { BudgetViewKind(rawValue: storedView) ?? .overview }
  private var sort: BudgetSort { BudgetSort(rawValue: storedSort) ?? .dateNew }
  private var narrow: Bool { sizeClass == .compact }

  var body: some View {
    Group {
      if let snapshot = model.snapshot {
        if narrow {
          content(snapshot).navigationDestination(item: $selection) { id in detail(id) }
        } else {
          HStack(alignment: .top, spacing: 0) {
            content(snapshot).frame(maxWidth: .infinity)
            Divider()
            Group {
              if let selection { detail(selection) } else {
                EmptyStateView(title: "記録を選んでください", message: "一覧の記録を選ぶと、ここに内容と精算を表示します。", compact: true).padding(TokenSpace.space4)
              }
            }
            .frame(width: 420)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(theme.colors.sheet.color)
          }
        }
      } else if model.loading {
        ProgressView("家計を読み込んでいます。").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(theme.colors.paper.color.ignoresSafeArea())
    .sheet(item: $creating) { request in ExpenseCreateSheet(request: request) { selection = $0.id } }
    .sheet(item: Binding(get: { settlingAll.map(SettleAllRequest.init) }, set: { settlingAll = $0?.input })) { request in
      SettleAllSheet(input: request.input) { batch in actions.settledAll(batch, model: model) }
    }
    .sheet(isPresented: $readingReceipt) {
      ReceiptReaderSheet(sample: readingStatus?.sample == true) { receipt, note in
        readingReceipt = false
        creating = ExpenseFormRequest(kind: .expense, receipt: receipt, note: note)
      }
    }
    .task { await loadReadingStatus() }
  }

  private func detail(_ id: Id) -> some View {
    ExpenseDetailView(id: id, actions: actions) { selection = nil }.id(id)
  }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot) -> some View {
    let colors = theme.colors
    let scoped = MemberScope.scoped(snapshot, scope: preferences.memberScope)
    let expenses = scoped.expenses
    let currentMonth = CalendarDate.monthKey(fromRfc3339: snapshot.context.asOf) ?? "2026-09"
    let latest = BudgetList.latestMonth(expenses, currentMonth: currentMonth)
    let shown = month.flatMap { $0 <= latest ? $0 : nil } ?? currentMonth
    let canCreate = model.can(.expenseCreate)
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        if let error = model.error { ErrorBanner(error: error) }
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("家計と精算")
          Text("家計と割り勘").font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("金額は1円単位で保存し、負担と精算を別の記録として残します。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          MemberScopePicker(snapshot: snapshot)
          if canCreate {
            Button { creating = ExpenseFormRequest(kind: .expense) } label: { Label("支出を追加", systemImage: "yensign.circle") }.fhButton(.primary)
            Button { creating = ExpenseFormRequest(kind: .income) } label: { Label("収入を追加", systemImage: "plus") }.fhButton(.secondary)
            if readingStatus?.available == true, model.can(.assistantUse) {
              Button { readingReceipt = true } label: { Label("領収書を読み取る", systemImage: "doc.text.viewfinder") }.fhButton(.secondary)
            }
          }
        }
        undoCallout(snapshot)
        Picker("家計の表示", selection: Binding(get: { view }, set: { storedView = $0.rawValue })) {
          ForEach(BudgetViewKind.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        if expenses.isEmpty {
          EmptyStateView(title: scoped.memberId == nil ? "まだ記録がありません" : "該当する記録はありません",
                         message: scoped.memberId == nil ? "「支出を追加」や「収入を追加」から記録すると、ここに集計と精算の状態を表示します。" : "表示する人を「すべて」に戻すと、ほかの記録を確認できます。",
                         illustration: .emptyBudget, compact: true) {
            if scoped.memberId == nil, canCreate { Button("最初の支出を記録") { creating = ExpenseFormRequest(kind: .expense) }.fhButton(.primary) }
          }
        } else {
          if view != .settlements { monthBar(shown, current: currentMonth, latest: latest) }
          switch view {
          case .overview:
            BudgetOverviewView(expenses: expenses, month: shown, open: open, showList: showList, showSettlements: { storedView = BudgetViewKind.settlements.rawValue })
          case .list:
            BudgetListView(expenses: expenses, month: shown, today: CalendarDate.dateKey(fromRfc3339: snapshot.context.asOf) ?? "\(shown)-01", currentMonth: currentMonth,
                           period: $period, from: $from, to: $to, category: $category, sort: Binding(get: { sort }, set: { storedSort = $0.rawValue }), open: open)
          case .members:
            BudgetMembersView(expenses: expenses, month: shown)
          case .settlements:
            BudgetSettlementsView(expenses: expenses, filtered: scoped.memberId != nil, actions: actions, open: open) { settlingAll = $0 }
          }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func open(_ id: Id) { selection = id }

  private func showList(_ category: ExpenseCategory?) {
    self.category = category
    period = .month; from = nil; to = nil
    storedView = BudgetViewKind.list.rawValue
  }

  /// 月を移す。週と日付の指定は前の月のものなので外す。費目はそのまま。
  private func moveMonth(_ next: String) {
    month = next
    period = .month; from = nil; to = nil
  }

  private func monthBar(_ shown: String, current: String, latest: String) -> some View {
    let colors = theme.colors
    return HStack(spacing: TokenSpace.space2) {
      Button { moveMonth(CalendarDate.shiftMonth(shown, -1) ?? shown) } label: { Image(systemName: "chevron.left") }
        .fhButton(.secondary)
        .accessibilityLabel("前月")
      Text(BudgetText.month(shown)).font(.headline).foregroundStyle(colors.ink.color).frame(maxWidth: .infinity).accessibilityAddTraits(.isHeader)
      Button("今月") { moveMonth(current) }.fhButton(.secondary).disabled(shown == current)
      Button { moveMonth(CalendarDate.shiftMonth(shown, 1) ?? shown) } label: { Image(systemName: "chevron.right") }
        .fhButton(.secondary)
        .disabled(shown >= latest)
        .accessibilityLabel("次月")
    }
  }

  @ViewBuilder
  private func undoCallout(_ snapshot: HouseholdSnapshot) -> some View {
    let busy = actions.busy != nil
    switch actions.undo {
    case .settlement(let expenseId, let record)?:
      Callout(systemImage: "yensign.circle", title: "\(Format.yen(record.amountJpy))の精算を記録しました", detail: "取り消しても、元の記録と取り消しの記録は履歴に残ります。", tone: .info) {
        Button("精算を取り消す") { Task { await actions.reverse(expenseId: expenseId, record: record, model: model) } }.fhButton(.secondary).disabled(busy)
      }
    case .batch(let batch)?:
      Callout(systemImage: "yensign.circle", title: BudgetText.settleAllDone(batch.items.count), detail: "取り消しても、元の記録と取り消しの記録は履歴に残ります。", tone: .info) {
        Button(Copy.ja.settleAllCopy.reverse) { Task { await actions.reverseBatch(batch.id, model: model) } }.fhButton(.secondary).disabled(busy)
      }
    case .deleted(let id, let title)?:
      Callout(systemImage: "trash", title: "「\(title)」を削除しました", detail: "7日以内なら元に戻せます。", tone: .info) {
        Button(Copy.ja.ja.actions.restore) { Task { await actions.restore(id, model: model) } }.fhButton(.secondary).disabled(busy)
      }
    case nil:
      EmptyView()
    }
  }

  private func loadReadingStatus() async {
    guard model.can(.assistantUse) else { return }
    if case .success(let status) = await model.gateway.getAssistantStatus(), status.available { readingStatus = status }
  }
}

/// 支出・収入の追加を開く頼み。領収書の読み取りから開くときは、読み取った内容を入れる。
struct ExpenseFormRequest: Identifiable {
  let id = UUID()
  var kind: ExpenseKind
  var receipt: ReceiptProposal?
  var note: String?
}

struct SettleAllRequest: Identifiable {
  let input: SettleAllInput
  var id: Int { input.hashValue }
}

/// 一覧の1行（Web の ExpenseRow）。
struct ExpenseRowView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let expense: Expense
  var showDate = true
  let open: (Id) -> Void

  var body: some View {
    let colors = theme.colors
    let payer = memberName(model.snapshot?.memberships ?? [], expense.payerMembershipId)
    let parts = (showDate ? [Format.dateOnly(expense.incurredOn)] : []) + [BudgetText.category(expense.category), "\(BudgetText.payerLabel(expense.kind))：\(payer)さん"]
    let remaining = Ledger.remainingTotal(expense)
    let shared = expense.shares.contains { $0.membershipId != expense.payerMembershipId }
    Button { open(expense.id) } label: {
      HStack(alignment: .top, spacing: TokenSpace.space3) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Text(expense.title).font(.body.weight(.bold)).foregroundStyle(colors.ink.color).multilineTextAlignment(.leading)
          Text(parts.joined(separator: " · ")).font(.footnote).foregroundStyle(colors.inkSoft.color).multilineTextAlignment(.leading)
          if let place = expense.place { Label(place.name, systemImage: "mappin").font(.footnote).foregroundStyle(colors.inkSoft.color) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        VStack(alignment: .trailing, spacing: TokenSpace.space1) {
          Text("\(expense.kind == .income ? "+" : "")\(Format.yen(expense.amountJpy))").font(.body.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color)
          if expense.kind == .income { StatusBadge("収入", tone: .success) }
          else if remaining > 0 { StatusBadge("残り\(Format.yen(remaining))", tone: .attention) }
          else if shared { StatusBadge("精算済み", systemImage: "checkmark") }
        }
      }
      .padding(TokenSpace.space3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
      .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .combine)
    .accessibilityHint("内容を開きます")
    .accessibilityIdentifier("budget.expense.open.\(expense.id)")
  }
}

/// 数字の札（Web の stat tile）。
struct StatTile: View {
  @Environment(\.theme) private var theme
  let title: String
  let value: String
  let detail: String
  var body: some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space1) {
      Text(title).font(.subheadline.weight(.bold)).foregroundStyle(colors.inkSoft.color)
      Text(value).font(.title2.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color)
      Text(detail).font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
    }
    .padding(TokenSpace.space3)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
    .accessibilityElement(children: .combine)
  }
}

/// 札を並べる。広い幅は横に、狭い幅は縦に。
struct TileRow<Content: View>: View {
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.dynamicTypeSize) private var typeSize
  @ViewBuilder let content: Content
  var body: some View {
    if sizeClass == .compact || typeSize.isAccessibilitySize {
      VStack(spacing: TokenSpace.space2) { content }
    } else {
      HStack(alignment: .top, spacing: TokenSpace.space2) { content }
    }
  }
}

/// 見出しのある囲み（Web の card の eyebrow と h2）。
struct LedgerCard<Content: View>: View {
  @Environment(\.theme) private var theme
  let eyebrow: String
  let title: String
  @ViewBuilder let content: Content
  var body: some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      VStack(alignment: .leading, spacing: 2) {
        Eyebrow(eyebrow)
        Text(title).font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
      }
      content
    }
    .padding(TokenSpace.space4)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
  }
}
