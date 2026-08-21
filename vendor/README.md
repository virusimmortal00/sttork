# Vendored material

This directory contains only provenance-approved, hash-locked third-party
inputs:

- `dork/` contains the selected TypeScript Z-machine core for the ADR-0009
  candidate integration. It is a locally modified, unendorsed subset pinned to
  one upstream commit, not the npm package and not an upstream distribution;
- `zork1/zork1.z3` is the separately licensed Release 119 story artifact.

Neither import grants trademark rights or marks Dork as an accepted production
interpreter. See `provenance/`, `LICENSES/`, and the candidate evidence ledger.

Before adding anything below `vendor/`:

1. pin the exact upstream revision and artifact hashes;
2. record every local path and modification under `provenance/records/`;
3. preserve all required license and copyright notices under `LICENSES/`;
4. document the reproducible acquisition/build procedure; and
5. make the provenance and license checks fail when the record drifts.

Do not copy an upstream repository here merely because its top-level project
is open source. Audit the exact subtree and generated artifacts being shipped.
