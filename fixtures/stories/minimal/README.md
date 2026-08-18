# Minimal Z-machine story

This project-owned, MIT-licensed Inform 6 program is the legal and deterministic
fixture for the engine boundary. It contains no Zork source, names, prose,
objects, map, parser library, or solution material.

The story deliberately implements its tiny command loop without the Inform
library. It supports `look`, `north`, `south`, `take token`, `inventory`,
`score`, and `quit`, plus a fixed parser-error response. This is enough to test
boot, input, dictionary parsing, state mutation, movement, inventory, score,
multiline output, and clean termination before any third-party game is loaded.

The pinned compiler and invocation are defined by
[ADR-0007](../../../docs/adr/0007-deterministic-minimal-z-machine-fixture.md)
and `artifact/manifest.json`. `pnpm story:verify` verifies the source hash,
checked-in binary hash, version 3 header, declared length, checksum, and
complete manifest without a compiler or network call.

Build Inform 6.44 from the exact commit recorded in provenance, then run:

```text
pnpm story:build -- --compiler /absolute/path/to/inform
```

The script compiles in two independent temporary directories with `LC_ALL=C`,
`TZ=UTC`, `-v3`, `-Cu`, and an explicit `$ZCODE_FILE_END_PADDING=0` argument. It
rejects warnings and refuses to write unless the two outputs are byte-identical.
For CI or a read-only audit, use the non-writing comparison mode:

```text
pnpm story:build:check -- --compiler /absolute/path/to/inform
```

The source keeps the parse buffer byte-addressed as required by the `read`
instruction. Its helper decodes dictionary addresses from two big-endian bytes,
and the command loop clears the optional second word before reading it so a
short command cannot reuse a stale parse entry.
