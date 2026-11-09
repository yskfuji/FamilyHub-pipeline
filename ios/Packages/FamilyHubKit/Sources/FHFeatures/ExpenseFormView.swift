import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway

/// 支出・収入の入力（Web の ExpenseForm.tsx と ExpenseSplitFields.tsx）。確かめと送る形は FHDomain の ExpenseForm（Web と同じ答え）。
struct ExpenseFormView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let initial: ExpenseDraft
  /// 編集のときの元の記録。
  var original: Expense?
  var splitLocked = false
  let busy: Bool
  let error: String
  var note: String?
  @Binding var draft: ExpenseDraft
  @Binding var problem: String

  var body: some View {
    let colors = theme.colors
    let memberships = model.snapshot?.memberships ?? []
    let adultIds = ExpenseForm.activeAdults(memberships).map(\.id)
    let income = draft.kind == .income
    let visible = memberships.filter { $0.status == .active || draft.selectedIds.contains($0.id) }
    let outside = ExpenseForm.peopleOutside(draft, adultIds: adultIds, memberships: memberships, creatorId: original?.creatorMembershipId ?? model.snapshot?.viewer.membershipId ?? "")
    Form {
      if !(problem.isEmpty && error.isEmpty) {
        Section { Text(problem.isEmpty ? error : problem).foregroundStyle(colors.danger.color).accessibilityIdentifier("budget.form.error") }
      }
      if let note { Section { Label(note, systemImage: "eye").font(.callout) } }
      Section {
        Picker(Copy.ja.kindChangeCopy.legend, selection: Binding(get: { draft.kind }, set: { kind in
          if original != nil { draft = ExpenseForm.withKind(draft, kind) } else { draft.kind = kind; draft.category = ExpenseForm.defaultCategory(kind) }
        })) {
          Text(BudgetText.kind(.expense)).tag(ExpenseKind.expense)
          Text(BudgetText.kind(.income)).tag(ExpenseKind.income)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("budget.form.kind")
      } footer: {
        if let original { kindChangeText(original, memberships: memberships).map { Text($0) } }
      }
      Section {
        TextField(ExpenseForm.titleLabel(draft.kind), text: limited($draft.title, ExpenseForm.titleLimit), prompt: Text(income ? "例：9月の給与" : "例：学校教材"))
          .accessibilityIdentifier("budget.form.title")
        DatePicker("日付", selection: Binding(get: { LocalTime.date("\(draft.date)T12:00") ?? Date() }, set: { draft.date = String(LocalTime.local(from: $0).prefix(10)) }), displayedComponents: .date)
          .environment(\.timeZone, EventFormView.tokyo)
        Picker("費目", selection: $draft.category) {
          ForEach(income ? ExpenseCategory.income : ExpenseCategory.spending, id: \.self) { Text(BudgetText.category($0)).tag($0) }
        }
      }
      Section {
        LabeledContent("金額（円）") {
          AmountField(label: "金額（円）", text: $draft.amount, identifier: "budget.form.amount").multilineTextAlignment(.trailing)
        }
        Picker(BudgetText.payerLabel(draft.kind), selection: $draft.payerId) {
          ForEach(ExpenseForm.payerChoices(memberships, keep: initial.payerId)) { Text($0.displayName).tag($0.id) }
        }
        if !income {
          Picker("負担の分け方", selection: Binding(get: { draft.splitMode }, set: { mode in
            if mode == .custom { draft.customAmounts = ExpenseForm.seedCustomAmounts(draft, adultIds: adultIds) }
            draft.splitMode = mode
          })) {
            ForEach(SplitMode.allCases, id: \.self) { Text($0.label).tag($0) }
          }
          .accessibilityIdentifier("budget.form.split")
          if draft.splitMode == .custom {
            ForEach(Array(Set(adultIds + draft.customAmounts.ids)).sorted { (adultIds + draft.customAmounts.ids).firstIndex(of: $0)! < (adultIds + draft.customAmounts.ids).firstIndex(of: $1)! }, id: \.self) { id in
              LabeledContent("\(memberName(memberships, id))さんの負担（円）") {
                AmountField(label: "\(memberName(memberships, id))さんの負担（円）", text: Binding(get: { draft.customAmounts[id] ?? "" }, set: { draft.customAmounts[id] = $0 }), identifier: "budget.form.share.\(id)")
                  .multilineTextAlignment(.trailing)
              }
            }
            Text(gapText).font(.footnote).foregroundStyle(colors.inkSoft.color)
          } else {
            Text(ExpenseForm.plannedShares(draft, adultIds: adultIds).map { "\(memberName(memberships, $0.membershipId))さん \(Format.yen($0.amountJpy))" }.joined(separator: "・"))
              .font(.footnote).foregroundStyle(colors.inkSoft.color)
          }
        }
      } header: {
        Text(income ? "金額" : "金額と負担")
      } footer: {
        if splitLocked { Text("精算の記録があるため、金額・支払った人・負担する人は変更できません。変えるには、先に精算を取り消してください。") }
      }
      .disabled(splitLocked)
      Section {
        TextField("メモ（任意）", text: limited($draft.note, ExpenseForm.noteLimit), axis: .vertical).lineLimit(2...5)
      }
      VisibilitySection(kind: .expense, audience: $draft.audience, selectedIds: $draft.selectedIds, initialAudience: initial.audience, people: visible)
      if !outside.isEmpty {
        Section { Label("\(outside.map(\.displayName).joined(separator: "、"))さんには、この公開範囲だと記録が表示されません。", systemImage: "exclamationmark.triangle").foregroundStyle(colors.ink.color) }
      }
      if !income, let place = draft.place {
        Section(Copy.ja.ja.place.legend) {
          LabeledContent("場所", value: place.name)
          Button("場所を外す", role: .destructive) { draft.place = nil }
        }
      }
    }
    .disabled(busy)
    .onChange(of: problem) { _, message in if !message.isEmpty { announce(message) } }
    .onChange(of: error) { _, message in if !message.isEmpty { announce(message) } }
  }

  private var gapText: String {
    switch ExpenseForm.customSplitGap(draft) {
    case nil: "先に金額を入力してください。"
    case 0?: "負担の合計は金額と同じです。"
    case let gap? where gap > 0: "あと\(Format.yen(gap))を割り当ててください。"
    case let gap?: "金額より\(Format.yen(-gap))多くなっています。"
    }
  }

  private func kindChangeText(_ original: Expense, memberships: [HouseholdMembership]) -> String? {
    let effects = ExpenseForm.kindChangeEffects(original, draft.kind)
    guard effects.changes else { return nil }
    if effects.blockedBySettlement { return Copy.ja.kindChangeCopy.blockedBySettlement }
    if effects.clearsShares {
      let people = original.shares.filter { $0.membershipId != original.payerMembershipId }.map { "\(memberName(memberships, $0.membershipId))さん \(Format.yen($0.amountJpy))" }.joined(separator: "・")
      return people.isEmpty ? Copy.ja.kindChangeCopy.clearsSharesPlain : BudgetText.clearsShares(people)
    }
    return Copy.ja.kindChangeCopy.requiresShares
  }
}

