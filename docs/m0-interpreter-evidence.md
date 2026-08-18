# M0 interpreter candidate evidence

Status: open; candidate not accepted  
Candidate: modified, unendorsed Dork fork at upstream commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622`, behavioral patch SHA-256
`a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`  
Decision: [ADR-0009](adr/0009-dork-typescript-interpreter-candidate.md)  
Last ledger update: 2026-08-18

The provenance-approved Dork core and Zork I Release 119 story are present for
the bounded candidate integration. Neither presence nor upstream test success
accepts Dork as the production interpreter. The project-owned minimal story
remains the mandatory base fixture, and all six gates apply to one exact Dork
source, patch, adapter, bundle, and story-fixture matrix.

The earlier Bocfel worker, persistence, conformance, and build evidence is
preserved in the [2026-08-17 Bocfel spike](m0-bocfel-spike-2026-08-17.md). It is
oracle/fallback evidence only and does not transfer to Dork.

## Status vocabulary

- `not run`: no reproducible candidate result is attached;
- `running`: bounded evidence work exists or is in progress, but the gate's
  complete criteria are not yet met;
- `pass`: the exact pinned source, patches, adapter, and bundle met the row's
  complete criteria and evidence is linked;
- `fail`: that exact candidate did not meet the criteria; and
- `invalidated`: a previously passing result no longer matches the candidate.

Only `pass` satisfies a gate. Static source inspection, an upstream README,
upstream tests, or a short smoke run is not a passing gate.

## Candidate identity

| Field              | Current candidate value                                                                                               | Acceptance requirement                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Interpreter source | Dork commit `e5fce5ca…`, tree `73de3daa…`; no release tag/package version                                             | Approved immutable source record and exact selected-file hashes                  |
| Candidate core     | Audited `src/zmachine/` subset plus behavioral patch SHA-256 `a0a31ec9…`; modified and unendorsed                     | Every local fork change identified and tested                                    |
| Compatibility ID   | `dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605` | Exact upstream and behavioral-fork identity bound into snapshots and runtime     |
| Wire encoding      | Schema-v2 golden SHA-256 `79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`                           | Full codec regression and verifier lock for the exact frozen encoding            |
| Runtime artifact   | Ignored TypeScript smoke modules; no production bundle yet                                                            | Hash and SBOM for every emitted release file                                     |
| Engine adapter     | Isolated Worker/factory bridge plus Dork schema v2 and Worker snapshot schema v1                                      | Complete browser matrix, watchdog, long-run, packaging, and acceptance evidence  |
| Base story         | Project-owned minimal fixture, SHA-256 `67d3a47a…`                                                                    | Reproducible artifact and verified fixture hash                                  |
| Zork I story       | Approved Release 119 / serial `880429`, SHA-256 `37084966…`                                                           | Separate story provenance, notice, compatibility tests, and trademark disclaimer |

The mutable upstream branch and unrelated npm package can never fill an identity
field.

## Checkpoint slice and remaining integration gap

Dork's upstream save callback is invoked only when the story executes SAVE. Its
serializer is a private dynamic-memory/stack encoding, not Quetzal, and omits
the PRNG state. Hidden command injection is not an acceptable workaround.

The behavioral fork now captures a separate Version 3 checkpoint at the
post-decode READ continuation. It includes dynamic memory, call/data stacks,
program counter, RNG mode, gameplay RNG state, checkpointable reseed-stream
state, flags, stream 3 state, counters, and pending READ metadata. The machine
checkpoint and envelope are schema version 2 and bind adapter compatibility ID
`zork-voice-dork-checkpoint-v2`. A strict 1 MiB big-endian envelope uses bounded
two-pass decode and binds runtime/adapter identity, story identity/hash,
revision, and last output. Restore stages a replacement in-process session to
one silent input boundary before an atomic swap. Per-turn execution has finite
instruction and 256 KiB output caps.

The complete schema-v2 wire encoding is locked by a unit regression to golden
SHA-256 `79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`; the
offline candidate verifier requires the same declaration.

A project-owned Version 3 story assembled directly in test memory proves
positive RANDOM, RANDOM 0, negative RANDOM predictable mode, and RESTART remain
exact across cold restore without introducing a fixture artifact. RANDOM 0 and
RESTART advance the persisted SplitMix32-style reseed stream; positive range
selection deterministically rejects incomplete uint32 tail buckets so
non-divisor ranges are unbiased and remain exact across restore.

The isolated Slice 1 bridge now copies and caps bytes before asynchronous work,
verifies the outer `EngineSnapshot` SHA-256, validates the inner Dork envelope,
and restores in a virgin Worker before swapping leases. Its outer Worker
snapshot schema preserves a bounded, insertion-ordered receipt journal and
requires an unbroken committed-revision history. Receipt capacity rejects before
mutation. A submitted response that is lost remains quarantined until the exact
request recovers its receipt; inspection alone cannot authorize new work.

SHA-256 supplies integrity checking, not authenticity. The generic contract
rejects snapshots over 4 MiB before copying or hashing; the Dork envelope
applies its stricter 1 MiB cap.

### 2026-08-18 browser smoke

One developer smoke ran the ignored TypeScript module graph in Chrome
`151.0.0.0` on macOS through two actual Dedicated Workers. The loopback server
sent this CSP:

```text
default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

