# ADR-0022: Place operational status below active text

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: ADR-0018's visible preparation-gap treatment

## Context

The shell displayed a role badge and “speaking” near the title while the active
line already carried the same Guide or Narrator attribution. Device review found
the upper status visually disconnected from the prose and redundant with its
role tag.

ADR-0018 also hid all activity animation whenever the visual conversation was
present, including the quiet preparation gap before the next spoken line. That
gap benefits from a restrained indication that work is continuing.

## Decision

Role-specific speaking status remains in the polite live region for assistive
technology but is not rendered as a second visible role badge. The active line's
literal role tag is the visible attribution.

When the visual conversation is present, an active focal line always has visual
priority. Operational processing or reconnecting status remains hidden while
that line contains content, including throughout its exit transition. If work is
still pending once the active line has fully left, status appears as a compact
subordinate line in the reserved row below the now-empty focal area, with a
small three-dot animation. It is also hidden during audible Guide or Narrator
playback and in settled, ready, paused, blocked, and ended states. The original
upper status reservation collapses while the conversation is visible.

The subordinate status is `aria-hidden`; the existing live region remains the
only accessible status announcement. Reduced-motion preferences remove its
animation while leaving its text visible.

Before any visual conversation exists, startup, permission, listening, and
processing continue to use the ordinary status area and appropriate activity
feedback.

## Consequences

The title region is quieter and the active prose owns its attribution. The
processing cue never competes with content already under focused reading and
appears only after that content is exhausted, without adding a second
live-region announcement or shifting the layout.

ADR-0018 still governs redundant motion during audible playback, but no longer
prohibits the small subordinate cue during a processing gap.

## Alternatives considered

- Remove all visible status. This is visually quiet but makes provider latency
  look like a stalled interface.
- Keep the upper speaking badge. This preserves the current implementation but
  duplicates role information.
- Show the subordinate cue during speech. The word reveal already communicates
  progress, so another animation would remain redundant.

## Validation

Presentation tests must prove that speaking status remains accessible, the upper
status is visually hidden with active conversation, only processing and
reconnecting project into the subordinate cue, active focal content suppresses
that cue through its exit transition, and reduced motion disables its animation.
Browser review must cover active speech, the processing gap after an exhausted
line, settled text, and narrow-screen layout without horizontal overflow.
