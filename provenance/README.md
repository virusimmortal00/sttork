# Provenance registry

This registry answers four questions for every external input: exactly where did
it come from, which immutable revision was reviewed, what license and other
rights apply, and what may this repository redistribute?

`index.json` lists all records. Each JSON record conforms to
`record.schema.json`. Third-party records identify an immutable upstream;
project-owned generated artifacts instead identify hashed local sources, build
tool records, and a claimed artifact manifest. A record with
`importStatus: "not-imported"` is research and approval metadata only; it does
not authorize a later import without updating `localPaths`, hashes, notices,
build instructions, and review status.

Only an `imported` record with approved redistribution and a preserved local
notice may claim repository files. Every claimed file requires a SHA-256 digest.

The check also scans the repository, excluding standard dependency/cache/build
directories, for story, interpreter, archive, font, image, audio/video, save,
and other binary artifact extensions. Putting a `.wasm`, `.z3`, media file, or
source archive outside `vendor/` does not bypass admission: its path and digest
must still be claimed by an approved imported record.

## Required workflow

1. Review the exact upstream files and license at a commit or immutable release.
2. Record source and artifact SHA-256 hashes before changing anything.
3. Preserve the original license and copyright notices verbatim.
4. Keep patches separate and identify every generated artifact and toolchain.
5. Make the redistribution decision explicit, including trademark exclusions.
6. Run the provenance check before and after the import.

Moving a mutable branch or `latest` URL is never sufficient provenance.
