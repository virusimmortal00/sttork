# ADR-0021: Switch the primary input between voice and text

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers
- Supersedes: the transcript-modal placement of accessible text input

## Context

The initial shell placed text entry at the bottom of the transcript modal. That
made an equivalent input transport look like a transcript utility, required a
modal round trip before every typed turn, and obscured that typed language
passes through the same Dungeon Guide policy as speech.

Voice remains the product's primary interface, but a player who cannot or does
not want to use a microphone needs an equally direct, legible input choice.

## Decision

After the story-opening gate reaches a terminal state, the primary play surface
shows a two-button `Voice`/`Text` input-mode switch. Voice is selected by
default when microphone capture is available. Voice mode shows the explicit
capture control; Text mode replaces it with a compact message composer. Enter
submits a typed turn and Shift+Enter may insert a line break.

Both transports enter the same normalized final-transcript boundary and the same
guide grounding, hint, command-validation, engine, event, and narration
pipeline. Text mode is not a parser terminal and cannot bypass the guide.

When microphone capture is unavailable, the shell selects Text and disables the
Voice option without opening the transcript modal. The switch remains hidden
during the authored welcome and story-opening gates so those one-shot actions
retain focus.

A decorative level-style waveform may appear only while capture is active. It is
state-driven rather than a measured amplitude claim, is hidden from the
accessibility tree, and is disabled by reduced-motion preferences. Stable
listening text remains authoritative.

## Consequences

Typed play becomes a first-class input mode without becoming a second gameplay
implementation. The transcript modal returns to inspection and copy/export
responsibilities. Switching modes is session-local and does not cancel active
work; the selector is unavailable while a turn is active.

The UI must preserve keyboard focus, expose pressed state for both mode buttons,
keep a visible label for the composer, and provide an explicit send button in
addition to Enter submission.

## Alternatives considered

- Keep text entry in Transcript. This keeps the default surface smaller but
  makes a primary accessibility path indirect and conceptually misplaced.
- Show voice and text controls simultaneously. This avoids switching but creates
  two competing primary actions.
- Add measured microphone amplitude now. The current capture port does not
  expose analyser samples; implying measured levels would be misleading.

## Validation

Unit and markup tests must prove mutually exclusive presentation, keyboard
submission, microphone-unavailable fallback, story-gate hiding, accessible
pressed states, and reduced-motion behavior. Browser review must verify Voice
and Text switching at desktop and narrow widths, focus transfer to the composer,
Enter submission, no transcript-modal text entry, and no console or layout
errors.
