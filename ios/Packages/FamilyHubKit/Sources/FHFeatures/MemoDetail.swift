import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// メモの内容（Web の MemoDrawer.tsx）。添付、文字認識の結果、編集、削除。
struct MemoDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let id: Id
  let queue: AttachmentQueue
  let onDeleted: (DeletedRecord) -> Void
  @State private var editing = false
  @State private var deleting = false
  @State private var busy = false

  var body: some View {
    Group {
      if let snapshot = model.snapshot, let memo = snapshot.memos.first(where: { $0.id == id }) {
        content(snapshot, memo: memo)
          .sheet(isPresented: $editing) { MemoEditSheet(memo: memo) }
      } else {
        ScrollView {
          EmptyStateView(title: "メモが見つからないか、表示する権限がありません", message: "削除されたか、共有の範囲が変わった可能性があります。", illustration: .emptyMemos)
            .padding(TokenSpace.space4)
        }
      }
    }
    .navigationTitle(model.snapshot?.memos.first { $0.id == id }?.title ?? "メモ")
    .inlineNavigationTitle()
  }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot, memo: Memo) -> some View {
    let colors = theme.colors
    let viewer = snapshot.viewer
    let name = { (id: Id) in memberName(snapshot.memberships, id) }
    let canEdit = Policy.canMutateOwned(viewer, .memoUpdate, ownerMembershipId: memo.authorMembershipId)
    let canAttach = Policy.canMutateOwned(viewer, .memoAttach, ownerMembershipId: memo.authorMembershipId)
    let canDelete = Policy.canDelete(viewer, .memoDelete, stakeholders: [memo.authorMembershipId])
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("メモの内容")
          Text(memo.title).font(.title2.weight(.bold)).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
          Text("\(CalendarText.day(MemoList.dateKey(memo))) · \(name(memo.authorMembershipId))").font(.footnote).foregroundStyle(colors.inkSoft.color)
        }
        Text(memo.body).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Text("タグ").font(.subheadline.weight(.bold)).foregroundStyle(colors.inkSoft.color)
          Text(memo.tags.isEmpty ? "なし" : memo.tags.map { "#\($0)" }.joined(separator: " ")).foregroundStyle(colors.ink.color)
        }
        .accessibilityElement(children: .combine)
        DetailItem(title: "共有範囲", value: Visibility.text(.memo, memo.visibility, nameOf: name))
        if let place = memo.place {
          DetailItem(title: Copy.ja.ja.place.legend, value: [place.name, place.address].compactMap { $0 }.joined(separator: "\n"))
          if model.can(.placeRead) {
            Button("この場所の記録を見る") { model.open(destination: "/places/\(Places.key(of: place))") }.fhButton(.secondary)
          }
          if place.provenance != nil { Text("\(Copy.ja.ja.place.attributionPrefix): \(Copy.ja.ja.place.attributionLabel)").font(.footnote).foregroundStyle(theme.colors.inkSoft.color) }
        }
        MemoAttachmentsView(memo: memo, canAttach: canAttach, queue: queue)
        if memo.ocrText != nil || (canEdit && !memo.attachments.isEmpty) {
          MemoOcrView(memo: memo, canEdit: canEdit)
        }
        if canEdit || canDelete {
          HStack(spacing: TokenSpace.space3) {
            if canEdit { Button("内容を編集") { editing = true }.fhButton(.secondary, fullWidth: true).accessibilityIdentifier("memo.detail.edit") }
            if canDelete { Button("メモを削除") { deleting = true }.fhButton(.danger, fullWidth: true).disabled(busy) }
          }
        }
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(colors.paper.color)
    .confirmationDialog("メモを削除しますか", isPresented: $deleting, titleVisibility: .visible) {
      Button(Copy.ja.ja.actions.delete, role: .destructive) { Task { await remove(memo) } }
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
    } message: {
      Text("「\(memo.title)」を削除します。添付ファイルも表示されなくなります。削除後7日間は元に戻せます。")
    }
  }

  private func remove(_ memo: Memo) async {
    busy = true
    defer { busy = false }
    let id = memo.id
    switch await model.mutate({ await $0.deleteMemo(id: id) }) {
    case .success:
      model.announce("「\(memo.title)」を削除しました")
      onDeleted(DeletedRecord(id: id, title: memo.title))
    case .failure(let failure):
      model.announce("\(failure.message) 削除はオフライン中に保存できません。")
    }
  }
}

