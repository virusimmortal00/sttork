# ADR-0002: Browser worker engine and narrow session backend

- Status: accepted
- Date: 2026-08-17
- Owners: maintainers

## Context

The product needs low-latency local game state and microphone/playback access,
but hosted provider authorization requires a trusted component that can hold
long-lived secrets. Provider failure must not make a confirmed save unavailable.

## Decision

The initial client is a TypeScript web application. The Z-machine runs in a
dedicated browser worker behind the versioned `EnginePort`. Local IndexedDB
holds authoritative checkpoints.

A narrow backend-for-frontend owns OAuth exchanges, encrypted long-lived
provider credentials, short-lived realtime session issuance, server-held
deployment keys, model allowlists, cost limits, and redacted operational data.
It is not the game-state authority. UI projections call neither providers nor
the engine directly; the browser coordinator owns ordered interaction.

## Consequences

Ordinary game play and restore remain local once the application and story are
loaded, while voice inference still requires a configured hosted provider. The
worker protocol and browser storage require explicit migration tests.
Self-hosters need a backend for provider-connected modes but not a project
account or remote game database.

## Alternatives considered

- Running the interpreter on the server would add round-trip latency and make
  provider/backend availability part of the game-state trust boundary.
- Running provider secrets entirely in the browser would expose long-lived
  credentials to storage, extensions, bundles, and debug tooling.
- A native application would narrow initial reach and duplicate accessibility
  and audio work across platforms.

## Validation

M1 must prove worker isolation, deterministic execution, snapshot compatibility,
and duplicate-command rejection. M3 must prove supported browser audio,
IndexedDB, accessibility, and recovery behavior. Reevaluate if those tests fail
or a browser cannot provide the required secure provider session pattern.
