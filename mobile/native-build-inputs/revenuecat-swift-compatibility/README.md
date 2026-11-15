# RevenueCat Swift compiler compatibility backport

`PaywallColor.swift` is the exact complete official RevenueCat source file at
commit [`870899891ac9a05118ae6ee16d4ae189b2c1eac2`](https://github.com/RevenueCat/purchases-ios/blob/870899891ac9a05118ae6ee16d4ae189b2c1eac2/Sources/Paywalls/PaywallColor.swift).
It includes the initializer relocation from official
[PR #6949](https://github.com/RevenueCat/purchases-ios/pull/6949), released in
[5.78.0](https://github.com/RevenueCat/purchases-ios/releases/tag/5.78.0).
The adjacent MIT license and copyright notice are retained from RevenueCat 5.50.1.

This is a one-file source backport; dependency resolution stays exactly at
react-native-purchases 9.6.11 / PurchasesHybridCommon 17.24.0 / RevenueCat 5.50.1.
The only file difference moves the unchanged **private** designated initializer
from the private extension into the primary struct, suppressing the synthesized
memberwise initializer collision under Swift 6.4 / Xcode 27. No public API or
initializer body changes, and no SwiftLint or other upstream changes are included.

| Frozen source | SHA-256 |
| --- | --- |
| [Official 5.50.1 original](https://github.com/RevenueCat/purchases-ios/blob/5.50.1/Sources/Paywalls/PaywallColor.swift), also frozen in `tests/fixtures/revenuecat-5.50.1/PaywallColor.swift` | `7d5eb572233ad587841d61be7294b32583d35724be6aa39006982d298774c511` |
| Official fixed full file here (also identical in release 5.78.0) | `c24c2c37e341bc2bd33dcdfeb9b0b6f394e1f5eb0609774c3aa50f41b3610344` |

The trusted local producer applies it only after successful `pod install
--deployment` and unchanged native-lock verification, before `native-input.json`
is captured. It requires the exact original target bytes and the exact fixed asset
bytes. Missing, altered, symlinked or already-patched input fails closed. CocoaPods
installs the target read-only; replacement is atomic within the new run's native
tree and preserves the file mode. Shared pod caches and previous runs are untouched.

The asset is part of the producer hash binding and frozen source archive. Completion
and read-only verification require the exact compatibility record plus actual fixed
native source bytes, in addition to all existing source/native-manifest, lock,
signature, bundle observation and signed-provenance checks. Rehashing an unpatched
native tree cannot satisfy the compatibility check.

Local tests use the frozen official original and fixed bytes, verify that only the
initializer moved, and test failure/forgery controls with explicit fake build tools.
They do not establish a full native build, signed archive or subscription behavior.
A fresh trusted producer run and all existing acceptance gates remain required.
