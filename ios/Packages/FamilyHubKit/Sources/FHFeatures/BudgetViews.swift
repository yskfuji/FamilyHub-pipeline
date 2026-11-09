import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

// 家計の4つの表示（Web の BudgetOverview・BudgetList・BudgetMembers・BudgetSettlements）。

/// 横の棒の1行。棒は飾りで、値は文字で示す。
struct BarRow: View {
  @Environment(\.theme) private var theme
  @Environment(\.dynamicTypeSize) private var typeSize
  let label: String
  let value: String
  /// 0〜1。
  let fraction: Double
  var tone: Color?

  var body: some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(label).foregroundStyle(colors.ink.color)
        Spacer(minLength: TokenSpace.space2)
        Text(value).monospacedDigit().foregroundStyle(colors.ink.color)
      }
      .font(.callout)
      GeometryReader { proxy in
        Capsule().fill(colors.line.color).overlay(alignment: .leading) {
          Capsule().fill(tone ?? colors.accent.color).frame(width: max(fraction > 0 ? 4 : 0, proxy.size.width * min(1, max(0, fraction))))
        }
      }
      .frame(height: 8)
      .accessibilityHidden(true)
    }
  }
}

/// 図の代わりの表（Web の「表で見る」）。
struct TableDisclosure: View {
  @Environment(\.theme) private var theme
  let caption: String
  let columns: [String]
  let rows: [[String]]
  @State private var open = false

  var body: some View {
    let colors = theme.colors
    DisclosureGroup("表で見る", isExpanded: $open) {
      VStack(alignment: .leading, spacing: TokenSpace.space2) {
        Text(caption).font(.footnote.weight(.bold)).foregroundStyle(colors.inkSoft.color)
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
          VStack(alignment: .leading, spacing: 2) {
            Text(row.first ?? "").font(.callout.weight(.bold)).foregroundStyle(colors.ink.color)
            ForEach(Array(zip(columns.dropFirst(), row.dropFirst())), id: \.0) { column, value in
              Text("\(column)：\(value)").font(.callout).foregroundStyle(colors.ink.color)
            }
          }
          .accessibilityElement(children: .combine)
          Divider()
        }
      }
      .padding(.top, TokenSpace.space2)
    }
    .tint(colors.accent.color)
  }
}

// MARK: 概要

