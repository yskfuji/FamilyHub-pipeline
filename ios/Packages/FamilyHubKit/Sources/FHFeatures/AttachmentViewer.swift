import SwiftUI
import AVKit
import PDFKit
import FHModel
import FHDomain
import FHDesign
import FHCopy
import FHGateway
#if canImport(UIKit)
import UIKit
#endif

/// 添付を見る（Web の AttachmentViewer.tsx）。inline のリンクで取り、この端末の一時の場所に置いてから見せる。
/// 画像・MP4・PDF だけをアプリの中で見せ、ほかは「保存して開く」にする。保存は共有の画面から選ぶ。
struct AttachmentViewerSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let memoId: Id
  let attachment: Attachment
  @State private var local: URL?
  @State private var failure: String?
  @State private var saving = false
  @State private var shared: SharedFile?
  @State private var document: PDFDocument?

  private var kind: AttachmentViewerKind { AttachmentViewerKind(mimeType: attachment.mimeType) }

  var body: some View {
    NavigationStack {
      Group {
        if let failure {
          unsupported(failure)
        } else if let local {
          viewer(local)
        } else {
          ProgressView(Copy.ja.attachmentViewerCopy.loading).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .background(theme.colors.paper.color)
      .navigationTitle(attachment.originalName)
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.close) { dismiss() } }
        ToolbarItem(placement: .primaryAction) {
          Button(saving ? "準備中…" : Copy.ja.attachmentViewerCopy.save) { Task { await save() } }
            .disabled(saving)
            .accessibilityLabel("\(spokenName(attachment))を端末に保存")
        }
      }
    }
    .accessibilityLabel("\(spokenName(attachment))を表示")
    .task { await load() }
    .sheet(item: $shared) { file in ShareSheet(url: file.url) }
  }

  @ViewBuilder
  private func viewer(_ url: URL) -> some View {
    switch kind {
    case .image: ImageFileView(url: url, name: spokenName(attachment)) { failure = Copy.ja.attachmentViewerCopy.imageFailed }
    case .video:
      VideoPlayer(player: AVPlayer(url: url))
        .accessibilityLabel(spokenName(attachment))
        .task {
          // 再生できない形（端末が対応しない符号化など）は、保存して開いてもらう。
          if (try? await AVURLAsset(url: url).load(.isPlayable)) != true { failure = Copy.ja.attachmentViewerCopy.videoFailed }
        }
    case .pdf:
      if let document { PDFFileView(document: document, name: spokenName(attachment)) } else { unsupported(Copy.ja.attachmentViewerCopy.pdfFailed) }
    case .other: unsupported(Copy.ja.attachmentViewerCopy.unsupported)
    }
  }

  private func unsupported(_ message: String) -> some View {
    let colors = theme.colors
    return ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space3) {
        Label(attachment.originalName, systemImage: "doc").font(.headline).foregroundStyle(colors.ink.color)
        Text(MemoAttachments.formatSize(attachment.byteSize)).foregroundStyle(colors.inkSoft.color)
        Text(message).foregroundStyle(colors.ink.color).fixedSize(horizontal: false, vertical: true)
        Button(Copy.ja.attachmentViewerCopy.saveAndOpen) { Task { await save() } }.fhButton(.primary).disabled(saving)
      }
      .padding(TokenSpace.space4)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func load() async {
    guard kind != .other else { failure = Copy.ja.attachmentViewerCopy.unsupported; return }
    switch await fetch(.inline) {
    case .success(let url):
      if kind == .pdf { document = PDFDocument(url: url) }
      local = url
    case .failure(let error): failure = error.message
    }
  }

  /// 保存のためのリンク（attachment）で取り、共有の画面を出す。
  private func save() async {
    guard !saving else { return }
    saving = true
    defer { saving = false }
    switch await fetch(.attachment) {
    case .success(let url): shared = SharedFile(url: url)
    case .failure(let error): model.announce(error.message)
    }
  }

  private func fetch(_ disposition: AttachmentDisposition) async -> GatewayResult<URL> {
    let memoId = memoId, attachmentId = attachment.id, name = attachment.originalName
    let link = await model.run { [gateway = model.gateway] in await gateway.getAttachmentLink(memoId: memoId, attachmentId: attachmentId, disposition: disposition) }
    guard case .success(let value) = link else { if case .failure(let error) = link { return .failure(error) }; return .failure(AttachmentFiles.unavailable) }
    return await model.gateway.downloadAttachment(value, fileName: name)
  }
}

struct SharedFile: Identifiable {
  let url: URL
  var id: URL { url }
}

private struct ImageFileView: View {
  let url: URL
  let name: String
  let failed: () -> Void
  var body: some View {
    #if canImport(UIKit)
    if let image = UIImage(contentsOfFile: url.path) {
      ScrollView([.horizontal, .vertical]) {
        Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity).accessibilityLabel(name)
      }
    } else {
      Color.clear.onAppear(perform: failed)
    }
    #else
    Color.clear.onAppear(perform: failed)
    #endif
  }
}

#if canImport(UIKit)
/// PDF を PDFKit で見せる。中のリンクは http と https だけを開く（javascript: や file: は開かない）。
private struct PDFFileView: UIViewRepresentable {
  let document: PDFDocument
  let name: String

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> PDFView {
    let view = PDFView()
    view.autoScales = true
    view.displayMode = .singlePageContinuous
    view.delegate = context.coordinator
    view.accessibilityLabel = name
    view.document = document
    return view
  }

  func updateUIView(_ view: PDFView, context: Context) {}

  final class Coordinator: NSObject, PDFViewDelegate {
    func pdfViewWillClick(onLink sender: PDFView, with url: URL) {
      guard let safe = MemoAttachments.safeLinkURL(url.absoluteString), let target = URL(string: safe) else { return }
      Task { @MainActor in UIApplication.shared.open(target) }
    }
  }
}

/// 共有の画面（「ファイルに保存」など）。
struct ShareSheet: UIViewControllerRepresentable {
  let url: URL
  func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#else
private struct PDFFileView: View {
  let document: PDFDocument
  let name: String
  var body: some View { Text(name) }
}

struct ShareSheet: View {
  let url: URL
  var body: some View { ShareLink(item: url) }
}
#endif
