# Initial Voice Smoke Vertical Slices

Status: implementation checkpoint plan  
Scope: shortest safety-preserving path to an initial developer voice test

## Target

The target is a developer smoke in which a player can speak one utterance, the
Dungeon Guide can execute, clarify, or explain, and an accepted action becomes
exactly one canonical command in the authoritative Z-machine. The player then
hears the exact engine response through narration. The ordinary path must not
require visible text; the same typed events remain available to the optional
accessible transcript and developer-debug surfaces.

This is an integration checkpoint, not a beta or provider-support claim. The
smoke may use explicit developer configuration and an opt-in, budget-limited
live test account.

## Relationship to the delivery milestones

These five slices are narrow vertical checkpoints through the existing M0-M5
work. They neither replace nor relax the deliverables and exit criteria in
[Delivery Milestones](milestones.md). In particular:

- completing a slice does not complete any M0-M7 milestone;
- Dork remains an isolated proposed interpreter candidate until every M0 gate,
  ADR acceptance condition, provenance check, and packaging review passes;
- the fake-audio checkpoint after slice 4 is not evidence that a live provider
  is qualified;
- the live smoke after slice 5 is not provider promotion, accessibility signoff,
  a 30-minute reference replay, or release readiness.

The slices preserve the repository invariants throughout: the Z-machine alone
owns world state, one validated canonical command is the ordinary mutation path,
engine/guide/player/system output remains distinctly attributed, and ambiguous
or uncertain intent does not execute.

## Slice 1 — Real Dork Worker bridge

### Deliverables

- Run the pinned Dork candidate and pinned story in an actual dedicated Worker,
  behind a versioned, bounded message protocol and a disposable worker lease.
- Support boot, canonical command execution, public inspection, snapshot, and
  replacement-worker restore without exporting Dork as an accepted production
  runtime.
- Enforce one in-flight stateful operation, `expectedRevision`, and a bounded
  request-receipt journal so exact retries cannot execute twice.
- Pass snapshots through the outer bounded `EngineSnapshot` integrity check and
  the inner Dork envelope validation. Copy bytes before asynchronous validation.
- Stage restore in a virgin worker and swap only after silent validation reaches
  the declared turn boundary; failed, timed-out, or cancelled staging must leave
  the active worker usable and unchanged.

### Exit criteria

- A real Worker boots the pinned story and returns the expected exact opening
  and command output at an input boundary.
- An exact duplicate `requestId` returns the recorded result without advancing
  revision; a conflicting duplicate, stale revision, malformed command, or
  overlapping operation cannot mutate state.
- A snapshot restored into a replacement Worker produces the same exact next
  command result as uninterrupted play, including revision, boundary, and
  branch-appropriate receipts.
- Corrupt, oversized, structurally valid but hash-mismatched,
  story-incompatible, runtime-incompatible, and boundary-incompatible snapshots
  are rejected before swap; the former worker then proves it can execute its
  expected next command.
- Cancellation and unknown-outcome cases follow the documented quarantine or
  exact-retry policy and never authorize a guessed second command.
- Focused Worker, engine, duplicate-delivery, and restore regressions pass, then
  the hermetic repository gate and build pass.

### Deliberately deferred

Guide reasoning, microphones, provider calls, and player-facing UI are deferred
to later slices. The remaining M0 evidence—including full fork conformance, long
cold-restore runs, complete browser/CSP coverage, generated bundle/SBOM review,
and formal Dork acceptance—remains governed by the M0 ledger.

## Slice 2 — Minimal bounded Dungeon Guide

### Deliverables

- Implement the provider-neutral guide decision contract and deterministic
  validation for the initial `execute`, `clarify`, and `explain` paths.
- Add an opening-area command knowledge index that exposes parser grammar and
  observed affordances without giving ordinary guide turns hidden world or
  solution data.
- Ground one proposed canonical command in the player transcript and observed
  context, or return a non-mutating clarification/explanation.
- Provide a deterministic fake `GuideModel` and adversarial fixtures so no live
  model is required.

### Exit criteria

- Representative direct and paraphrased intents produce an allowed single
  command and the expected engine outcome.
- Ambiguous objects, low-confidence interpretations, materially different
  actions, and multi-step requests do not silently execute.
- “What can I do?” and parser-help cases mention only currently safe grammar and
  observed affordances.
- Malformed decisions, extra fields, command separators, hidden facts, hostile
  game prose, and requests to bypass the engine fail closed.
- Deterministic guide-to-engine scenarios cover execute, clarify, explain,
  rejection, and provider failure with zero live inference calls.