/// 支出・収入の追加。開いている間は1つの冪等の鍵を使う。オフラインの待ち行列には入れない。
struct ExpenseCreateSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let request: ExpenseFormRequest
  let onCreated: (Expense) -> Void
  @State private var draft = ExpenseForm.newDraft(date: "", viewer: "", adultIds: [], audience: .household)
  @State private var initial = ExpenseForm.newDraft(date: "", viewer: "", adultIds: [], audience: .household)
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false
  @State private var ready = false
  @State private var key = UUID().uuidString.lowercased()

  var body: some View {
    NavigationStack {
      ExpenseFormView(initial: initial, busy: busy, error: error, note: request.note, draft: $draft, problem: $problem)
        .navigationTitle("すぐに追加")
        .inlineNavigationTitle()
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.add) { Task { await submit() } }.disabled(busy).accessibilityIdentifier("budget.form.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
    .onAppear(perform: prepare)
  }

  private var adultIds: [Id] { ExpenseForm.activeAdults(model.snapshot?.memberships ?? []).map(\.id) }

  private func prepare() {
    guard !ready, let snapshot = model.snapshot else { return }
    ready = true
    let audience = Visibility.defaultAudience(snapshot.viewer.role, .expense, preferred: model.privacy?.defaultAudience)
    let fresh = ExpenseForm.newDraft(date: CalendarDate.dateKey(fromRfc3339: snapshot.context.asOf) ?? "", viewer: snapshot.viewer.membershipId, adultIds: adultIds, audience: audience, kind: request.kind)
    initial = fresh
    // 読み取りの候補は、利用者が確かめるまで保存していない入力として扱う。
    draft = request.receipt.map { ExpenseForm.apply($0, to: fresh) } ?? fresh
  }

  private func submit() async {
    guard !busy else { return }
    if let found = ExpenseForm.problem(draft, splitLocked: false) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = ExpenseForm.createInput(draft, adultIds: adultIds)
    let key = key
    switch await model.mutate({ await $0.createExpense(input, idempotencyKey: key) }) {
    case .success(let expense):
      model.announce(expense.kind == .income ? "収入を追加しました" : "支出を追加しました")
      onCreated(expense)
      dismiss()
    case .failure(let failure):
      error = "\(failure.message) 支出は未送信の変更として保存されません。"
    }
  }
}

