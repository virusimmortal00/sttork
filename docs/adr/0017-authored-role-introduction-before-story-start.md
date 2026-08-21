# ADR-0017: Add an authored role introduction before story start

- Status: accepted
- Date: 2026-08-20
- Owners: maintainers

## Context

The prior first-run flow moved directly from a fresh playable surface to
`START STORY`. That minimized delay, but it asked a new player to infer the
difference between the Dungeon Guide and Narrator while the canonical Zork
opening was already underway. Device review found that transition abrupt and
left the Guide's purpose unclear.

The introduction cannot be generated per session or represented as engine
output. Either approach would add unnecessary latency and cost, and the latter
would violate the attribution boundary between project-authored experience copy
and original game prose.

## Decision

A fresh playable session begins with one explicit `ENTER` action. That player
gesture prepares and plays these two fixed, project-authored messages in order:

- Guide: “Hello traveler. I'm your Dungeon Guide. I can help you find the right
  words, explain your options, and offer hints when invited, without taking the
  adventure from you. Our Narrator will give voice to the world itself.”
- Narrator: “Greetings. I am the Narrator. I speak for each place, discovery,
  and consequence, exactly as the story reveals it. When you are ready, the
  threshold awaits.”

Each message is an accessible `experience.role-introduction` event with an
explicit `guide` or `narrator` role. Its `narration.requested` event points back
to that authored source. It is not an `engine.output`, Guide model response, or
observed-world fact, and it cannot mutate or inspect the Z-machine.

Stop may interrupt the welcome. Completion, interruption, preparation failure,
or playback failure all advance to a distinct, keyboard-operable
`THE STORY BEGINS` gate so optional welcome audio can never trap the player.
Activating that gate invokes the existing one-shot authenticated opening flow
defined by ADR-0014. The opening event, selected prose, engine revision, and
ordinary gameplay gate remain unchanged.

The visible spoken-text surface may show both messages word by word with their
roles. The complete accessible transcript retains the same attribution even when
audio is interrupted or unavailable. No microphone permission is required for
either pre-story action.

## Consequences

The player now makes two deliberate first-run gestures: one to meet the voices
and one to begin canonical game narration. The welcome adds up to two bounded
speech requests, but no reasoning request and no engine operation. Fixed copy
makes its latency, cost, spoiler content, and regression behavior reviewable.

The experience presentation has pre-story phases for welcome, introduction, and
story readiness. The canonical projection's `ready` / `starting` / `started`
story phase still describes only publication and narration of the authenticated
game opening; authored welcome events do not impersonate that state transition.

## Alternatives considered

- Continue directly to `START STORY`. This is faster but does not establish the
  two voices or explain their different authority.
- Generate a bespoke welcome. This adds cost, latency, and nondeterministic
  claims before the player has done anything.
- Put the explanation on screen only. This conflicts with the voice-first
  first-run requirement and excludes eyes-free play.
- Fold the welcome into Zork's opening. This would blur project-authored prose
  with canonical engine output.

## Validation

Hermetic tests must prove that the two source events remain ordered and
attributed, each narration request links to its own source, duplicate activation
does not duplicate events, and no engine inspection, command, or revision change
occurs. Presentation tests must prove Stop is available only while
welcome/opening audio is active, `THE STORY BEGINS` is a distinct enabled gate,
and capture/text input remain unavailable until the opening reaches a terminal
outcome.

Browser verification must cover keyboard activation, Guide-to-Narrator status
and transcript transitions, interruption, reduced motion, and the separate
story-start gesture.
