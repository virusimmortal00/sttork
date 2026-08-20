# ADR-0018: Let visible speech replace redundant activity motion

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Amends:
  [ADR-0013](0013-persistent-command-history-and-active-only-indicator.md)

## Context

ADR-0013 keeps the decorative activity indicator visible during audible
playback. The experimental word-by-word spoken-text surface now makes that same
active state visually explicit. Device review found the animated three-dot
indicator redundant and visually disconnected when it appeared between the
speaker label and the words being spoken.

The spoken-text container also retained its active minimum height after
playback, while the now-idle status feedback retained its own height. Together
they left a large empty band between the product title and the final spoken
line.

## Decision

Whenever the spoken-text surface is visible, it replaces the decorative activity
indicator. This includes an actively revealing line, a settled line, and the
preparation gap between sequential Guide and Narrator clips. The role-specific
or compact operational status label remains visible and accessible, so
attribution and processing state do not depend on motion or text alone.
Processing before any spoken line appears may still use the indicator.

`Processing` is presented as a compact operational label rather than the
headline-scale default status. It remains readable and available through the
same polite live region.

The spoken-text presentation records whether it is `active` or `settled`. Once
playback completes, is interrupted, or fails, the settled presentation releases
the active transcript and status-feedback minimum heights and aligns its final
line at the start of the remaining content area. Beginning another playback
restores the active layout.

This is a presentation-only change. Audio lifecycle events, narration text,
accessible transcript, engine state, and playback control behavior are
unchanged. Reduced-motion mode continues to disable all decorative animation.

## Consequences

Audible playback no longer combines two simultaneous visual activity signals.
The final line settles closer to the product title and leaves more room for
controls and bounded history. CSS depends on the same browser-level `:has()`
support already used by the shell.

## Validation

Presentation coverage must prove that any visible speech hides the activity
indicator, Processing uses the compact treatment, visible speech collapses the
empty status-feedback reservation, and settled speech releases the transcript
minimum height. Browser verification must compare both active and completed
playback at desktop and narrow widths, with reduced motion still conveying role
and state without animation.