struct BudgetOverviewView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let expenses: [Expense]
  let month: String
  let open: (Id) -> Void
  let showList: (ExpenseCategory?) -> Void
  let showSettlements: () -> Void

  var body: some View {
    let colors = theme.colors
    let overview = Budget.monthOverview(expenses, month: month)
    let short = BudgetText.shortMonth(month)
    VStack(alignment: .leading, spacing: TokenSpace.space4) {
      if overview.count == 0 {
        EmptyStateView(title: "\(BudgetText.month(month))の記録はありません", message: "別の月を選ぶか、支出や収入を追加してください。", illustration: .emptyBudget, compact: true)
        unsettled
      } else {
        TileRow {
          StatTile(title: "\(short)の支出", value: Format.yen(overview.spending.totalJpy), detail: "\(BudgetText.month(month))の支出\(overview.spending.count)件の合計")
          StatTile(title: "\(short)の収入", value: Format.yen(overview.income.totalJpy), detail: overview.income.count > 0 ? "収入\(overview.income.count)件の合計" : "収入の記録はありません")
          StatTile(title: "差し引き", value: Format.signedYen(overview.netJpy), detail: "収入から支出を引いた額")
        }
        balance(overview)
        let spending = Budget.categoryBreakdown(expenses, month: month)
        if !spending.isEmpty { categories(spending, eyebrow: "費目別", title: "\(short)の支出の内訳", tone: colors.accent.color, table: "spending") }
        let income = Budget.incomeBreakdown(expenses, month: month)
        if !income.isEmpty { categories(income, eyebrow: "収入", title: "\(short)の収入の内訳", tone: colors.success.color, table: "income") }
        unsettled
        trend
        recent
      }
    }
  }

  private func balance(_ overview: Budget.Overview) -> some View {
    let colors = theme.colors
    let result = Budget.balanceOf(spending: overview.spending.totalJpy, income: overview.income.totalJpy)
    let comparison = Budget.monthComparison(expenses, month: month)
    let previous = BudgetText.shortMonth(comparison.previousMonth)
    let text: String = if result.percent == nil { "この月の収入の記録はありません。" }
      else if result.overJpy > 0 { "支出が収入を\(Format.yen(result.overJpy))上回っています。" }
      else { "収入の\(result.percent!)%を支出にあて、\(Format.yen(result.leftJpy))残っています。" }
    let compare: String = switch comparison.differenceJpy {
    case nil: "先月（\(previous)）の支出の記録はありません。"
    case 0?: "支出は先月（\(previous)）と同じです。"
    case let difference?: "支出は先月（\(previous)）より\(Format.yen(abs(difference)))\(difference > 0 ? "多い" : "少ない")です。"
    }
    let width = overview.spending.totalJpy > 0 ? Double(max(1, result.percent ?? 100)) / 100 : 0
    return LedgerCard(eyebrow: "収支", title: "収入と支出のバランス") {
      Text(text).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
      GeometryReader { proxy in
        Capsule().fill(colors.line.color).overlay(alignment: .leading) {
          Capsule().fill(result.overJpy > 0 ? colors.danger.color : colors.accent.color).frame(width: proxy.size.width * min(1, width))
        }
      }
      .frame(height: 10)
      .accessibilityHidden(true)
      Text(compare).font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
    }
  }

  private func categories(_ items: [Budget.CategoryTotal], eyebrow: String, title: String, tone: Color, table: String) -> some View {
    let largest = Double(items.map(\.totalJpy).max() ?? 1)
    return LedgerCard(eyebrow: eyebrow, title: title) {
      ForEach(items, id: \.category) { item in
        Button { showList(item.category) } label: {
          BarRow(label: BudgetText.category(item.category), value: "\(Format.yen(item.totalJpy))（\(item.percent)%）", fraction: Double(item.totalJpy) / largest, tone: tone)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(BudgetText.category(item.category))の記録を見る \(Format.yen(item.totalJpy))（\(item.percent)%）")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("budget.category.open.\(item.category.rawValue)")
      }
      TableDisclosure(caption: title, columns: ["費目", "金額", "割合"], rows: items.map { [BudgetText.category($0.category), Format.yen($0.totalJpy), "\($0.percent)%"] })
        .accessibilityIdentifier("chart.table.\(table)-categories")
    }
  }

  private var unsettled: some View {
    let colors = theme.colors
    let summary = Ledger.unsettled(expenses)
    let transfers = Budget.simplifiedTransfers(expenses)
    let names = model.snapshot?.memberships ?? []
    return LedgerCard(eyebrow: "未精算の内訳", title: "誰にいくら支払うか") {
      if summary.count == 0 {
        Text("すべて精算済みです。").foregroundStyle(colors.ink.color)
      } else {
        Text("残りのある記録が\(summary.count)件、合計\(Format.yen(summary.totalJpy))です。").foregroundStyle(colors.ink.color)
        ForEach(Array(transfers.enumerated()), id: \.offset) { _, transfer in
          HStack {
            Text(BudgetText.transfer(memberName(names, transfer.from), memberName(names, transfer.to))).foregroundStyle(colors.ink.color)
            Spacer()
            Text(Format.yen(transfer.amountJpy)).font(.body.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color)
          }
          .accessibilityElement(children: .combine)
        }
        Button("精算の画面を開く", action: showSettlements).fhLink().accessibilityIdentifier("budget.unsettled.open")
      }
    }
  }

  private var trend: some View {
    let colors = theme.colors
    let result = Budget.trend(expenses, endMonth: month)
    let first = result.months.first?.month ?? month
    return LedgerCard(eyebrow: "推移", title: "6か月の推移") {
      if !result.drawable {
        Text("記録のある月が2か月以上になると、\(BudgetText.shortMonth(first))から\(BudgetText.shortMonth(month))までの推移を表示します。").foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
      } else {
        Text("月ごとの支出と収入の合計です。記録のない月は0円です。\(result.showIncome ? "支出と収入は、それぞれの最も多い月を同じ長さにして描いています。" : "")").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        trendPanel("支出", values: result.months.map { ($0.month, $0.spendingJpy) }, tone: colors.accent.color)
        if result.showIncome { trendPanel("収入", values: result.months.map { ($0.month, $0.incomeJpy) }, tone: colors.success.color) }
        TableDisclosure(caption: "\(BudgetText.month(first))〜\(BudgetText.month(month))の推移", columns: ["月", "支出", "収入"],
                        rows: result.months.map { ["\(BudgetText.month($0.month))\($0.month == month ? "（表示中）" : "")", Format.yen($0.spendingJpy), Format.yen($0.incomeJpy)] })
      }
    }
  }

  private func trendPanel(_ title: String, values: [(String, Int)], tone: Color) -> some View {
    let colors = theme.colors
    let largest = Double(max(1, values.map(\.1).max() ?? 1))
    return VStack(alignment: .leading, spacing: TokenSpace.space2) {
      Text(title).font(.subheadline.weight(.bold)).foregroundStyle(colors.inkSoft.color).accessibilityAddTraits(.isHeader)
      ForEach(values, id: \.0) { key, value in
        BarRow(label: "\(BudgetText.shortMonth(key))\(key == month ? "（表示中）" : "")", value: Format.yen(value), fraction: Double(value) / largest, tone: tone)
          .accessibilityElement(children: .combine)
      }
    }
  }

  private var recent: some View {
    let items = BudgetList.sort(BudgetList.filter(expenses, range: BudgetList.monthRange(month), category: nil), .dateNew, memberOrder: []).prefix(8)
    return LedgerCard(eyebrow: "記録", title: "最近の記録") {
      ForEach(Array(items)) { expense in ExpenseRowView(expense: expense, open: open) }
      Button("一覧を見る") { showList(nil) }.fhLink().accessibilityIdentifier("budget.recent.open-list")
    }
  }
}

