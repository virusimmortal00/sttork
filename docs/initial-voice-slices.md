# Initial Voice Smoke Vertical Slices

Status: implementation checkpoint plan  
Scope: shortest safety-preserving path to an initial developer voice test

## Target

The target is a developer smoke in which a player can speak one utterance, the
Dungeon Guide can execute, clarify, or explain, and an accepted action becomes
exactly one canonical command in the authoritative Z-machine. The player then
hears the exact engine response through narration. The ordinary path must not
require visible text; the same typed events remain available to the optional
accessible transcript and developer-debug surfaces.

A fresh smoke begins with one explicit `START STORY` action. It publishes and
retains the authenticated boot output as exact `engine.output` at revision zero
before microphone permission or any player turn. For an exact reviewed
story/build/opening tuple it speaks ADR-0014's deterministic whole-line excerpt;
any mismatch speaks the complete output. Opening completion, interruption, or
failure all yield the normal controls; Repeat retains that same narrator source
and selected text without republishing it or advancing the engine. Failure keeps
the recoverable blocked status, with actionable safe text where available,
rather than reporting Ready.

This is an integration checkpoint, not a beta or provider-support claim. The
smoke may use explicit developer configuration and an opt-in, budget-limited
live test account.

## Relationship to the delivery milestones

These five slices are narrow vertical checkpoints through the existing M0-M5
work. They neither replace nor relax the deliverables and exit criteria in
[Delivery Milestones](milestones.md). In particular:

- completing a slice does not complete any M0-M7 milestone;
- Dork remains an isolated proposed interpreter candidate until every M0 gate,
  ADR acceptance condition, provenance check, and packaging review passes;
- the fake-audio checkpoint after slice 4 is not evidence that a live provider
  is qualified;
- the live smoke after slice 5 is not provider promotion, accessibility signoff,
  a 30-minute reference replay, or release readiness.

The slices preserve the repository invariants throughout: the Z-machine alone
owns world state, one validated canonical command is the ordinary mutation path,
engine/guide/player/system output remains distinctly attributed, and ambiguous
or uncertain intent does not execute.

## Slice 1 — Real Dork Worker bridge

Implementation checkpoint: bounded developer exit met on 2026-08-18 in
Chrome 151. This records the isolated Worker bridge and one restrictive-CSP
smoke; it does not accept Dork or satisfy the broader M0 browser, watchdog,
conformance, long-run, or packaging gates.

### Deliverables

- Run the pinned Dork candidate and pinned story in an actual dedicated Worker,
  behind a versioned, bounded message protocol and a disposable worker lease.
- Support boot, canonical command execution, public inspection, snapshot, and
  replacement-worker restore without exporting Dork as an accepted production
  runtime.
- Enforce one in-flight stateful operation, `expectedRevision`, and a bounded
  request-receipt journal so exact retries cannot execute twice.
- Pass snapshots through the outer bounded `EngineSnapshot` integrity check and
  the inner Dork envelope validation. Copy bytes before asynchronous validation.
- Stage restore in a virgin worker and swap only after silent validation reaches
  the declared turn boundary; failed, timed-out, or cancelled staging must leave
  the active worker usable and unchanged.

### Exit criteria

- A real Worker boots the pinned story and returns the expected exact opening
  and command output at an input boundary.
- An exact duplicate `requestId` returns the recorded result without advancing
  revision; a conflicting duplicate, stale revision, malformed command, or
  overlapping operation cannot mutate state.
- A snapshot restored into a replacement Worker produces the same exact next
  command result as uninterrupted play, including revision, boundary, and
  branch-appropriate receipts.
- Corrupt, oversized, structurally valid but hash-mismatched,
  story-incompatible, runtime-incompatible, and boundary-incompatible snapshots
  are rejected before swap; the former worker then proves it can execute its
  expected next command.
- Cancellation and unknown-outcome cases follow the documented quarantine or
  exact-retry policy and never authorize a guessed second command.
- Focused Worker, engine, duplicate-delivery, and restore regressions pass, then
  the hermetic repository gate and build pass.

### Deliberately deferred

Guide reasoning, microphones, provider calls, and player-facing UI are deferred
to later slices. The remaining M0 evidence—including full fork conformance, long
cold-restore runs, complete browser/CSP coverage, generated bundle/SBOM review,
and formal Dork acceptance—remains governed by the M0 ledger.

## Slice 2 — Minimal bounded Dungeon Guide

Implementation checkpoint: bounded developer exit met on 2026-08-18. The landed
subset validates the complete provider-neutral decision union, while the initial
policy accepts only `execute`, `clarify`, and deterministic command-help
`explain` outcomes. This does not complete M2 or qualify a live guide model.

