// swift-tools-version: 6.2
import PackageDescription

// よりどころの iOS アプリの中身。アプリの target（ios/project.yml）はこれを読むだけにする。
// FHModel と FHDomain と FHGateway は macOS でも動くので、`swift test` で数秒で確かめられる。
let package = Package(
  name: "FamilyHubKit",
  defaultLocalization: "ja",
  platforms: [.iOS("26.0"), .macOS("26.0")],
  products: [
    .library(name: "FHModel", targets: ["FHModel"]),
    .library(name: "FHCopy", targets: ["FHCopy"]),
    .library(name: "FHDomain", targets: ["FHDomain"]),
    .library(name: "FHGateway", targets: ["FHGateway"]),
    .library(name: "FHDesign", targets: ["FHDesign"]),
    .library(name: "FHFeatures", targets: ["FHFeatures"]),
  ],
  targets: [
    .target(name: "FHModel"),
    .target(name: "FHCopy", resources: [.copy("Copy")]),
    .target(name: "FHDomain", dependencies: ["FHModel", "FHCopy"]),
    .target(
      name: "FHGateway",
      dependencies: ["FHModel"],
      resources: [.copy("Resources/sample-engine.js"), .copy("Resources/samples")]
    ),
    .target(name: "FHDesign", dependencies: ["FHModel", "FHCopy", "FHDomain"]),
    .target(name: "FHFeatures", dependencies: ["FHModel", "FHCopy", "FHDomain", "FHGateway", "FHDesign"]),
    .testTarget(name: "FHModelTests", dependencies: ["FHModel"], resources: [.copy("Fixtures")]),
    .testTarget(name: "FHDomainTests", dependencies: ["FHDomain", "FHModel"], resources: [.copy("Vectors")]),
    .testTarget(name: "FHGatewayTests", dependencies: ["FHGateway", "FHModel"]),
    .testTarget(name: "FHDesignTests", dependencies: ["FHDesign", "FHCopy"]),
  ],
  swiftLanguageModes: [.v6]
)
