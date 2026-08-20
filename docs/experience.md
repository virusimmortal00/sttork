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
- one bounded, newest-first list of recent canonical commands; the active
  request is emphasized and confirmed prior commands remain slightly muted;
- a compact microphone control that is reachable by touch and keyboard;
- a discoverable settings/transcript control that may recede when inactive;
- an accessible status region, even when no text is visually rendered.

Controls appear on focus, pointer movement, tap, or a relevant error, then
recede. No important state is communicated by color or animation alone.
Reduced-motion mode replaces pulsing and waveform effects with discrete state
changes.

Transcript, voice preferences, and developer debug are utilities rather than
gameplay controls. Their triggers live in a subdued page footer outside the
centered play surface, and each opens a labeled modal without reflowing or
displacing the active game. Opening a modal moves focus inside it; closing by
its button, Escape, or backdrop restores focus to its trigger. Transcript keeps
the complete accessible text-input fallback inside the modal.

The command history is governed by
[ADR-0013](adr/0013-persistent-command-history-and-active-only-indicator.md). It
displays only exact canonical commands. The active request comes from
`engine.command.requested`; only a matching `engine.command.committed` enters
the bounded muted history. Rejected, not-submitted, and uncertain requests do
not appear as completed actions. Provider proposals never render in this
surface.

The decorative activity indicator is absent while the player is simply ready,
paused, blocked, or finished. It appears during startup, microphone permission,
listening, and processing/reconnecting. It is hidden whenever visible spoken
text is carrying that same activity context, including the preparation gap
between sequential voices; the spoken-text surface replaces redundant motion
under ADR-0018. Stable status text communicates every state independently of
motion.

Progressive spoken text retains direct references to its bounded active-line
word elements and advances them with at most one scheduled callback. It does not
query the DOM for each word or use paint-heavy blur filters. Stop, interruption,
failure, and replacement cancel that single callback and preserve only text
revealed before the boundary. Reduced-motion presentation schedules no
progressive callbacks, reveals the narration immediately, and keeps the same
role attribution and six-line visual-history bound.

On a fresh session, the first control is an authored role welcome, visually
labeled `ENTER`, as defined by
[ADR-0017](adr/0017-authored-role-introduction-before-story-start.md). It
introduces the Guide and Narrator through two fixed, distinctly attributed lines
without consulting or changing the engine. Completion, interruption, or failure
exposes the distinct `THE STORY BEGINS` action. It is enabled without microphone
permission and does not begin capture. Activating it once publishes the full
authenticated opening engine output at revision zero and requests narrator
speech from it; it is not a parser command and therefore never enters the
canonical-command history. The spoken request may use only the deterministic,
story-pinned whole-line excerpt in
[ADR-0014](adr/0014-story-pinned-spoken-opening-excerpt.md), with the complete
output as the fallback for any identity or text mismatch. While the opening is
being prepared or played, ordinary capture and text submission remain gated and
Stop remains available. After playback completes, is interrupted, or fails, the
primary control becomes the ordinary speaking control, visually labeled `SPEAK`,
and the accessibility text path becomes available. Completion and interruption
show Ready; failure preserves a recoverable blocked state while those ordinary
controls remain usable. Known safe failures replace generic `Action needed` with
an actionable status: browser playback authorization asks the player to tap
Repeat, and the bounded developer profile reports when its request limit has
been reached.

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
booting -> ready (ENTER) -> guide-speaking -> narrator-speaking -> ready (THE STORY BEGINS)
ready (THE STORY BEGINS) -> processing -> narrator-speaking -> ready
processing | narrator-speaking -> ready: opening completes or is interrupted
processing | narrator-speaking -> blocked: opening fails; normal controls remain usable
ready -> listening -> processing
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

Speech synthesis, response download, decoding, and buffering remain
`processing`. The role-specific speaking state begins only when the browser
reports its first `playing` event for that utterance. That boundary emits
`audio.playback.started`; requesting synthesis or invoking `play()` is not
enough. This keeps both the visible indicator and accessible live region aligned
with the browser's closest observable approximation of audible playback.

The browser playback adapter primes one persistent media element synchronously
from an audio-related player gesture, then reuses that element for synthesized
responses. Speech synthesis and download may outlive transient browser
activation, so they must not be followed by first-time playback on a newly
created element. Priming uses a short valid local clip, is silent, makes no
provider request, and emits no semantic playback event. Its readiness promise
must never gate synthesis indefinitely: it is bounded, while the synthesized
element's actual `playing` event remains authoritative. A bounded first-playing
deadline converts a stalled browser media promise into the recoverable playback
authorization path. Stop invalidates pending priming so another explicit player
gesture can retry. While Repeat or a new turn actively retries blocked
narration, Processing and the activity indicator supersede the stale blocked
projection.

