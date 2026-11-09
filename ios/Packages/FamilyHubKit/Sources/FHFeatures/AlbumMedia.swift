import SwiftUI
import AVKit
import FHModel
import FHDomain
import FHDesign
import FHGateway
#if canImport(UIKit)
import UIKit
#endif

/// 取った写真や動画の置き場所を覚える（同じものを何度も取らない）。サインアウトで AttachmentFiles ごと消える。
@MainActor
final class MediaCache {
  static let shared = MediaCache()
  private var files: [String: URL] = [:]
  private var loading: [String: Task<URL?, Never>] = [:]

  func file(_ source: MediaSource, name: String, gateway: any FamilyHubGateway) async -> URL? {
    switch source {
    case .local(let url): return url
    case .sampleArt: return nil
    case .server(let path):
      if let url = files[path], FileManager.default.fileExists(atPath: url.path) { return url }
      if let running = loading[path] { return await running.value }
      let task = Task { () -> URL? in
        if case .success(let url) = await gateway.downloadMedia(source, fileName: name) { return url }
        return nil
      }
      loading[path] = task
      let url = await task.value
      loading[path] = nil
      if let url { files[path] = url }
      return url
    }
  }

  func clear() { files = [:] }
}

/// 見本の写真（Web の sampleImage の SVG と同じ絵）。名前の文字から色を決め、空と太陽と丘を描く。
struct SampleArt: View {
  let id: String

  static func hue(_ id: String) -> Double { Double(id.utf16.reduce(0) { $0 + Int($1) } % 360) }

  var body: some View {
    let hue = Self.hue(id)
    Canvas { context, size in
      // 640×480 の絵を、枠いっぱいに切り取って描く。
      let scale = max(size.width / 640, size.height / 480)
      context.translateBy(x: (size.width - 640 * scale) / 2, y: (size.height - 480 * scale) / 2)
      context.scaleBy(x: scale, y: scale)
      let gradient = Gradient(colors: [Color.hsl(hue, 0.45, 0.70), Color.hsl((hue + 50).truncatingRemainder(dividingBy: 360), 0.40, 0.45)])
      context.fill(Path(CGRect(x: 0, y: 0, width: 640, height: 480)), with: .linearGradient(gradient, startPoint: .zero, endPoint: CGPoint(x: 640, y: 480)))
      context.fill(Path(ellipseIn: CGRect(x: 500 - 56, y: 120 - 56, width: 112, height: 112)), with: .color(Color.hsl(45, 0.90, 0.80)))
      var hill = Path()
      hill.move(to: CGPoint(x: 0, y: 400))
      hill.addLine(to: CGPoint(x: 200, y: 240))
      hill.addLine(to: CGPoint(x: 340, y: 350))
      hill.addLine(to: CGPoint(x: 450, y: 280))
      hill.addLine(to: CGPoint(x: 640, y: 400))
      hill.addLine(to: CGPoint(x: 640, y: 480))
      hill.addLine(to: CGPoint(x: 0, y: 480))
      hill.closeSubpath()
      context.fill(hill, with: .color(Color.hsl((hue + 120).truncatingRemainder(dividingBy: 360), 0.30, 0.35)))
    }
    .accessibilityHidden(true)
  }
}

extension Color {
  /// CSS の hsl()。
  static func hsl(_ hue: Double, _ saturation: Double, _ lightness: Double) -> Color {
    let chroma = (1 - abs(2 * lightness - 1)) * saturation
    let section = hue / 60
    let x = chroma * (1 - abs(section.truncatingRemainder(dividingBy: 2) - 1))
    let (r, g, b): (Double, Double, Double) = switch section {
    case ..<1: (chroma, x, 0)
    case ..<2: (x, chroma, 0)
    case ..<3: (0, chroma, x)
    case ..<4: (0, x, chroma)
    case ..<5: (x, 0, chroma)
    default: (chroma, 0, x)
    }
    let m = lightness - chroma / 2
    return Color(red: r + m, green: g + m, blue: b + m)
  }
}

/// アルバムの写真や縮小画像。見本は描き、サーバーの分は取ってから見せる。
struct MediaImage: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let item: AlbumItem
  let variant: MediaVariant
  var contentMode: ContentMode = .fill
  @State private var image: PlatformImage?
  @State private var failed = false

  var body: some View {
    let source = model.gateway.mediaSource(albumId: item.albumId, itemId: item.id, variant: variant)
    ZStack {
      theme.colors.line.color
      if case .sampleArt(let id) = source {
        SampleArt(id: id)
      } else if let image {
        Image(platformImage: image).resizable().aspectRatio(contentMode: contentMode)
      } else if failed || (variant == .thumbnail && !item.hasThumbnail) {
        Image(systemName: item.kind == .video ? "film" : "photo").font(.title).foregroundStyle(theme.colors.inkSoft.color)
      } else {
        ProgressView()
      }
    }
    .clipped()
    .task(id: "\(item.id)-\(variant.rawValue)") {
      guard variant == .file || item.hasThumbnail else { return }
      if case .sampleArt = source { return }
      guard let url = await MediaCache.shared.file(source, name: variant == .thumbnail ? "\(item.id)-thumb.jpg" : item.originalName, gateway: model.gateway),
            let loaded = PlatformImage(contentsOfFile: url.path) else { failed = true; return }
      image = loaded
    }
  }
}

#if canImport(UIKit)
typealias PlatformImage = UIImage
extension Image { init(platformImage: UIImage) { self.init(uiImage: platformImage) } }
#else
import AppKit
typealias PlatformImage = NSImage
extension Image { init(platformImage: NSImage) { self.init(nsImage: platformImage) } }
#endif

/// アルバムの動画。ファイルを取ってから流す（セッションの cookie が要るため）。
struct MediaVideo: View {
  @Environment(AppModel.self) private var model
  let item: AlbumItem
  var autoplay = false
  var muted = false
  var onEnd: (() -> Void)?
  @State private var player: AVPlayer?
  @State private var failed = false

  var body: some View {
    ZStack {
      Color.black
      if let player {
        VideoPlayer(player: player).accessibilityLabel("動画「\(AlbumText.spoken(item))」")
      } else if failed {
        Text("この動画はこの端末では再生できません。").foregroundStyle(.white).padding()
      } else if case .sampleArt(let id) = model.gateway.mediaSource(albumId: item.albumId, itemId: item.id, variant: .file) {
        SampleArt(id: id)
      } else {
        ProgressView().tint(.white)
      }
    }
    .task(id: item.id) {
      let source = model.gateway.mediaSource(albumId: item.albumId, itemId: item.id, variant: .file)
      if case .sampleArt = source { if autoplay { try? await Task.sleep(for: .seconds(5)); onEnd?() }; return }
      guard let url = await MediaCache.shared.file(source, name: item.originalName, gateway: model.gateway) else { failed = true; return }
      let next = AVPlayer(url: url)
      next.isMuted = muted
      player = next
      if autoplay { next.play() }
      if let onEnd {
        for await _ in NotificationCenter.default.notifications(named: AVPlayerItem.didPlayToEndTimeNotification, object: next.currentItem) { onEnd(); break }
      }
    }
    .onChange(of: muted) { _, value in player?.isMuted = value }
    .onDisappear { player?.pause() }
  }
}