Evolution note, 2026-08-19: the chained OpenAI smoke now requires execute
proposals to select a current command-knowledge affordance ID and typed slots;
provider-authored parser text is no longer accepted. The risk-tiered semantic
lane covers zero-slot `look` and `inventory` plus T2 examination of one
explicitly named observed object, allowing unseen natural paraphrases without
adding literal aliases. Navigation and state-changing actions retain lexical
grounding pending the later policies in
[ADR-0012](adr/0012-structured-semantic-command-intents.md). This does not
reopen the Slice 2 checkpoint or complete M2.

### Deliverables

- Implement the provider-neutral guide decision contract and deterministic
  validation for the initial `execute`, `clarify`, and `explain` paths.
- Add an opening-area command knowledge index that exposes parser grammar and
  observed affordances without giving ordinary guide turns hidden world or
  solution data.
- Ground one proposed canonical command in the player transcript and observed
  context, or return a non-mutating clarification/explanation.
- Provide a deterministic fake `GuideModel` and adversarial fixtures so no live
  model is required.

### Exit criteria

- Representative direct and paraphrased intents produce an allowed single
  command and the expected engine outcome.
- Ambiguous objects, low-confidence interpretations, materially different
  actions, and multi-step requests do not silently execute.
- “What can I do?” and parser-help cases mention only currently safe grammar and
  observed affordances.
- Malformed decisions, extra fields, command separators, hidden facts, hostile
  game prose, and requests to bypass the engine fail closed.
- Deterministic guide-to-engine scenarios cover execute, clarify, explain,
  rejection, and provider failure with zero live inference calls.

### Deliberately deferred

The complete observed-memory model, progressive hint ladder, full command
knowledge extraction, release evaluation corpus, companion personality, and
provider-specific prompting remain M2 work beyond this initial subset.

### Landed evidence

- `guide-core` treats model output as `unknown`, rejects additional fields and
  malformed union branches, propagates cancellation, and converts ordinary
  provider failure into an explicit non-mutating result.
- The initial execute gate rejects low confidence, negation, command batches,
  remaining multi-step goals, unsupported grammar, hidden object referents, and
  substitutions not grounded in the player's utterance.
- `command-knowledge` exposes only reviewed opening grammar and object names
  supplied as observed context. Command-help prose is generated
  deterministically from that view; provider prose is not forwarded.
- Hermetic regressions use a deterministic fake model and the isolated Dork
  candidate with the project-owned minimal story. Direct movement and a spoken
  `pick up` paraphrase reach one expected engine turn; clarification,
  explanation, rejection, and provider failure leave the engine revision
  unchanged.

## Slice 3 — Semantic turn orchestrator

Implementation checkpoint: bounded developer exit met on 2026-08-18. The landed
session coordinator connects deterministic final transcripts, the Slice 2 guide,
authoritative engine execution, snapshots, typed events, and a provider-neutral
narration request. This does not include an audio shell, live provider, durable
event store, or cloud checkpoint persistence.

### Deliverables

- Connect final transcript, guide decision, command validation, Dork execution,
  exact engine output, checkpoint request, and narration request through one
  provider-neutral coordinator.
- Allocate ordered, attributable semantic events and correlation/causation IDs
  for every stage while keeping player, guide, engine, and system prose
  distinct.
- Define cancellation and recovery around the engine commit boundary, including
  stale provider responses and exact request retries.

### Exit criteria

- A deterministic final transcript drives one complete semantic turn with the
  expected event order, one committed command, exact engine text, and exact
  narrator input.
- Clarify and explain decisions emit no engine request; rejected guide output
  cannot leak into execution.
- Duplicate delivery, provider retry, and stale callbacks produce at most one
  committed revision and one canonical committed event sequence.
- Cancellation before submission prevents mutation; cancellation after
  submission reports the confirmed or uncertain outcome without claiming an
  undo.
- A transcriber, guide, narration, checkpoint, or engine failure preserves the
  last confirmed game state and emits a recoverable typed system event.

### Deliberately deferred

Long-session memory compaction, polished projections, cloud persistence,
provider authentication, and live networking are deferred.

### Landed evidence

- The coordinator is the sole event-sequence allocator and emits closed typed
  payloads for transcript, guide decision, command, exact engine output,
  checkpoint, narration, recovery, and system-error families. Prose events carry
  an explicit retention classification.
- Interaction IDs are bounded and journaled. Concurrent and completed duplicate
  delivery returns one result; conflicting reuse fails. Journal capacity fails
  before work begins.
