# ADR-0011: Show transient canonical command and activity status

- Status: superseded by
  [ADR-0013](0013-persistent-command-history-and-active-only-indicator.md)
- Date: 2026-08-19
- Owners: maintainers

## Context

The voice-first experience originally prohibited commands on the default screen
and reserved them for the optional transcript. Device testing showed two gaps in
that contract: a player could not verify which validated parser command reached
the engine-request boundary, and multi-second transcription, reasoning,
synthesis, download, or decode intervals could appear frozen even though the
session was making progress.

A provider proposal is not authoritative enough to display as the action taken.
The canonical `engine.command.requested` event is emitted only at the validated
engine boundary, directly before the coordinator submits that command. The
existing audio controller and experience projection already distinguish
requesting microphone access, listening, processing, role-specific audible
playback, paused, and failure states.

## Decision

The quiet default screen may show one transient, text-equivalent command status
such as `Command: examine leaflet`. It is derived only from the canonical
`engine.command.requested` event, never from provider prose or a proposed guide
decision. A matching commit updates projection provenance without changing the
visible wording or repeating its live-region announcement. Rejection, uncertain
engine state, narrator cancellation or failure, pause, the next capture, or
completion of matching narrator playback clears the cue.

The cue is an ephemeral trust and status signal, not persistent game prose or a
replacement transcript. Its lifetime is event-driven and replayable; it does not
use a wall-clock timeout.

The default screen also includes a decorative activity indicator for starting,
microphone permission, listening, processing, and audible playback. Canonical
visible status text remains the accessible, non-motion signal. Motion is hidden
from the accessibility tree, never changes live-region wording, and is disabled
when `prefers-reduced-motion: reduce` is active.

## Consequences

The command boundary becomes inspectable without opening the full transcript,
which improves trust in agent-mediated actions. The default screen now permits
one bounded line of transient canonical text, superseding the narrower
acceptance criterion that prohibited every visible command.

Projection code must preserve the command's source event IDs and clear it on all
terminal and stale paths. Shells must write live-region text only when it
changes so unrelated semantic events do not cause duplicate screen-reader
announcements. The complete attributed transcript remains optional and retains
the same canonical command independently.

Animation is supplementary. Ready, paused, blocked, and reduced-motion states
remain understandable from stable text and static shape alone.

## Alternatives considered

- Keep commands only in transcript mode. This preserves the old screen contract
  but does not provide immediate confidence about an agent-mediated action.
- Display the provider's proposed command earlier. This can show an action that
  policy later rejects and violates the canonical event boundary.
- Clear the cue after a fixed delay. Timers are non-replayable and can expire
  before slow narration begins or linger after a fast failure.
- Animate the status text itself. Cycling punctuation or labels produces noisy
  screen-reader output and makes motion carry semantic meaning.

## Validation

Pure projection tests cover request, matching commit, output, rejection,
narration failure, next-capture clearing, guide playback, and narrator playback.
DOM-light presentation tests cover canonical wording, idempotent live-region
writes, and activity-state mapping. Browser verification must confirm normal
motion, a static reduced-motion rendering, mobile reflow, cancellation and
failure recovery, and one screen-reader announcement per command.

Reevaluate if the cue distracts from audio-first play, is mistaken for engine
success before commit, or causes duplicate announcements with TTS.
