# ADR-0026: Resolve deictic observation from recent object focus

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers

## Context

Players unfamiliar with parser verbs naturally continue an object interaction as
a conversation. After `read leaflet`, “Is there anything on the back?” has a
clear conversational referent, but it neither repeats the noun nor says EXAMINE.
The former opening projection retained current scene objects and pending
clarification focus, but discarded the target of a completed command. The
provider therefore fell back to a generic single-action clarification.

Treating any last-mentioned noun as focus would be unsafe and stale. Answering
the question from model knowledge would also invent a fact the engine has not
revealed.

## Decision

The authenticated opening-scene projection retains one source-backed recent
object focus from the latest correlated `engine.command.committed` and
`engine.output` pair. This focus records the canonical command target and is
separate from current-location membership: READ or TAKE may move an object while
leaving it available for a follow-up observation.

A bounded local resolver may use that focus for reviewed deictic questions about
an object's reverse surface, including “Is there anything on the back?” It
compiles one least-effect T2 `EXAMINE <focused object>` command. It does not
answer yes or no; the Z-machine remains the only authority on what the action
reveals.

The focus is replaced by the next completed object-directed command and cleared
by movement, unmatched engine output, or a completed non-object command. It is
accepted only from the exact authenticated story projection. Conditional,
negated, multi-action, or unreviewed referential wording retains the ordinary
clarification and grounding path.

## Consequences

- Immediate conversational follow-ups work without teaching parser syntax.
- Implicit movement caused by READ does not erase the dialogue referent.
- The resolver remains bounded to one canonical event-derived target and one
  non-mutating observation affordance.
- Broader pronoun and discourse resolution still requires a separately reviewed
  focus model; this decision is not an unbounded transcript heuristic.

## Validation

Projection, guide, and real-engine tests cover `open mailbox` → `read leaflet` →
“Is there anything on the back?” and require exactly one `examine leaflet`
commit, no provider call for the follow-up, no clarification, and canonical
engine output as the answer.
