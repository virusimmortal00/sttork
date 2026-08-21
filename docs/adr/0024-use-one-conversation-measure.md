# ADR-0024: Use one conversation measure

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: ADR-0019's distinct active-line and history widths

## Context

ADR-0019 capped the active line at 36 rem and allowed history to reach 64 rem.
The vertical separation, type scale, and muted color already establish a strong
active-versus-history hierarchy. Device review showed that the additional width
contrast made the conversation feel disconnected: active prose wrapped early
while its history stretched across a much wider band.

## Decision

The active line, its containing conversation region, and the bounded muted
history use the same responsive measure, capped at 50 rem. This is the midpoint
between the former 36 rem active measure and 64 rem history measure.

The active line remains central and visually prominent. History remains lower,
muted, bounded, and scrollable. This decision changes horizontal measure only;
it does not flatten role attribution, type scale, vertical hierarchy, or
accessibility projections.

## Consequences

Active text wraps less often, history is easier to scan, and their left and
right edges align. History may wrap slightly more than under ADR-0019, but the
50 rem measure remains substantially wider than the former active line.

## Alternatives considered

- Keep the 36/64 rem split. This preserves the earlier hierarchy but retains the
  visible disconnection found in device review.
- Make both regions 36 rem. This keeps a compact reading measure but gives up
  useful space for active narration.
- Make both regions 64 rem. This minimizes wrapping but lets prose become too
  broad on desktop displays.

## Validation

Markup tests must enforce one 50 rem cap for the container, active line, and
history. Browser review must confirm aligned edges at desktop and narrow widths,
with no horizontal overflow and with active/history hierarchy still legible.
