import Foundation
import Observation
import FHModel
import FHDomain
import FHGateway

/// 添付を送る順番（Web の useAttachmentQueue.ts）。
/// - 1つずつ送る。ファイルごとに鍵を決め、送り直しでも同じ鍵を使う（応答が届かなくても添付が2つにならない）。
/// - 送り直しは利用者が選ぶ（送れなかった理由が送り直しで直るときだけ）。
/// - 受け付けられたら、確認が終わるまで 2.5秒ごとに12回まで家族の記録を取り直す。
/// - メモの画面が持つ。画面を閉じても残り、アプリを閉じると消える（ファイルはこの端末の外に残さない）。
@Observable @MainActor
final class AttachmentQueue {
  enum State: Sendable { case waiting, sending, failed }

  struct Item: Identifiable, Sendable {
    let key: String
    let memoId: Id
    let file: UploadFile
    var state: State
    var message: String?
    var retryable: Bool
    var id: String { key }
    var name: String { file.name }

    var statusText: String {
      if let message { return message }
      return switch state { case .waiting: "順番を待っています"; case .sending: "送っています…"; case .failed: "送れませんでした" }
    }
  }

  static let pollInterval: Duration = .milliseconds(2500)
  static let polls = 12

  private(set) var items: [Item] = []
  @ObservationIgnored private var sending = false
  @ObservationIgnored private var watching: [Id: Int] = [:]
  @ObservationIgnored private var polling: Task<Void, Never>?
  @ObservationIgnored private let interval: Duration

  init(pollInterval: Duration = AttachmentQueue.pollInterval) { interval = pollInterval }

  func items(for memoId: Id) -> [Item] { items.filter { $0.memoId == memoId } }

  /// 選んだファイルを並べる。受け付けられないものは、送らずに理由を残す。
  func add(_ memoId: Id, _ files: [PickedFile], model: AppModel) {
    for picked in files {
      items.append(Item(key: UUID().uuidString.lowercased(), memoId: memoId, file: picked.file, state: picked.problem == nil ? .waiting : .failed, message: picked.problem, retryable: false))
    }
    pump(model)
  }

  func retry(_ key: String, model: AppModel) {
    guard let index = items.firstIndex(where: { $0.key == key }), items[index].state == .failed, items[index].retryable else { return }
    items[index].state = .waiting
    items[index].message = nil
    pump(model)
  }

  func discard(_ key: String) { items.removeAll { $0.key == key && $0.state != .sending } }

  private func pump(_ model: AppModel) {
    guard !sending else { return }
    sending = true
    Task {
      while let index = items.firstIndex(where: { $0.state == .waiting }) {
        items[index].state = .sending
        let item = items[index]
        let memoId = item.memoId, file = item.file, key = item.key
        let result = await model.mutate { await $0.uploadAttachment(memoId: memoId, file: file, idempotencyKey: key) }
        guard let current = items.firstIndex(where: { $0.key == key }) else { continue }
        switch result {
        case .success:
          items.remove(at: current)
          model.announce("ファイルを受け付けました。確認が終わるまで開けません。")
          watching[memoId] = Self.polls
          poll(model)
        case .failure(let failure):
          items[current].state = .failed
          items[current].message = failure.message
          items[current].retryable = failure.retryable
        }
      }
      sending = false
    }
  }

  /// 確認中の添付があるメモを見張り、終わるまで記録を取り直す。
  private func poll(_ model: AppModel) {
    guard polling == nil else { return }
    polling = Task {
      defer { polling = nil }
      while true {
        let pending = watching.filter { id, left in
          left > 0 && (model.snapshot?.memos.first { $0.id == id }?.attachments.contains { $0.status == .quarantined } ?? false)
        }
        guard !pending.isEmpty else { watching = [:]; return }
        try? await Task.sleep(for: interval)
        if Task.isCancelled { return }
        for id in pending.keys { watching[id, default: 1] -= 1 }
        _ = await model.refresh()
      }
    }
  }
}
