import Foundation
import FHModel
import FHGateway
#if os(iOS)
import AuthenticationServices
import UIKit
#endif

/// パスキーの登録（Web の credentials.create と serializeRegistration）。
/// 端末のパスキーは、アプリと同じドメインの webcredentials の設定（AASA と entitlement）が要る。
/// Info.plist の FHPasskeyRelyingParty（Local.xcconfig の FH_PASSKEY_RP_ID）が空のときは使わない。
enum Passkeys {
  /// 登録に使うドメイン。まだ用意していなければ nil。
  static var relyingParty: String? {
    let value = (Bundle.main.object(forInfoDictionaryKey: "FHPasskeyRelyingParty") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
    return value.isEmpty || value.hasPrefix("$(") ? nil : value
  }

  static let unavailable = GatewayError(code: .upstreamFailure, message: "このアプリでは、まだパスキーを追加できません。Web の画面から追加してください。", retryable: false)
  static let cancelled = GatewayError(code: .upstreamFailure, message: "パスキーの作成がキャンセルされました。", retryable: true)
  static let failed = GatewayError(code: .upstreamFailure, message: "パスキーの作成を完了できませんでした。", retryable: true)

  /// 端末でパスキーを作る。見本では端末の確認を模した値を返す（Web の見本と同じ）。
  @MainActor static func create(_ start: PasskeyRegistrationStart, sample: Bool) async -> Result<JSONValue, GatewayError> {
    if sample { return .success(.object(["id": .string("mock-credential-\(UUID().uuidString.lowercased())"), "demo": .bool(true)])) }
    guard let domain = relyingParty, let options = PasskeyWire.options(start.publicKey), options.relyingParty == domain else { return .failure(unavailable) }
    #if os(iOS)
    return await PasskeyCreator().create(options)
    #else
    return .failure(unavailable)
    #endif
  }
}

#if os(iOS)
/// AuthenticationServices でパスキーを作る。1回の作成ごとに作り、終わったら捨てる。
@MainActor
final class PasskeyCreator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  private var continuation: CheckedContinuation<Result<JSONValue, GatewayError>, Never>?

  func create(_ options: PasskeyWire.CreationOptions) async -> Result<JSONValue, GatewayError> {
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.relyingParty)
    let request = provider.createCredentialRegistrationRequest(challenge: options.challenge, name: options.userName, userID: options.userId)
    request.excludedCredentials = options.excluded.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    return await withCheckedContinuation { continuation in
      self.continuation = continuation
      controller.performRequests()
    }
  }

  nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration
    let value = registration.flatMap { item in item.rawAttestationObject.map { PasskeyWire.registrationJSON(credentialId: item.credentialID, clientDataJSON: item.rawClientDataJSON, attestationObject: $0) } }
    MainActor.assumeIsolated { finish(value.map { .success($0) } ?? .failure(Passkeys.failed)) }
  }

  nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
    let cancelled = (error as? ASAuthorizationError)?.code == .canceled
    MainActor.assumeIsolated { finish(.failure(cancelled ? Passkeys.cancelled : Passkeys.failed)) }
  }

  nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    MainActor.assumeIsolated {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
  }

  private func finish(_ result: Result<JSONValue, GatewayError>) {
    continuation?.resume(returning: result)
    continuation = nil
  }
}
#endif
