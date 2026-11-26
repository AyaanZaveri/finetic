// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "NavigatorAetherBridge",
    platforms: [.macOS(.v15)],
    products: [.library(name: "NavigatorAetherBridge", type: .dynamic, targets: ["NavigatorAetherBridge"])],
    dependencies: [
        .package(url: "https://github.com/superuser404notfound/AetherEngine", exact: "7.76.0")
    ],
    targets: [
        .target(name: "NavigatorAetherBridge", dependencies: [.product(name: "AetherEngine", package: "AetherEngine")]),
        .testTarget(name: "NavigatorAetherBridgeTests", dependencies: ["NavigatorAetherBridge"])
    ]
)
