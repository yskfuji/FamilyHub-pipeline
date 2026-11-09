import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 家族の情報を検索する（Web の SearchOverlay.tsx）。入力のたびに少し待ってからサーバーに問い合わせ、種類ごとにまとめて示す。
/// 下には、画面を開く・記録を追加するなどの操作も並べる（Web のコマンドパレット）。
struct SearchSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let addKind: (QuickAddKind) -> Void
  @State private var query = ""
  @State private var results: [SearchResult] = []
  @State private var loading = false
  @State private var error: GatewayError?
  @FocusState private var focused: Bool

  struct Command: Identifiable {
    let id: String
    let label: String
    let group: String
    let keywords: String
    let run: () -> Void
  }

  var body: some View {
    let colors = theme.colors
    let trimmed = Account.jsTrim(query)
    NavigationStack {
      List {
        if !trimmed.isEmpty {
          if loading { Text("検索しています…").foregroundStyle(colors.inkSoft.color) }
          else if let error {
            Section {
              Text(error.message).foregroundStyle(colors.danger.color)
              Button("もう一度検索") { Task { await search(trimmed) } }
            }
          } else if results.isEmpty {
            Section {
              Text("一致する情報はありません").font(.headline)
              Text("語を短くするか、別の言い方で探してください。").foregroundStyle(colors.inkSoft.color)
            }
          } else {
            ForEach(SearchGroups.group(results)) { group in
              Section("\(group.label) \(group.items.count)件") {
                ForEach(group.items, id: \.destination) { result in
                  Button {
                    dismiss()
                    model.open(destination: result.destination)
                  } label: {
                    VStack(alignment: .leading, spacing: 2) {
                      Text(result.label).foregroundStyle(colors.ink.color)
                      if let detail = result.detail, !detail.isEmpty { Text(detail).font(.footnote).foregroundStyle(colors.inkSoft.color) }
                    }
                  }
                  .accessibilityLabel("\(group.label)「\(result.label)」を開く")
                }
              }
            }
          }
        }
        let commands = commandList.filter { matches($0, trimmed) }
        if !commands.isEmpty {
          ForEach(Dictionary(grouping: commands, by: \.group).sorted { order($0.key) < order($1.key) }, id: \.key) { group, items in
            Section(group) {
              ForEach(items) { command in Button(command.label) { dismiss(); command.run() } }
            }
          }
        }
      }
      .searchable(text: $query, placement: searchPlacement, prompt: "予定・メモ・家計・アルバムなどを検索")
      .navigationTitle("家族の情報を検索")
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("検索を閉じる") { dismiss() } } }
      .task(id: trimmed) {
        results = []
        error = nil
        guard !trimmed.isEmpty else { loading = false; return }
        loading = true
        try? await Task.sleep(for: .milliseconds(160))
        if Task.isCancelled { return }
        await search(trimmed)
      }
    }
  }

  private var searchPlacement: SearchFieldPlacement {
    #if os(iOS)
    .navigationBarDrawer(displayMode: .always)
    #else
    .automatic
    #endif
  }

  private func search(_ text: String) async {
    loading = true
    defer { loading = false }
    switch await model.run({ [gateway = model.gateway] in await gateway.search(text) }) {
    case .success(let value): results = value; error = nil
    case .failure(let failure): error = failure
    }
  }

  private func order(_ group: String) -> Int { ["画面を開く", "追加する", "テーマ"].firstIndex(of: group) ?? 9 }

  private func matches(_ command: Command, _ text: String) -> Bool {
    guard !text.isEmpty else { return true }
    return "\(command.label) \(command.group) \(command.keywords)".nfkcLowercased.contains(text.nfkcLowercased)
  }

  private var commandList: [Command] {
    var list: [Command] = []
    let open: [(String, String, String)] = [("/today", "今日を開く", "ホーム"), ("/calendar", "予定を開く", "カレンダー"), ("/tasks", "タスクを開く", "やること"), ("/notes", "メモを開く", "ノート"), ("/budget", "家計を開く", "お金 支出"), ("/albums", "アルバムを開く", "写真 動画"), ("/places", "場所を開く", "お店"), ("/insights", "ヒントを開く", "確認"), ("/settings", "設定を開く", "")]
    for (path, label, keywords) in open { list.append(Command(id: path, label: label, group: "画面を開く", keywords: keywords) { model.open(destination: path) }) }
    for kind in QuickAddKind.allCases where model.can(kind.capability) {
      list.append(Command(id: "add-\(kind.rawValue)", label: "\(kind.label)を追加", group: "追加する", keywords: "新規 作成") { addKind(kind) })
    }
    return list
  }
}

extension String {
  var nfkcLowercased: String { precomposedStringWithCompatibilityMapping.lowercased() }
}

/// すぐに追加（Web の QuickCreate）。どの画面からでも、記録を追加する入力を開く。
enum QuickAddKind: String, CaseIterable, Identifiable {
  case todo, event, memo, expense, income
  var id: String { rawValue }
  var label: String { switch self { case .todo: "タスク"; case .event: "予定"; case .memo: "メモ"; case .expense: "支出"; case .income: "収入" } }
  var systemImage: String { switch self { case .todo: "checkmark.circle"; case .event: "calendar"; case .memo: "note.text"; case .expense: "yensign.circle"; case .income: "plus.circle" } }
  var capability: Capability { switch self { case .todo: .taskCreate; case .event: .eventCreate; case .memo: .memoCreate; case .expense, .income: .expenseCreate } }
}

/// すぐに追加の入力。種類ごとの追加の画面をそのまま使う。
struct QuickAddSheet: View {
  @Environment(AppModel.self) private var model
  let kind: QuickAddKind

  var body: some View {
    let today = model.snapshot.flatMap { CalendarDate.dateKey(fromRfc3339: $0.context.asOf) } ?? ""
    switch kind {
    case .todo: TaskCreateSheet { model.open(destination: "/tasks/\($0.id)") }
    case .event: EventCreateSheet(request: EventFormRequest(prefill: EventPrefill(date: today)))
    case .memo: MemoCreateSheet { memo, _ in model.open(destination: "/notes/\(memo.id)") }
    case .expense: ExpenseCreateSheet(request: ExpenseFormRequest(kind: .expense)) { model.open(destination: "/budget/\($0.id)") }
    case .income: ExpenseCreateSheet(request: ExpenseFormRequest(kind: .income)) { model.open(destination: "/budget/\($0.id)") }
    }
  }
}
