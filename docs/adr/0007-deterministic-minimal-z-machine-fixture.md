# ADR-0007: Deterministic minimal Z-machine fixture

- Status: accepted
- Date: 2026-08-17
- Owners: maintainers

## Context

M0 needs a legal, hermetic story artifact before any Zork content or production
interpreter is admitted. The artifact must be small enough to audit, useful for
the first engine-boundary tests, and reproducible without importing a parser
library or third-party story content.

The compiler is itself a provenance-sensitive build input. An unpinned package,
mutable release URL, timestamp-derived serial, or compiler-added end padding
would make the checked-in hash an unreliable baseline.

## Decision

Maintain an original, repository-owned, MIT-licensed Inform 6 program at
`fixtures/stories/minimal/source/minimal.inf`. It contains a small library-free
command loop and no Zork source, story data, prose, map, objects, or solution
material. Compile it as Z-machine version 3 with:

- Inform 6.44, tag `v6.44`, source commit
  `973a81bebcbd613578b1cc6a1b23a009fe06abd8`;
- the upstream Artistic License 2.0 licensing option;
- fixed `Release 1` and serial `260817` source directives;
- compiler arguments `-v3`, `-Cu`, and `$ZCODE_FILE_END_PADDING=0`; and
- `LC_ALL=C` and `TZ=UTC` in the compiler environment.

The padding setting is an explicit process argument, not an in-source `!%`
directive, so its application does not depend on directive placement. The
checked-in artifact must have actual byte length equal to its version 3 header's
declared length.

`pnpm story:build` copies the source into two independent temporary directories,
compiles both copies, rejects compiler warnings or an unexpected release banner,
and writes the artifact and deterministic manifest only when both outputs are
byte-identical. `pnpm story:build:check` performs the same rebuild but compares
against the checked-in files without rewriting them; this is the safe mode for
reproducibility CI. `pnpm story:verify` requires no compiler or network and
validates the source and artifact hashes, header version, release, serial,
compiler marker, declared length, checksum, and complete manifest.

The compiler executable and source tree are not committed or shipped. The
provenance record pins the compiler source revision and the build validates its
release banner; this decision does not claim an executable hash or OCI digest.

This fixture proves the M0 build and basic boot/input/parser/state baseline. It
does not by itself satisfy later M1 gates for status-window or styled output,
randomness, ambiguity, save/restore/restart, or confirmation prompts. Those
remain separate interpreter scenarios and evidence.

## Consequences

Ordinary CI can authenticate the committed fixture without downloading or
executing a compiler. A toolchain-enabled reproducibility job can use the
non-writing check mode and cannot self-bless changed output.

The story is deliberately not built with the Inform library, avoiding another
large third-party input and keeping its behavior auditable. This means the
fixture is not a representative general-purpose Inform game and later engine
conformance work needs additional licensed scenarios.

An intentional source, compiler, flag, release, or serial change updates the
artifact manifest and provenance hashes together. A compiler family or story
format change requires a superseding ADR.

## Alternatives considered

- **ZILF and ZIL.** Appropriate to reevaluate for licensed production ZIL
  sources, but unnecessary for an original M0 fixture and a larger toolchain
  surface than the library-free Inform program.
- **Inform 6 with the standard library.** Familiar authoring ergonomics, but it
  would add library source, version, license, and output variability that this
  minimal fixture does not need.
- **Hand-authored Z-code bytes.** Minimizes tooling but makes behavioral changes
  difficult to review and shifts compiler correctness into custom binary
  assembly code.
- **A downloaded sample story.** Rejected because it would test third-party
  content provenance rather than establish the project-owned legal baseline.

## Validation

On 2026-08-17, an Inform executable built from the pinned source checkout
reported `Inform 6.44 (11th September 2025)`. Two builds under the declared
arguments and environment completed without warnings and were byte-identical.
The resulting `minimal.z3` is 2,166 bytes with SHA-256
`67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389`; its header
declares the same length, version 3, release 1, serial `260817`, and checksum
`0x63c0`.

Canonical checks are:

```text
pnpm story:verify
pnpm story:build -- --compiler /absolute/path/to/inform
pnpm story:build:check -- --compiler /absolute/path/to/inform
```

Primary references: the pinned
[Inform 6 source revision](https://github.com/DavidKinder/Inform6/tree/973a81bebcbd613578b1cc6a1b23a009fe06abd8),
[Inform 6 license](https://github.com/DavidKinder/Inform6/blob/973a81bebcbd613578b1cc6a1b23a009fe06abd8/licence.txt),
and
[Z-machine header specification](https://inform-fiction.org/zmachine/standards/z1point1/sect11.html).
