import SwiftUI

// iOS だけにある入力の設定。macOS の swift test でも組み立てられるように、ここにまとめる。

extension View {
  /// メールアドレス（パスワードの自動入力ではユーザー名として扱う）。
  func emailInput() -> some View {
    #if os(iOS)
    self.keyboardType(.emailAddress).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
    #else
    self.autocorrectionDisabled()
    #endif
  }

  /// パスワード。new は新しく作るとき（強いパスワードの提案を出す）。
  func passwordInput(new: Bool) -> some View {
    #if os(iOS)
    self.textContentType(new ? .newPassword : .password).textInputAutocapitalization(.never).autocorrectionDisabled()
    #else
    self
    #endif
  }

  /// 確認コード（届いたコードを候補に出す）。
  func oneTimeCodeInput() -> some View {
    #if os(iOS)
    self.textContentType(.oneTimeCode).keyboardType(.asciiCapable).textInputAutocapitalization(.never).autocorrectionDisabled()
    #else
    self
    #endif
  }

  func plainTextInput() -> some View {
    #if os(iOS)
    self.textInputAutocapitalization(.never).autocorrectionDisabled()
    #else
    self.autocorrectionDisabled()
    #endif
  }

  func inlineNavigationTitle() -> some View {
    #if os(iOS)
    self.navigationBarTitleDisplayMode(.inline)
    #else
    self
    #endif
  }
}

#if os(iOS)
import UIKit

/// 画面のどこに触れても「操作した」と数える（無操作の期限のため）。触れた内容は邪魔しない。
struct ActivityTracker: UIViewRepresentable {
  let onActivity: @MainActor () -> Void

  func makeUIView(context: Context) -> TrackerView { TrackerView(onActivity: onActivity) }
  func updateUIView(_ view: TrackerView, context: Context) { view.onActivity = onActivity }

  final class TrackerView: UIView {
    var onActivity: @MainActor () -> Void
    private weak var installedOn: UIWindow?
    private lazy var recognizer = TouchRecognizer { [weak self] in self?.onActivity() }

    init(onActivity: @escaping @MainActor () -> Void) {
      self.onActivity = onActivity
      super.init(frame: .zero)
      isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) は使わない") }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      guard let window, installedOn !== window else { return }
      installedOn?.removeGestureRecognizer(recognizer)
      window.addGestureRecognizer(recognizer)
      installedOn = window
    }
  }

  final class TouchRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private let onTouch: @MainActor () -> Void
    init(onTouch: @escaping @MainActor () -> Void) {
      self.onTouch = onTouch
      super.init(target: nil, action: nil)
      cancelsTouchesInView = false
      delaysTouchesBegan = false
      delaysTouchesEnded = false
      delegate = self
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
      onTouch()
      state = .failed
    }
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent) {
      onTouch()
      super.pressesBegan(presses, with: event)
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
  }
}
#endif

extension View {
  /// 画面いっぱいに重ねる（iPhone・iPad）。macOS（試験のための組み立て）では普通のシートにする。
  @ViewBuilder func fullCover<Item: Identifiable, Content: View>(item: Binding<Item?>, @ViewBuilder content: @escaping (Item) -> Content) -> some View {
    #if os(iOS)
    fullScreenCover(item: item, content: content)
    #else
    sheet(item: item, content: content)
    #endif
  }

  @ViewBuilder func fullCover<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
    #if os(iOS)
    fullScreenCover(isPresented: isPresented, content: content)
    #else
    sheet(isPresented: isPresented, content: content)
    #endif
  }
}
