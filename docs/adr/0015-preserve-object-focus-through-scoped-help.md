# ADR-0015: Preserve object focus through scoped command help

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: the pending-help lifecycle clause of ADR-0012

## Context

ADR-0012 introduced a session-only READ-versus-EXAMINE choice bound to one
currently observed object. It required any intervening command help to clear
that choice. Device testing showed that this loses essential dialogue context:
after asking what is on or in the leaflet, a player asking “what are the action
options?” received the entire parser catalog and could no longer say “examine
it” or “read it.”

The scene projection must not infer a generic last-mentioned noun, and provider
prose must not become command authority. The guide nevertheless needs a bounded
way to retain the object that its own immediately preceding clarification made
salient.

## Decision

The existing `read-examine-choice` frame is also the bounded dialogue focus for
that clarification. It contains only one current observed-object value ID and
the fixed allowed actions `examine` and `read`; it remains session-only and is
not added to events or saves.

Help about those active options returns another deterministic clarification
bound to the same revalidated object. It explains the effect difference, exposes
only the two canonical choices, and preserves the frame so a later explicit or
pronominal choice can be grounded. A READ-versus-EXAMINE comparison while that
frame is active follows the same rule. Explicit global help or an unrelated
topic still clears or supersedes the focus.

The provider may receive the validated pending frame as bounded conversational
context. It cannot author a parser command or player-facing explanation. If it
classifies an unseen scoped-help paraphrase, local policy accepts only an
`explain` decision containing exactly the current `grammar.examine` and
`grammar.read` source IDs, then renders the same deterministic clarification.

A connective is not by itself proof of multiple game turns. In particular, “on
or in” can coordinate two content prepositions around one current object. The
bounded local recognizer treats that as one content goal while independent
action clauses and multiple objects remain non-executing ambiguities.

The focus is cleared when its object is no longer current, an unrelated fresh
command is accepted, explicit global help supersedes it, or the session or
lifecycle ends. No help turn executes an engine command or claims that an option
will succeed.

## Consequences

- Natural follow-ups remain object-specific without storing an unbounded chat
  transcript or a free-floating “last noun.”
- The provider can classify unseen help paraphrases, but local IDs, current
  object checks, and deterministic prose remain the authority boundary.
- Scoped help is represented as `clarify`, not `explain`, so the existing
  coordinator can preserve the frame without an event-schema change.
- Generic/global help and dialogue correction still need explicit product
  semantics; this ADR does not add undo or navigation history.

## Alternatives considered

- **Clear focus for every help turn:** rejected because it caused the reported
  full-catalog response and broke the immediate pronominal follow-up.
- **Store the last mentioned noun:** rejected because mention is not reliable
  evidence of player focus and can bind stale or adversarial text.
- **Let provider prose carry the context:** rejected because provider output is
  not authoritative and would weaken deterministic command grounding.

## Validation

Hermetic guide, provider, BFF, browser-adapter, session, and real-engine tests
must cover: `open mailbox` → “what's on or in the leaflet?” → scoped action
options → `examine it` or `read it`; zero engine mutation on both help turns;
one final revalidated command; stale-object failure; true multi-action
contrasts; bounded pending serialization; and no full command catalog in the
scoped response.
