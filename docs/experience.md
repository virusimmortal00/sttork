# Voice-First Experience

## Status

This document defines the product and interaction contract for the first
playable Zork Voice experience. The default interface is voice-first and
eyes-free. Visible text remains available as an accessibility, troubleshooting,
and development surface; it is not a separate gameplay engine or the default
presentation.

## Product principle

> Voice is the interface. The screen is optional context.

A player should be able to begin, play, ask the Dungeon Guide for help, save,
pause, resume, and recover from ordinary misunderstandings without reading the
screen. The screen should feel quiet when it is used: it communicates system
state, not a terminal full of prose.

## Experience goals

- Make natural spoken intent feel more important than memorizing parser syntax.
- Preserve the original game's prose and rules beneath the voice layer.
- Make the narrator and Dungeon Guide unmistakably different roles.
- Keep ordinary play possible with near-zero visible text or menu navigation.
- Provide complete captions, transcript inspection, keyboard access, and debug
  evidence on demand.
- Make listening, processing, speaking, interruption, and failure states legible
  without exposing implementation complexity.

## Non-goals

- A graphical map, illustrated world, character avatars, or animated cutscenes.
- A persistent text-adventure terminal in the default view.
- AI-generated replacement prose for Z-machine output.
- Always-listening microphone access without explicit player control and visible
  state.
- A separately marketed text-only version. Optional text input is an
  accessibility and QA accommodation that uses the same guide and engine
  pipeline.

## Default screen

The default screen contains no transcript and no game prose. It has:

- a near-black, low-detail background;
- one central state indicator with a non-color-only change for idle, listening,
  processing, guide speech, narrator speech, paused, and error states;
- a compact microphone control that is reachable by touch and keyboard;
- a discoverable settings/transcript control that may recede when inactive;
- an accessible status region, even when no text is visually rendered.

Controls appear on focus, pointer movement, tap, or a relevant error, then
recede. No important state is communicated by color or animation alone.
Reduced-motion mode replaces pulsing and waveform effects with discrete state
changes.

## Display-state projection

The interaction state machine in `architecture.md` is canonical. The experience
reduces it and related provider/audio events into a coarser display state; this
type is a UI projection, not a second session state machine.

```ts
type ExperienceDisplayState =
  | "booting"
  | "ready"
  | "listening"
  | "processing"
  | "guide-speaking"
  | "narrator-speaking"
  | "paused"
  | "reconnecting"
  | "blocked"
  | "ended";
```

Only the projection reducer derives this state from canonical events. Provider
callbacks emit events through the session orchestrator; they do not directly
manipulate the interface.

Expected high-level display transitions:

```text
booting -> ready -> listening -> processing
processing -> guide-speaking -> ready
processing -> narrator-speaking -> ready
processing -> guide-speaking -> narrator-speaking -> ready
any active state -> paused -> ready
any provider-dependent state -> reconnecting -> previous safe state
any state -> blocked -> ready | ended
ready -> ended
```

The UI must not show `ready` while capture is active or show `listening` while
audio is being transmitted without the player's knowledge.

## First-run flow

The first run should be brief and playable without a visual tutorial:

1. Ask for microphone access immediately before it is needed, with a concise
   explanation.
2. Let the player choose or confirm a configured provider connection.
3. Play short samples that establish the narrator voice, guide voice, and
   listening cue.
4. Teach three controls by voice: how to speak, “stop,” and “help.”
5. Ask whether captions should remain visible and whether proactive hint offers
   are allowed.
6. Begin the game and narrate the exact opening output.

Returning players skip the tutorial unless audio output, microphone access, or
provider configuration has changed.

## Input model

The implementation baseline and first vertical slice use explicit capture rather
than an always-open microphone. Whether explicit capture or measured
voice-activity detection becomes the public-launch default remains a decision
gate; changing the baseline requires privacy, cost, false-activation, and
interruption evidence plus a recorded project decision.

- **Hold to talk:** press and hold the primary control or keyboard shortcut,
  speak, then release.
- **Tap to talk:** tap once to begin and again to submit; silence timeout may
  submit after an audible warning.
- **Barge-in:** activating capture while either role is speaking immediately
  interrupts playback and begins a new utterance.

