// swift-tools-version:5.9
import PackageDescription

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
      dependencies: [.product(name: "FlatBuffers", package: "flatbuffers")]
    ),
    .testTarget(
      name: "NeapsTideDatabaseTests",
      dependencies: ["NeapsTideDatabase"],
      resources: [.copy("fixture.tcdb")]
    ),
  ]
)
