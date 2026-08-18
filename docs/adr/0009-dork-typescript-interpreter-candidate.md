# ADR-0009: Evaluate pinned Dork TypeScript as the primary Z-machine candidate

- Status: proposed
- Date: 2026-08-18
- Owners: maintainers
- Supersedes: ADR-0006

## Context

The Bocfel experiment reduced Z-machine compatibility risk, but it also exposed
disproportionate production complexity across C++, Rust, Emscripten, RemGlk, Glk
adaptation, generated WebAssembly, and a custom build supply chain. That work
remains useful as independent reference evidence, but it is not the simplest
path to the voice product.

[Dork](https://github.com/ntoskrnlexe/dork) is a small TypeScript Z-machine. Its
core has no DOM dependency, uses a library-facing `ZMachineIO` interface, does
not use dynamic evaluation, and has a natural awaited `read()` boundary for
mapping one command to one turn. Its upstream tests exercise CZECH, Praxix,
StrictZ, Unicode, crash handling, and Zork I. The pinned repository also carries
the exact MIT-licensed Zork I Release 119 story used by its compatibility test.

Dork is nevertheless new. It has no release tag or package version, and the npm
name `dork` belongs to an unrelated package. Its README describes Quetzal saves,
but the pinned upstream implementation emits a private memory/stack encoding,
omits interpreter PRNG state, and exposes save bytes only when the story itself
executes SAVE. The project has therefore built a bounded behavioral fork to
evaluate programmatic checkpoints; upstream has not endorsed that fork.

## Decision

Treat Dork commit `e5fce5ca678660611b5d2daa94bbffdb3a84e622`, tree
`73de3daa6c28926b0d9d628f064f9c0ffe7f0ab0`, plus behavioral patch SHA-256
`a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`, as the
primary M0 interpreter candidate. Never resolve the candidate from a mutable
branch or the unrelated npm package. Its runtime compatibility ID binds the
upstream and fork identities exactly:

```text
dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605
```

The candidate redistribution unit is limited to the audited TypeScript
interpreter core, Dork's MIT license and ancestry notice, and the
repository-owned `EnginePort` adapter. It excludes Dork's Bun server, xterm UI,
development dependencies, complete test corpus, and reference walkthrough
transcript. A provenance-approved copy of the core may live under `vendor/` for
the isolated candidate integration, but it is not a production interpreter
selection or release artifact merely because it is committed.

The project owns a modified, unendorsed fork. Its current bounded Version 3
checkpoint slice:

- captures the post-decode READ continuation only at an input boundary;
- preserves dynamic memory, call/data stacks, program counter, RNG mode,
  gameplay RNG state, checkpointable reseed-stream state, interpreter flags,
  stream 3 state, counters, and pending READ metadata;
- uses machine-checkpoint and envelope schema version 2 with adapter
  compatibility ID `zork-voice-dork-checkpoint-v2`;
- locks the complete schema-v2 wire encoding to golden SHA-256
  `79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba` through a
  codec regression and the candidate verifier;
- uses a strict 1 MiB big-endian envelope with bounded two-pass decoding and
  binds runtime/adapter identity, story identity/hash, revision, and last
  output;
- applies finite per-turn instruction and 256 KiB output limits; and
- stages a replacement session through one silent input boundary before an
  atomic in-process swap.

The fork also makes Z-machine RNG semantics checkpointable and deterministic:
RANDOM 0 and RESTART advance a persisted SplitMix32-style reseed stream,
negative RANDOM enters predictable mode, and positive RANDOM deterministically
rejects incomplete tail buckets for unbiased ranges that do not divide 2^32. A
project-owned, in-memory Version 3 test covers those paths across cold restore
without adding a story artifact.

This is evidence, not production selection. The isolated Slice 1 spike now runs
through real disposable browser Worker leases, outer `EngineSnapshot` SHA-256
verification, a bounded receipt journal, exact-retry quarantine, and
replacement-worker restore. One Chrome 151 restrictive-CSP developer smoke is
recorded. It still lacks Safari and full browser-matrix evidence, watchdog
termination, the complete behavioral matrix, conformance rerun, and final
bundle/SBOM closure. The generic 4 MiB snapshot cap applies before copying or
hashing, while the Dork envelope applies its stricter 1 MiB limit. SHA-256 is an
integrity check, not authentication.

All six M0 gates restart for the exact Dork commit plus exact project patch and
adapter set:

1. dedicated Chrome and Safari worker execution under the production CSP;
2. complete, non-leaking turn-boundary classification;
3. opaque programmatic snapshot bytes with pre-mutation mismatch/corruption
   rejection;
4. deterministic cold-worker restart, including PRNG continuation;
5. applicable Z-machine conformance plus repository-owned fixture scenarios;
6. complete source, patch, bundle, license, notice, and SBOM evidence.

Candidate selection and the bounded checkpoint slice do not mark any gate
passed. Upstream tests and README claims are research inputs, not project
acceptance evidence.

The bundled Zork I file remains a separately licensed and separately tracked
story artifact. It may be bundled only under its own immutable provenance,
artifact hash, Microsoft MIT notice, and trademark exclusion. Interpreter
selection does not admit logos, packaging, marketing assets, or trademark use.
Release 119 is admitted as the exact upstream historical compiled artifact; the
project does not currently possess or reproduce the exact historical Infocom
toolchain, so this admission proves immutable acquisition rather than a modern
source rebuild. A future ZILF reconstruction is a distinct artifact and may not
silently replace it.

Retain Bocfel 2.5.1 as an independent behavioral oracle and fallback. If Dork
fails a substantive gate or requires disproportionate private maintenance,
propose returning to Bocfel behind the unchanged `EnginePort`; do not weaken the
port or its save semantics.

## Consequences

The primary path becomes ordinary TypeScript that is easier to inspect, patch,
run in a worker, and integrate with the existing monorepo. It removes the
C++/Rust/Emscripten/Glk toolchain from the candidate production path.

The project accepts higher interpreter-maturity risk and owns bounded fork
changes for host checkpoints, transactional restore, PRNG persistence, parser
correctness, cancellation, and worker lifecycle. Dork's upstream save encoding
is not treated as Quetzal compatibility. Standard Quetzal import/export can be
considered separately from the authoritative project checkpoint after
deterministic restore is proven.

## Alternatives considered

- **Bocfel/Emglken-style WebAssembly.** Retained as the mature oracle and
  fallback, but no longer primary because the bridge, build, snapshot, and
  redistribution closure are disproportionately large for the initial product.
- **A direct Zork-to-TypeScript rewrite.** Rejected because it would make the
  project responsible for reimplementing the parser, object model, timers, RNG,
  saves, and three games instead of preserving the original Z-machine stories.
- **ifvms/ZVM.** Not selected because its legacy JIT uses `new Function`, which
  would require an `unsafe-eval` CSP exception.
- **An ordinary `dork` package dependency.** Rejected because no matching
  versioned package exists and the npm name refers to unrelated software.

## Validation

The normative record is
[`docs/m0-interpreter-evidence.md`](../m0-interpreter-evidence.md). All six
gates remain non-pass. Every gate must pass for the same pinned Dork source,
patch set, adapter, story fixture, browser baseline, and emitted bundle.
Revalidate on every Dork commit, local patch, adapter, bundler, TypeScript, or
story-artifact change.
