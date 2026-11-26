// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Apex",
    platforms: [.iOS(.v16), .macOS(.v14)],
    products: [
        .library(name: "ApexBridge", targets: ["ApexBridge"])
    ],
    dependencies: [
        .package(name: "PocketLlamaEngine", path: "../../../runtime/ios")
    ],
    targets: [
        .target(
            name: "ApexBridge",
            dependencies: [
                .product(name: "PocketLlamaEngine", package: "PocketLlamaEngine")
            ],
            path: "Sources/ApexBridge"
        ),
        .testTarget(
            name: "ApexBridgeTests",
            dependencies: [
                "ApexBridge",
                .product(name: "PocketLlamaEngine", package: "PocketLlamaEngine")
            ],
            path: "Tests/ApexBridgeTests"
        )
    ]
)
