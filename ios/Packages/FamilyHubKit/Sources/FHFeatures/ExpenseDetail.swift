import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 支出・収入の内容（Web の ExpenseDetail.tsx）。概要 → 場所 → 負担と精算 → 精算の履歴。
struct ExpenseDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let id: Id
  let actions: BudgetActions
  let onClose: () -> Void
  @State private var editing = false
  @State private var deleting = false

  var body: some View {
    Group {
      if let snapshot = model.snapshot, let expense = snapshot.expenses.first(where: { $0.id == id }) {
        content(snapshot, expense: expense)
          .sheet(isPresented: $editing) { ExpenseEditSheet(expense: expense, actions: actions) }
      } else {
        ScrollView {
          EmptyStateView(title: "支出が見つからないか、表示する権限がありません", message: "削除されたか、共有の範囲が変わった可能性があります。", illustration: .emptyBudget)
            .padding(TokenSpace.space4)
        }
      }
    }
    .navigationTitle(model.snapshot?.expenses.first { $0.id == id }?.title ?? "家計")
    .inlineNavigationTitle()
  }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot, expense: Expense) -> some View {
    let colors = theme.colors
    let viewer = snapshot.viewer
    let name = { (id: Id) in memberName(snapshot.memberships, id) }
    let locked = Budget.hasActiveSettlement(expense)
    let income = expense.kind == .income
    let kind = BudgetText.kind(expense.kind)
    let canDelete = Policy.canDelete(viewer, .expenseDelete, stakeholders: [expense.creatorMembershipId, expense.payerMembershipId])
    let canEdit = model.can(.expenseUpdate)
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("\(kind)の内容")
          Text(expense.title).font(.title2.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        }
        Card {
          VStack(alignment: .leading, spacing: TokenSpace.space3) {
            DetailItem(title: "金額", value: Format.yen(expense.amountJpy))
            DetailItem(title: "日付", value: Format.dateOnly(expense.incurredOn))
            DetailItem(title: "種類", value: kind)
            DetailItem(title: "費目", value: BudgetText.category(expense.category))
            DetailItem(title: BudgetText.payerLabel(expense.kind), value: "\(name(expense.payerMembershipId))さん")
            DetailItem(title: "公開範囲", value: Visibility.text(.expense, expense.visibility, nameOf: name))
            if let note = expense.note { DetailItem(title: "メモ", value: note) }
          }
        }
        if let place = expense.place {
          DetailItem(title: Copy.ja.ja.place.legend, value: [place.name, place.address].compactMap { $0 }.joined(separator: "\n"))
        }
        if !income { shares(expense, snapshot: snapshot) }
        if canEdit || canDelete {
          HStack(spacing: TokenSpace.space3) {
            if canEdit { Button("内容を編集") { editing = true }.fhButton(.secondary, fullWidth: true).accessibilityIdentifier("budget.expense.edit.\(expense.id)") }
            if canDelete {
              Button("\(kind)を削除") { deleting = true }
                .fhButton(.danger, fullWidth: true)
                .disabled(locked || actions.busy != nil)
                .accessibilityIdentifier("budget.expense.delete.\(expense.id)")
            }
          }
          if canDelete, locked { Text("精算の記録があるため削除できません。削除するには、先に精算を取り消してください。").font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true) }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(colors.paper.color)
    .confirmationDialog("\(kind)を削除しますか", isPresented: $deleting, titleVisibility: .visible) {
      Button(Copy.ja.ja.actions.delete, role: .destructive) {
        Task { if await actions.remove(expense, model: model) { onClose() } }
      }
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
    } message: {
      Text("「\(expense.title)」（\(Format.yen(expense.amountJpy))）を削除します。\(income ? "月の集計からも外れます。" : "未精算の集計からも外れます。")削除後7日間は元に戻せます。")
    }
  }

  @ViewBuilder
  private func shares(_ expense: Expense, snapshot: HouseholdSnapshot) -> some View {
    let colors = theme.colors
    let name = { (id: Id) in memberName(snapshot.memberships, id) }
    let remaining = Ledger.remaining(expense)
    let shared = expense.shares.contains { $0.membershipId != expense.payerMembershipId }
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      Text("負担と精算").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
      ForEach(expense.shares, id: \.membershipId) { share in
        let payer = share.membershipId == expense.payerMembershipId
        VStack(alignment: .leading, spacing: 2) {
          Text("\(name(share.membershipId))\(payer ? "（支払った人）" : "")").font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
          Text("負担 \(Format.yen(share.amountJpy)) · 精算済み \(Format.yen(share.settledJpy)) · 残り \(payer ? "—" : Format.yen(max(0, share.amountJpy - share.settledJpy)))").font(.callout).monospacedDigit().foregroundStyle(colors.ink.color)
        }
        .accessibilityElement(children: .combine)
      }
      if model.can(.expenseSettle), !remaining.isEmpty {
        ForEach(remaining, id: \.membershipId) { share in
          SettlementFormView(expense: expense, membershipId: share.membershipId, remaining: share.amountJpy, actions: actions).id("\(share.membershipId)-\(share.amountJpy)")
        }
      }
      if remaining.isEmpty { Text(shared ? "すべて精算済みです。" : "支払った人だけの負担なので、精算はありません。").font(.footnote).foregroundStyle(colors.inkSoft.color) }
      Text("精算の履歴").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
      SettlementHistoryView(rows: Budget.settlementHistory([expense]).map(Budget.HistoryRow.single), showExpense: false, actions: actions, place: "detail")
    }
  }
}

