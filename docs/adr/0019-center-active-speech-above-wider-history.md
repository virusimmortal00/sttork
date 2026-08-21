# ADR-0019: Center active speech above a wider history

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: ADR-0018's settled spoken-text height-collapse rule

## Context

ADR-0018 collapsed the spoken-text container after playback so its final line
settled close to the product title. Device review showed that the bounded muted
history then crowded the same upper region, while the active or final spoken
line lost its intended position as the screen's primary focal point. Longer
history lines also wrapped within the active line's narrow reading width.

The activity-motion decision in ADR-0018 remains sound. This record changes only
the spatial relationship between the active spoken line and its visual history.

## Decision

The active spoken line retains a narrow, readable measure in the central focal
area during and after playback. The muted newest-first history occupies a
separate, wider band below it with a responsive vertical gap. History remains
bounded and scrollable, and it stays hidden from assistive technology as part of
the existing decorative spoken-text surface; the complete attributed Transcript
remains the accessible record.

The settled presentation no longer collapses its reserved focal height. Narrow
viewports reduce both the vertical separation and history height so playback
controls remain reachable without horizontal overflow. The bounded history
viewport reserves that final height even while empty; arriving rows animate
inside it and never resize the surrounding grid or displace playback controls.
The active row itself has a substantial responsive minimum rather than relying
only on the overall conversation height, allowing it to use available viewport
space while keeping its text vertically centered.

## Consequences

Current speech is easier to distinguish from prior lines, and longer history
entries wrap less often. The spoken-text surface uses more vertical space after
playback than ADR-0018 allowed. This is intentional, but it requires desktop and
narrow-screen review to ensure contextual controls remain visible.

Visible speech continues to replace the decorative activity indicator. Audio
lifecycle, canonical text, transcript attribution, reduced-motion behavior, and
engine state are unchanged.

## Alternatives considered

- Keep the collapsed settled layout. This preserves vertical compactness but
  continues to crowd active and historical speech together.
- Widen both active speech and history equally. This reduces wrapping but makes
  the focal line harder to scan and weakens the hierarchy.
- Put history above the active line. This lets old text claim the first reading
  position and recreates the observed competition.

## Validation

Presentation coverage must prove that the active and history regions have
distinct responsive widths, the history follows the active line with an explicit
gap, settled playback retains the focal height, the empty and populated history
use the same reserved viewport height, and narrow viewports compress the layout
without horizontal overflow. Browser review should cover active and settled
Guide and Narrator speech at desktop and phone widths, plus keyboard access to
playback controls and reduced motion.