Hands-free voice activity detection may be added later as an opt-in setting with
a persistent listening indicator and clear privacy behavior. It must use the
same interaction and event contracts.

Silence, accidental activation, and background noise do not produce game
commands. Low-confidence command-bearing words trigger spoken confirmation as
defined by the guide policy.

## Audio roles

### Narrator

The narrator reads the exact Z-machine response. Pronunciation hints, whitespace
normalization, and expansion of non-semantic formatting are allowed; paraphrase
and embellishment are not.

### Dungeon Guide

The guide acknowledges intent when useful, asks clarifying questions, explains
available command forms, recalls observed facts, and gives spoiler-controlled
hints. It never speaks as if a proposed action succeeded before the engine
confirms it.

### System voice and cues

Short nonverbal cues identify capture start, capture end, interruption,
reconnecting, and a recoverable error. System explanations use the guide voice
but are emitted through the canonical `system.*` event family so transcripts and
diagnostics identify them correctly.

Narrator and guide should use distinct voices. If a provider supports only one
acceptable voice, distinguish them with delivery settings and a brief transition
cue. Do not rely on stereo position, pitch, or color as the only distinction.

Audio behavior:

- Never play narrator and guide speech simultaneously.
- Queue exact engine narration ahead of optional guide commentary unless
  clarification must occur first.
- Cancel queued, no-longer-relevant commentary after a barge-in.
- Preserve interrupted content so “repeat that” can replay it from the
  beginning.
- Duck nonessential ambience during speech; ambience is optional and off by
  default.
- Apply speech rate independently to narrator and guide while maintaining a
  global shortcut.

## Turn choreography

For a straightforward action:

1. The listening cue sounds and capture begins.
2. Capture ends; the state changes to processing immediately.
3. The guide may give a short noncommittal acknowledgement.
4. A grounded parser command is executed.
5. The narrator speaks the exact engine response.
6. The experience returns to ready.

For an ambiguous action, no parser command is executed. The guide asks one
concise question, the experience returns to listening when the player activates
capture, and the answer is correlated with the pending intent.

For a player question, the guide answers without generating an engine turn
unless an observation command is necessary and the player has agreed to it.

## Meta voice controls

These controls are part of the application, not Zork parser commands. Common
variants should be recognized before the general guide decision where practical.

| Player intent                         | Required behavior                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| “Stop” / “quiet”                      | Stop unsubmitted capture, safely cancellable provider work, and current/queued speech; never reverse an accepted engine command. |
| “Repeat that”                         | Replay the most recently interrupted or completed guide/narrator utterance, preserving its role.                                 |
| “Repeat the room”                     | Replay the latest engine observation or room description.                                                                        |
| “Pause”                               | Stop capture and playback, preserve the session, and enter paused state.                                                         |
| “Resume”                              | Return to ready without replaying content unless requested.                                                                      |
| “Slower” / “faster”                   | Adjust subsequent speech in bounded increments and confirm with a short sample or cue.                                           |
| “What did you hear?”                  | Speak the latest transcript and interpretation without executing it again.                                                       |
| “Help” / “what can I say?”            | Explain contextual examples grounded in observed state.                                                                          |
| “Show transcript” / “hide transcript” | Toggle the visible transcript without changing gameplay.                                                                         |
| “Debug on” / “debug off”              | Toggle only when debug features are enabled for the build/user.                                                                  |

Destructive or state-changing requests such as restart, restore, overwrite save,
discard, attack, or quit follow the guide's clarification policy rather than
this immediate-control table.

## Event projection

The versioned `EventEnvelope` and semantic event families in `architecture.md`
are the sole canonical, persisted domain event schema. The experience package
consumes that ordered stream and derives typed, disposable projections for the
current screen, audio queue, transcript, accessibility tree, and debug panel. It
does not append or persist a competing `ExperienceEvent` stream.

An experience projection retains the canonical event IDs and sequence range that
produced it:

