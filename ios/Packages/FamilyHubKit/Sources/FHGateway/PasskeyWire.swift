import Foundation
import FHModel

/// パスキーの登録で、サーバーとやり取りする形（Web の browserPasskeyOptions と serializeRegistration）。
public enum PasskeyWire {
  /// サーバーの作成の条件（base64url の JSON）から、要る値を取り出す。
  public struct CreationOptions: Equatable, Sendable {
    public var challenge: Data
    public var relyingParty: String
    public var userId: Data
    public var userName: String
    public var excluded: [Data]
    public init(challenge: Data, relyingParty: String, userId: Data, userName: String, excluded: [Data]) {
      self.challenge = challenge; self.relyingParty = relyingParty; self.userId = userId; self.userName = userName; self.excluded = excluded
    }
  }

  public static func options(_ publicKey: JSONValue?) -> CreationOptions? {
    guard case .object(let root)? = publicKey,
          case .string(let challenge)? = root["challenge"], let challengeData = Base64URL.decode(challenge),
          case .object(let rp)? = root["rp"], case .string(let rpId)? = rp["id"],
          case .object(let user)? = root["user"], case .string(let userId)? = user["id"], let userData = Base64URL.decode(userId),
          case .string(let name)? = user["name"] else { return nil }
    var excluded: [Data] = []
    if case .array(let list)? = root["excludeCredentials"] {
      for item in list { if case .object(let entry) = item, case .string(let id)? = entry["id"], let data = Base64URL.decode(id) { excluded.append(data) } }
    }
    return CreationOptions(challenge: challengeData, relyingParty: rpId, userId: userData, userName: name, excluded: excluded)
  }

  /// 登録の応答（RegistrationResponseJSON）。Web の serializeRegistration と同じ形。
  public static func registrationJSON(credentialId: Data, clientDataJSON: Data, attestationObject: Data) -> JSONValue {
    let id = Base64URL.encode(credentialId)
    return .object([
      "id": .string(id),
      "type": .string("public-key"),
      "rawId": .string(id),
      "authenticatorAttachment": .string("platform"),
      "clientExtensionResults": .object([:]),
      "response": .object([
        "clientDataJSON": .string(Base64URL.encode(clientDataJSON)),
        "attestationObject": .string(Base64URL.encode(attestationObject)),
        "transports": .array([.string("internal"), .string("hybrid")]),
      ]),
    ])
  }

}

public enum Base64URL {
  public static func encode(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  public static func decode(_ text: String) -> Data? {
    var value = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while value.count % 4 != 0 { value += "=" }
    return Data(base64Encoded: value)
  }
}

