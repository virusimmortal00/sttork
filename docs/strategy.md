# Zork Voice: Product and Technical Strategy

Status: initial architecture baseline  
Audience: maintainers, contributors, product designers, and reviewers

## Product thesis

Zork Voice is a free, open-source, voice-native way to experience the classic
game through an AI Dungeon Guide. The player should be able to speak in natural
language, hear the world respond, ask what is possible, and request help without
having to learn a 1970s parser or watch a terminal.

The original game remains the world. The AI is an interpreter and companion, not
an alternate game engine. It may translate intent, explain parser behavior, ask
clarifying questions, recall previously observed facts, and provide
spoiler-controlled hints. It may not invent rooms, objects, outcomes, inventory,
score, or state changes.

The primary interface is audio. The default screen is deliberately quiet: a
small status indicator and essential controls, with no persistent prose. A
visible transcript/caption view is a first-class accessibility and debugging
surface over the same event stream. It is not a separate implementation of the
game.

## Product principles

1. **The game is authoritative.** Every consequential action is executed by the
   deterministic Z-machine. The guide never edits game state.
2. **Voice is the interface; the screen is optional context.** A player should
   be able to complete an ordinary session without reading the screen.
3. **Help preserves discovery.** Syntax help, contextual guidance, hints, and
   complete solutions are different permission levels. The guide starts with the
   least revealing response that can help.
4. **Interpret conservatively.** Clear, reversible intent can be executed.
   Ambiguous, destructive, or multi-step intent is clarified or confirmed.
5. **Original prose stays original.** Engine output is labeled and narrated as
   game output, never silently rewritten by a model. Guide speech is a distinct
   role.
6. **Providers are replaceable.** Speech recognition, guide reasoning, and
   narration depend on capability-based ports, not a provider-specific domain
   model.
7. **Privacy and cost are product behavior.** Recording, retention, connected
   accounts, model choice, and estimated usage must be understandable and
   controllable.
8. **Accessibility is not a fallback.** Captions, screen-reader announcements,
   keyboard-operable controls, repeat/stop, speech-rate controls, and non-color
   status cues ship with the voice experience.

## Goals

### Player experience

- Let a player speak ordinary intentions such as “look for another way into the
  house” rather than requiring exact parser syntax.
- Let the guide execute an unambiguous command, ask a concise clarification, or
  explain why the requested action is not currently available.
- Narrate exact game responses and clearly distinguish the narrator from the
  guide through voice, earcons, or both.
- Support “repeat,” “pause,” “resume,” “stop speaking,” “what can I do?”, “what
  happened?”, and spoiler-leveled hint requests as voice controls.
- Preserve a session across reloads and restore both the engine and the guide’s
  player-visible memory at a command boundary.
- Offer an optional visible mode showing the player transcript, interpreted
  command, exact engine response, and guide speech.

### Engineering

- Run the Z-machine behind a small, versioned adapter with one mutation path.
- Represent interaction as typed, ordered events so audio, captions, debug
  views, persistence, and tests observe the same facts.
- Support a split voice pipeline (speech-to-text, guide model, text-to-speech)
  and a realtime provider without changing game-domain code.
- Make provider profiles testable against the same command-understanding,
  spoiler, latency, cancellation, and recovery suites.
- Keep provider credentials out of browser storage and out of logs in the hosted
  deployment.
- Keep the repository usable by self-hosters without requiring proprietary
  infrastructure, while accepting that hosted inference accounts and usage may
  have provider costs.

## Non-goals

- Reimplementing, remastering, expanding, or “improving” Zork’s world logic.
- Allowing a language model to simulate actions that the Z-machine rejects.
- A conventional text-terminal gameplay mode in the first release. Visible text
  exists for captions, accessibility, observability, and debugging; typed parser
  play is not the core product.
- Always-listening background operation in the first release.
- Local speech or local language-model inference.
- Supporting Wispr Flow in the current provider plan.
- Guaranteeing that every model exposed by an aggregator works. Models are
  admitted through explicit capability and conformance checks.
- Multiplayer, user-authored worlds, mobile app-store binaries, or cloud save
  synchronization in the initial vertical slice.
- Treating a ChatGPT subscription as OpenAI API authorization or API billing.

## Core experience

The default session follows this loop:

1. The player activates listening and speaks.
2. The system transcribes the utterance and classifies it as a game intent,
   guide question, hint request, or session control.
3. The guide grounds the request in facts the player has observed and in a
   filtered command/grammar index.
4. The guide either asks for clarification, answers without changing the game,
   or proposes one canonical parser command.
5. The command coordinator validates and serializes the proposal, then sends it
   to the Z-machine.
6. The engine commits the transition and returns exact prose.
7. The narrator speaks the prose. Optional guide commentary remains separately
   labeled and should be brief.
