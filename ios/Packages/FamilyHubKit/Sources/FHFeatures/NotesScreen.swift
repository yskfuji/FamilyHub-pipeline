import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// メモの画面（Web の src/features/notes/NotesPage.tsx）。家族で共有する連絡や控え。
/// iPhone は一覧から押して内容へ進む。iPad は一覧と、右に内容を並べる。
struct NotesScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass

  @AppStorage("fh.memoSort") private var storedSort = MemoSort.newest.rawValue
  @State private var query = ""
  @State private var selection: Id?
  @State private var creating = false
  @State private var deleted: DeletedRecord?
  @State private var queue = AttachmentQueue()

  private var sort: MemoSort { MemoSort.parse(storedSort) }
  private var narrow: Bool { sizeClass == .compact }

  var body: some View {
    Group {
      if let snapshot = model.snapshot {
        if narrow {
          list(snapshot).navigationDestination(item: $selection) { id in detail(id) }
        } else {
          HStack(alignment: .top, spacing: 0) {
            list(snapshot).frame(maxWidth: .infinity)
            Divider()
            Group {
              if let selection { detail(selection) } else {
                EmptyStateView(title: "メモを選んでください", message: "一覧のメモを選ぶと、ここに内容を表示します。", compact: true).padding(TokenSpace.space4)
              }
            }
            .frame(width: 420)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(theme.colors.sheet.color)
          }
        }
      } else if model.loading {
        ProgressView("メモを読み込んでいます。").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(theme.colors.paper.color.ignoresSafeArea())
    .sheet(isPresented: $creating) {
      MemoCreateSheet { memo, files in
        selection = memo.id
        if !files.isEmpty { queue.add(memo.id, files, model: model) }
      }
    }
    .onAppear(perform: takeFocus)
    .onChange(of: model.focus) { _, _ in takeFocus() }
  }

  private func takeFocus() {
    guard case .memo(let id)? = model.focus else { return }
    model.focus = nil
    selection = id
  }

  private func detail(_ id: Id) -> some View {
    MemoDetailView(id: id, queue: queue) { removed in
      deleted = removed
      selection = nil
    }
    .id(id)
  }

  @ViewBuilder
  private func list(_ snapshot: HouseholdSnapshot) -> some View {
    let colors = theme.colors
    let scoped = MemberScope.scoped(snapshot, scope: preferences.memberScope)
    let shown = MemoList.sort(scoped.memos.filter { MemoList.matches($0, query: query) }, sort)
    let canCreate = model.can(.memoCreate)
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        if let error = model.error { ErrorBanner(error: error) }
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("メモ")
          Text("家族のメモ").font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("家族で共有する連絡や控えをまとめます。文字認識の結果は、元のファイルと照らし合わせて確認できます。").font(.callout).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          MemberScopePicker(snapshot: snapshot)
          if canCreate {
            Button { creating = true } label: { Label("メモを追加", systemImage: "plus") }.fhButton(.primary)
          }
        }
        if let deleted { DeletedCallout(record: deleted) { await restore(deleted) } }
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          HStack(spacing: TokenSpace.space2) {
            Image(systemName: "magnifyingglass").foregroundStyle(colors.inkSoft.color).accessibilityHidden(true)
            TextField("メモを検索", text: $query)
              .textFieldStyle(.plain)
              .autocorrectionDisabled()
              .submitLabel(.search)
              .accessibilityIdentifier("memo.search")
            if !query.isEmpty {
              Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(colors.inkSoft.color) }
                .buttonStyle(.plain)
                .accessibilityLabel("検索語を消す")
            }
          }
          .padding(TokenSpace.space3)
          .frame(minHeight: 44)
          .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
          .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
          Text("タイトル、本文、タグ、文字認識の結果、記録した場所の名前から検索します。").font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        Picker("メモの並び順", selection: Binding(get: { sort }, set: { storedSort = $0.rawValue })) {
          ForEach(MemoSort.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        if shown.isEmpty {
          if scoped.memos.isEmpty && scoped.memberId == nil {
            EmptyStateView(title: "まだメモはありません", message: canCreate ? "学校からの連絡や控えをメモにすると、家族で同じものを確認できます。" : "共有されたメモが追加されると、ここに表示します。", illustration: .emptyMemos, compact: true) {
              if canCreate { Button("最初のメモを書く") { creating = true }.fhButton(.primary) }
            }
          } else if scoped.memberId != nil {
            EmptyStateView(title: "条件に合うメモはありません", message: "表示する人を「すべて」に戻すと、ほかの記録を確認できます。", illustration: .emptyMemos, compact: true)
          } else {
            EmptyStateView(title: "条件に合うメモはありません", message: "検索語を短くするか、新しいメモを追加してください。", illustration: .emptySearch, compact: true)
          }
        } else {
          VStack(spacing: TokenSpace.space2) {
            ForEach(shown) { memo in
              MemoRow(memo: memo, snapshot: snapshot, selected: !narrow && selection == memo.id) { selection = memo.id }
            }
          }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func restore(_ removed: DeletedRecord) async {
    let id = removed.id
    switch await model.mutate({ await $0.restoreMemo(id: id) }) {
    case .success:
      deleted = nil
      model.announce("「\(removed.title)」を元に戻しました")
    case .failure(let failure):
      model.announce(failure.message)
    }
  }
}

/// 一覧の1件（Web のメモのカード）。
struct MemoRow: View {
  @Environment(\.theme) private var theme
  let memo: Memo
  let snapshot: HouseholdSnapshot
  let selected: Bool
  let open: () -> Void

  var body: some View {
    let colors = theme.colors
    let name = { (id: Id) in memberName(snapshot.memberships, id) }
    let meta = [name(memo.authorMembershipId), memo.tags.isEmpty ? nil : memo.tags.joined(separator: " / "), Visibility.text(.memo, memo.visibility, nameOf: name)].compactMap { $0 }.joined(separator: " · ")
    Button(action: open) {
      VStack(alignment: .leading, spacing: TokenSpace.space1) {
        Label(CalendarText.day(MemoList.dateKey(memo)), systemImage: "note.text").font(.footnote.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
        Text(memo.title).font(.body.weight(.bold)).foregroundStyle(colors.ink.color).multilineTextAlignment(.leading)
        // 行数で切ると、大きな文字で途中が隠れる。長い本文は初めの部分だけを出す。
        Text(excerpt).font(.callout).foregroundStyle(colors.inkSoft.color).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
        if let place = memo.place { Label(place.name, systemImage: "mappin").font(.footnote).foregroundStyle(colors.inkSoft.color) }
        Text(meta).font(.footnote).foregroundStyle(colors.inkSoft.color).multilineTextAlignment(.leading)
        if !memo.attachments.isEmpty {
          StatusBadge("添付 \(memo.attachments.count)件", tone: memo.attachments.contains { $0.status == .rejected } ? .danger : memo.attachments.contains { $0.status != .clean } ? .attention : .success)
        }
      }
      .padding(TokenSpace.space3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(selected ? colors.accent.color.opacity(0.08) : colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
      .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(selected ? colors.accent.color : colors.line.color))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .combine)
    .accessibilityHint("内容を開きます")
    .accessibilityIdentifier("memo.row.\(memo.id)")
  }

  private var excerpt: String { memo.body.count > 80 ? "\(memo.body.prefix(80))…" : memo.body }
}