/// 添付ファイル（Web の MemoAttachments.tsx）。確認が終わったものだけ開ける。
struct MemoAttachmentsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let memo: Memo
  let canAttach: Bool
  let queue: AttachmentQueue
  @State private var viewing: Attachment?
  @State private var removing: Attachment?

  var body: some View {
    let colors = theme.colors
    let queued = queue.items(for: memo.id)
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      Text("添付ファイル").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
      if memo.attachments.isEmpty && queued.isEmpty {
        Text("添付ファイルはありません。").foregroundStyle(colors.inkSoft.color)
      }
      ForEach(memo.attachments) { attachment in row(attachment) }
      ForEach(queued) { item in queuedRow(item) }
      if queued.contains(where: { $0.state == .failed && $0.retryable }) {
        Text("送れなかったファイルは、この画面を離れるまで残ります。メモは作り直さずに送り直せます。").font(.footnote).foregroundStyle(colors.inkSoft.color)
      }
      if canAttach {
        AttachmentPickButtons(photoLabel: "写真を追加", fileLabel: "ファイルを追加") { queue.add(memo.id, $0, model: model) }
      }
      Callout(systemImage: "lock", title: "確認が終わるまでファイルは開けません", detail: "\(MemoAttachments.limitsText)共有相手の範囲も確認してください。", tone: .plain)
    }
    .sheet(item: $viewing) { attachment in AttachmentViewerSheet(memoId: memo.id, attachment: attachment) }
    .confirmationDialog("添付ファイルを削除しますか", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { attachment in
      Button(Copy.ja.ja.actions.delete, role: .destructive) { Task { await remove(attachment) } }
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
    } message: { attachment in Text("「\(attachment.originalName)」を削除します。添付ファイルの削除は元に戻せません。") }
  }

  @ViewBuilder
  private func row(_ attachment: Attachment) -> some View {
    let colors = theme.colors
    let kind = AttachmentViewerKind(mimeType: attachment.mimeType)
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      HStack(alignment: .top, spacing: TokenSpace.space2) {
        Image(systemName: attachment.mimeType.hasPrefix("image/") ? "photo" : attachment.mimeType.hasPrefix("video/") ? "film" : "doc").foregroundStyle(colors.inkSoft.color).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text(attachment.originalName).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
          Text("\(MemoAttachments.formatSize(attachment.byteSize)) · \(attachment.statusMessage)").font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
      }
      HStack(spacing: TokenSpace.space2) {
        if attachment.status == .clean {
          Button(kind == .other ? Copy.ja.attachmentViewerCopy.saveAndOpen : Copy.ja.attachmentViewerCopy.open) { viewing = attachment }
            .fhButton(.secondary)
            .accessibilityLabel("\(spokenName(attachment))を\(kind == .other ? "保存して開く" : "開く")")
        } else {
          StatusBadge(MemoAttachments.statusLabel(attachment.status), tone: attachment.status == .rejected ? .danger : attachment.status == .quarantined ? .attention : .neutral)
        }
        if canAttach {
          Button(Copy.ja.ja.actions.delete.replacingOccurrences(of: "する", with: "")) { removing = attachment }
            .fhLink()
            .accessibilityLabel("\(spokenName(attachment))を削除")
        }
      }
    }
    .padding(TokenSpace.space3)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
  }

  @ViewBuilder
  private func queuedRow(_ item: AttachmentQueue.Item) -> some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      HStack(spacing: TokenSpace.space2) {
        if item.state == .sending { ProgressView() } else { Image(systemName: item.state == .failed ? "exclamationmark.triangle" : "clock").foregroundStyle(item.state == .failed ? colors.danger.color : colors.inkSoft.color).accessibilityHidden(true) }
        VStack(alignment: .leading, spacing: 2) {
          Text(item.name).font(.body.weight(.semibold)).foregroundStyle(colors.ink.color)
          Text(item.statusText).font(.footnote).foregroundStyle(item.state == .failed ? colors.danger.color : colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
      }
      if item.state == .failed {
        HStack(spacing: TokenSpace.space2) {
          if item.retryable {
            Button(Copy.ja.ja.actions.retry) { queue.retry(item.key, model: model) }.fhButton(.secondary).accessibilityLabel("\(item.name)をもう一度送る")
          }
          Button("取り除く") { queue.discard(item.key) }.fhLink().accessibilityLabel("\(item.name)を取り除く")
        }
      }
    }
    .padding(TokenSpace.space3)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
  }

  private func remove(_ attachment: Attachment) async {
    let memoId = memo.id, attachmentId = attachment.id
    switch await model.mutate({ await $0.deleteAttachment(memoId: memoId, attachmentId: attachmentId) }) {
    case .success: model.announce("「\(attachment.originalName)」を削除しました")
    case .failure(let failure): model.announce(failure.message)
    }
  }
}