```ts
interface ExperienceProjection<TKind extends string, TData> {
  kind: TKind;
  sourceEventIds: readonly string[];
  throughSequence: number;
  data: TData;
}

type StatusProjection = ExperienceProjection<
  "status",
  {
    state: ExperienceDisplayState;
    activeRole?: "guide" | "narrator" | "system";
    recoverableAction?: string;
  }
>;

type TranscriptItemProjection = ExperienceProjection<
  "transcript-item",
  {
    role: "player" | "guide" | "game" | "system";
    text: string;
    command?: string;
    delivery: "pending" | "speaking" | "interrupted" | "complete" | "failed";
  }
>;
```

Canonical-to-experience mapping is explicit:

| Canonical event families                                                     | Experience projections                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `session.*`, `provider.*`, `system.*`                                        | Session status, connection recovery, and accessible notices                                                         |
| `audio.capture.*`, `audio.playback.*`                                        | Listening/speaking state, control state, and interruption feedback                                                  |
| `transcript.final`                                                           | Player transcript item and guide input; partial transcripts remain ephemeral unless diagnostic retention is enabled |
| `guide.decision.*`, `guide.clarification`, `guide.explanation`, `guide.hint` | Guide role item, pending clarification, and debug decision detail                                                   |
| `engine.command.*`, `engine.output`                                          | Command item, exact game item, narrator request, and engine-turn debug detail                                       |
| `narration.*`                                                                | Audio queue and delivery state for an existing guide or engine source event                                         |
| `save.*`                                                                     | Checkpoint/recovery status and debug metadata                                                                       |

Projection reducers are pure and replayable. They may hide information but may
not change canonical text, reorder source events, or infer game facts from
rendered strings. Reloading a canonical event prefix must produce the same
transcript and accessibility projections. Provider-native payloads stay in
short-lived adapter diagnostics, and credentials are never canonical events or
projection fields.

## Visible transcript mode

The optional transcript is a semantic rendering of the event stream. It shows,
with clear role labels:

- final player transcript;
- the grounded command sent to the engine;
- exact game output;
- guide questions, explanations, and hints;
- interrupted, retried, or failed speech status when relevant.

Partial transcription is hidden by default to reduce distraction but may be
enabled. Corrections do not rewrite historical events; they append a correction
linked to the original event.

Transcript mode supports adjustable type size, line spacing, contrast, caption
duration, role labels, and copy/export controls. Opening or closing it does not
pause or branch gameplay.

Text input may be enabled as an accessibility or test accommodation. Submitted
text is normalized at the same semantic boundary as `transcript.final` and
receives the same guide grounding, hint policy, and engine execution behavior as
speech. It does not bypass the guide or become a separate save format.

## Accessibility requirements

- Maintain semantic live regions for current system status, guide speech, and
  narrator speech even when visible captions are off.
- Provide keyboard equivalents for capture, stop, repeat, pause, transcript, and
  settings.
- Do not require hold gestures; tap-to-talk is always available.
- Do not communicate role or state through color, motion, stereo position, or
  sound alone.
- Support visible captions, high contrast, large text, reduced motion, mono
  audio, and independently adjustable speech rates.
- Preserve focus when controls recede and return focus predictably when
  transcript or settings panels close.
- Announce microphone and provider failures with an accessible recovery action.
- Permit text input for players who cannot speak and visible output for players
  who cannot hear.
- Ensure screen-reader output does not duplicate simultaneous TTS by offering a
  clear “screen reader manages speech” preference.

Conformance targets WCAG 2.2 AA for all visible and interactive surfaces.
Accessibility settings are local-first, exportable with player preferences, and
available before gameplay begins.

## Debug mode

Debug mode is deliberately separate from the accessible transcript. It may
expose:

- raw and final transcription with confidence and timing;
- provider and model selected for each stage;
- guide decision branch, structured payload, validation outcome, and confidence;
- candidate command affordances and grounded referents;
- commands sent to the Z-machine and exact responses;
- observed-memory additions and provenance;
- event IDs, engine revisions, queue state, latency, retries, and estimated
  usage;
- save/checkpoint identifiers and provider error codes.

Debug mode must never display access tokens, authorization headers, raw OAuth
codes, secret URLs, or unredacted account identifiers. Raw audio playback/export
is available only if the player explicitly enabled recording for the session.

Debug mode can export a deterministic, redacted replay fixture containing
events, adapter outcomes, engine checkpoint metadata, and expected assertions.
Export is an explicit action and excludes credentials.

