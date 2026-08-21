# ADR-0027: Project source-backed observed-world referents

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers

## Context

The opening-area projection can ground references to its reviewed mailbox,
leaflet, house, and door, but it stops being useful as soon as the player enters
another room. Canonical output at Forest Path visibly discloses a tree and low
branches, yet “Examine tree” formerly reached the provider with no eligible
object slot and fell back to a generic clarification.

Adding a story-specific exception for every room would duplicate parser lore and
still miss conversational follow-ups. Giving the model an unbounded transcript
or hidden object table would weaken provenance, spoiler, and command-authority
boundaries.

## Decision

The session maintains a provider-neutral, replay-derived
`ObservedWorldProjection` alongside the canonical event stream. It creates
bounded entity referents only from exact `engine.output` physical-presentation
clauses and records the source sentence, event ID, and engine revision. Player
transcripts, guide output, provider output, and quoted prose cannot create a
referent.

The projection distinguishes historical entities from the current scene.
Correlated movement and LOOK results replace the current set; other correlated
results may add current referents. A command commit is only a pending attempt
and does not prove an effect. The opening-specific scene projection remains an
optional enrichment layer for reviewed relations and ranked suggestions.

A source-backed current entity may populate an ordinary command-knowledge slot.
An explicit command such as `EXAMINE TREE` still passes grammar, direct-speech,
risk, revision, and idempotency checks before execution. Entity extraction does
not assert that a parser command is supported or will succeed. Object-scoped
help may recommend EXAMINE as a low-effect first attempt while saying that the
game decides what works.

The projection also retains one recent object focus from a correlated completed
object command. An explicit pronominal follow-up such as “Inspect it” may bind
to that entity only while it remains current and must pass the same grounding
checks. The broader opening-specific reverse-side resolver in ADR-0026 remains
separate because its recently read object may no longer be current.

## Consequences

- Objects disclosed after the opening participate in command grounding and
  concise contextual help without per-room hardcoding.
- Every eligible referent remains attributable to exact canonical game output.
- The projection is an observed-language index, not a second game state, hidden
  map, parser-support guarantee, or puzzle graph.
- Generic noun extraction is intentionally conservative and lossy. Later
  interpreter instrumentation may replace it with structured parser/object
  observations while preserving this contract.
- Ambiguous, stale, unobserved, consequential, and multi-action requests still
  fail closed or ask for clarification.

## Alternatives considered

- **Add room-specific object tables:** precise but unscalable and easy to drift
  from canonical game output.
- **Send the full transcript to the provider:** conversationally flexible but
  weakens provenance, bounded memory, and spoiler controls.
- **Expose the interpreter object table:** precise but leaks hidden state and
  violates the public-observation boundary.
- **Build a complete puzzle graph now:** unnecessary for referent grounding and
  likely to encode unseen solutions. Structured observed facts and relations can
  grow independently when their source contracts are ready.

## Validation

Projection, guide, session, and real-engine integration tests cover movement to
Forest Path, extraction of `tree` and `branches` with source evidence,
non-mutating tree help, direct `EXAMINE TREE`, and the current-focus follow-up
“Inspect it.” The flow requires canonical engine commands and output, no model
call for the grounded tree turns, and no hidden-state access.