8. A save checkpoint is made at the completed command boundary.

Multi-command plans are permitted only as a sequence of single commands. The
coordinator inspects each response and stops on failure, an unexpected scene
change, a clarification need, or player interruption. It never submits a batch
whose intermediate consequences cannot be observed.

### Guide behavior

The Dungeon Guide has four primary responsibilities:

- **Interpret:** translate clear natural-language intent into parser commands.
- **Clarify:** offer a small set of grounded choices when an instruction could
  map to materially different actions.
- **Explain:** describe parser affordances or summarize only facts the player
  has already observed.
- **Hint:** reveal help according to an explicit ladder.

The default hint ladder is:

1. Syntax help: how to express the intended interaction.
2. Gentle nudge: an observed detail worth reconsidering.
3. Strong hint: the relevant observed object, location, or relationship.
4. Solution: an exact command or command sequence, only after explicit consent.

Hints and ordinary interpretation must have separate data access. Normal guide
turns receive no solution text or hidden map state. Hint content is released by
policy and records the player-approved level.

## Interface strategy

### Default minimal view

The default screen contains only what is needed to operate and trust the audio
session:

- listening/thinking/guide-speaking/narrator-speaking/paused/error state;
- a prominent start/stop or push-to-talk control;
- a discreet way to open settings and the visible transcript;
- non-color status semantics for screen readers and low-vision users.

The first release uses push-to-talk or explicit turn-taking. Barge-in may stop
speech playback, but it cannot undo an engine command that already committed.
Always-listening voice activity detection is considered only after privacy,
cost, interruption, and false-activation behavior are measured.

### Visible and debug views

Visible mode renders the persisted semantic events: heard speech, guide
decision, canonical command, engine prose, and guide response. It supports text
size, contrast, caption duration, reduced motion, and screen-reader live-region
preferences.

An accessible text-entry control may use the same intent-and-guide pipeline as
speech when voice input is unavailable. It is an alternate input transport, not
a second terminal implementation or a bypass around guide and engine policy.

Debug mode is explicitly opt-in and additionally shows provider/model IDs,
latency spans, token or usage estimates when providers expose them, raw versus
normalized transcripts, guide decision payloads, engine I/O, checkpoint IDs, and
recoverable errors. Debug exports redact credentials and personal data.

## Provider strategy

Provider support is expressed as profiles composed from three roles:
transcription, guide reasoning, and narration. A provider may implement one,
several, or all roles. A profile is enabled only when every required capability
passes a startup check and the conformance suite for its configured models.

### OpenRouter: primary open-model profile

OpenRouter is the primary path for users who want hosted open models and
user-funded inference. The hosted app uses OpenRouter’s documented account
authorization flow; the backend associates the resulting credential with the app
session and never exposes the credential to ordinary browser code.

The project maintains a small model allowlist rather than offering an arbitrary
model picker. Admission requires suitable model terms and passing thresholds for
structured decisions, tool discipline, spoiler isolation, latency, and audio
quality. “Open model” is recorded precisely (license, weights availability, and
serving provider) rather than used as an unqualified label.

OpenRouter will ordinarily use a split pipeline. Model identifiers and routing
preferences are deployment configuration, not hard-coded domain behavior.

### OpenAI API: optional realtime profile

OpenAI Realtime is an optional, higher-integration profile for low-latency audio
and tool calling. A deployment-owned API key remains on the backend. Browser
sessions receive only short-lived client/session credentials produced through
the currently supported OpenAI API flow.

No specific “older” or “mini” model is promised in architecture. Available
models, prices, and capabilities change. Candidate models are selected from
configuration after a benchmark of command accuracy, tool reliability, voice
latency, narration fidelity, and measured cost per play minute. A ChatGPT or
Codex login is not treated as an OpenAI API login unless OpenAI publishes a
supported third-party authorization flow for that purpose.

Even in a unified realtime session, the provider must use the same guide tool
boundary. Exact engine prose is passed to a narration path that is forbidden to
summarize or embellish it.

### Hugging Face: conditional and experimental

Hugging Face is retained as an experimental route for open-model inference and
account-authorized usage where the selected service supports it. Availability,
streaming behavior, structured-output reliability, and TTS coverage vary by
model and inference provider, so no complete Hugging Face profile is advertised
until it passes the same end-to-end suite.

The adapter may fill only one role in a composed profile. For example, a Hugging
Face transcription or guide model can be paired with an allowed narration
adapter. Such composition must be visible to the user because audio and
transcript data can cross more than one processor.

## Success measures

The normative quality thresholds, latency budgets, and release gates live in
[Testing and Regression Strategy](./testing.md). At a strategic level, success
requires:

