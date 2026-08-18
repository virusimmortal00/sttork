# Dork worker candidate

This directory locks the exact inputs for ADR-0009. The selected Dork core is
copied under `vendor/dork/`; Zork I Release 119 is separately copied under
`vendor/zork1/`. Both imports have independent provenance and notices.

The candidate is a modified, unendorsed fork of upstream Dork commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622`. The fork's behavioral patch has
SHA-256 `a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`. The
runtime compatibility ID binds both identities:

```text
dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605
```

Two local TypeScript build adaptations change relative import specifiers from
`.ts` to `.js` for NodeNext emit and spell the optional seed field as
`number | undefined` for `exactOptionalPropertyTypes`. Those two changes are
build-only. The same fork also contains intentional runtime behavior changes for
host checkpoints and a parser token-capacity fix; it must not be described as an
unmodified upstream copy.

`source-lock.json` records upstream and local hashes. Run:

```text
pnpm dork:verify
```

The check authenticates every selected source and notice, then validates the
Zork story's hash, size, version, release, serial, declared length, and header
checksum without network access. It also requires the schema-v2 wire golden
declaration described below.

## Checkpoint slice

The isolated candidate session now proves a bounded Version 3 checkpoint and
cold-restore slice:

- checkpoints are captured at the post-decode continuation of the Version 3 READ
  instruction;
- state includes dynamic memory, data and call stacks, program counter, current
  RNG mode, gameplay RNG state, checkpointable reseed-stream state, interpreter
  flags, stream 3 state, instruction/turn counters, and pending READ metadata;
- machine-checkpoint and envelope schemas are version 2, with adapter
  compatibility ID `zork-voice-dork-checkpoint-v2`;
- a unit regression hashes the complete schema-v2 wire encoding to golden
  SHA-256 `79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`,
  and `pnpm dork:verify` pins that declaration;
- the strict big-endian codec is capped at 1 MiB and uses bounded structural and
  materialization passes before accepting data;
- the envelope binds runtime and adapter compatibility IDs, story identity and
  SHA-256, revision, and the last output;
- each turn has a finite instruction budget and a 256 KiB output cap;
- restore stages a replacement Dork session through one silent input boundary,
  then swaps the candidate state atomically; and
- the generic engine snapshot contract rejects payloads over 4 MiB before
  copying or hashing them.

Repository tests cover minimal-story and Zork I cold-restore smokes, corrupt and
truncated checkpoint rejection, runtime/adapter configuration and story mismatch
failure atomicity, repeated restore, and detached snapshot bytes. The fork also
fixes a parse-buffer token-capacity bug found by the fixture.

A project-owned Version 3 story assembled only in test memory proves positive
RANDOM, RANDOM 0, negative RANDOM predictable mode, and RESTART remain exact
across cold restore; it adds no fixture artifact. RANDOM 0 and RESTART advance a
checkpointable SplitMix32-style reseed stream, while positive range scaling uses
deterministic tail rejection. For ranges that do not divide 2^32, incomplete
tail buckets consume another checkpointed gameplay state so accepted results are
unbiased and cold-restorable.

## Remaining boundary

This remains spike/test code and is not exported or compiled by the production
`game-engine` package. The isolated Slice 1 bridge now supplies a versioned
browser message boundary, disposable Worker leases, a bounded outer receipt
journal, outer `EngineSnapshot` SHA-256 validation, and virgin-worker restore.
Receipt capacity rejects before mutation, while a lost submitted response
quarantines execution until the exact request recovers its receipt.

Build the ignored browser module graph with `pnpm dork:worker:build`, then run
`pnpm dork:worker:serve` and open the printed loopback URL. The smoke uses only
external scripts under a restrictive CSP and proves boot, exact output,
snapshot, termination of the old lease, silent replacement-worker restore,
branch receipt replay, corrupt-restore rejection, and continued active-worker
use. It is developer evidence, not a production bundle or release artifact.

SHA-256 provides integrity checking, not authenticity. Restore remains an
explicit lifecycle operation and is not exposed as a guide tool.

Missing behavioral fixtures include operand-zero READ, the full
status/style/general-restart output matrix, a 50-turn cold-worker comparison,
Safari evidence, watchdog termination, conformance reruns, and release
bundle/SBOM closure. Dork's story-driven save encoding is not Quetzal and is not
used as the project checkpoint. No M0 gate is accepted by this slice.