### Deliberately deferred

The complete observed-memory model, progressive hint ladder, full command
knowledge extraction, release evaluation corpus, companion personality, and
provider-specific prompting remain M2 work beyond this initial subset.

## Slice 3 — Semantic turn orchestrator

### Deliverables

- Connect final transcript, guide decision, command validation, Dork execution,
  exact engine output, checkpoint request, and narration request through one
  provider-neutral coordinator.
- Allocate ordered, attributable semantic events and correlation/causation IDs
  for every stage while keeping player, guide, engine, and system prose
  distinct.
- Define cancellation and recovery around the engine commit boundary, including
  stale provider responses and exact request retries.

### Exit criteria

- A deterministic final transcript drives one complete semantic turn with the
  expected event order, one committed command, exact engine text, and exact
  narrator input.
- Clarify and explain decisions emit no engine request; rejected guide output
  cannot leak into execution.
- Duplicate delivery, provider retry, and stale callbacks produce at most one
  committed revision and one canonical committed event sequence.
- Cancellation before submission prevents mutation; cancellation after
  submission reports the confirmed or uncertain outcome without claiming an
  undo.
- A transcriber, guide, narration, checkpoint, or engine failure preserves the
  last confirmed game state and emits a recoverable typed system event.

### Deliberately deferred

Long-session memory compaction, polished projections, cloud persistence,
provider authentication, and live networking are deferred.

## Slice 4 — Browser audio shell with deterministic fakes

### Deliverables

- Add explicit push-to-talk capture, playback, stop/interruption, and a virtual
  audio clock around scripted or redistribution-safe recorded speech adapters.
- Present only essential listening/thinking/speaking/error state and controls by
  default, with optional accessible transcript and developer-debug projections
  over the same event stream.
- Keep narrator and guide audio semantically distinct and prevent playback from
  becoming player input in the supported test setup.

### Exit criteria

- A browser end-to-end test drives fixture audio through transcription, guide,
  the real Dork Worker bridge, exact narration input, and completed playback
  without requiring visible prose or a paid network call.
- Silence, low confidence, rapid push-to-talk start/stop, double delivery, and
  interruption produce no unintended or duplicate command.
- Stop, repeat, pause/resume, keyboard operation, microphone denial, narration
  failure, and transcript visibility expose coherent audible and accessible
  states.
- Transcript/debug projections preserve player transcript, guide decision,
  canonical command, exact engine output, and errors without changing behavior.
- The focused browser suite and hermetic repository gate pass.

### Deliberately deferred

Live provider credentials, production audio quality, the full supported-browser
and assistive-technology matrix, always-listening behavior, and visual polish
remain deferred.

**Checkpoint after slice 4:** the project has an initial fake/recorded-audio
end-to-end voice loop suitable for reliable local development and CI.

## Slice 5 — One budget-limited live provider profile

### Deliverables

- Configure one current, officially supported provider profile for the live
  smoke while retaining the provider-neutral transcriber, guide, narrator, and
  optional realtime capability boundaries.
- Add the required server trust boundary for provider authorization or
  short-lived browser credentials; no long-lived secret may enter browser
  storage, events, logs, fixtures, or debug exports.
- Make the live smoke opt-in, skippable without credentials, request-limited,
  spend-capped, cancellation-aware, and separately observable from hermetic CI.
- Record the exact provider/profile/model configuration and dated smoke
  conditions without hard-coding mutable catalog or pricing assumptions into
  domain logic.

### Exit criteria

- A developer can speak an unambiguous intent and hear the exact response after
  one validated, at-most-once engine command without relying on visible prose.
- A spoken ambiguous intent yields a clarification and zero engine mutation.
- Interruption stops pending audio/future work according to the commit boundary,
  and an injected provider error leaves the latest confirmed checkpoint usable.
- The tested credential expires or disconnects as designed, the session/request
  cap is enforced, and redaction checks find no credential or sensitive raw
  audio in persisted diagnostics.
- The opt-in live smoke passes for the recorded configuration while every
  ordinary repository test still passes with no credentials and no billable
  calls.

### Deliberately deferred

Provider promotion, model allowlist breadth, three-run quality thresholds,
30-minute reference replays, published cost/latency claims, production OAuth
hardening, provider failover, and Hugging Face graduation remain in M4-M7.

**Checkpoint after slice 5:** the project has an initial live developer voice
test. It is evidence that the architecture connects end to end, not that the
interpreter, provider, or product is release-qualified.
