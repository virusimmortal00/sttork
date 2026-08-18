# Bocfel worker and persistence spike — 2026-08-17

> Historical note (2026-08-18): ADR-0009 superseded Bocfel as the primary
> candidate with a pinned Dork TypeScript evaluation. This record remains the
> Bocfel oracle/fallback evidence; none of its results transfers to Dork.

Status: exploratory evidence; no ADR-0006 gate passed  
Scope: disposable, non-release Bocfel 2.5.1 WebAssembly build  
Host: macOS 26.6.1 (25G76), Apple Silicon  
Review date: 2026-08-17

This record preserves useful results from a bounded M0 experiment without
turning the experiment into a dependency or release artifact. The build trees,
generated JavaScript/WebAssembly, conformance stories, save bytes, and browser
harness remained outside the repository under disposable `/private/tmp`
directories. No Zork source or story binary was used.

The experiment established that a small project-owned bridge can run this
candidate in real dedicated browser workers and can move Bocfel autosave bytes
through an in-memory `Dialog`. It did **not** establish the complete production
worker protocol, safe restore rejection, conformance, or redistribution closure.
At the time of this spike ADR-0006 was proposed. ADR-0009 has since superseded
it and retains this work only as oracle/fallback evidence.

Research-only provenance records identify the
[Bocfel archive](../provenance/records/bocfel-interpreter-v2-5-1.json) and
[CZECH package](../provenance/records/czech-conformance-v0-8.json). Both have
empty `localPaths`; neither record authorizes an import or release.

## Immutable source identities

The experiment started from these exact upstream objects:

| Input                  | Identity                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Emglken                | commit `36ba70f5f0f7f7b1f9daa0c1e45fde0cdc196ec3`; tree `3fe8fac4a820b7b1615ba8a437e689934d827096` |
| Garglk checkout        | commit `cca807be21d78588cf483317a0eda2769c5ee811`; tree `9128780eb144f996bce02b5b31fcc60d238b72a2` |
| Bocfel subtree         | tree `2bb11913801618efe0e1c7153626137293b1d2c1`; version 2.5.1                                     |
| RemGlk-rs              | commit `34e0ed91c1d6949862409c19d1b11816debb9ade`; tree `3e495e0895e1b1bc18f58f0cd0d42bb5ffe5708b` |
| `remglk` subtree       | tree `d6277a5636fdf02767aa740514409f74e4bec7db`                                                    |
| `remglk_capi` subtree  | tree `320f29df0163dfe7de9c953004c7872f8e57739f`                                                    |
| Cargo lockfile         | SHA-256 `a3d0fecac711b66f7d5ad6d800de60572b53a3cc3b7ab0996623bd45741c4a51`                         |
| Project-owned V3 story | 2,166 bytes; SHA-256 `67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389`            |