- An engine exception after request submission is recorded as unknown and
  authorizes only an exact retry of the same request ID, revision, and command.
  Receipt recovery produces one committed event/output sequence and does not
  advance the engine twice.
- Cancellation before engine submission cannot mutate. Cancellation after a
  confirmed commit preserves and checkpoints that commit, suppresses narration,
  and never claims an undo. Late guide callbacks cannot re-enter the turn.
- Hermetic fake-port tests cover guide, transcription, engine inspection,
  checkpoint, narration, projection, cancellation, duplicate, and uncertainty
  failures. A real isolated Dork integration proves final transcript through
  exact narration input and checkpoint, with duplicate delivery held to one
  revision.

## Slice 4 — Browser audio shell with deterministic fakes

Implementation checkpoint: bounded developer exit met on 2026-08-18 in the
in-app Chromium browser. The deterministic shell exercises a real module
Dedicated Worker under restrictive CSP with no provider call or recorded player
audio. This is not M3 completion, production microphone support, or browser and
assistive-technology signoff.

### Deliverables

- Add explicit push-to-talk capture, playback, stop/interruption, and a virtual
  audio clock around scripted or redistribution-safe recorded speech adapters.
- Present only essential listening/thinking/speaking/error state and controls by
  default, with optional accessible transcript and developer-debug projections
  over the same event stream.
- Keep narrator and guide audio semantically distinct and prevent playback from
  becoming player input in the supported test setup.

### Exit criteria

- A browser end-to-end test drives fixture audio through transcription, guide,
  the real Dork Worker bridge, exact narration input, and completed playback
  without requiring visible prose or a paid network call.
- Silence, low confidence, rapid push-to-talk start/stop, double delivery, and
  interruption produce no unintended or duplicate command.
- Stop, repeat, pause/resume, keyboard operation, microphone denial, narration
  failure, and transcript visibility expose coherent audible and accessible
  states.
- Transcript/debug projections preserve player transcript, guide decision,
  canonical command, exact engine output, and errors without changing behavior.
- Focused audio/projection regressions, a real manual browser/CSP smoke, and the
  hermetic repository gate pass.

### Deliberately deferred

Live provider credentials, production audio quality, the full supported-browser
and assistive-technology matrix, always-listening behavior, and visual polish
remain deferred.

**Checkpoint after slice 4:** the project has an initial fake/recorded-audio
end-to-end voice loop suitable for reliable local development and CI.

### Landed evidence

- The default browser surface exposes only session status and five controls;
  transcript, accessible text input, exact game prose, and developer event
  evidence are hidden until explicitly opened.
- Scripted push-to-talk runs through capture, final transcript, the bounded
  guide, the real Dork Worker, checkpointing, exact narration input, and virtual
  playback. Narrator and guide playback retain separate typed roles.
- The browser smoke proves one executable movement, an ambiguous request with
  zero mutation, deterministic parser help, silence with zero mutation, and the
  same semantic path through accessible text input. The Worker reports that it
  has `WorkerGlobalScope` and no `document` or `window`.
- Pause/resume, repeat, Stop, keyboard capture, microphone-denial recovery, and
  mid-playback interruption have focused regressions. Projection replay proves
  stable attribution and rejects out-of-order events.
- A clean browser load and committed turn produced no console warning or error
  under `default-src 'none'`, same-origin script/Worker/connect directives, and
  no media permission or network provider.

## Slice 5 — One budget-limited live provider profile

Implementation checkpoint: the bounded chained-OpenAI harness landed on
2026-08-19. The slice checkpoint remains open pending recorded real-microphone
browser evidence under the served CSP; this implementation does not constitute
OpenAI Realtime support or progress M4/M5 by itself.

### Deliverables

- Configure one current, officially supported provider profile for the live
  smoke while retaining the provider-neutral transcriber, guide, narrator, and
  optional realtime capability boundaries.
- Add the required server trust boundary for provider authorization or
  short-lived browser credentials; no long-lived secret may enter browser
  storage, events, logs, fixtures, or debug exports.
- Make the live smoke opt-in, skippable without credentials, request-limited,
  spend-capped, cancellation-aware, and separately observable from hermetic CI.
- Record the exact provider/profile/model configuration and dated smoke
  conditions without hard-coding mutable catalog or pricing assumptions into
  domain logic.

### Exit criteria

- A developer can speak an unambiguous intent and hear the exact response after
  one validated, at-most-once engine command without relying on visible prose.
- A spoken ambiguous intent yields a clarification and zero engine mutation.
- Interruption stops pending audio/future work according to the commit boundary,
  and an injected provider error leaves the latest confirmed checkpoint usable.
