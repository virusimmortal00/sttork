# ADR-0025: Segment and prefetch authored narration

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers

## Context

The fixed Guide, Narrator, and story-opening prose was prepared and played in
paragraph-sized clips. A new synthesis request began only after the preceding
clip ended, creating avoidable silence at deterministic transitions. The visual
conversation independently estimated progress by word rate, so it could advance
to a later sentence without an authoritative audio boundary.

## Decision

Authored role introductions and the deterministic story-opening excerpt are
split into ordered sentence-or-line narration requests. The semantic event
stream retains the original attributed source event while giving each segment
its own `narration.requested`, `narration.ready`, and playback lifecycle.

While segment N plays, the playback controller prepares N+1 and N+2 in parallel.
Prepared clips are held in a bounded eight-entry, session-memory cache keyed by
exact role, text, voice, and speed. Preparation never starts audio. A failed
prefetch is recoverable: ordinary playback requests that segment when its turn
arrives. Stop aborts in-flight lookahead through the active playback signal.

When the authored Narrator introduction begins, the live shell also warms the
first two deterministic story-opening segments. This is audio-only preparation:
the revision-zero `engine.output` and attributed narration events remain behind
the explicit story-start action, and a prefetched clip is consumed later only
when its exact role, text, voice, and speed match that authorized request.

Audible playback remains strictly serial. The visual conversation begins a
segment only at `audio.playback.started` and completes it at
`audio.playback.ended`. If a start event arrives early, the presentation queues
it until the prior visual segment has finished. No estimated visual timer may
advance into a later sentence independently of these audio boundaries.

## Consequences

Short consecutive sentences and Guide-to-Narrator transitions are less likely to
expose synthesis latency. Active text cannot replace an unfinished sentence. The
original prose, role attribution, source event, and engine authority remain
unchanged.

Each two-segment lookahead can issue up to two billable speech requests before
they are audible after the player starts the introduction. The bounded cache and
abort signal limit retained data and unnecessary continuation. Raw audio remains
session-memory-only and excluded from semantic fixtures and telemetry.

## Alternatives considered

- Prefetch only N+1. This still risks a gap when several short sentences finish
  faster than synthesis can complete.
- Keep paragraph clips and tune the visual WPM estimate. This cannot provide an
  authoritative sentence boundary and does not hide transition latency.
- Request every known clip immediately. This maximizes concurrency, cost, and
  unused work after cancellation.

## Validation

Coordinator tests must prove deterministic sentence and line ordering.
Controller tests must prove that exactly the next two segments begin preparation
while N is active and that playback starts remain serial. Provider-adapter tests
must prove a prefetched clip is consumed without a duplicate request. Visual
tests and browser review must confirm that a later segment cannot replace an
active one and that cancellation remains recoverable.
