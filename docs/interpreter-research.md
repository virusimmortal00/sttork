# Browser Z-machine interpreter research

Status: informative M0 research; candidate source imported, no interpreter
accepted

Last verified: 2026-08-18

This document records the evidence behind the current interpreter candidate. It
is not provenance approval, a dependency declaration, or permission to
redistribute an interpreter or story artifact. The isolated Dork source and Zork
I story copies have separate provenance approval. Immutable revisions, artifact
hashes, complete notices, and generated-bundle license evidence remain required
before accepting a production interpreter or importing a different candidate
revision.

## Result

The leading candidate is a modified, unendorsed fork of the TypeScript
interpreter **Dork**, pinned to upstream commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622` and behavioral patch SHA-256
`a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`. It has a
small DOM-free core and a clean input/output seam, but it is a new, unversioned
project and is not yet an accepted production interpreter.

**Bocfel 2.5.1** is retained as the mature behavioral oracle and fallback. The
custom WebAssembly path proved technically viable, but its C++/Rust/Emscripten/
Glk build, bridge, persistence, and redistribution closure were disproportionate
for the first product slice. **ifvms/ZVM 1.1.6** remains research context rather
than the active fallback because its dynamic JIT requires `unsafe-eval`.

The proposed decision and reset gate ledger are in
[ADR-0009](adr/0009-dork-typescript-interpreter-candidate.md) and
[M0 interpreter evidence](m0-interpreter-evidence.md). ADR-0006 and the dated
Bocfel spike remain historical oracle evidence.

## Dork TypeScript candidate

### Exact source and packaging posture

- The candidate is commit
  [`e5fce5ca678660611b5d2daa94bbffdb3a84e622`](https://github.com/ntoskrnlexe/dork/commit/e5fce5ca678660611b5d2daa94bbffdb3a84e622),
  tree `73de3daa6c28926b0d9d628f064f9c0ffe7f0ab0`, committed 2026-08-18.
- It is MIT-licensed and attributes its interpreter ancestry to public-domain
  JSZM. The candidate core contains no `eval` or `new Function`.
- It has no tag, release, or package version. The npm name `dork` identifies
  unrelated software, so this project source-pins the audited commit rather than
  adding an npm dependency.
- The candidate fork's runtime compatibility ID binds the upstream commit and
  behavioral patch exactly:
  `dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`.
  The fork is modified project work, not an upstream-endorsed Dork release.
- Only `src/zmachine/` plus the upstream license/notice belongs in the candidate
  redistribution unit. Dork's Bun server, xterm UI, development dependencies,
  conformance binaries, and walkthrough transcript are not runtime inputs.

### Engine-port fit

Dork constructs `ZMachine(story, io, options)` and awaits `io.read()` whenever
the story reaches an input boundary. `io.print()` preserves interpreter output,
and resolution of `run()` identifies termination. This makes boot and
one-command turn handling substantially smaller than a Glk bridge.

The current implementation still lacks cancellation/watchdog behavior and a
browser-worker transport. The generic adapter is a single-transport scaffold;
the in-process Dork spike does not implement a real Worker factory or active
lease swap. Dedicated Chrome/Safari Worker execution under the production CSP,
complete turn-boundary classification, and failure/quarantine behavior remain
project tests rather than inferred capabilities.

### Checkpoint fork evidence and remaining gap

Dork upstream does not expose a programmatic host snapshot. Its save callback is
reached only when the story executes the SAVE opcode. Injecting or hiding a
visible SAVE command is forbidden by this project's engine contract.

Despite the README wording, the pinned `saves.ts` format is not a Quetzal
`FORM`/`IFZS` container. It serializes dynamic memory and a private stack
layout, checks only the story release bytes during restore, and omits the PRNG
state. No save or cold-restart gate is credited from that upstream
implementation.

The project fork now captures a separate Version 3 checkpoint at the post-decode
READ continuation. It includes dynamic memory, call/data stacks, program
counter, RNG mode, gameplay RNG state, checkpointable reseed-stream state,
flags, stream 3 state, instruction/turn counters, and pending READ metadata. The
machine checkpoint and envelope are schema version 2 with adapter compatibility
ID `zork-voice-dork-checkpoint-v2`. A strict 1 MiB big-endian envelope uses
bounded two-pass decode and binds the exact runtime/adapter ID, story identity
and SHA-256, revision, last output, and machine state. Each turn also has a
finite instruction limit and a 256 KiB output cap.

A unit regression locks the full schema-v2 wire encoding to golden SHA-256
`79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`, and the
offline candidate verifier requires that declaration.

Restore validates and advances a replacement in-process Dork session silently to
one input boundary before atomically swapping the candidate state. Minimal and
Zork I cold-restore smokes cover corrupt/truncated/oversized data, configuration
and story mismatch failure atomicity, repeat restore, detached bytes, and one
restored minimal branch matching uninterrupted play. The same fork fixes a
parse-buffer token-capacity defect found by the fixture.

The fork now persists RNG mode, gameplay state, and a separate reseed stream.
RANDOM 0 and RESTART advance that checkpointable SplitMix32-style stream;
negative RANDOM enters predictable mode; and positive RANDOM uses deterministic
tail rejection so incomplete uint32 buckets cannot bias ranges that do not
divide 2^32. A project-owned Version 3 story built only in test memory proves
positive RANDOM, RANDOM 0, negative RANDOM, and RESTART output/state equivalence
across cold restore without adding a fixture artifact.

This is bounded evidence. The Dork spike is not connected to a replacement
Worker/factory or the outer `EngineSnapshot` SHA-256 verifier. Its standalone
bytes receive structural validation, but an arbitrary bit change that remains
structurally valid relies on the future outer digest for detection. The generic
contract's 4 MiB before-copy cap and outer digest complement the Dork envelope's
stricter 1 MiB cap; SHA-256 supplies integrity, not authenticity.

Still missing are receipt journaling/idempotency, cancellation/watchdog, an
operand-zero READ fixture, the complete status/style/general-restart/output
matrix, a 50-turn cold restore, Chrome/Safari and CSP evidence, conformance
rerun for the exact fork, and final bundle/SBOM closure. The opaque-save and
cold-restart gates are therefore only `running`; all six M0 gates remain
non-pass.

### Upstream test evidence

A disposable checkout of the unmodified pinned upstream commit completed 43
tests with nine optional proprietary-game corpus tests skipped. Its CZECH
v3/v4/v5/v8, Praxix, StrictZ, Unicode, and crash tests passed. The Zork I script
also ran, but its comparison assertion normalizes output and requires only the
first 250 words to match before expected RNG divergence; it is not a 365-command
byte-exact proof. The applicable conformance set has not been rerun against the
exact behavioral fork.

These results justify the candidate. They do not replace this project's
independent worker, fixture, save, cold-restart, conformance, and bundle gates.

### Bundled Zork I

Dork's `vendor/zork1/zork1.zip` is not a ZIP archive. It is the raw version 3
Release 119 / serial `880429` story, 86,838 bytes, SHA-256
`37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79`. It is
byte-identical to `COMPILED/zork1.z3` in
[`historicalsource/zork1`](https://github.com/historicalsource/zork1/tree/97b7b3d68c075dd9af7da499c3e9690ada3471fd)
and is covered by that repository's Microsoft MIT license. The local artifact
uses a `.z3` name and its own provenance record. The license grants no
trademark, logo, packaging, or endorsement rights, and Dork bundles only Zork I.

### 2026-08-17 spike update

A disposable build subsequently proved that an experiment-only Bocfel/RemGlk
artifact can run the repository-owned V3 fixture in real dedicated workers in
Chrome and Safari and can round-trip BFZS autosave bytes across a 60-turn cold
restart. A CZECH 0.8 V3 run reported 349 machine-checked passes, zero failures,
and 19 print-only checks. Exact source identities, artifact/save hashes,
toolchain observations, browser results, and limitations are preserved in the
[dated spike record](m0-bocfel-spike-2026-08-17.md).

These are partial results, not accepted gates. The disposable runtime/browser
harness and generated artifact are not in the repository; the build still
included an ambiguously licensed Garglk static-patch file; RemGlk linked
`pb-imgsize`, whose published crate lacks a complete license notice; restore
rejection and failure atomicity were not tested; conformance coverage is
incomplete; and no generated SBOM or notice bundle exists.

## Bocfel through an Emglken-style build

### Compatibility and maintenance

- Emglken
  [version 0.7.2](https://github.com/curiousdannii/emglken/releases/tag/v0.7.2),
  published 2026-05-24, pins
  [Bocfel 2.5.1](https://github.com/curiousdannii/emglken/blob/v0.7.2/versions.json).
- Current Bocfel source accepts Z-code versions 1 through 8, maps versions 7 and
  8 onto its version 5 execution path where appropriate, and can be compiled
  without version 6. See
  [`zterp.cpp`](https://github.com/garglk/garglk/blob/master/terps/bocfel/zterp.cpp)
  and Emglken's
  [Bocfel targets](https://github.com/curiousdannii/emglken/blob/v0.7.2/CMakeLists.txt).
- The Bocfel manual describes full support for versions 1 through 5, 7, and 8,
  with limited version 6 support. Version 6 is outside the initial Zork I-III
  scope. See the official [Bocfel manual](https://bocfel.org/bocfel.html).
- The upstream Gargoyle repository containing Bocfel was active on
  [2026-08-14](https://github.com/garglk/garglk/commit/0ffc874a508b946c88990045467615f8fb0f8cc0).
  Parchment published its current
  [2026.8.1 release](https://github.com/curiousdannii/parchment/releases/tag/2026.8.1)
  on 2026-08-01 with updated Bocfel integration.

This is strong evidence of a maintained interpreter and browser integration
path. It is not evidence that the stock artifact satisfies this project's worker
and persistence contracts.

### Browser API and worker gap

Emglken compiles Glk interpreters to JavaScript and WebAssembly and exports
`Bocfel` and `BocfelNoZ6` ES modules. Its public startup function expects an
asynchronous `Dialog`, `GlkOte`, and command-line-style `arguments`; the story
is loaded through Dialog. See
[`src/index.js`](https://github.com/curiousdannii/emglken/blob/v0.7.2/src/index.js)
and
[`src/preamble.js`](https://github.com/curiousdannii/emglken/blob/v0.7.2/src/preamble.js).

That is a browser UI protocol, not a typed `execute(command) -> complete output`
engine API. The stock Emscripten settings declare `ENVIRONMENT=node,web`, not
`worker`, in
[`src/common.cmake`](https://github.com/curiousdannii/emglken/blob/v0.7.2/src/common.cmake).
The custom build must therefore prove worker execution and add a narrow bridge
for story bytes, line input, output events, file operations, and lifecycle
control. No application or guide code may depend directly on Glk objects.

### Save and restore gap

Bocfel's current save implementation writes normal Quetzal `IFZS` files with the
expected memory and stack chunks. It also has interpreter-specific save and
autosave machinery. See
[`stack.cpp`](https://github.com/garglk/garglk/blob/master/terps/bocfel/stack.cpp).

Those capabilities are not a public JavaScript `snapshot()` API. Bocfel's Glk
library-state autosave is conditional in
[`glkautosave.cpp`](https://github.com/garglk/garglk/blob/master/terps/bocfel/glkautosave.cpp),
and Parchment's 2025 Emglken migration explicitly documented that
[autosaving was not then available](https://github.com/curiousdannii/parchment/releases/tag/2025.1.14).
The latest release notes do not establish the opaque, programmatic save-byte
contract required here. A small audited export or a fully mediated in-memory
Dialog file bridge may be needed; the M0 spike must determine which, without
injecting a visible `SAVE` command into the game.

### License and redistribution boundary

Bocfel's current license is
[MIT](https://github.com/garglk/garglk/blob/master/terps/bocfel/LICENSE).
Emglken's component table identifies Emglken, RemGlk-rs, AsyncGlk, and Bocfel as
MIT-licensed, while Scare and TADS are GPL-2.0. See the
[Emglken component matrix](https://github.com/curiousdannii/emglken/blob/v0.7.2/README.md#included-projects).

The aggregate npm package is a different redistribution unit. Its exact
[`license` field is `GPL-2.0`](https://github.com/curiousdannii/emglken/blob/v0.7.2/package.json),
and its published file list includes builds for the GPL interpreters. The
project must not install, copy, or redistribute that package while describing
the result as MIT-only.

The candidate build must contain only the components actually required for
Bocfel, with every linked and generated component audited. Passing the gate
requires an SBOM, immutable source revisions and hashes, preserved notices, and
evidence that GPL Scare/TADS code and artifacts are absent. The Emscripten
runtime, Rust/C/C++ libraries, JavaScript bridge, and build-time inputs remain
part of that audit even when their expected licenses are permissive.

The source-closure audit recommends using the Bocfel author's 2.5.1 archive
rather than Garglk's larger tree. Garglk adds `static-patches.h`, which is
absent from the author archive and has unclear license provenance. It is
irrelevant to the initial stories and must be omitted. The same audit found that
`pb-imgsize` 0.2.5 is linked through RemGlk but ships without the complete
notice needed to exercise its declared MIT grant. A production candidate must
obtain an authoritative notice or remove that dependency from the no-graphics
build.

## Fallback: ifvms/ZVM 1.1.6

ifvms is a pure JavaScript Z-machine previously used by Parchment and Lectrote.
The exact v1.1.6 package and repository license is
[MIT](https://github.com/curiousdannii/ifvms.js/blob/v1.1.6/LICENSE), and its
[package metadata](https://github.com/curiousdannii/ifvms.js/blob/v1.1.6/package.json)
publishes a CommonJS entry point.

Its public ZVM API takes story bytes plus a Glk object, then runs through
`prepare`, `start`/`init`, and `resume`. The same source explicitly supports
versions 3, 4, 5, and 8 and records known output and save-table limitations. See
[`src/zvm.js`](https://github.com/curiousdannii/ifvms.js/blob/v1.1.6/src/zvm.js).
It implements Quetzal save/restore and Dialog-backed autosave in
[`runtime.js`](https://github.com/curiousdannii/ifvms.js/blob/v1.1.6/src/zvm/runtime.js)
and
[`file.js`](https://github.com/curiousdannii/ifvms.js/blob/v1.1.6/src/common/file.js).

The latest release,
[v1.1.6](https://github.com/curiousdannii/ifvms.js/releases/tag/v1.1.6), was
published 2021-02-11. The default branch received a narrow correctness fix on
[2025-07-12](https://github.com/curiousdannii/ifvms.js/commit/6ac63e6b61144d4353a168df16c4ad5c22526f88),
but Parchment replaced ZVM with Bocfel in its 2025 migration. The package is
untyped, uses an older CommonJS/Browserify integration style, and compiles JIT
routines with `new Function`. The latter requires an `unsafe-eval` CSP posture
and is a material security disadvantage for a microphone-enabled application.

The fallback is therefore credible for version 3 compatibility, not preferred.
It receives no grandfathered exception from worker isolation, restart,
conformance, save-byte, or license gates.

## Other browser-oriented implementations reviewed

- [`zmachine@0.3.0`](https://www.npmjs.com/package/zmachine) offers an appealing
  TypeScript `IOAdapter` and MIT license, but it was first published on
  2026-01-26 and has no GitHub releases or tags. Its published ESM package has a
  still-open
  [module-resolution defect](https://github.com/daniellockard/zmachine/issues/4),
  and its advertised save exports do not match the current
  [root source exports](https://github.com/daniellockard/zmachine/blob/main/src/index.ts).
  It is suitable only for a future experimental comparison, not the M0 fallback.
- [Encrusted](https://github.com/DeMille/encrusted) is an MIT Rust/WebAssembly
  version 3 interpreter with Quetzal saves, but it has no releases, marks its
  npm package private, depends on an old nightly Rust/Webpack stack, and its
  default branch's latest commit is from
  [2019-02-25](https://github.com/DeMille/encrusted/commit/6fbe4f93fb3e75bac4614bfd489db12d5e250c4b).

Parchment remains the reference browser integration and a useful behavioral
oracle, not the engine library dependency. Its full application distribution
contains interpreters under different licenses and should not be copied as the
project's engine artifact.

## Revalidation rule

Before accepting Dork, reinstating Bocfel, or importing a different candidate
revision, re-open every linked upstream release, license, package manifest, and
build file; replace mutable branch links with immutable commit IDs in
provenance; run every gate in
[the M0 evidence ledger](m0-interpreter-evidence.md); and record the generated
artifact hashes and notices. A later upstream release does not silently replace
the reviewed version.