- The tested credential expires or disconnects as designed, the session/request
  cap is enforced, and redaction checks find no credential or sensitive raw
  audio in persisted diagnostics.
- The opt-in live smoke passes for the recorded configuration while every
  ordinary repository test still passes with no credentials and no billable
  calls.

### Deliberately deferred

Provider promotion, model allowlist breadth, three-run quality thresholds,
30-minute reference replays, published cost/latency claims, production OAuth
hardening, provider failover, and Hugging Face graduation remain in M4-M7.

**Checkpoint after slice 5:** the project has an initial live developer voice
test. It is evidence that the architecture connects end to end, not that the
interpreter, provider, or product is release-qualified.

### Landed implementation evidence

- The browser path connects bounded `MediaRecorder` push-to-talk capture to a
  one-shot in-memory audio store, the same-origin BFF, `gpt-4o-mini-transcribe`,
  a strict `gpt-5.6-luna` Responses decision, provider-neutral guide policy and
  the semantic coordinator, the authenticated Zork I Dork Worker, exact
  multiline engine prose, and role-specific `tts-1` playback.
- The long-lived provider key remains in the trusted local server. Browser code
  receives only a random process-lifetime session token. The default is
  loopback-only; an opt-in remote-device smoke keeps the upstream listener on
  loopback and requires one exact HTTPS public origin through a private,
  authenticated proxy and encrypted tunnel. Same-origin and exact-host checks,
  restrictive CSP, microphone Permissions Policy, `no-store`, bounded request
  and response bodies, cancellation, and one-shot audio disposal are enforced.
- One provider instance enforces a global 12-request ceiling. The ordinary
  hermetic gate contains provider, BFF, browser-adapter, audio-controller, and
  local-harness regressions and makes no provider call. The ignored browser and
  Worker graph builds without credentials.
- The fresh-session presentation gates capture and text submission behind one
  `START STORY` action that does not require microphone permission. Its
  authenticated revision-zero boot output is published once, its initial
  narration consumes one TTS request, and any terminal playback outcome exposes
  the normal controls with the exact full opening retained for accessibility.
  Repeat retains the same source and actual spoken selection. A failed terminal
  remains visibly blocked and recoverable while those controls stay usable.
  Browser playback now primes and reuses one media element from explicit
  audio-related gestures. A 2026-08-19 mobile regression showed that an
  ultra-short primer could leave its browser play promise pending after
  `narration.ready`; the primer and first-playing waits are now bounded, pending
  activation cannot indefinitely gate synthesis, and Stop makes priming
  retryable. Safe failures distinguish playback authorization and the request
  cap, and active retries replace a stale blocked heading with Processing. This
  correction remains pending a fresh real-device confirmation.
- A 2026-08-19 private-HTTPS in-app browser smoke exercised the live text path
  without microphone permission. A social greeting produced one grounded
  clarification with revision zero; one movement request produced exactly one
  committed revision, checkpoint, exact Zork output, and completed narrator
  playback. The Worker remained isolated and the browser console stayed clean.
  This is live-provider integration evidence, not the required microphone
  checkpoint.

Policy evolution after that recorded smoke: accepted
[ADR-0014](adr/0014-story-pinned-spoken-opening-excerpt.md) keeps the complete
opening canonical and accessible but permits the exact Release 119 tuple to
speak a reviewed 32-word excerpt instead of the full 67-word boot output. That
decision does not rewrite the preceding historical result and is not evidence
that the excerpt has passed a live browser or microphone smoke.

### Evidence still required

- Record a real browser microphone turn for one unambiguous intent, one engine
  revision, and audible exact narration without relying on visible prose.
- Begin that run with `START STORY` and record the revision-zero opening, its
  full exact transcript/accessibility text, the reviewed excerpt (or safe
  full-output fallback), no-microphone activation, one initial TTS request,
  terminal transition to the normal controls, and retained-source-and-text
  Repeat behavior. This remains pending live evidence rather than a claim
  established by the hermetic implementation.
- Record a spoken ambiguous intent that produces clarification and no engine
  mutation, plus interruption behavior and injected-provider-failure recovery
  from the last confirmed checkpoint.
- Preserve browser version, CSP/console result, request-count evidence, and a
  redaction check showing that neither the key nor raw audio entered persisted
  diagnostics. Until those checks pass, the Slice 5 checkpoint remains open.
- If the checkpoint runs from another device, also preserve secure-context,
  TLS/proxy/tunnel, access-denial, header-preservation, cache/log-redaction, and
  raw-upstream-unreachability evidence without publishing private topology.
