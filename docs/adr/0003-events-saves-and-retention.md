# ADR-0003: Canonical events, opaque saves, and local-first retention

- Status: accepted
- Date: 2026-08-17
- Owners: maintainers

## Context

Voice, guide decisions, engine commits, narration, accessibility views, and
debugging need one replayable semantic history without treating a model
transcript as game state. Saves must survive provider nondeterminism and
failure.

## Decision

The versioned `EventEnvelope` and semantic families in `docs/architecture.md`
are the only canonical persisted event schema. The browser coordinator is the
single sequence allocator. UI and accessibility records are disposable typed
projections that point back to canonical event IDs.

An opaque Z-machine snapshot plus a versioned, hash-addressed manifest is the
authoritative save. Guide memory and a bounded event tail are advisory sidecars.
Event replay tests behavior and rebuilds projections; it is not a substitute for
an engine snapshot.

Raw audio and partial transcripts are not retained by default. Final transcripts
and semantic history remain local according to an explicit history setting. No
prose, audio, saves, or guide memory goes to project telemetry by default.

## Consequences

Original game output, player speech, guide output, and system status remain
attributable. Schema and save changes require migrations and fixtures. Some
debugging information will be unavailable unless a player explicitly enables and
exports diagnostic recording.

## Alternatives considered

- Treating a provider conversation as history couples saves and diagnosis to a
  vendor and leaks unbounded context.
- Reconstructing state from commands can diverge because of RNG and interpreter
  behavior.
- Retaining raw audio by default adds privacy and storage risk without being
  required for play.

## Validation

Schema changes require replay and migration fixtures. M1 must prove snapshot
restore equivalence; M3 must prove that minimal, accessible, and debug views
render from the same events. Any cloud retention requires a superseding data
flow and explicit player consent.
