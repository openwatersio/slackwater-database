// swift-tools-version:5.9
import PackageDescription

// At the repository root, not beside the sources in packages/swift, because
// SwiftPM resolves a git dependency only from a manifest at the root of the
// repository. `path:` on each target points back into packages/swift, so
// consumers can depend on this repository by URL.
let package = Package(
  name: "NeapsTideDatabase",
  platforms: [
    .iOS(.v14),
    .macOS(.v11),
    .watchOS(.v7),
    .tvOS(.v14),
  ],
  products: [
    .library(name: "NeapsTideDatabase", targets: ["NeapsTideDatabase"])
  ],
  dependencies: [
    // Exact: the generated code calls FlatBuffersVersion_25_9_23(), which only
    // that runtime release defines. Bump together with the flatc pin in
    // mise.toml and regenerate.
    .package(url: "https://github.com/google/flatbuffers.git", exact: "25.9.23")
  ],
  targets: [
    .target(
      name: "NeapsTideDatabase",
      dependencies: [.product(name: "FlatBuffers", package: "flatbuffers")],
      path: "packages/swift/Sources/NeapsTideDatabase"
    ),
    .testTarget(
      name: "NeapsTideDatabaseTests",
      dependencies: ["NeapsTideDatabase"],
      path: "packages/swift/Tests/NeapsTideDatabaseTests",
      resources: [.copy("fixture.tcdb")]
    ),
  ]
)
