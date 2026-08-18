# Documentation map

These documents are the source of truth for product and engineering decisions.
They describe intended boundaries rather than a finalized technology stack.

## Read in this order

1. [Strategy](strategy.md) — outcomes, principles, scope, and provider posture.
2. [Architecture](architecture.md) — boundaries, data flow, state, security, and
   proposed repository shape.
3. [Dungeon Guide](guide-agent.md) — agent responsibilities, tools, decisions,
   memory, hints, and failure behavior.
4. [Experience](experience.md) — the near-screenless default, accessibility,
   visible transcript, debug surfaces, and audio interaction states.
5. [Testing](testing.md) — verification, evaluations, regression gates, and
   operational quality signals.
6. [Milestones](milestones.md) — implementation order and exit criteria.
7. [Project decisions](project-decisions.md) — settled decisions, assumptions,
   and questions that require evidence before resolution.
8. [M0 interpreter evidence](m0-interpreter-evidence.md) — the open acceptance
   ledger for the proposed browser Z-machine candidate.
9. [Dated Dork spike](m0-dork-spike-2026-08-18.md) — pinned source/story and
   bounded turn/checkpoint/RNG/cold-restore evidence; all gates remain non-pass.
10. [Dated Bocfel spike](m0-bocfel-spike-2026-08-17.md) — historical oracle and
    fallback worker/persistence evidence.
11. [Development](development.md) — pinned runtime, installation, canonical
    commands, test placement, and workspace rules.
12. [Repository operations](repository-operations.md) — CI behavior, required
    GitHub protections, dependency updates, and release prerequisites.

The dated [provider and upstream research snapshot](provider-research.md) and
[browser interpreter research](interpreter-research.md) record external facts
behind the initial plan. They are informative and must be revalidated before the
associated provider or interpreter decision is promoted.

Material changes to those decisions use an
[architecture decision record](adr/README.md).

The [threat model](threat-model.md) is the security review baseline for browser,
backend, provider, save, audio, and observability changes.

Repository-wide contributor and coding-agent rules live in
[AGENTS.md](../AGENTS.md).

## Authority and conflict resolution

When documentation disagrees, use this priority:

1. Security, licensing, and product invariants in `AGENTS.md`.
2. Explicit settled decisions in `project-decisions.md`.
3. Domain-specific contracts in `architecture.md` and `guide-agent.md`.
4. Roadmap ordering in `milestones.md`.
5. Examples and proposed implementation details.

Examples are illustrative. A concrete implementation may evolve as long as it
continues to satisfy the documented contracts and the change updates the
affected documents.