The run authenticated the project story, booted at an input boundary, executed
exact LOOK/NORTH output, captured an outer snapshot, terminated and replaced the
active Worker, silently restored, replayed the pre-snapshot receipt, committed
the post-snapshot branch request once, rejected a corrupt restore, and then
advanced the preserved worker to revision 3. Worker evidence reported
`WorkerGlobalScope=true`, `document` absent, and `window` absent; the browser
log contained no warnings or errors. The per-run snapshot SHA-256 was
`3fdab402801392609597652e58a232f63120db71fa5a88f627e033f0a398c34b`; secure boot
entropy means that digest is evidence for this run, not a fixed golden. The
ignored emitted entry/runtime SHA-256 values were
`17f9621d277ef519910ed22b2573329e9b1b0881039209918e7651e97d69151b` and
`96e6c303c6c67b5b686eac3e37959ab698c4c18296e3197d7df7b941c730b630`; they
identify this smoke graph only and are not a release bundle. Toolchain: Node
`24.19.0`, pnpm `11.19.0`, TypeScript `6.0.3`.

This is bounded Chrome evidence only. Safari, the complete browser matrix,
watchdog termination, long cold-worker replays, and release bundle/SBOM closure
were not run.

## Gate ledger

| Gate                     | Status  | Evidence required                                                                                                                              | Current evidence                                                                                                                                                                                                                                |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated worker         | running | Pinned source and adapter in real Chrome/Safari dedicated workers; production CSP; boot, input, cancellation, termination, and isolation       | Chrome 151 restrictive-CSP smoke passed with two real Dedicated Workers, replacement lease swap, exact output, corrupt-restore preservation, and isolation flags; Safari, watchdog termination, and the complete matrix remain                  |
| Turn boundary            | running | Recorded boot and at least 50 turns covering normal, multiline, status, prompt, parser-error, restart, and termination output with no leakage  | Repository tests cover 50 alternating movement turns plus parser-error/termination, Zork I smokes, and an RNG-specific RESTART path; status, style, general restart, operand-zero READ, and the full output-class matrix remain                 |
| Opaque save bytes        | running | Automatic command-boundary snapshot with no visible SAVE; corrupt/mismatch rejection before mutation; same-session restore                     | Outer SHA plus strict inner validation, oversize-before-copy rejection, mismatch/corruption failure atomicity, detached bytes, repeat restore, and bounded receipt history are wired; hostile import depth and complete browser coverage remain |
| Cold-restart equivalence | running | Uninterrupted versus terminate/new-worker/restore paths with matching output, revisions, digests, and PRNG continuation over at least 50 turns | A real Chrome replacement Worker matched the next branch result and receipt replay; minimal/Zork and RNG cold smokes also pass, but the required 50-turn cold-worker comparison and Safari run remain                                           |
| Interpreter conformance  | running | Applicable standard-suite report plus repository fixture scenarios, exact hashes, and zero unexplained failures                                | Disposable unmodified upstream checkout ran 43 tests with 9 optional skips; the exact behavioral fork has not had the applicable suite rerun, and independent durable project evidence plus print review remain                                 |
| SBOM and redistribution  | running | Exact selected source/patch/bundle manifest, notices, dependency closure, and generated artifact SBOM                                          | Core/story provenance and notices plus the behavioral patch identity are recorded; no final worker bundle, complete patch closure, notice bundle, or generated SBOM exists                                                                      |

## Evidence package requirements

Each row that moves to `pass` must link or record:

- Dork commit/tree, selected upstream blobs, and clean-tree state;
- behavioral patch SHA-256
  `a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`, every
  constituent local change, its purpose, and upstream status;
- Node, TypeScript, bundler, browser, and package-manager versions;
- complete reproducible build and test commands;
- SHA-256 values for source inputs, stories, emitted bundles, snapshots, and
  material reports;
- exact browser/operating-system versions for browser evidence;
- structured test output and relevant raw logs;
- snapshot schema, story/runtime/adapter compatibility identity, corruption and
  failure-atomicity results;
- machine-checkpoint/envelope schema version 2 and adapter compatibility ID
  `zork-voice-dork-checkpoint-v2`;
- full schema-v2 wire golden SHA-256
  `79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba` plus its
  codec regression and verifier lock;
- artifact SBOM plus all third-party notices; and
- reviewer, date, limitations, and reevaluation trigger.

Do not import Dork's conformance stories, commercial-game corpus, or walkthrough
transcript merely because they exist in the upstream checkout. Each external
fixture requires separate provenance and redistribution approval.

## Decision rule

ADR-0009 remains proposed while any row is not `pass`. If all rows pass for the
same immutable source, patch set, adapter, bundle, and story matrix, maintainers
may accept ADR-0009 and declare the exact runtime identity.

If a row fails, preserve the result. Repair and rerun a bounded Dork fork, or
propose reinstating Bocfel behind the unchanged `EnginePort`. Do not reinterpret
normal in-game SAVE support, upstream conformance claims, or an MIT source
license as a substitute for a failed runtime gate.
