# ADR-0020: Focus committed commands in the visual conversation

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: ADR-0013's separate command-list presentation

## Context

ADR-0013 introduced a persistent command list below the primary controls so the
player could verify what the engine received. Device review found that this
separate panel competed with the Guide/Narrator conversation and made a newly
accepted command feel less important than the prose it caused.

ADR-0019 already establishes a central focal line followed by wider muted
history. A canonical command is part of that same turn narrative, but it must
remain unmistakably distinct from speech and must never expose an unvalidated
provider proposal.

The final normalized player transcript is also part of that turn narrative.
Without a short focal confirmation, a voice player cannot verify what the system
heard before interpretation begins, while leaving it in a separate panel would
split the same visual sequence.

## Decision

Only the exact command from `engine.command.committed` enters the visual
conversation. It first occupies the central focal line with a light-gold
monospace treatment, slightly enlarged centered text, no visible role tag, and a
brief restrained entrance animation. It retains a short minimum focal dwell so
the entrance completes and the accepted action registers before dissolving. A
Guide or Narrator line that becomes ready during that dwell queues behind it.
The command then moves into the same bounded newest-first history, where the
explicit light-gold `COMMAND` tag returns. The separate visible recent-command
panel is removed.

The earlier `engine.command.requested` boundary remains available through the
visually hidden polite command cue so assistive technology receives timely
confirmation without reading the decorative conversation twice. Rejected,
not-submitted, uncertain, and provider-proposed commands never appear in the
visual conversation.

The exact normalized text from `transcript.final` first occupies that focal line
without progressive word reveal. It uses an explicit warm-orange `PLAYER` role
tag, remains briefly for recognition, and then dissolves into the same history
before the resulting Guide, command, or Narrator line takes focus. The color is
redundant with the literal role label. Partial transcription and raw audio never
enter this decorative surface.

A standalone parenthetical line within exact Narrator game output represents an
implicit parser action such as `(Taken)`. The visual projection gives that line
an `ACTION` role with a muted lavender accent and a short focal dwell before it
settles into history. When `(Taken)` follows a correlated committed object
command, the visual projection names that command's target—for example,
`Took leaflet.`—rather than displaying the context-free parenthetical. This is a
presentation enrichment only: the exact `(Taken)` text remains within its
canonical `engine.output`, and it never becomes or impersonates an
`engine.command.committed` event. If no trustworthy command target is available,
the projection preserves the original text instead of guessing.

Reduced-motion mode removes the command entrance animation. The untagged focal
line remains redundant with the visually hidden polite command cue, while
monospace uppercase typography distinguishes it from prose without color. The
historical line retains the literal `COMMAND` role. A command earcon may be
evaluated later, but this decision neither adds nor requires sound; any future
earcon must be optional and redundant with visible and accessible state.

## Consequences

The player sees both what the system heard and the accepted action at the main
point of focus before hearing its consequence. Player, command, implicit action,
Guide, and Narrator history therefore reads as one attributed turn sequence. The
shared six-line bound means older entries age out together rather than
maintaining separate visual limits.

The experience projection may continue retaining its bounded canonical action
data for replay, debugging, and trust checks even though the default shell no
longer renders a separate action-log component.

## Alternatives considered

- Keep the separate command panel. This preserves independent capacity but
  continues to split attention across two histories.
- Focus `engine.command.requested`. This appears slightly earlier but could
  visually promote a command the engine later rejects.
- Show provider proposals. This would blur proposal and authority boundaries and
  is prohibited.
- Add the earcon now. The sound has not yet passed device, preference, and
  accessibility review.

## Validation

Tests must prove that both smoke shells remove the separate action-log markup,
only committed events invoke command presentation, the main and historical
command and player roles retain non-color labels, player text is revealed
atomically, the command animation disappears under reduced motion, and all roles
share the existing bounded history. Tests must also prove that correlated
`(Taken)` output names the committed command target while uncorrelated or
unrecognized parentheticals remain exact. Browser review must exercise a final
transcript and committed command at desktop and phone widths and confirm that
their focal states precede Narrator playback without duplicating screen-reader
output.
