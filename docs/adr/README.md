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