## Interruption and concurrency

There is one active player interaction at a time. Starting a new utterance while
processing cancels guide generation when cancellation is safe; it does not
cancel an engine command that has already been accepted. The orchestrator
reports the accepted result before acting on the new request.

Each engine command includes the expected engine revision and an idempotency
key. Late provider responses for an older interaction are discarded. Speech
queue entries reference their source event, so a restore, retry, or interruption
can invalidate stale audio without deleting the event history.

“Stop” immediately ends unsubmitted capture and playback and cancels provider
work only while cancellation is safe. It does not cancel, reverse, or conceal an
engine command that was already accepted; the confirmed result is reported
before another action. The guide should explain this commit-boundary distinction
if it matters.

## Recovery behavior

The experience remains quiet but explicit when something fails:

- **No speech detected:** play the recoverable cue and return to ready; do not
  invoke the guide.
- **Uncertain transcript:** the guide repeats only the uncertain interpretation
  and asks for confirmation.
- **Network/provider interruption:** move to reconnecting, preserve the engine
  checkpoint, retry within a bounded policy, then offer another configured
  provider.
- **Authentication or quota problem:** preserve progress and open a minimal
  accessible connection panel. Do not expose provider details in ordinary speech
  beyond what is actionable.
- **Narration failure:** retain the utterance for retry, expose its text in an
  automatically offered recovery card, and keep screen-reader access intact.
- **Microphone denied/unavailable:** provide concise steps to restore permission
  and expose accessibility text input.
- **Engine failure:** stop capture and guide actions, check the command receipt,
  and atomically restore the last verified checkpoint when commit status is
  known. Report whether the last command committed; require an explicit restore
  or restart choice when status or compatibility is uncertain.

No error automatically substitutes model-generated prose for missing Z-machine
output.

## Preferences and persistence

Persist locally by default:

- capture mode;
- narrator and guide voices;
- narrator and guide speech rates;
- cue and ambience volumes;
- caption/transcript, contrast, text size, and reduced-motion settings;
- preferred hint ceiling and proactive-hint choice;
- selected provider profile, excluding raw credentials from ordinary application
  storage;
- paired engine checkpoint and guide-memory checkpoint.

Cloud synchronization, when introduced, is optional and versioned. Restoring a
checkpoint restores its matching event cursor and guide memory so the interface
never displays knowledge from another branch.

## Performance budgets

These are product targets measured at the browser boundary and reported by
provider profile:

- capture-state feedback: within 100 ms of player input;
- barge-in playback stop: p95 within 250 ms;
- processing-state feedback: within one animation frame after capture
  submission;
- first audible acknowledgement after final transcript: target p50 at or below
  1.5 seconds and p95 at or below 3.5 seconds for qualified profiles;
- engine output to narration audio: target p50 at or below 1 second;
- transcript/event update after engine output: within 100 ms;
- no overlapping role playback and no duplicated engine command under retry.

A provider profile that cannot meet the conversational target may remain
available with a clear “higher latency” label, but it must still meet
correctness and interruption requirements.

## Experience acceptance criteria

The first vertical slice is ready when:

1. A first-time player can start and complete the slice without reading the
   screen.
2. Default play shows no transcript, player speech, command, or game prose.
3. The player can hear which speech belongs to the original game and which
   belongs to the guide.
4. Direct, ambiguous, informational, and hint-seeking utterances follow the
   guide contract.
5. “Stop,” “repeat,” “pause,” “resume,” “help,” speed changes, and transcript
   toggling work by voice and keyboard.
6. Barge-in stops speech without duplicating or silently cancelling an accepted
   engine command.
7. Transcript mode can reconstruct every player, guide, command, engine,
   narrator, and error turn in order.
8. Debug mode can explain a failed turn without exposing credentials.
9. Screen-reader, keyboard-only, visible-caption, reduced-motion, and text-input
   paths complete the same slice.
10. Provider disconnect, TTS failure, and microphone denial preserve the last
    verified game state and offer an accessible recovery path.
11. OpenAI Realtime and each enabled OpenRouter or Hugging Face profile pass the
    same experience and guide conformance fixtures.
