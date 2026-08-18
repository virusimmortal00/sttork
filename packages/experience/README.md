# Experience

This package owns pure minimal, accessibility, transcript, and debug
projections. Projections consume canonical events and cannot call the engine or
providers directly.

The initial reducer preserves exact player/guide/game attribution, source event
IDs, sequence order, playback delivery state, and a coarse display state. It
does not decide whether transcript or debug surfaces are visible; those are
local accessibility/developer preferences over the same projection.