// MARK: 一覧

struct BudgetListView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let expenses: [Expense]
  let month: String
  let today: String
  let currentMonth: String
  @Binding var period: BudgetPeriod
  @Binding var from: String?
  @Binding var to: String?
  @Binding var category: ExpenseCategory?
  @Binding var sort: BudgetSort
  let open: (Id) -> Void

  var body: some View {
    let colors = theme.colors
    let range = BudgetList.range(month: month, period: period, from: from, to: to, today: today)
    let order = (model.snapshot?.memberships ?? []).map(\.id)
    let sorted = BudgetList.sort(BudgetList.filter(expenses, range: range, category: category), sort, memberOrder: order)
    let groups = BudgetList.groups(sorted, sort)
    let rangeText = range.start == range.end ? Format.dateOnly(range.start) : "\(Format.dateOnly(range.start))〜\(Format.dateOnly(range.end))"
    VStack(alignment: .leading, spacing: TokenSpace.space4) {
      LedgerCard(eyebrow: "絞り込み", title: "一覧の絞り込み") {
        Picker("費目", selection: $category) {
          Text("すべての費目").tag(ExpenseCategory?.none)
          Section("支出") { ForEach(ExpenseCategory.spending, id: \.self) { Text(BudgetText.category($0)).tag(ExpenseCategory?.some($0)) } }
          Section("収入") { ForEach(ExpenseCategory.income, id: \.self) { Text(BudgetText.category($0)).tag(ExpenseCategory?.some($0)) } }
        }
        .accessibilityIdentifier("budget.list.category")
        Picker("期間", selection: Binding(get: { period }, set: { next in
          period = next
          if next == .custom { let whole = BudgetList.monthRange(month); from = whole.start; to = whole.end } else { from = nil; to = nil }
        })) {
          Text("月全体").tag(BudgetPeriod.month)
          Text(month == currentMonth ? "今週" : "月の最初の週").tag(BudgetPeriod.week)
          Text("日付で指定").tag(BudgetPeriod.custom)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("budget.list.period")
        if period == .custom {
          DatePicker("開始日", selection: dateBinding($from), displayedComponents: .date).environment(\.timeZone, EventFormView.tokyo)
          DatePicker("終了日", selection: dateBinding($to), displayedComponents: .date).environment(\.timeZone, EventFormView.tokyo)
        }
        Picker("並べ替え", selection: $sort) {
          ForEach(BudgetSort.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .accessibilityIdentifier("budget.list.sort")
        Text("\(rangeText) · \(sorted.count)件").font(.footnote.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
      }
      if sorted.isEmpty {
        if category != nil || period != .month {
          EmptyStateView(title: "該当する記録はありません", message: "別の条件を選ぶか、絞り込みを外してください。", illustration: .emptySearch, compact: true) {
            Button("絞り込みを外す") { category = nil; period = .month; from = nil; to = nil }.fhButton(.secondary).accessibilityIdentifier("budget.list.clear")
          }
        } else {
          EmptyStateView(title: "該当する記録はありません", message: "この月の記録はまだありません。", illustration: .emptyBudget, compact: true)
        }
      } else {
        ForEach(groups) { group in
          VStack(alignment: .leading, spacing: TokenSpace.space2) {
            if let date = group.date {
              VStack(alignment: .leading, spacing: 2) {
                Text(CivilDate(key: date).map(Format.monthDay) ?? date).font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
                let totals = [group.expenseJpy > 0 ? "支出 \(Format.yen(group.expenseJpy))" : nil, group.incomeJpy > 0 ? "収入 \(Format.yen(group.incomeJpy))" : nil].compactMap { $0 }
                if !totals.isEmpty { Text(totals.joined(separator: " · ")).font(.footnote).foregroundStyle(colors.inkSoft.color) }
              }
            }
            ForEach(group.items) { expense in ExpenseRowView(expense: expense, showDate: group.date == nil, open: open) }
          }
        }
      }
    }
  }

  private func dateBinding(_ value: Binding<String?>) -> Binding<Date> {
    Binding(get: { LocalTime.date("\(value.wrappedValue ?? "\(month)-01")T12:00") ?? Date() },
            set: { value.wrappedValue = String(LocalTime.local(from: $0).prefix(10)) })
  }
}

// MARK: メンバー別

struct BudgetMembersView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let expenses: [Expense]
  let month: String

  var body: some View {
    let colors = theme.colors
    let memberships = model.snapshot?.memberships ?? []
    let totals = Budget.memberTotals(expenses, month: month, memberships: memberships)
    if totals.isEmpty {
      EmptyStateView(title: "この月の支出はありません", message: "支出を記録すると、人ごとの支払いと負担をここに表示します。", illustration: .emptyBudget, compact: true)
    } else {
      LedgerCard(eyebrow: BudgetText.month(month), title: "メンバー別の支払いと負担") {
        Text("差は「支払った額 − 負担する額」です。プラスの人は、負担より多く支払っています。精算は含めていません。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        ForEach(totals, id: \.membershipId) { total in
          memberRow(memberName(memberships, total.membershipId), paid: total.paidJpy, burden: total.burdenJpy, difference: total.differenceJpy)
        }
        memberRow("合計", paid: totals.reduce(0) { $0 + $1.paidJpy }, burden: totals.reduce(0) { $0 + $1.burdenJpy }, difference: totals.reduce(0) { $0 + $1.differenceJpy })
      }
    }
  }

  private func memberRow(_ name: String, paid: Int, burden: Int, difference: Int) -> some View {
    let colors = theme.colors
    return VStack(alignment: .leading, spacing: 2) {
      Text(name).font(.body.weight(.bold)).foregroundStyle(colors.ink.color)
      Text("支払った額 \(Format.yen(paid)) · 負担する額 \(Format.yen(burden))").font(.callout).monospacedDigit().foregroundStyle(colors.ink.color)
      Text("差 \(Format.signedYen(difference))").font(.callout.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color)
      Divider()
    }
    .accessibilityElement(children: .combine)
  }
}

// MARK: 精算

struct BudgetSettlementsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let expenses: [Expense]
  let filtered: Bool
  let actions: BudgetActions
  let open: (Id) -> Void
  let settleAll: (SettleAllInput) -> Void

  var body: some View {
    let colors = theme.colors
    let names = model.snapshot?.memberships ?? []
    let summary = Ledger.unsettled(expenses)
    let shares = Budget.openShares(expenses)
    let order = names.map(\.id)
    let balances = Budget.netBalances(shares).stableOrder(order)
    let transfers = Budget.transfers(Budget.netBalances(shares))
    let request = Budget.settleAllRequest(expenses, memberFilterActive: filtered)
    let canSettle = model.can(.expenseSettle)
    VStack(alignment: .leading, spacing: TokenSpace.space4) {
      TileRow {
        StatTile(title: "未精算", value: Format.yen(summary.totalJpy), detail: summary.count > 0 ? "残りのある記録\(summary.count)件" : "すべて精算済みです")
        StatTile(title: "精算済み", value: Format.yen(Budget.settledNet(expenses)), detail: "取り消した分を除いた合計")
      }
      LedgerCard(eyebrow: "まとめて精算", title: "誰が誰に渡せば済むか") {
        if transfers.isEmpty {
          Text("支払いが残っている人はいません。").foregroundStyle(colors.ink.color)
        } else {
          Text("残りのある記録をすべて相殺した金額です。受け渡しのあとは「まとめて精算する」で一度に記録するか、下の記録ごとに精算を残してください。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
          Text("人ごとの差し引き").font(.subheadline.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          let largest = Double(max(1, balances.map { abs($0.amountJpy) }.max() ?? 1))
          ForEach(balances, id: \.membershipId) { balance in
            let label = balance.amountJpy > 0 ? "受け取る \(Format.yen(balance.amountJpy))" : balance.amountJpy < 0 ? "支払う \(Format.yen(-balance.amountJpy))" : "残りなし"
            BarRow(label: "\(memberName(names, balance.membershipId))さん", value: label, fraction: Double(abs(balance.amountJpy)) / largest, tone: balance.amountJpy >= 0 ? colors.success.color : colors.accent.color)
              .accessibilityElement(children: .combine)
          }
          Text("受け渡し").font(.subheadline.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          ForEach(Array(transfers.enumerated()), id: \.offset) { _, transfer in
            HStack {
              Text(BudgetText.transfer(memberName(names, transfer.from), memberName(names, transfer.to))).foregroundStyle(colors.ink.color)
              Spacer()
              Text(Format.yen(transfer.amountJpy)).font(.body.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color)
            }
            .accessibilityElement(children: .combine)
          }
          if canSettle, let request {
            Button(Copy.ja.settleAllCopy.open) { settleAll(request) }.fhButton(.primary).accessibilityIdentifier("budget.settle-all.open")
          } else if canSettle, filtered {
            Text(Copy.ja.settleAllCopy.filtered).font(.callout).foregroundStyle(colors.inkSoft.color)
          }
        }
      }
      LedgerCard(eyebrow: "すべての月", title: "残りのある記録") {
        let open = Budget.openExpenses(expenses)
        if open.isEmpty {
          Text("残りのある記録はありません。新しい支出を記録すると、ここに表示します。").foregroundStyle(colors.inkSoft.color)
        } else {
          Text("古い順").font(.footnote).foregroundStyle(colors.inkSoft.color)
          ForEach(open) { expense in ExpenseRowView(expense: expense, open: self.open) }
        }
      }
      LedgerCard(eyebrow: "精算", title: "精算の履歴") {
        Text("新しい順").font(.footnote).foregroundStyle(colors.inkSoft.color)
        SettlementHistoryView(rows: Budget.groupedSettlementHistory(expenses, batches: model.snapshot?.settlementBatches ?? []), showExpense: true, actions: actions, place: "list", open: open)
      }
    }
  }
}

extension Array where Element == Budget.Balance {
  /// 受け取る額の多い順、同じならメンバーの並び。
  func stableOrder(_ order: [Id]) -> [Budget.Balance] {
    let rank = { (id: Id) in order.firstIndex(of: id) ?? order.count }
    return sorted { $0.amountJpy != $1.amountJpy ? $0.amountJpy > $1.amountJpy : rank($0.membershipId) < rank($1.membershipId) }
  }
}

/// 精算の履歴（Web の SettlementHistory）。取り消しは反対の記録として並べ、元の記録は書き換えない。
struct SettlementHistoryView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let rows: [Budget.HistoryRow]
  let showExpense: Bool
  let actions: BudgetActions
  let place: String
  var open: ((Id) -> Void)?

  var body: some View {
    let colors = theme.colors
    if rows.isEmpty {
      Text("精算の記録はまだありません。精算すると、ここに日時と金額が残ります。").foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
    } else {
      ForEach(rows) { row in
        switch row {
        case .single(let entry): single(entry)
        case .batch(let batch): batchRow(batch)
        }
        Divider()
      }
    }
  }

  private var names: [HouseholdMembership] { model.snapshot?.memberships ?? [] }

  @ViewBuilder
  private func single(_ entry: Budget.HistoryEntry) -> some View {
    let colors = theme.colors
    let record = entry.record
    let reversal = entry.reverses != nil
    let title = reversal ? "取り消し（\(memberName(names, record.toMembershipId))さんの精算）" : BudgetText.transfer(memberName(names, record.fromMembershipId), memberName(names, record.toMembershipId))
    let meta = BudgetText.at(record.recordedAt) + (record.batchId != nil ? " · \(Copy.ja.settleAllCopy.partOfBatch)" : "")
    VStack(alignment: .leading, spacing: TokenSpace.space1) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
          Text(meta).font(.footnote).foregroundStyle(colors.inkSoft.color)
        }
        Spacer()
        Text(record.amountJpy < 0 ? "−\(Format.yen(-record.amountJpy))" : Format.yen(record.amountJpy)).font(.body.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color)
      }
      .accessibilityElement(children: .combine)
      HStack(spacing: TokenSpace.space2) {
        if showExpense, let open { Button(entry.expenseTitle) { open(entry.expenseId) }.fhLink() }
        if entry.reversedBy != nil {
          StatusBadge("取り消し済み")
        } else if entry.canReverse, model.can(.expenseSettle) {
          Button(actions.busy == record.id ? "取り消し中…" : "取り消す") { Task { await actions.reverse(expenseId: entry.expenseId, record: record, model: model) } }
            .fhButton(.secondary)
            .disabled(actions.busy != nil)
            .accessibilityLabel("\(BudgetText.at(record.recordedAt))の\(Format.yen(record.amountJpy))の精算を取り消す")
            .accessibilityIdentifier("budget.settlement.reverse.\(place).\(record.id)")
        }
      }
    }
  }

  @ViewBuilder
  private func batchRow(_ batch: Budget.BatchRow) -> some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
          Text(batch.reversal ? BudgetText.batchReversalTitle(batch.entries.count) : BudgetText.batchTitle(batch.entries.count)).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
          Text("\(BudgetText.at(batch.recordedAt)) · 負担の合計 \(Format.yen(batch.totalJpy))").font(.footnote).foregroundStyle(colors.inkSoft.color)
        }
        Spacer()
      }
      .accessibilityElement(children: .combine)
      if !batch.reversal {
        ForEach(Array(batch.transfers.enumerated()), id: \.offset) { _, transfer in
          Text("\(BudgetText.transfer(memberName(names, transfer.from), memberName(names, transfer.to))) \(Format.yen(transfer.amountJpy))").font(.callout).foregroundStyle(colors.ink.color)
        }
      }
      DisclosureGroup("\(Copy.ja.settleAllCopy.includes)（\(batch.entries.count)件）") {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          ForEach(batch.entries) { entry in
            if let open { Button(entry.expenseTitle) { open(entry.expenseId) }.fhLink() } else { Text(entry.expenseTitle) }
          }
        }
      }
      .tint(colors.accent.color)
      if batch.partlyReversed { Text(Copy.ja.settleAllCopy.partlyReversed).font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true) }
      if !batch.reversal {
        if batch.reversed {
          StatusBadge(Copy.ja.settleAllCopy.reversed)
        } else if batch.canReverse, model.can(.expenseSettle) {
          Button(actions.busy == "batch:\(batch.batchId)" ? Copy.ja.settleAllCopy.reversing : Copy.ja.settleAllCopy.reverse) { Task { await actions.reverseBatch(batch.batchId, model: model) } }
            .fhButton(.secondary)
            .disabled(actions.busy != nil)
            .accessibilityIdentifier("budget.settlement.reverse-batch.\(batch.batchId)")
        }
      }
    }
  }
}