/// 1人分の精算（Web の SettlementForm）。残り全額と半分をすぐに選べる。
struct SettlementFormView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let expense: Expense
  let membershipId: Id
  let remaining: Int
  let actions: BudgetActions
  @State private var text: String
  @State private var error = ""

  init(expense: Expense, membershipId: Id, remaining: Int, actions: BudgetActions) {
    self.expense = expense; self.membershipId = membershipId; self.remaining = remaining; self.actions = actions
    _text = State(initialValue: ExpenseForm.formatAmountInput(String(remaining)))
  }

  var body: some View {
    let colors = theme.colors
    let name = memberName(model.snapshot?.memberships ?? [], membershipId)
    let parsed = ExpenseForm.parseYen(text)
    let label = parsed == remaining ? "\(name)さんの残り\(Format.yen(remaining))を精算" : parsed.map { $0 > 0 ? "\(name)さんの\(Format.yen($0))を精算" : nil } ?? nil
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      Text("\(name)さんの精算額（残り\(Format.yen(remaining))）").font(.subheadline.weight(.bold)).foregroundStyle(colors.ink.color)
      AmountField(label: "\(name)さんの精算額", text: $text, identifier: "budget.settlement.amount.\(expense.id).\(membershipId)")
        .padding(TokenSpace.space3)
        .frame(minHeight: 44)
        .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
      HStack(spacing: TokenSpace.space2) {
        ForEach(SettlementForm.presets(remaining), id: \.kind) { preset in
          Button(preset.kind == .full ? "残り全額（\(Format.yen(preset.amountJpy))）" : "半分（\(Format.yen(preset.amountJpy))）") { text = ExpenseForm.formatAmountInput(String(preset.amountJpy)); error = "" }
            .fhButton(.secondary)
            .accessibilityIdentifier("budget.settlement.preset.\(preset.kind.rawValue).\(expense.id).\(membershipId)")
        }
      }
      if !error.isEmpty { Text(error).foregroundStyle(colors.danger.color) }
      Button(label ?? "\(name)さんの精算を記録") { Task { await submit() } }
        .fhButton(.primary)
        .disabled(actions.busy != nil)
        .accessibilityIdentifier("budget.settlement.record.\(expense.id).\(membershipId)")
    }
    .padding(TokenSpace.space3)
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
  }

  private func submit() async {
    if let problem = SettlementForm.amountProblem(text, remaining: remaining) { error = problem; announce(problem); return }
    error = ""
    if let message = await actions.settle(expense, from: membershipId, amount: ExpenseForm.parseYen(text) ?? 0, model: model) { error = message }
  }
}