/// 支出・収入の編集。精算の記録があるときは、金額・支払った人・負担を変えない。
struct ExpenseEditSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let expense: Expense
  let actions: BudgetActions
  @State private var draft: ExpenseDraft
  @State private var initial: ExpenseDraft
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false

  init(expense: Expense, actions: BudgetActions) {
    self.expense = expense
    self.actions = actions
    let start = ExpenseForm.draft(from: expense, adultIds: [])
    _draft = State(initialValue: start)
    _initial = State(initialValue: start)
  }

  var body: some View {
    let locked = Budget.hasActiveSettlement(expense)
    NavigationStack {
      ExpenseFormView(initial: initial, original: expense, splitLocked: locked, busy: busy, error: error, draft: $draft, problem: $problem)
        .navigationTitle("\(BudgetText.kind(expense.kind))を編集")
        .inlineNavigationTitle()
        .navigationSubtitle("保存に失敗した場合も、入力中の内容は残ります。")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.saveChanges) { Task { await submit(locked) } }.disabled(busy).accessibilityIdentifier("budget.form.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
    .onAppear {
      // 等分かどうかは大人のメンバーで決まるので、家族の記録が分かってから下書きを作る。
      let adults = ExpenseForm.activeAdults(model.snapshot?.memberships ?? []).map(\.id)
      let start = ExpenseForm.draft(from: expense, adultIds: adults)
      if draft == initial { draft = start }
      initial = start
    }
  }

  private func submit(_ locked: Bool) async {
    guard !busy else { return }
    if let found = ExpenseForm.problem(draft, splitLocked: locked) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let adults = ExpenseForm.activeAdults(model.snapshot?.memberships ?? []).map(\.id)
    let input = ExpenseForm.updateInput(draft, original: expense, adultIds: adults, splitLocked: locked)
    if let message = await actions.update(expense, input: input, model: model) { error = message } else { dismiss() }
  }
}

/// まとめて精算する（Web の SettleAllDialog.tsx）。開いたときの内容をそのまま送り、サーバーが今の残りと照らす。
struct SettleAllSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let input: SettleAllInput
  let onDone: (SettlementBatch) -> Void
  @State private var key = UUID().uuidString.lowercased()
  @State private var busy = false
  @State private var failure: Failure?

  enum Failure: Equatable { case stale(String), refused(String), other(String) }

  var body: some View {
    let colors = theme.colors
    let names = model.snapshot?.memberships ?? []
    let records = Set(input.shares.map(\.expenseId)).count
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: TokenSpace.space4) {
          Text(BudgetText.settleAllDescription(input.shares.count)).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
          Text(Copy.ja.settleAllCopy.transfersHeading).font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          if input.transfers.isEmpty {
            Text(Copy.ja.settleAllCopy.noTransfer).foregroundStyle(colors.ink.color)
          } else {
            ForEach(Array(input.transfers.enumerated()), id: \.offset) { _, transfer in
              HStack {
                Text(BudgetText.transfer(memberName(names, transfer.from), memberName(names, transfer.to))).foregroundStyle(colors.ink.color)
                Spacer()
                Text(Format.yen(transfer.amountJpy)).font(.body.weight(.bold)).monospacedDigit().foregroundStyle(colors.ink.color)
              }
              .accessibilityElement(children: .combine)
            }
          }
          Text(BudgetText.settleAllRecords(records)).foregroundStyle(colors.ink.color)
          Text(Copy.ja.settleAllCopy.note).font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
          switch failure {
          case .stale(let message)?:
            Callout(systemImage: "arrow.clockwise", title: Copy.ja.settleAllCopy.stale, detail: message, tone: .info) {
              Button(Copy.ja.settleAllCopy.reload) { Task { await reload() } }.fhButton(.primary).accessibilityIdentifier("budget.settle-all.reload")
            }
          case .refused(let message)?, .other(let message)?:
            Text(message).foregroundStyle(colors.danger.color).fixedSize(horizontal: false, vertical: true)
          case nil:
            EmptyView()
          }
        }
        .padding(TokenSpace.space4)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .background(colors.paper.color)
      .navigationTitle(Copy.ja.settleAllCopy.title)
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(isRefused ? Copy.ja.ja.actions.close : Copy.ja.ja.actions.cancel) { dismiss() }.disabled(busy) }
        if !isRefused, !isStale {
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.settleAllCopy.busy : Copy.ja.settleAllCopy.confirm) { Task { await confirm() } }.disabled(busy).accessibilityIdentifier("budget.settle-all.confirm")
          }
        }
      }
    }
  }

  private var isRefused: Bool { if case .refused = failure { true } else { false } }
  private var isStale: Bool { if case .stale = failure { true } else { false } }

  private func confirm() async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    let input = input, key = key
    switch await model.mutate({ await $0.settleAll(input, idempotencyKey: key) }) {
    case .success(let batch):
      onDone(batch)
      dismiss()
    case .failure(let error):
      if error.code == .conflict, error.message == Copy.serverMessages.serverMessages.settleAllChanged { failure = .stale(error.message) }
      else if error.code == .conflict { failure = .refused(error.message) }
      else { failure = .other(error.message) }
    }
  }

  private func reload() async {
    _ = await model.refresh()
    model.announce(Copy.ja.settleAllCopy.reloaded)
    dismiss()
  }
}