## First-run flow

The first run should be brief and playable without a visual tutorial:

1. Complete any required story authentication and provider connection before
   presenting the playable surface.
2. Present `ENTER` without requesting microphone permission. On activation, play
   the fixed ADR-0017 Guide and Narrator introductions in order, keeping their
   source events and visible/accessibility roles distinct.
3. After the welcome completes, is interrupted, or fails, present
   `THE STORY BEGINS`. This second action also remains independent of microphone
   access.
4. On one activation, publish the authenticated boot output as exact
   `engine.output` at revision zero. Request the deterministic ADR-0014 spoken
   selection once in the narrator role, falling back to the complete output on
   any story/build/opening mismatch.
5. After opening playback completes, is interrupted with Stop, or fails, expose
   the ordinary speaking and accessible-text controls. Preserve the exact
   opening in the transcript/accessibility projection in every case. Keep a
   failed opening visibly recoverable with an actionable safe status where one
   is known; do not put it back behind `START STORY`.
6. Ask for microphone access immediately before the first capture, with a
   concise explanation and an equivalent text-input path.
7. Teach “stop” and “help” by voice, reinforce the narrator/guide distinction,
   and ask whether captions and proactive hint offers should remain enabled.

Returning players skip the tutorial unless audio output, microphone access, or
provider configuration has changed.

For the current authenticated Zork I Release 119 tuple, the spoken form is the
following 32-word whole-line excerpt rather than all 67 words in the boot
output:

```text
ZORK I: The Great Underground Empire

West of House
You are standing in an open field west of a white house, with a boarded front door.
There is a small mailbox here.
```

The omitted credits, release metadata, and prompt remain in the exact game
event, transcript, and accessibility projection. The excerpt contains no
generated replacement prose.

`START STORY` is a one-shot session transition. Rapid or repeated activation
does not republish the opening event or synthesize it twice. The opening remains
the most recent narrator source, and its actual spoken selection is retained, so
Repeat can request the same playback again after a completion, interruption, or
failure without advancing the engine or appending another `engine.output`.

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
and embellishment are not. `START STORY` is the sole shorter-prose exception:
ADR-0014 may select reviewed whole original lines for an exact story/build and
known opening. A mismatch reads the complete output, and ordinary turn responses
remain exact.

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

The exact voice IDs are a configurable presentation choice, not part of either
role's semantic identity. First-run samples or cues must make a voice change
feel like an intentional handoff between the Dungeon Guide and the game
narrator, not a provider inconsistency.

Audio behavior:

- Never play narrator and guide speech simultaneously.
- Queue exact ordinary engine narration ahead of optional guide commentary
  unless clarification must occur first. The one `START STORY` selection remains
  governed by ADR-0014.
- Cancel queued, no-longer-relevant commentary after a barge-in.
- Preserve interrupted content so “repeat that” can replay it from the
  beginning.
- Retain at most the latest completed synthesized clip in session memory so an
  exact Repeat can replay locally. Key it by role, exact text, voice, and rate;
  never persist it, and never treat an interrupted or failed clip as complete.
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
capture, and the answer is correlated with the pending intent. In the bounded
opening-area profile, an object-only answer may fill one reviewed pending action
slot only when it exactly names a currently observed object; it is not treated
as an unconstrained new command.

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

