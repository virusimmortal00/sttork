# ADR-0004: Compose providers by capability behind normalized ports

- Status: accepted
- Date: 2026-08-17
- Owners: maintainers

## Context

OpenRouter, OpenAI Realtime, and Hugging Face expose different combinations of
speech, reasoning, narration, streaming, authentication, cancellation, and usage
reporting. Domain behavior cannot safely depend on one vendor's response objects
or on the assumption that one vendor supplies every role.

## Decision

Provider profiles compose small ports for transcription, guide reasoning,
narration, and optional realtime transport. Adapters declare normalized
capabilities and return domain-safe updates or `unknown` guide output. The core
schema validator is the only component that can produce an accepted
`GuideDecision`.

Profiles pin model and adapter IDs, processors, conformance version, limits,
authorization mode, and maturity. A profile is unavailable unless all required
capabilities pass startup and conformance checks. Switching processor, privacy
terms, or billing responsibility is never silent.

## Consequences

OpenRouter can be the first chained profile, OpenAI can supply a realtime
profile, and Hugging Face can be rejected or used for only qualified roles
without changing guide or engine code. Adapters carry extra normalization and
contract-test work.

## Alternatives considered

- A single generic `complete()` API hides streaming, cancellation, audio, and
  usage differences that affect correctness and cost.
- Provider conditionals in UI/domain code make conformance and failure handling
  inconsistent.
- Automatic cross-provider fallback can change processors, billing, and privacy
  without informed consent.

## Validation

Every adapter must pass recorded, non-billable contract tests; live smoke tests
are separate and capped. Model/provider promotion requires the repeated guide,
voice, latency, security, and cost gates in `docs/testing.md`.