/// 領収書を読み取る（Web の ReceiptReadDialog.tsx）。読み取った内容は支出の入力に入れるだけで、保存は利用者が行う。
struct ReceiptReaderSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let sample: Bool
  let onRead: (ReceiptProposal, String) -> Void
  @State private var file: UploadFile?
  @State private var error = ""
  @State private var reading: Task<Void, Never>?

  var body: some View {
    let colors = theme.colors
    let copy = Copy.ja.ja.reading.self
    NavigationStack {
      Form {
        Section {
          Label {
            VStack(alignment: .leading, spacing: 2) {
              Text(sample ? copy.sampleTitle : copy.title).font(.callout.weight(.bold))
              Text((sample ? copy.sampleBody : copy.body) + copy.keep).font(.footnote).foregroundStyle(colors.inkSoft.color)
            }
          } icon: { Image(systemName: "eye") }
        }
        Section {
          AttachmentPickButtons(photoLabel: file == nil ? "写真から選ぶ" : "別の写真を選ぶ") { picked in
            guard let first = picked.first else { return }
            if let problem = Reading.imageProblem(name: first.file.name, type: first.file.type, size: first.file.size) { error = problem; file = nil } else { error = ""; file = first.file }
          }
          if let file { LabeledContent("領収書の画像", value: "\(file.name)（\(MemoAttachments.formatSize(file.size))）") }
        } footer: { Text("JPEG と PNG を読み取れます（10MBまで）。写真の HEIC は JPEG に変えて送ります。") }
        if reading != nil { Section { HStack { ProgressView(); Text("読み取っています。しばらくお待ちください。") } } }
        if !error.isEmpty { Section { Text(error).foregroundStyle(colors.danger.color) } }
      }
      .navigationTitle("領収書を読み取る")
      .inlineNavigationTitle()
      .navigationSubtitle("金額・日付・店名・費目を読み取り、支出の入力に入れます。")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { reading?.cancel(); dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(reading != nil ? "読み取り中…" : "読み取る") { start() }.disabled(file == nil || reading != nil).accessibilityIdentifier("assistant.receipt.submit")
        }
      }
      .onDisappear { reading?.cancel() }
    }
  }

  private func start() {
    guard let file, reading == nil else { return }
    error = ""
    let gateway = model.gateway
    reading = Task {
      defer { reading = nil }
      let started = await model.run { await gateway.readReceipt(file) }
      guard case .success(var current) = started else { if case .failure(let failure) = started { error = failure.message }; return }
      let deadline = ContinuousClock.now + Reading.waitLimit
      while ContinuousClock.now < deadline {
        try? await Task.sleep(for: Reading.pollInterval)
        if Task.isCancelled { return }
        switch await gateway.getAssistantJob(id: current.id) {
        case .failure(let failure): error = failure.message; return
        case .success(let next):
          current = next
          if next.status == .failed { error = next.message ?? Reading.waitedTooLong; return }
          if next.status == .done {
            guard let receipt = next.receipt else { error = "読み取れませんでした。写りや内容を確かめて、もう一度お試しください。"; return }
            onRead(receipt, next.sample == true ? Copy.ja.ja.reading.reviewSample : Copy.ja.ja.reading.review)
            return
          }
        }
      }
      error = Reading.waitedTooLong
    }
  }
}
