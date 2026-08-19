# ADR-0013: Keep a bounded command history and hide idle activity

- Status: accepted
- Date: 2026-08-19
- Owners: maintainers
- Supersedes: [ADR-0011](0011-transient-command-and-activity-status.md)

## Context

ADR-0011 introduced one transient canonical-command cue and a decorative
activity indicator. Device testing showed that the command vanished too soon to
serve as a useful record of how the guide interpreted successive turns. It also
showed three static dots while the experience was ready, which looked like
unfinished work rather than a quiet invitation for the player to speak.

The full attributed transcript remains optional and is too detailed for this
small trust signal. Provider proposals remain too early and untrusted to become
an action record. Canonical engine request and commit events already provide a
replayable distinction between a command being submitted and one the engine has
accepted.

## Decision

The default screen shows a bounded, newest-first list of recent canonical game
commands. A command may appear immediately as the active request, derived only
from `engine.command.requested`. It becomes an ordinary muted history item only
after the matching `engine.command.committed` event. A rejected, not-submitted,
or uncertain request does not become committed history. Recovery that later
produces a canonical matching commit adds the command exactly once.

The list retains at most eight committed commands. It displays about three rows
before scrolling, is keyboard-scrollable and labeled, and contains command text
only. The newest active request is visually emphasized; committed rows use a
solid muted color that retains required contrast. The existing separate polite
live region announces only the active command once. The history itself is not a
live region, so adding a row does not reannounce the entire list or duplicate
spoken narration.

Persistence means session/event-replay persistence. The list is a disposable
projection of canonical events, not an independent `localStorage` record. A full
unbounded and attributed history remains available in Transcript.

The decorative activity indicator is visible only while work is active: startup,
microphone permission, listening, processing or reconnecting, and audible
guide/narrator playback. It is hidden while ready, paused, blocked,
recoverable-error, or ended. Stable visible status text remains authoritative,
and reduced-motion mode still disables all animation.

## Consequences

Players can compare the current interpretation with a few prior engine turns
without opening Transcript, while the default surface remains bounded and does
not become a terminal or game-prose display. Confirmed history cannot imply that
a provider proposal, rejected request, or uncertain command mutated the game.

Projection reducers must cap and de-duplicate committed commands
deterministically, including exact-retry recovery. Shell rendering must be
keyed/idempotent so unrelated events do not reset scroll position or assistive
technology navigation. The action list must remain usable at mobile widths, high
zoom, and by keyboard.

## Alternatives considered

- Keep one transient cue. This was too easy to miss and provided no short-term
  comparison across successive turns.
- Persist every request with status labels. This risks leaving stale “sending”
  rows and makes failures look like ordinary game history.
- Put the entire transcript on the default screen. This conflicts with the
  voice-first, quiet-screen contract and repeats game prose.
- Leave static dots visible while ready. Device testing interpreted them as
  continuing work, which is exactly the ambiguity the activity indicator should
  remove.

## Validation

Projection tests cover request, matching commit, rejection, uncertain outcome,
recovered commit, de-duplication, deterministic cap eviction, and replay
equivalence. Presentation tests cover newest-first rendering, muted committed
rows, one active announcement, idempotent updates, scroll preservation, and an
empty hidden list. State-presentation tests cover active-only indicator
visibility and reduced-motion CSS.

Browser verification must cover keyboard and touch scrolling, 200–400% zoom,
mobile reflow, reduced motion, and one screen-reader announcement per submitted
command without replaying the history.