type ActionLogItemProjection = ExperienceProjection<
  "action-log-item",
  {
    requestId: string;
    correlationId: string;
    command: string;
    phase: "committed";
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

type StoryStartPhase = "ready" | "starting" | "started";

interface ExperienceProjectionState {
  storyStartPhase: StoryStartPhase;
  storyStartSource?: {
    outputEventId: string;
    correlationId: string;
    narration?: { id: string; requestEventId: string };
  };
}
```

The revision-zero opening `engine.output` moves `storyStartPhase` from `ready`
to `starting`. Only the correlated narrator preparation terminal or playback
terminal moves it to `started`, so replay and live reduction expose the same
control gate. A failed terminal projects `blocked`; the `started` phase still
exposes ordinary controls and Repeat. Safe authorization and request-cap codes
produce actionable status text, while an unclassified failure remains
`Action needed`. Completion, interruption, or preparation cancellation projects
Ready.

Canonical-to-experience mapping is explicit:

| Canonical event families                                                     | Experience projections                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.*`, `provider.*`, `system.*`                                        | Session status, connection recovery, and accessible notices                                                                                                                   |
| `audio.capture.*`, `audio.playback.*`                                        | Listening/speaking state, control state, and interruption feedback                                                                                                            |
| `transcript.final`                                                           | Player transcript item and guide input; partial transcripts remain ephemeral unless diagnostic retention is enabled                                                           |
| `guide.decision.*`, `guide.clarification`, `guide.explanation`, `guide.hint` | Guide role item, pending clarification, and debug decision detail                                                                                                             |
| `engine.command.*`, `engine.output`                                          | Active command cue, bounded committed-command history, exact game item, source-linked narrator request (including the pinned opening selection), and engine-turn debug detail |
| `narration.*`                                                                | Audio queue and delivery state for an existing guide or engine source event                                                                                                   |
| `save.*`                                                                     | Checkpoint/recovery status and debug metadata                                                                                                                                 |

Projection reducers are pure and replayable. They may hide information but may
not change canonical text, reorder source events, or infer game facts from
rendered strings. Reloading a canonical event prefix must produce the same
transcript and accessibility projections. Provider-native payloads stay in
short-lived adapter diagnostics, and credentials are never canonical events or
projection fields.

The live experience state is a bounded working set, not a second copy of the
session record. It retains at most 128 recent transcript items and 256 recent
debug/source-event entries. The complete canonical semantic-event history
remains authoritative. Transcript and debug dialogs render only while open, page
backward through canonical event prefixes, and discard their DOM or serialized
JSON when closed. Paging therefore preserves complete accessible history without
making ordinary turns perform hidden DOM replacement or unbounded JSON
serialization.

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
pause or branch gameplay. Long transcripts are exposed in bounded pages with
Older and Newer controls; moving between pages is a projection-only operation.

Text input may be enabled as an accessibility or test accommodation. Submitted
text is normalized at the same semantic boundary as `transcript.final` and
receives the same guide grounding, hint policy, and engine execution behavior as
speech. It does not bypass the guide or become a separate save format.

## Accessibility requirements

- Maintain semantic live regions for current system status, guide speech, and
  narrator speech even when visible captions are off.
- Keep `START STORY` keyboard operable and enabled before microphone permission;
  activating it must not request or begin microphone capture.
- Provide keyboard equivalents for capture, stop, repeat, pause, transcript, and
  settings.
- Do not require hold gestures; tap-to-talk is always available.
- Do not communicate role or state through color, motion, stereo position, or
  sound alone.
- Keep activity animation decorative and hidden from the accessibility tree;
  update the stable status live region only on a real state change.
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

If opening narration fails or is interrupted, retain its revision-zero
`engine.output`, expose the normal controls, and make Repeat a retry of that
same narrator source and the same excerpt-or-fallback text. Interruption returns
to Ready; failure remains `blocked` with actionable safe status text where
available, or generic `Action needed`, while those controls stay usable. A retry
may issue another synthesis request, but it must not republish the boot output,
advance the engine, reselect narration text, or re-enter the `START STORY` gate.

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
2. `START STORY` publishes the exact authenticated revision-zero opening and
   speaks its deterministic story-pinned excerpt (or full-output fallback)
   without requesting microphone permission, then yields the normal controls
   after a completed, interrupted, or failed playback. Failure retains the
   recoverable blocked status, using actionable safe text where available,
   rather than falsely reporting Ready.
3. Default play shows no transcript, player speech, or game prose; the only
   persistent text is bounded canonical-command history defined by ADR-0013.
4. The player can hear which speech belongs to the original game and which
   belongs to the guide.
5. Direct, ambiguous, informational, and hint-seeking utterances follow the
   guide contract.
6. “Stop,” “repeat,” “pause,” “resume,” “help,” speed changes, and transcript
   toggling work by voice and keyboard.
7. Barge-in stops speech without duplicating or silently cancelling an accepted
   engine command.
8. Transcript mode can reconstruct every player, guide, command, engine,
   narrator, and error turn in order.
9. Debug mode can explain a failed turn without exposing credentials.
10. Screen-reader, keyboard-only, visible-caption, reduced-motion, and
    text-input paths complete the same slice.
11. Provider disconnect, TTS failure, and microphone denial preserve the last
    verified game state and offer an accessible recovery path.
12. OpenAI Realtime and each enabled OpenRouter or Hugging Face profile pass the
    same experience and guide conformance fixtures.