/// 文字認識の結果（Web の MemoOcr.tsx）。読み取りの誤りを、元のファイルと照らして人が直す。
struct MemoOcrView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let memo: Memo
  let canEdit: Bool
  @State private var editing = false
  @State private var text = ""
  @State private var busy = false
  @State private var error = ""

  var body: some View {
    let colors = theme.colors
    VStack(alignment: .leading, spacing: TokenSpace.space3) {
      HStack {
        Text("文字認識の結果").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
        StatusBadge("元のファイルと照合", tone: .info)
      }
      if editing {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Text("文字認識の結果を修正").font(.subheadline.weight(.bold)).foregroundStyle(colors.inkSoft.color)
          TextEditor(text: limited($text, MemoForm.ocrLimit))
            .frame(minHeight: 140)
            .scrollContentBackground(.hidden)
            .padding(TokenSpace.space2)
            .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusSm))
            .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(colors.line.color))
            .accessibilityLabel("文字認識の結果を修正")
            .accessibilityIdentifier("memo.ocr.text")
          Text("空にして保存すると、結果を外します。").font(.footnote).foregroundStyle(colors.inkSoft.color)
        }
        if !error.isEmpty { Text(error).foregroundStyle(colors.danger.color) }
        HStack(spacing: TokenSpace.space3) {
          Button(Copy.ja.ja.actions.cancel) { editing = false; error = "" }.fhButton(.secondary).disabled(busy)
          Button(busy ? Copy.ja.ja.actions.saving : Copy.ja.ja.actions.saveChanges) { Task { await save() } }.fhButton(.primary).disabled(busy).accessibilityIdentifier("memo.ocr.save")
        }
      } else {
        Text(memo.ocrText ?? "読み取った文字はありません。").foregroundStyle(memo.ocrText == nil ? colors.inkSoft.color : colors.ink.color).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        Text("文字認識には誤りが含まれることがあります。重要な日時や金額は、元のファイルで確認してください。").font(.footnote).foregroundStyle(colors.inkSoft.color).fixedSize(horizontal: false, vertical: true)
        if canEdit {
          Button(memo.ocrText == nil ? "文字を入力" : "文字を修正") { text = memo.ocrText ?? ""; error = ""; editing = true }
            .fhButton(.secondary)
            .accessibilityIdentifier("memo.ocr.edit")
        }
      }
    }
    .padding(TokenSpace.space3)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusSm).stroke(theme.colors.line.color))
  }

  private func save() async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    let input = MemoForm.ocrInput(text)
    let id = memo.id, version = memo.version
    switch await model.mutate({ await $0.updateMemo(id: id, input: input, expectedVersion: version, context: nil) }) {
    case .success:
      editing = false
      model.announce("文字認識の結果を修正しました")
    case .failure(let failure):
      error = failure.message
    }
  }
}

/// 読み上げで使う添付の名前。拡張子は読みにくいので、種類の言葉に置き換える（例: 写真「教材の写真」）。
func spokenName(_ attachment: Attachment) -> String {
  let name = attachment.originalName
  let base = name.contains(".") ? String(name[..<name.lastIndex(of: ".")!]) : name
  let kind = attachment.mimeType.hasPrefix("image/") ? "写真" : attachment.mimeType.hasPrefix("video/") ? "動画" : attachment.mimeType == "application/pdf" ? "PDF" : "ファイル"
  return "\(kind)「\(base.isEmpty ? name : base)」"
}