- zero mutations outside the engine and zero duplicate committed commands;
- deterministic save/restore equivalence across the supported engine/story
  matrix;
- guide intent, grounding, clarification, and spoiler evaluations meeting the
  published release thresholds on every qualified profile;
- an ordinary session that can be completed without visible prose and an
  equivalent visible-text path that does not require audio;
- provider latency, cost, and usage reported separately under documented test
  conditions before a profile is enabled by default.

Provider-dependent measurements remain segmented by profile; aggregator or
network variance is not averaged away.

## Delivery strategy

Work proceeds as vertical slices rather than isolated subsystems:

1. **Deterministic loop:** load the licensed story, send a command through the
   adapter, emit exact output, checkpoint, restore, and prove equivalence.
2. **Voice loop:** capture one utterance, transcribe, execute a known command,
   narrate exact output, and expose the same events in visible mode.
3. **Guide loop:** add constrained execute/clarify/explain decisions and a
   grounded command knowledge index.
4. **Companion loop:** add observed-world memory, the explicit hint ladder,
   repeat/help controls, and role-distinct audio.
5. **Provider hardening:** certify the OpenRouter profile, benchmark the
   optional OpenAI Realtime profile, and graduate Hugging Face capabilities
   individually.
6. **Release hardening:** accessibility, security, privacy, licensing,
   regression fixtures, cost controls, documentation, and self-hosting.

Each slice includes automated tests, recorded synthetic audio fixtures, failure
handling, and a manual eyes-free acceptance scenario. Milestone completion is
defined by observable behavior rather than percentage of components built.

## High-level repository layout

```text
apps/
  web/                    Voice-first PWA and optional visible/debug renderers
  server/                 Session API, provider auth, ephemeral credentials

packages/
  contracts/              Versioned events, decisions, commands, save manifests
  audio/                  Capture, playback, turn-taking, cancellation, earcons
  engine/                 Z-machine worker and authoritative adapter
  guide/                  Guide policy, memory, and hint policy
  session/                Semantic turn ordering and commit-boundary recovery
  command-knowledge/      Extracted grammar and player-safe affordance index
  providers/              Provider ports and profile composition
  persistence/            Local checkpoints and optional cloud-facing ports
  observability/          Redacted traces, metrics, and debug projections
  test-support/           Fake providers, story fixtures, replay helpers

vendor/
  dork/                   Audited TypeScript interpreter candidate core
  zork1/                  Audited Release 119 story artifact

LICENSES/
  THIRD-PARTY-NOTICES.md
  ...                     Upstream licenses and generated-artifact provenance

docs/
  strategy.md
  architecture.md
  ...                     Milestones, testing, regressions, contributing guides
```

This is a target layout, not permission to vendor code before its exact source,
license, notices, and generated artifacts have been audited.

## Licensing and naming boundary

The source-code license, story data, trademarks, packaging, artwork, sound, and
brand identity are separate concerns. Before distributing a compiled story or
vendored source, maintainers must record its upstream repository and commit,
license text, required notices, acquisition or build steps, and artifact hashes.
A historical prebuilt story is identified as such and is not represented as a
reproducible modern build.

The project must not imply endorsement by the Zork rights holders. A permissive
source release does not itself grant trademark rights. Public naming, logos,
store listings, and bundled historical assets require a separate review. Every
provider SDK, open model, voice, and fixture also needs provenance and terms
recorded in the third-party notices or model registry as appropriate.

## Strategic risks

| Risk                                                | Strategy                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The guide hallucinates a valid-looking action       | Strict decision schema, player-safe context, command validator, engine authority           |
| Guidance spoils puzzles                             | Separate hint capability, progressive consent, tests for hidden-fact leakage               |
| Realtime costs become unsuitable                    | Push-to-talk first, usage telemetry, model benchmarks, user-authorized OpenRouter path     |
| Provider capability or model availability changes   | Capability discovery, allowlisted profiles, adapters, contract tests                       |
| Voice latency makes the game feel inert             | Early acknowledgements, streaming where safe, performance budgets per stage                |
| Retries execute an action twice                     | Idempotency keys, one command sequencer, checkpointed commit receipts                      |
| Minimal visuals obscure state or errors             | Distinct earcons, repeat/help controls, screen-reader semantics, optional visible mode     |
| Story license is confused with trademark permission | Provenance manifest, preserved notices, brand review before public release                 |
| Audio or transcripts expose sensitive data          | Data minimization, explicit retention, redaction, encrypted credentials, deletion controls |

## Decision policy

Architecture changes must preserve the engine-authority, voice-first,
player-safe knowledge, provider-neutral, and ordered-event invariants. A change
that weakens one of them requires a written architecture decision record with a
threat analysis, migration plan, and regression coverage.