For a production candidate, prefer the Bocfel author's immutable
[`bocfel-2.5.1.tar.gz`](https://cspiegel.github.io/bocfel/downloads/bocfel-2.5.1.tar.gz),
SHA-256 `33c26329d8341a772a488a062ce9941a9e847fb56cd96cf2ee4537c14c023942`, over
the larger Garglk checkout. Files common to that archive and the pinned Garglk
Bocfel subtree were byte-identical in the source-closure audit.

License-file hashes observed during the experiment were:

- selected Emglken MIT license:
  `7f832914e3a094960455f9a5ef730c7d6141222f1da8649511839bb3e0efd38c`;
- Bocfel MIT license:
  `f8a7cb5097ca3cf3149c40d256eb1244ee787bda4cd6f6dff42a59a2e802aee9`; and
- RemGlk MIT license:
  `98b2179558b1ea72993f2b6bcbebd954be85de7f550965edcfd0969efdc76152`.

These hashes identify reviewed texts. They are not a generated-bundle license
approval.

## Experimental build

The build targeted only `bocfel-noz6`. It used the 23 Bocfel translation units
identified in the source-closure audit, `libremglk_capi.a`, the selected Emglken
preamble, and the Emglken JavaScript library bridge. The link trace did not
select Scare, TADS, Hugo, Glulxe, or Git interpreter objects. The aggregate
`emglken@0.7.2` npm package was not installed or redistributed.

The disposable patch set:

1. removed unrelated interpreter targets from the experimental CMake graph;
2. added `worker` to Emscripten's `ENVIRONMENT=node,web` allow-list;
3. enabled Bocfel autosave behind an experiment-only compile definition; and
4. returned the deterministic in-memory path `/zork-voice-autosave.bfzs` from
   the autosave-name hook.

The build still defined `ZTERP_STATIC_PATCH_FILE` and therefore included
Garglk's extra `static-patches.h`. That file is absent from the official Bocfel
release and has ambiguous license provenance. The production spike must omit the
definition and file, then repeat every behavioral and reproducibility test.

The effective build sequence inside the Linux/arm64 builder was:

```sh
RUSTFLAGS=-Csymbol-mangling-version=v0 \
  cargo build --release --locked --package remglk_capi \
  --target=wasm32-unknown-emscripten
emcmake cmake -DCMAKE_BUILD_TYPE=Release -S . -B build
cmake --build build --target bocfel-noz6 --parallel 1
```

The experiment used Emscripten SDK image tag 5.0.5. The observed multi-platform
index was
`sha256:cc4dcb4ca57cb35858b7fbb606c0ee857051d9f76b452f7fcfc3d8159dae670c`; the
audited Linux/arm64 platform digest was
`sha256:fdeb6390adf809104c13bd1696eed36d1ab832a0d6f421ec4ff97cbd87a00dba`. The
locally extended image ID was
`sha256:4a20e69e6a940f27738693b67d0aa83cec65ee74230229c1d9fc91d9a8dcd6f6`. It
contained Emscripten 5.0.5, Rust 1.94.0, CMake 3.28.3, Node 22.16.0, and Python
3.12.3.

The upstream Dockerfile fetched `rustup` through a mutable shell installer, so
the local image ID is evidence about this run, not an acceptable release
toolchain pin. A release build must pin the platform image, installer bytes,
Rust distribution manifest, Cargo inputs, and network-off source cache.

Two clean checkouts at different temporary paths, built with equivalent patches
and the same `/src` container mount, emitted byte-identical files:

| File               |     Bytes | SHA-256                                                            |
| ------------------ | --------: | ------------------------------------------------------------------ |
| `bocfel-noz6.js`   |    62,133 | `f0211c9b437ee34a24a995b6d74bc892423a53ccb2b7ab20b7b5557c1b59e7a5` |
| `bocfel-noz6.wasm` | 1,242,762 | `27dbb56a04b0543938e58cd06ee769cad8c5478e9b155ce4fc5511ee9e829c7d` |

These are experiment hashes, not approved release hashes.

## Dedicated-worker smoke result

A project-owned JavaScript harness loaded the repository-owned minimal story and
experimental WebAssembly module in an actual dedicated module worker. The worker
reported:

- `typeof document === "undefined"`;
- `typeof window === "undefined"`; and
- `self instanceof WorkerGlobalScope === true`.

It accepted six newline-free commands—`look`, `take token`, `inventory`,
`north`, `south`, and `score`—and produced seven Glk updates: one boot update
and one completed input boundary per command. Expected fixture fragments were
present without a browser warning or console error.

The same harness passed in:

- Google Chrome 151.0.7922.138; and
- Safari 26.6 on macOS 26.6.1.

The server applied this CSP:

```text
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

This proves a bounded browser-worker path, not the dedicated-worker gate. The
experiment did not use the repository's typed adapter, did not decode raw worker
messages through a production validator, and did not cover cancellation,
duplicate delivery, terminal state, malformed messages, or every required output
class.

## Opaque save and cold-restart result

The bridge copied Bocfel's `BFZS` autosave bytes from the in-memory `Dialog`
without issuing a visible `SAVE` command or opening a file prompt. The
checkpoint was 10,932 bytes with SHA-256
`28692eb2755e1b71503f78c0af7db4cbec4482012c9f2008298919e48ddbaf5b`.

The cold-restart scenario executed 30 prefix commands, captured the checkpoint,
terminated the worker, booted a new worker from the bytes, and executed 30
continuation commands. A separate control worker executed all 60 commands
without restart. After removing only Glk transport generation/window-layout
fields and sorting window updates by ID:

- all 30 continuation updates matched the control;
- no mismatch index was reported;
- the uninterrupted and restored final snapshots both hashed to
  `238c50d5c19c5bfdce6546ade9c89bee47ca0dfce96a1a83adc4cbf1cc72a576`;
- no `enter filename` or `save game` prompt appeared; and
- restored boot emitted Bocfel's separate
  `Continuing last session from autosave` notice.

That notice is restore lifecycle output, not story narration, and a production
bridge must classify it separately.

This result does not pass the save or restart gates. It did not test corrupt,
truncated, story-mismatched, interpreter-mismatched, or interrupted snapshots;
it did not prove pre-mutation rejection; and the harness had no authoritative
logical revision or independent state-digest comparison. It also did not prove
that the complete Glk library state required by more complex stories survives.

## Conformance result

The current IFTF Z-machine Standard Appendix C at commit
[`d46676270e0562c246b143870693f806d090a4bd`](https://github.com/iftechfoundation/Z-Machine-Standard/blob/d46676270e0562c246b143870693f806d090a4bd/appc.html)
lists complementary test stories rather than one modern all-inclusive suite.
CZECH 0.8 is the core story in that set that explicitly supports a V3 build;
Praxix, TerpEtude, Unicode, and Strict Z cover additional behavior.

The separate CZECH 0.8 version 3 run used the official IF Archive package:

| Input                               | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `czech_0_8.zip`                     | `d0795723e98563050575c4d3c08fdd29ade2543e132d8190255763e3bf6fef6a` |
| `czech.inf`                         | `783ca6ed532b985b62b8c28ffed5de5634b5e7c18698f671b0b09083c4de9d4b` |
| expected V3 transcript `czech.out3` | `4a2c1880e5ac8fa264c6362d2fdea4b9edece35b956a758ae3e319ed6ca96c61` |
| archive `README.txt`                | `01219007c87a3f9bb8790a31049b258b206e74743fc31891f4fdd352e4439b6d` |

CZECH uses a custom permissive license, copyright 2003 Amir Karger, that
requires preservation of its copyright and license text. It needs a reviewed
`LicenseRef` and verbatim notice before any source or binary may enter the
repository.

Inform 6.44 from commit `973a81bebcbd613578b1cc6a1b23a009fe06abd8` compiled the
source twice with `LC_ALL=C`, `TZ=UTC`, and `-v3`. The temporary compiler
executable hashed to
`1215dc8a90d3d1991b4344b9895ec8ea891d76d603204d7e34e85e0886f10a3c`. Both
10,752-byte results were identical, with SHA-256
`3a8b98e7aece7fafaed73ae044e926a4267f8b33dee93a6dab865e46f0290b4c`. The
generated serial was `260818`, derived from the build date, so the binary is not
a durable reproducible fixture until the serial is fixed or the exact generated
bytes are intentionally pinned.

The run produced 368 total checks: 349 machine-checked passes, zero
machine-checked failures, and 19 print-only checks requiring human comparison.

After excluding the four interpreter/header lines that CZECH documents as
variable, the normalized output matched the supplied V3 transcript exactly. The
same story reached this summary through a dedicated Chrome module worker under
the spike CSP, with worker isolation assertions passing and no recorded browser
warning or error.

CZECH explicitly omits ordinary I/O, read/tokenization, table operations,
save/restart, and other areas covered by complementary Z-machine test stories.
The 19 print checks were not accepted by a recorded review, Safari did not run
this conformance story, and the repository-owned fixture scenarios are not yet a
real interpreter suite. This result therefore does not pass the conformance
gate.

## Redistribution review

The actual Rust target compiled permissively declared crates, but two material
issues prevent approval:

1. `pb-imgsize` 0.2.5 declares MIT in package metadata but its published crate
   and tagged source do not contain the license text or a complete copyright
   notice. It is linked through RemGlk image-dimension parsing. Obtain an
   authoritative notice, or remove/feature-gate the dependency for the no-Z6
   build.
2. The experimental Garglk build includes `static-patches.h`, whose license is
   ambiguous. Use the official Bocfel archive and omit this nonessential file.

The experiment produced no SPDX/CycloneDX artifact SBOM, builder SBOM, complete
notice bundle, or automated artifact-level GPL exclusion report. A linker trace
showing no known GPL interpreter object is valuable input but is not a
substitute for those deliverables.

## Historical gate assessment and proposed next experiment

No result in this document was a `pass`. At the time, the smallest
acceptance-oriented next experiment was to:

1. build from the official Bocfel 2.5.1 archive, pinned RemGlk, and selected MIT
   Emglken glue using a dedicated project-owned CMake manifest;
2. remove `static-patches.h` and resolve or remove `pb-imgsize`;
3. pin the complete Linux builder and generate artifact and builder SBOMs;
4. connect the candidate to the repository's typed adapter through an
   unknown-to-domain worker codec;
5. make snapshot restore transactional and test corrupt, mismatched, lost-reply,
   termination, idempotent retry, and branch/receipt behavior;
6. run the complete fixture turn/output matrix and cold-restart comparison with
   revisions and independent state digests; and
7. complete the applicable Z-machine conformance matrix and review all
   print-only checks.

Only evidence emitted by that reproducible, pinned candidate could have moved an
ADR-0006 gate to `pass`. ADR-0009 now makes Dork the active candidate.
