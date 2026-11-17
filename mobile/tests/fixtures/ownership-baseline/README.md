# Frozen ownership baseline fixture

These are the reviewed `mobile/src/sync/progressSync.ts` bytes from commit
`3a744a1f8fd8ac83284d6bc1eb3fa60eb4cc351f`, compressed only to avoid duplicating a long source file.
SHA-256 after decompression: `0091988824b080070239caf57cb7723fedad6703451c3e5d63d02c1de4e2362c`.

Native provenance tests build their isolated stub repository from this accepted reader, rather than
silently treating the current descendant App source as the old baseline. The production guard's
reader hash is unchanged and still checks the fixture through real Git objects. This fixture and
its fake build/signature tools do not establish a signed native build or authorize an OTA.
