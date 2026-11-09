import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// メモの入力（Web の MemoForm.tsx）。作るときだけ、ファイルも一緒に選べる。
struct MemoFormView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let initial: MemoDraft
  let busy: Bool
  let error: String
  var offerFiles = false
  @Binding var draft: MemoDraft
  @Binding var files: [PickedFile]
  @Binding var problem: String

  var body: some View {
    let colors = theme.colors
    let memberships = model.snapshot?.memberships ?? []
    let visible = memberships.filter { $0.status == .active || draft.selectedIds.contains($0.id) }
    let today = model.snapshot.flatMap { CalendarDate.dateKey(fromRfc3339: $0.context.asOf) } ?? "2026-09-30"
    Form {
      if !(problem.isEmpty && error.isEmpty) {
        Section { Text(problem.isEmpty ? error : problem).foregroundStyle(colors.danger.color).accessibilityIdentifier("memo.form.error") }
      }
      Section {
        TextField("タイトル", text: limited($draft.title, MemoForm.titleLimit)).accessibilityIdentifier("memo.form.title")
        TextField("本文", text: limited($draft.body, MemoForm.bodyLimit), axis: .vertical).lineLimit(4...12).accessibilityIdentifier("memo.form.body")
      }
      Section {
        TextField("タグ", text: $draft.tags).accessibilityIdentifier("memo.form.tags")
      } footer: { Text("例：学校、今週。読点またはカンマで区切ります（最大\(MemoForm.maxTags)件）") }
      Section {
        Toggle("日付を決める", isOn: Binding(get: { !draft.memoDate.isEmpty }, set: { draft.memoDate = $0 ? today : "" }))
        if !draft.memoDate.isEmpty {
          DatePicker("日付", selection: Binding(get: { LocalTime.date("\(draft.memoDate)T12:00") ?? Date() }, set: { draft.memoDate = String(LocalTime.local(from: $0).prefix(10)) }), displayedComponents: .date)
            .environment(\.timeZone, EventFormView.tokyo)
        }
      }
      VisibilitySection(kind: .memo, audience: $draft.audience, selectedIds: $draft.selectedIds, initialAudience: initial.audience, people: visible)
      if let place = draft.place {
        Section("場所") {
          LabeledContent("場所", value: place.name)
          Button("場所を外す", role: .destructive) { draft.place = nil }
        }
      }
      if offerFiles, model.can(.memoAttach) {
        Section {
          AttachmentPickButtons { files += $0 }
          ForEach(files) { picked in
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text(picked.file.name).foregroundStyle(colors.ink.color)
                Text(picked.problem ?? MemoAttachments.formatSize(picked.file.size)).font(.footnote).foregroundStyle(picked.problem == nil ? colors.inkSoft.color : colors.danger.color)
              }
              Spacer()
              Button("外す") { files.removeAll { $0.id == picked.id } }
                .fhLink()
                .accessibilityLabel("\(picked.file.name)を選択から外す")
            }
          }
        } header: { Text("添付ファイル（任意）") } footer: { Text(MemoAttachments.limitsText) }
      }
    }
    .disabled(busy)
    .onChange(of: problem) { _, message in if !message.isEmpty { announce(message) } }
    .onChange(of: error) { _, message in if !message.isEmpty { announce(message) } }
  }
}

/// メモを作る。ファイルは、メモができてから順番に送る。
struct MemoCreateSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let onCreated: (Memo, [PickedFile]) -> Void
  @State private var draft = MemoForm.newDraft(date: "", audience: .household)
  @State private var initial = MemoForm.newDraft(date: "", audience: .household)
  @State private var files: [PickedFile] = []
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false
  @State private var ready = false
  @State private var key = UUID().uuidString.lowercased()

  var body: some View {
    NavigationStack {
      MemoFormView(initial: initial, busy: busy, error: error, offerFiles: true, draft: $draft, files: $files, problem: $problem)
        .navigationTitle("メモを作る")
        .inlineNavigationTitle()
        .navigationSubtitle("ファイルも一緒に追加できます。追加したファイルは、確認が終わるまで開けません。")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if dirty { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? "作成中…" : "作成する") { Task { await submit() } }.disabled(busy).accessibilityIdentifier("memo.form.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: dirty, asking: $asking) { dismiss() })
    .onAppear(perform: prepare)
  }

  private var dirty: Bool { draft != initial || !files.isEmpty }

  private func prepare() {
    guard !ready, let snapshot = model.snapshot else { return }
    ready = true
    let audience = Visibility.defaultAudience(snapshot.viewer.role, .memo, preferred: model.privacy?.defaultAudience)
    let fresh = MemoForm.newDraft(date: CalendarDate.dateKey(fromRfc3339: snapshot.context.asOf) ?? "", audience: audience)
    initial = fresh
    draft = fresh
  }

  private func submit() async {
    guard !busy else { return }
    if let found = MemoForm.problem(draft) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = MemoForm.createInput(draft)
    let context = model.mutationContext(key: key)
    switch await model.mutate({ await $0.createMemo(input, context: context) }) {
    case .success(let memo):
      model.announce("メモを作成しました")
      onCreated(memo, files)
      dismiss()
    case .failure(let failure):
      error = failure.message
    }
  }
}

/// メモの編集。保存に失敗しても、入力中の内容は残る。
struct MemoEditSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let memo: Memo
  @State private var draft: MemoDraft
  @State private var initial: MemoDraft
  @State private var files: [PickedFile] = []
  @State private var problem = ""
  @State private var error = ""
  @State private var busy = false
  @State private var asking = false

  init(memo: Memo) {
    self.memo = memo
    let start = MemoForm.draft(from: memo)
    _draft = State(initialValue: start)
    _initial = State(initialValue: start)
  }

  var body: some View {
    NavigationStack {
      MemoFormView(initial: initial, busy: busy, error: error, draft: $draft, files: $files, problem: $problem)
        .navigationTitle("メモを編集")
        .inlineNavigationTitle()
        .navigationSubtitle("保存に失敗した場合も、入力中の内容は残ります。")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.cancel) { if draft != initial { asking = true } else { dismiss() } }.disabled(busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.saveChanges) { Task { await submit() } }.disabled(busy).accessibilityIdentifier("memo.form.save")
          }
        }
    }
    .modifier(UnsavedGuard(dirty: draft != initial, asking: $asking) { dismiss() })
  }

  private func submit() async {
    guard !busy else { return }
    if let found = MemoForm.problem(draft) { problem = found; return }
    problem = ""; error = ""; busy = true
    defer { busy = false }
    let input = MemoForm.updateInput(draft, original: memo)
    let id = memo.id, version = memo.version
    switch await model.mutate({ await $0.updateMemo(id: id, input: input, expectedVersion: version, context: nil) }) {
    case .success:
      model.announce("メモを更新しました")
      dismiss()
    case .failure(let failure):
      error = failure.message
    }
  }
}
