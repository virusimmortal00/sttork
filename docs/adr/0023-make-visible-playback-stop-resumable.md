# ADR-0023: Make the visible playback stop resumable

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: the visible playback-control portion of the Stop behavior in the
  experience contract

## Context

The visible Stop control permanently interrupted the current utterance. Repeat
could replay it from the beginning, but there was no way to continue from the
point where the player stopped. The adjacent Pause control changed session state
by stopping playback and likewise did not preserve the media position. Their
distinction was therefore unclear and neither produced the expected resume
behavior.

## Decision

During audible Guide or Narrator playback, the visible square control pauses the
existing media element without aborting the playback request or releasing its
source. The control then becomes a play triangle named `Resume playback` and
continues that same element from its retained position on activation.

The progressive active-text presentation pauses at the same semantic boundary.
It retains the revealed words and the remaining delay before its next reveal,
then resumes that pending step only after media playback resumes. It neither
finishes nor restarts the visible sentence while audio is paused.

During capture, provider processing, or another operation that cannot safely be
continued from a media position, the square retains hard-stop behavior. Repeat
remains a separate circular-arrow control and replays the most recent utterance
from the beginning.

Playback controls use symbols visually. Every symbol button has a stable
accessible name, title, disabled state, and keyboard behavior. The redundant
Pause button is removed.

## Consequences

Players can suspend narration and continue without losing their place. Stop and
Resume occupy one compact location, while Repeat keeps its distinct restart
meaning. The playback adapter contract now includes pause and resume operations.

An active paused clip retains its media resource until it resumes, completes, or
is explicitly interrupted. Provider work and capture remain cancellable and do
not gain unsafe continuation semantics.

## Alternatives considered

- Keep hard Stop and make Resume restart the clip. That duplicates Repeat and
  does not resume from the stopped position.
- Keep separate Stop, Pause, and Resume controls. This adds visual weight and
  preserves two controls whose former behavior was indistinguishable.
- Seek to the prior position after synthesizing again. This adds latency and a
  new provider request when the browser already has the active media source.

## Validation

Controller tests must prove that active narration calls playback pause, enters
paused state, calls resume, and returns to the original speaking role without an
interrupted playback event. Presentation tests must prove progressive text
reveals no additional words while paused and resumes with its remaining delay.
Browser adapter tests must prove that the same audio element is paused and
replayed. Markup and browser review must confirm symbol controls expose Stop,
Resume, and Repeat names without visible word labels.
