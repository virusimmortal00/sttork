# ADR-0016: Separate contextual suggestions from parser authority

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: the fixed READ-versus-EXAMINE suggestion clauses of ADR-0012 and
  ADR-0015

## Context

The initial content-question policy treated every request about an object's
contents as a fixed choice between EXAMINE and READ. That was appropriate for
the leaflet, where both parser actions are useful distinctions, but it produced
misleading advice for the closed mailbox: “what's inside the mailbox?” offered
READ even though OPEN is the useful contextual attempt.

READ must not be removed from the parser grammar to correct that advice. Zork I
Release 119 accepts `READ MAILBOX` and responds with its characteristic awkward
parser text. A player who explicitly asks for that command should still be able
to experience it. The product therefore needs a hard distinction between a short
list of helpful things to try and the broader set of parser commands that the
player may explicitly request.

The exact-story scene projection already derives source-backed contextual
affordances from canonical engine events. Object labels and the global grammar
alone do not establish which actions are helpful in the current scene, and a
provider proposal is not trusted evidence of either world state or command
authority.

## Decision

Object-scoped suggestions are derived only from the trusted, current
`OpeningSceneProjection`. For this slice,
`resolveOpeningSceneObjectActionSuggestion` returns one current object and
exactly two distinct ranked actions. The closed mailbox offers EXAMINE and OPEN;
the revealed leaflet offers EXAMINE and READ. These are attempts the guide may
recommend, not claims that the parser will accept them or a list of every
command the player is allowed to try.

The session may retain that recommendation as a bounded
`contextual-object-action-choice` dialogue-focus frame:

```ts
interface ContextualObjectActionChoice {
  kind: "contextual-object-action-choice";
  objectValueId: string;
  suggestedActions: readonly [
    PendingOpeningContextualObjectAction,
    PendingOpeningContextualObjectAction,
  ];
}
```

`suggestedActions` deliberately describes advice rather than authorization. The
frame is session-only and is not added to events or saves. The legacy
`read-examine-choice` shape, including its `allowedActions` field, remains
accepted during this migration.

The frame may supply only the still-current object referent; its suggestions do
not authorize an action. A direct affirmative follow-up that explicitly says
`READ`, `read it`, or another parser action may use that single revalidated
object focus even when the action was not suggested, but the action must still
pass the ordinary command-knowledge, lexical authorization, risk, revision, and
commit gates. An explicit command that names both its action and object likewise
supersedes the focus and uses those ordinary gates. Consequently, explicit
`READ MAILBOX` and direct `read it` remain available even though READ is not
recommended for the mailbox.

Scoped help may preserve the focus only when the object and exact ordered action
pair are still offered by the current scene. The provider may receive the
validated frame as bounded dialogue context and may classify an unseen help
paraphrase only by echoing the exact corresponding grammar source IDs. Local
policy revalidates those IDs and renders deterministic prose; provider prose or
choices cannot add, replace, or authorize an action.

If the trusted scene projection is absent, the object is stale, or its current
suggestion pair has changed, the guide fails closed with a generic non-mutating
clarification and clears the contextual focus. It does not infer OPEN, READ, or
another recommendation from an object name or the global grammar.

A committed parser command is evidence only that the engine processed the
command. Its correlated exact engine output determines how the scene projection
changes. In particular, the reviewed Release 119 response to `READ MAILBOX`
keeps the mailbox current because the parser declined to read or take it. The
projection must not invalidate the object merely because READ can take other
objects.

## Consequences

- The guide can recommend the useful mailbox actions without suppressing Zork's
  broader and sometimes awkward parser behavior.
- Suggestions, dialogue focus, parser support, and execution authorization have
  distinct meanings and validation boundaries.
- Scoped follow-ups remain concise without introducing a last-mentioned-noun
  heuristic or unbounded conversation memory.
- The scene projection must recognize reviewed command outcomes precisely enough
  to update current objects and affordances without treating an attempted action
  as a successful mutation.
- The provider, browser adapter, BFF, session copier, and tests must support the
  generalized bounded frame. No event or save schema changes.

## Alternatives considered

- **Remove READ for the mailbox:** rejected because recommendations must not
  redefine the parser or hide valid explicit commands.
- **Continue offering EXAMINE and READ for every content question:** rejected
  because parser possibility is not the same as useful contextual guidance.
- **Infer suggestions from the object's label or the global grammar:** rejected
  because neither is source-backed current-scene evidence.
- **Let the provider choose the suggestions:** rejected because provider output
  cannot establish observed state or command authority.
- **Preserve a stale pair until the player chooses:** rejected because scene
  changes can make a formerly useful pronominal choice materially different.

## Validation

Hermetic command-knowledge, guide, provider, browser, BFF, and session tests
must cover the two exact current pairs, malformed and stale frames, scoped help,
provider attempts to broaden a pair, no-scene fallback, and the independence of
explicit command grounding from suggestion membership. Help and clarification
turns must issue no engine command.

A real Release 119 integration must cover “what's inside the mailbox?” producing
only the EXAMINE/OPEN clarification, followed by explicit `READ MAILBOX`
committing exactly once and preserving the exact engine response. A subsequent
inventory check must remain engine-authored evidence that the mailbox was not
taken, and replaying an interaction ID must not submit another command. The
existing leaflet EXAMINE/READ flow remains a required contrast. These are
required regressions, not live-provider evaluation evidence.
