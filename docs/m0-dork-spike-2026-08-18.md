# Dork TypeScript candidate spike — 2026-08-18

Status: bounded integration, checkpoint, and RNG evidence; no M0 gate accepted  
Candidate: modified, unendorsed fork of Dork commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622`  
Decision: [ADR-0009](adr/0009-dork-typescript-interpreter-candidate.md)

## Scope and result

This spike imports the audited, dependency-free `src/zmachine/` core, preserves
its license/notice, and proves a narrow TypeScript turn seam and Version 3
checkpoint slice against both the repository-owned fixture and the separately
approved Zork I Release 119 story.

The result supports evaluating Dork as the primary candidate. It does not accept
the interpreter: there is no real browser Worker/factory swap, production
`EnginePort` wiring, receipt journal/idempotency, cancellation/watchdog,
complete behavioral or conformance matrix, final bundle, or SBOM yet.

## Immutable inputs

| Input                    | Identity                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Dork repository          | commit `e5fce5ca678660611b5d2daa94bbffdb3a84e622`; tree `73de3daa6c28926b0d9d628f064f9c0ffe7f0ab0`                                |
| Dork codeload archive    | 154,389 bytes; SHA-256 `12a93295d6b16b88eeee999c78a96aee2cc0d68070f61ffff8215133163ba541`                                         |
| Imported Dork subset     | selected `src/zmachine/` files with upstream/local hashes in `spikes/dork-worker/source-lock.json`                                |
| Behavioral fork patch    | SHA-256 `a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`                                                        |
| Runtime compatibility ID | `dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`             |
| Schema-v2 wire golden    | SHA-256 `79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`                                                        |
| Minimal fixture          | SHA-256 `67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389`                                                        |
| Zork I                   | version 3, Release 119, serial `880429`, 86,838 bytes, SHA-256 `37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79` |

The Zork artifact is copied directly from `COMPILED/zork1.z3` at
`historicalsource/zork1` commit `97b7b3d68c075dd9af7da499c3e9690ada3471fd`. It
is byte-identical to Dork's misleadingly named `vendor/zork1/zork1.zip`, which
is raw Z-machine data rather than a ZIP archive.

## Fork and adaptation boundary

The imported core has two build-only TypeScript adaptations:

1. relative `.ts` import specifiers become `.js` for this repository's NodeNext
   declaration/JavaScript emit; and
2. the optional seed field is spelled `number | undefined` for
   `exactOptionalPropertyTypes` compatibility.

Those two changes do not affect runtime behavior. The fork also has intentional
behavior changes: it adds host-checkpoint state and continuation handling and
fixes a parse-buffer token-capacity bug and negative RANDOM predictable mode. It
also makes RANDOM 0 and RESTART use a checkpointable SplitMix32-style reseed
stream and gives positive RANDOM deterministic tail rejection for unbiased
non-divisor ranges. Upstream and local file hashes plus the combined behavioral
patch digest identify this modified, unendorsed candidate; it is not merely Dork
with build syntax changes.

## Turn and upstream verification

In a disposable checkout of the unmodified pinned upstream commit:

- `bun install --frozen-lockfile` completed;
- `bun test` reported 43 passed, 9 optional commercial-game tests skipped, and 0
  failed; and
- the audited source contains no `eval` or `new Function`.

The upstream successes include its CZECH v3/v4/v5/v8, Praxix, StrictZ, Unicode,
and crash tests. They are research evidence only. The exact behavioral fork has
not had the applicable conformance corpus rerun with complete fixture licenses,
hashes, print review, and the project browser/runtime matrix.

The repository integration suite proves:

- boot reaches one awaited `ZMachineIO.read()` boundary;
- each submitted canonical command returns only output since the preceding
  boundary;
- ordinary output, parser errors, and termination do not leak across turns;
- 50 alternating movement commands retain one complete boundary each;
- a rejected overlength input leaves the pending boundary usable;
- the project-owned story boots, accepts commands, and terminates; and
- Zork I boots, executes LOOK, prompts for quit confirmation, and terminates.

`pnpm dork:verify` independently authenticates the recorded core/notice inputs
plus the Zork story's digest, size, version, release, serial, declared length,
and header checksum without network access. It also requires the locked
schema-v2 wire golden declaration.

## Checkpoint implementation

Dork's upstream README says saves are Quetzal. At the pinned upstream commit,
`saves.ts` instead emits a private dynamic-memory/stack layout; it is not a
`FORM`/`IFZS` container, is available only when the story executes SAVE,
validates too little story identity, and omits interpreter PRNG state. That
story-driven encoding is not the project checkpoint.

The behavioral fork adds a separate host checkpoint at the post-decode
continuation of a Version 3 READ. It captures dynamic memory, data and call
stacks, program counter, RNG mode, gameplay RNG state, checkpointable
reseed-stream state, interpreter flags, stream 3 state, instruction/turn
counters, and pending READ metadata.

The strict big-endian envelope:

- uses machine-checkpoint and envelope schema version 2 plus adapter
  compatibility ID `zork-voice-dork-checkpoint-v2`;
- has its complete schema-v2 wire encoding locked by a unit regression to
  SHA-256 `79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`,
  with the same declaration pinned by `pnpm dork:verify`;
- rejects input over 1 MiB;
- performs a bounded structural pass before materializing arrays;
- binds the exact upstream-plus-fork runtime ID, adapter ID, story identity and
  SHA-256, revision, last output, and machine checkpoint; and
- caps retained output at 256 KiB.

Execution also has a finite per-turn instruction budget. Restore decodes and
validates a replacement Dork session, advances it silently to one declared input
boundary, and only then atomically swaps the in-process candidate state.

Repository tests cover minimal-story and Zork I cold-restore smokes, a restored
branch matching the uninterrupted minimal-story branch, corrupt/truncated and
oversized checkpoints, malformed machine state, runtime/adapter configuration
and story mismatch rejection with the active session preserved, repeat restore,
and detached snapshot bytes.

A separate project-owned Version 3 story is assembled directly in test memory
and does not add a checked-in story fixture artifact. It proves positive RANDOM,
RANDOM 0 reseeding, negative RANDOM predictable mode, and RESTART produce exact
RNG state and output across cold restore. Stable unit vectors also cover
reseed-stream advancement and deterministic rejection of incomplete uint32 tail
buckets for unbiased ranges that do not divide 2^32.

## Integrity and production boundary

The generic engine snapshot contract caps bytes at 4 MiB before copying or
hashing; the Dork envelope has the stricter 1 MiB cap. The standalone Dork spike
bytes receive strict structural validation, but the spike is not yet wired
through the outer `EngineSnapshot` SHA-256 check. An arbitrary bit change that
still forms a structurally valid Dork envelope therefore relies on the future
outer digest for detection. SHA-256 checks integrity, not authenticity.

The in-process replacement proves the failure-atomicity shape, not a real
replacement Worker or factory/active-lease swap. There is no persistent receipt
journal or idempotent retry path, cancellation/watchdog behavior, or quarantine
proof yet.

## Explicit limitations

The slice does not yet include:

- an operand-zero READ fixture;
- the complete status/style/general-restart/output-class matrix;
- a 50-turn cold-restore comparison;
- dedicated Chrome/Safari Worker and production-CSP runs;
- an applicable conformance rerun for the exact fork; or
- final bundle, patch-closure, notice-bundle, and generated-SBOM evidence.

## Gate disposition

- Dedicated worker: **not run**.
- Turn boundary: **running**; the 50-turn movement run lacks the required
  status/style/restart/output-class coverage.
- Opaque save bytes: **running**; bounded automatic snapshots, structural
  rejection, failure atomicity, repeat restore, and detached bytes are proven
  only in the standalone in-process spike, without outer snapshot-SHA wiring.
- Cold restart: **running**; minimal-story and bounded Zork replacement-session
  smokes plus the in-memory RNG/reseed/RESTART equivalence test exist, but no
  Worker restart or 50-turn comparison exists.
- Conformance: **running**; disposable upstream results are partial evidence and
  have not been rerun against the exact fork.
- SBOM/redistribution: **running**; source/story provenance is recorded, but the
  final patch/bundle closure and generated SBOM do not exist.

All six gates remain non-pass.
