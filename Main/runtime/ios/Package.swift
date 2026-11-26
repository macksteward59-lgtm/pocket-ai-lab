// swift-tools-version: 5.9
import PackageDescription

// The xcframework and vendor headers are produced by scripts/build-llama-cpp.sh.
// Resolving this package before that script runs fails closed: there is no invented backend.
let package = Package(
    name: "PocketLlamaEngine",
    platforms: [
        .iOS(.v16),
        .macOS(.v14)
    ],
    products: [
        .library(name: "PocketLlamaEngine", targets: ["PocketLlamaEngine"])
    ],
    targets: [
        .binaryTarget(name: "pocketllama", path: "build/xc/llama.xcframework"),
        .binaryTarget(name: "pocketggml", path: "build/xc/ggml.xcframework"),
        .binaryTarget(name: "pocketggmlbase", path: "build/xc/ggml-base.xcframework"),
        .binaryTarget(name: "pocketggmlcpu", path: "build/xc/ggml-cpu.xcframework"),
        .binaryTarget(name: "pocketggmlmetal", path: "build/xc/ggml-metal.xcframework"),
        .binaryTarget(name: "pocketvendorhash", path: "build/xc/vendor-hash.xcframework"),
        .target(
            name: "LlamaCppBridge",
            dependencies: [
                "pocketllama",
                "pocketggml",
                "pocketggmlbase",
                "pocketggmlcpu",
                "pocketggmlmetal",
                "pocketvendorhash"
            ],
            path: "Sources/LlamaCppBridge",
            publicHeadersPath: "include",
            cSettings: [
                .define("POCKET_LLAMA_LINKED", to: "1"),
                .headerSearchPath("vendor")
            ],
            linkerSettings: [
                .linkedFramework("Foundation"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("Accelerate"),
                .linkedLibrary("c++"),
                .unsafeFlags(["-ObjC"])
            ]
        ),
        .target(
            name: "PocketLlamaEngine",
            dependencies: ["LlamaCppBridge"],
            path: "Sources/PocketLlamaEngine",
            swiftSettings: [
                .define("POCKET_LLAMA_LINKED")
            ]
        ),
        .testTarget(
            name: "LlamaEngineTests",
            dependencies: ["PocketLlamaEngine"],
            path: "Tests/LlamaEngineTests"
        )
    ]
)
