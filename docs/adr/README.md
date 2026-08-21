# Architecture decision records

Use an architecture decision record (ADR) for a choice that changes a settled
decision, a trust boundary, a public contract, a provider posture, licensing
obligations, or a milestone's fundamental approach.

Name records sequentially:

```text
0001-short-decision-name.md
0002-next-decision.md
```

Accepted ADRs are immutable except for typo or link corrections. Supersede a
decision with a new ADR and link both records.

## Decision index

- [ADR-0001: MIT license and inbound contribution terms](0001-project-license-and-contributions.md)
  — accepted.
- [ADR-0002: Browser worker engine and narrow session backend](0002-browser-worker-and-bff-boundary.md)
  — accepted.
- [ADR-0003: Canonical events, opaque saves, and local-first retention](0003-events-saves-and-retention.md)
  — accepted.
- [ADR-0004: Compose providers by capability behind normalized ports](0004-provider-capability-composition.md)
  — accepted.
- [ADR-0005: Provisional Chrome and Safari browser baseline](0005-browser-support-baseline.md)
  — accepted.
- [ADR-0006: Browser Z-machine interpreter candidate](0006-z-machine-interpreter-candidate.md)
  — superseded by ADR-0009; retained as the Bocfel oracle/fallback record.
- [ADR-0007: Deterministic minimal Z-machine fixture](0007-deterministic-minimal-z-machine-fixture.md)
  — accepted.
- [ADR-0008: Pinned Node, pnpm, and TypeScript foundation](0008-node-pnpm-typescript-toolchain.md)
  — superseded by ADR-0010.
- [ADR-0009: Pinned Dork TypeScript interpreter candidate](0009-dork-typescript-interpreter-candidate.md)
  — proposed; acceptance depends on the reset M0 evidence ledger.
- [ADR-0010: Pin the workspace to Node 26 Current](0010-node-26-current-toolchain.md)
  — accepted; supersedes ADR-0008.
- [ADR-0011: Show transient canonical command and activity status](0011-transient-command-and-activity-status.md)
  — superseded by ADR-0013.
- [ADR-0012: Resolve natural language through structured command intents](0012-structured-semantic-command-intents.md)
  — accepted; the first rollout is limited to certified global observations.
- [ADR-0013: Keep a bounded command history and hide idle activity](0013-persistent-command-history-and-active-only-indicator.md)
  — accepted; supersedes ADR-0011.
- [ADR-0014: Allow a story-pinned spoken opening excerpt](0014-story-pinned-spoken-opening-excerpt.md)
  — accepted; canonical boot output remains byte-exact.
- [ADR-0015: Preserve object focus through scoped command help](0015-preserve-object-focus-through-scoped-help.md)
  — accepted; supersedes ADR-0012's blanket pending-help clearing rule, while
  ADR-0016 supersedes its fixed READ-versus-EXAMINE suggestion shape.
- [ADR-0016: Separate contextual suggestions from parser authority](0016-separate-contextual-suggestions-from-parser-authority.md)
  — accepted; contextual advice does not restrict explicit parser commands.
- [ADR-0017: Add an authored role introduction before story start](0017-authored-role-introduction-before-story-start.md)
  — accepted; the fixed Guide and Narrator welcome does not touch engine state.
- [ADR-0018: Let visible speech replace redundant activity motion](0018-visible-speech-replaces-redundant-activity-motion.md)
  — accepted; its settled height-collapse rule is superseded by ADR-0019.
- [ADR-0019: Center active speech above a wider history](0019-center-active-speech-above-wider-history.md)
  — accepted; its distinct-width rule is superseded by ADR-0024 while the
  vertical hierarchy remains.
- [ADR-0020: Focus committed commands in the visual conversation](0020-focus-committed-commands-in-visual-conversation.md)
  — accepted; supersedes ADR-0013's separate command-list presentation.
- [ADR-0021: Switch the primary input between voice and text](0021-switch-primary-input-between-voice-and-text.md)
  — accepted; supersedes text entry inside the transcript modal.
- [ADR-0022: Place operational status below active text](0022-place-operational-status-below-active-text.md)
  — accepted; speaking attribution is no longer duplicated near the title.
- [ADR-0023: Make the visible playback stop resumable](0023-make-visible-playback-stop-resumable.md)
  — accepted; the square pauses active narration and becomes a resume triangle.
- [ADR-0024: Use one conversation measure](0024-use-one-conversation-measure.md)
  — accepted; active text and muted history share a responsive 50 rem cap.
- [ADR-0025: Segment and prefetch authored narration](0025-segment-and-prefetch-authored-narration.md)
  — accepted; N+1 and N+2 warm while N plays, but sentence starts remain serial.
- [ADR-0026: Resolve deictic observation from recent object focus](0026-resolve-deictic-observation-from-recent-object-focus.md)
  — accepted; a reviewed reverse-side question may EXAMINE the latest
  event-derived object while the engine remains fact authority.
- [ADR-0027: Project source-backed observed-world referents](0027-project-source-backed-observed-world-referents.md)
  — accepted; exact engine prose may create attributable current referents for
  ordinary grounding without exposing hidden interpreter state.
- [ADR-0028: Adopt STTork as the independent public project name](0028-adopt-sttork-public-name.md)
  — accepted; Zork is now a compatibility/provenance reference rather than the
  project brand, and legacy wire identifiers remain stable.

## Template

```md
# ADR-NNNN: Decision title

- Status: proposed | accepted | rejected | superseded
- Date: YYYY-MM-DD
- Owners: names or team
- Supersedes: ADR-NNNN, if applicable

## Context

What constraint, evidence, or problem requires a decision?

## Decision

What will the project do?

## Consequences

What becomes easier, harder, required, or intentionally unsupported?

## Alternatives considered

What credible alternatives were evaluated, and why were they not selected?

## Validation

What prototype, measurement, test, or review will confirm the decision remains
sound? State any date or condition that should trigger reevaluation.
```
