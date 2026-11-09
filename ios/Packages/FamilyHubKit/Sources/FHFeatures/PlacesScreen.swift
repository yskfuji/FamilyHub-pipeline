import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 記録した場所（Web の src/features/places/PlacesPage.tsx）。支出とメモに付けた場所をまとめる。地図や現在地は使わない。
struct PlacesScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var query = ""
  @State private var sort: Places.Sort = .recent
  @State private var selection: String?
  @State private var creating: ExpenseFormRequest?

  var body: some View {
    let colors = theme.colors
    let snapshot = model.snapshot
    let all = Places.aggregate(expenses: snapshot?.expenses ?? [], memos: snapshot?.memos ?? [])
    let needle = Account.jsTrim(query).jsLowercasedForFeatures
    let shown = Places.sort(all.filter { needle.isEmpty || "\($0.place.name) \($0.place.address ?? "")".lowercased().contains(needle) }, sort)
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("場所")
          Text("記録した場所").font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("支出やメモに付けた場所を、まとめて確認できます。地図や現在地は使いません。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        if all.isEmpty {
          EmptyStateView(title: "まだ場所を記録していません", message: "支出やメモを追加するときに「場所を追加（任意）」から、現在地・写真・名前・手入力で場所を付けられます。", illustration: .emptyPlaces, compact: true) {
            if model.can(.expenseCreate) { Button("支出を追加") { creating = ExpenseFormRequest(kind: .expense) }.fhButton(.primary) }
          }
        } else {
          VStack(alignment: .leading, spacing: TokenSpace.space1) {
            TextField("場所を検索", text: $query)
              .padding(TokenSpace.space3)
              .frame(minHeight: 44)
              .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
              .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
              .accessibilityIdentifier("places.search")
            Text("場所の名前と住所から探します。").font(.footnote).foregroundStyle(colors.inkSoft.color)
          }
          Picker("並べ替え", selection: $sort) { ForEach(Places.Sort.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
          Text("\(shown.count)か所\(needle.isEmpty ? "" : "（「\(Account.jsTrim(query))」に一致）")").font(.footnote.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
          if shown.isEmpty {
            EmptyStateView(title: "条件に合う場所はありません", message: "検索語を短くしてください。", illustration: .emptySearch, compact: true)
          }
          ForEach(shown) { item in
            Button { selection = item.key } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(item.place.name).font(.body.weight(.bold)).foregroundStyle(colors.ink.color)
                if let address = item.place.address { Text(address).font(.footnote).foregroundStyle(colors.inkSoft.color) }
                let counts = [item.expenseCount > 0 ? "支出\(item.expenseCount)件・\(Format.yen(item.expenseTotalJpy))" : nil, item.memoCount > 0 ? "メモ\(item.memoCount)件" : nil].compactMap { $0 }.joined(separator: " ")
                Text(counts).font(.footnote).foregroundStyle(colors.ink.color)
                Text("最後の記録：\(Format.dateOnly(item.lastUsedOn))").font(.footnote).foregroundStyle(colors.inkSoft.color)
              }
              .padding(TokenSpace.space3)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
              .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("places.open.\(item.key)")
          }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: 900, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(colors.paper.color.ignoresSafeArea())
    .navigationDestination(item: $selection) { key in PlaceDetailView(key: key) }
    .sheet(item: $creating) { ExpenseCreateSheet(request: $0) { _ in } }
    .onAppear(perform: takeFocus)
    .onChange(of: model.focus) { _, _ in takeFocus() }
  }

  private func takeFocus() {
    guard case .place(let key)? = model.focus else { return }
    model.focus = nil
    selection = key
  }
}

/// 1つの場所の記録。
struct PlaceDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let key: String

  var body: some View {
    let colors = theme.colors
    let item = Places.aggregate(expenses: model.snapshot?.expenses ?? [], memos: model.snapshot?.memos ?? []).first { $0.key == key }
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        if let item {
          VStack(alignment: .leading, spacing: TokenSpace.space1) {
            Eyebrow("記録した場所")
            Text(item.place.name).font(.title2.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
            let meta = Places.meta(item.place)
            if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(colors.inkSoft.color) }
            if item.place.provenance != nil { Text("\(Copy.ja.ja.place.attributionPrefix): \(Copy.ja.ja.place.attributionLabel)").font(.footnote).foregroundStyle(colors.inkSoft.color) }
          }
          Text("この場所の記録（\(item.uses.count)件）").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          ForEach(item.uses, id: \.id) { use in
            Button { model.open(destination: use.kind == .expense ? "/budget/\(use.id)" : "/notes/\(use.id)") } label: {
              HStack {
                Image(systemName: use.kind == .expense ? "yensign.circle" : "note.text").foregroundStyle(colors.inkSoft.color).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                  Text(use.title).foregroundStyle(colors.ink.color)
                  Text("\(use.kind == .expense ? "支出" : "メモ") · \(Format.dateOnly(use.date))").font(.footnote).foregroundStyle(colors.inkSoft.color)
                }
                Spacer()
                if let amount = use.amountJpy { Text(Format.yen(amount)).monospacedDigit().foregroundStyle(colors.ink.color) }
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
          }
          Text("場所は、記録した支出・メモからまとめています。場所を外したり支出・メモを削除したりすると、この一覧からも外れます。見られるのは管理者と大人のメンバーだけです。").font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        } else {
          EmptyStateView(title: "場所が見つからないか、表示する権限がありません", message: "削除されたか、共有の範囲が変わった可能性があります。", illustration: .emptyPlaces)
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(colors.paper.color.ignoresSafeArea())
    .navigationTitle(item?.place.name ?? "場所")
    .inlineNavigationTitle()
  }
}

extension String {
  /// JS の toLowerCase と同じく、言語に依らない小文字。
  var jsLowercasedForFeatures: String { lowercased() }
}

/// ヒント（Web の InsightsPage.tsx）。記録から計算した、確認しておきたいこと。記録は自動で変えない。
struct InsightsScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var insights: [Insight]?
  @State private var error: GatewayError?

  var body: some View {
    let colors = theme.colors
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("ヒント")
          Text("確認しておきたいこと").font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("予定・タスク・家計の記録から、確認しておきたいことをまとめています。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        Callout(systemImage: "info.circle", title: "ヒントは記録から計算しています", detail: "ヒントをもとに予定や担当を自動で変更することはありません。操作しなくても、記録はそのままです。", tone: .info)
        if let error {
          Callout(systemImage: "exclamationmark.triangle", title: error.message, detail: errorGuidance(error), tone: .plain) {
            Button("もう一度試す") { Task { await load() } }.fhButton(.secondary)
          }
        } else if let insights {
          if insights.isEmpty {
            EmptyStateView(title: "いま確認が必要なことはありません", message: "予定やタスク、家計の記録に変化があると、ここに表示します。", illustration: .emptyDone, compact: true)
          }
          ForEach(Array(insights.enumerated()), id: \.element.id) { index, insight in
            LedgerCard(eyebrow: String(format: "ヒント %02d", index + 1), title: insight.title) {
              StatusBadge("情報の確かさ：\(confidence(insight.confidence))", tone: insight.confidence == .high ? .success : insight.confidence == .medium ? .attention : .neutral)
              Text(insight.summary).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
              VStack(alignment: .leading, spacing: 2) {
                Text("もとにした情報").font(.footnote.weight(.bold)).foregroundStyle(colors.inkSoft.color)
                Text(insight.evidence).font(.footnote).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
              }
              Button(insight.actionLabel) { model.open(destination: insight.destination) }.fhButton(.secondary).accessibilityIdentifier("insights.open.\(insight.id)")
            }
          }
        } else {
          ProgressView("ヒントを読み込んでいます").frame(maxWidth: .infinity)
        }
        LedgerCard(eyebrow: "表示の範囲", title: "この画面では行わないこと") {
          Text("公平さの判定、気持ちや関係性の推測、予定や担当の自動変更は行いません。").foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: 900, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(colors.paper.color.ignoresSafeArea())
    .task(id: model.snapshot?.context.asOf) { await load() }
    .onChange(of: model.snapshot) { _, _ in Task { await load() } }
  }

  private func confidence(_ value: Confidence) -> String {
    let labels = Copy.ja.ja.insightConfidence.self
    return switch value { case .high: labels.high; case .medium: labels.medium; default: labels.low }
  }

  private func load() async {
    switch await model.run({ [gateway = model.gateway] in await gateway.listInsights() }) {
    case .success(let value): insights = value; error = nil
    case .failure(let failure): error = failure
    }
  }
}

/// 失敗のときの案内（ja.ts の errorGuidance）。
func errorGuidance(_ error: GatewayError) -> String {
  if error.code == .offline { return "入力した内容は残っています。接続を確認してから、もう一度お試しください。" }
  if error.code == .conflict { return "最新の内容を確認してから、もう一度変更してください。" }
  if error.code == .forbidden || error.code == .notFound { return "必要な場合は、管理者に共有設定を確認してください。" }
  if error.retryable { return "入力した内容は残っています。しばらくしてから、もう一度お試しください。" }
  return "表示された項目を確認して、入力内容を修正してください。"
}
