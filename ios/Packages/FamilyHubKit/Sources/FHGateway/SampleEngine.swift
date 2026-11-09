import Foundation
import JavaScriptCore
import FHModel

/// 見本のモードの仕組み。Web の見本（src/data/mockGateway.ts）をまとめた sample-engine.js を JavaScriptCore で動かす。
/// 規則はサーバーと同じもの（src/domain/commands）なので、見本でも同じ検証と同じ失敗の文言になる。
/// JSContext は1本の直列の queue の上だけで触る。
public final class SampleEngine: @unchecked Sendable {
  public enum EngineError: Error, CustomStringConvertible {
    case missingScript
    case script(String)
    public var description: String {
      switch self {
      case .missingScript: "sample-engine.js が見つかりません"
      case .script(let message): "見本の仕組みの失敗: \(message)"
      }
    }
  }

  private let queue = DispatchQueue(label: "family-hub.sample-engine")
  private var context: JSContext?
  private var timers: [Int: DispatchWorkItem] = [:]
  private var nextTimer = 0
  private var lastException: String?
  /// 見本の時計の速さ。1 は実際の時間。試験では待ち時間を縮める。
  private let timeScale: Double

  public init(actorId: Id = "member-aoi", auditHistory: Bool = true, timeScale: Double = 1) throws {
    self.timeScale = timeScale
    guard let url = Bundle.module.url(forResource: "sample-engine", withExtension: "js"),
          let source = try? String(contentsOf: url, encoding: .utf8) else { throw EngineError.missingScript }
    try queue.sync {
      guard let context = JSContext() else { throw EngineError.script("JSContext を作れません") }
      context.exceptionHandler = { [weak self] _, exception in
        self?.lastException = exception?.toString() ?? "unknown"
      }
      let schedule: @convention(block) (Double, JSValue) -> Int = { [weak self] milliseconds, callback in
        self?.schedule(after: milliseconds, callback) ?? 0
      }
      let cancel: @convention(block) (Int) -> Void = { [weak self] id in
        self?.timers.removeValue(forKey: id)?.cancel()
      }
      context.setObject(schedule, forKeyedSubscript: "__fhTimer" as NSString)
      context.setObject(cancel, forKeyedSubscript: "__fhClearTimer" as NSString)
      context.evaluateScript(source, withSourceURL: url)
      if let exception = lastException { throw EngineError.script(exception) }
      self.context = context
      try resetOnQueue(actorId: actorId, auditHistory: auditHistory)
    }
  }

  private func schedule(after milliseconds: Double, _ callback: JSValue) -> Int {
    nextTimer += 1
    let id = nextTimer
    let item = DispatchWorkItem { [weak self] in
      self?.timers.removeValue(forKey: id)
      callback.call(withArguments: [])
    }
    timers[id] = item
    queue.asyncAfter(deadline: .now() + max(0, milliseconds) / 1000 * timeScale, execute: item)
    return id
  }

  private func resetOnQueue(actorId: Id, auditHistory: Bool) throws {
    lastException = nil
    let options = auditHistory ? #"{"auditHistory":true}"# : "{}"
    context?.objectForKeyedSubscript("FH").invokeMethod("reset", withArguments: [actorId, options])
    if let exception = lastException { throw EngineError.script(exception) }
  }

  /// 見本の家族を作り直す（「見本をはじめから」）。
  public func reset(actorId: Id = "member-aoi", auditHistory: Bool = true) throws {
    try queue.sync {
      timers.values.forEach { $0.cancel() }
      timers.removeAll()
      try resetOnQueue(actorId: actorId, auditHistory: auditHistory)
    }
  }

  /// FH.call(port, method, argsJson) を呼び、結果（Result）の JSON を返す。
  public func call(_ port: String, _ method: String, argumentsJSON: String) async throws -> Data {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
      queue.async { [self] in
        guard let context else { return continuation.resume(throwing: EngineError.missingScript) }
        lastException = nil
        let resolved: @convention(block) (String) -> Void = { json in continuation.resume(returning: Data(json.utf8)) }
        let rejected: @convention(block) (JSValue) -> Void = { error in continuation.resume(throwing: EngineError.script(error.toString() ?? "rejected")) }
        let promise = context.objectForKeyedSubscript("FH").invokeMethod("call", withArguments: [port, method, argumentsJSON])
        if let exception = lastException {
          continuation.resume(throwing: EngineError.script(exception))
          return
        }
        promise?.invokeMethod("then", withArguments: [JSValue(object: resolved, in: context) as Any, JSValue(object: rejected, in: context) as Any])
      }
    }
  }

  /// 写真の URL。見本の写真は fh-sample-image://<id>（アプリが同じ色を描く）。
  public func mediaURL(albumId: Id, itemId: Id, variant: String) -> String {
    queue.sync {
      context?.objectForKeyedSubscript("FH").invokeMethod("mediaUrl", withArguments: [albumId, itemId, variant])?.toString() ?? ""
    }
  }
}
