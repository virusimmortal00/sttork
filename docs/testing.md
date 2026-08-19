# Testing and Regression Strategy

Status: normative for implementation and release work

Applies to: game engine, Dungeon Guide, audio pipeline, provider adapters,
accessibility surfaces, and supporting services

## 1. Quality contract

The product is a voice-first, agent-guided way to play a deterministic game.
Testing must protect five boundaries:

1. The game engine is the only authority that may change game state.
2. The Dungeon Guide may interpret, clarify, explain, recall, and offer
   consented hints, but it may only act through declared tools.
3. The default experience works without reading visible text. Its bounded
   canonical-command history and active-work indicator are redundant trust cues;
   transcript and debug views remain complete, optional renderers of the same
   event stream.
4. OpenRouter, OpenAI, and any later-qualified Hugging Face implementation obey
   the same provider contracts.
5. A provider failure, model change, or ambiguous utterance must never silently
   become an unintended game command.

A feature is not complete until its normal path, cancellation path, failure
path, observability, and regression coverage are implemented.

## 2. Test environments

We maintain three deliberately different environments.

### Hermetic

Used on every pull request. It has no paid provider calls, no network
dependency, no real credentials, and no reliance on wall-clock timing. It uses:

- a small repository-owned interactive-fiction story fixture;
- deterministic clocks and entropy;
- recorded, redistributable audio fixtures;
- fake streaming transports;
- mock OAuth and provider servers;
- fixed guide decisions or a deterministic fake guide.

This suite must be sufficient to prove command safety and state determinism.

### Provider smoke

Runs on a schedule and before a provider profile is promoted. It calls a
provider's current API with a tightly capped test account. It detects
authentication, protocol, model-availability, streaming, structured-output, and
cancellation drift. It is never required for an untrusted fork's pull request.

### Release candidate

Runs against a production-like deployment with real browsers and the release
model allowlist. It includes longer golden replays, accessibility review,
security checks, network impairment, and cost/latency measurement.

Live test credentials must be scoped, rate-limited, redacted, and separate from
production credentials.

## 3. Test pyramid

| Layer              | Primary purpose                      | Typical examples                                                              | Required cadence                                            |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Unit               | Pure behavior and invariants         | event reducers, command normalization, hint policy, save metadata, cost math  | every change                                                |
| Component          | One subsystem behind a fake boundary | Z-machine adapter, guide policy, audio state machine, provider adapter        | every change                                                |
| Contract           | Common interface behavior            | provider streaming/cancel/error semantics, guide decision schema, save format | every change; live smoke nightly                            |
| Integration        | Multiple real local subsystems       | guide decision to engine result to narration event                            | every change                                                |
| Browser end-to-end | User-observable flows                | microphone lifecycle, interruption, transcript toggle, save/restore           | every change for critical paths                             |
| Evaluation         | Probabilistic guide/voice quality    | intent grounding, ambiguity, spoilers, audio robustness                       | deterministic subset per change; full suite nightly/release |
| Manual/exploratory | Human perception and platform gaps   | voice ergonomics, screen readers, mobile audio permissions                    | each release candidate                                      |

Do not replace lower-level assertions with screenshots. Browser tests should
assert semantic events and accessible state first; screenshots are supplementary
evidence for the intentionally minimal visual shell.

The current foundation exposes these stable commands:

```text
test                 every current non-live test
test:unit            focused unit suite
test:contract        focused hermetic contract suite
test:integration     focused local cross-package suite
check                hermetic source gate, including broad test discovery
pnpm run ci          package script: check followed by the TypeScript build
story:verify         offline checked-artifact validation
dork:verify          offline Dork-core and bundled Zork I authentication
story:build:check    non-writing two-build comparison with the pinned compiler
audit:all            networked advisory audit of all locked dependencies
audit:production     networked production-only advisory audit
```

Browser end-to-end, deterministic guide/speech evaluation, live-provider smoke,
and release-candidate commands are added only with their real implementations
and non-empty suites. The concrete package manager and runner may change, but
these responsibilities must remain independently runnable.

## 4. Deterministic engine fixtures

### 4.1 Story fixture policy

Engine tests must not depend exclusively on Zork content. A tiny test story
owned by this project should exercise:

- room movement;
- object discovery and manipulation;
- inventory;
- ambiguity and parser errors;
- score/state mutation;
- random behavior with injected entropy;
- save, restore, restart, and quit prompts;
- multiline and styled output.

Zork-specific fixtures may be committed only after the license/provenance gate
in `docs/milestones.md` is satisfied. Every story binary used in CI is pinned by
SHA-256 and has either compiler provenance or an ADR-approved immutable
historical-acquisition record.

### 4.2 Scenario format

Engine fixtures are data, not test code. A scenario records:

- fixture schema version;
- story identifier and content hash;
- interpreter build/version;
- initial state (`fresh` or a pinned save blob);
- entropy seed and virtual clock, if used;
- ordered input commands;
- exact normalized engine output after each command;
- expected state digest and notable semantic events.

Example shape:

```json
{
  "schemaVersion": 1,
  "id": "mailbox-open-and-restore",
  "story": { "id": "test-story", "sha256": "..." },
  "initialState": { "kind": "fresh", "entropySeed": 7 },
  "steps": [
    {
      "command": "OPEN MAILBOX",
      "expect": {
        "output": "The mailbox opens.",
        "stateDigest": "..."
      }
    }
  ]
}
```

Normalization is intentionally narrow: line endings, transport prompts, and
documented terminal-control sequences may be normalized. Tests must not
normalize wording, punctuation, object names, or meaningful whitespace merely to
make a snapshot pass.

### 4.3 Engine invariants

Every supported interpreter build must prove that:

- the same initial save, entropy, and command sequence produces the same output
  and state digest;
- save followed by restore reproduces the exact next result;
- cancellation before command commit produces no mutation;
- a command is committed at most once, even after retry or reconnect;
- multiple commands are executed in order and stop under the guide's declared
  stop policy;
- parser failures are ordinary engine responses, not transport errors;
- game output is preserved verbatim in the canonical event log;
- engine state cannot be mutated through guide memory, UI state, or provider
  payloads.

Run core deterministic scenarios repeatedly in CI to reveal leaked clocks,
shared state, and nondeterministic ordering.

## 5. Provider contract testing

Provider-specific code implements narrow capability contracts rather than
leaking SDK objects into the application. Capabilities are negotiated
explicitly; a provider is not assumed to support transcription, guide inference,
narration, and realtime transport merely because it supports one of them.

### 5.1 Required contracts

Test these contracts where implemented:

- `Transcriber`: audio ingestion, partial/final transcript ordering, confidence
  metadata, language, cancellation, and terminal errors.
- `GuideModel`: schema-conforming decisions, tool-call streaming, usage
  reporting, cancellation, and refusal/error representation.
- `Narrator`: exact requested text, first-audio notification, completion,
  interruption, and audio format metadata.
- `RealtimeSession`: connection lifecycle, ephemeral credentials, tool-call
  correlation, interruption, reconnection, and session close.
- `ProviderAuth`: connect, callback validation, expiry, revocation, disconnect,
  and safe error reporting.

Each adapter runs against a shared conformance suite. The mock server must
cover:

- partial frames split at arbitrary byte boundaries;
- duplicated, delayed, and out-of-order events;
- rate limits and retry hints;
- authentication expiry during a session;
- malformed structured output;
- empty audio and oversized payloads;
- clean and unclean disconnects;
- cancellation before and after a tool call is proposed;
- usage metadata that is absent, late, or revised.

Retries are allowed only for idempotent operations. An engine command is never
retried by a provider adapter. Tool-call IDs and locally generated turn IDs
provide at-most-once command execution.

### 5.2 Live smoke rules

Live smoke tests:

- use an allowlisted model identifier and record the resolved model/version when
  provided;
- operate under a hard request and spend cap;
- contain no Zork solution corpus, personal audio, or production save data;
- test a minimal successful turn, a tool call, cancellation, and one expected
  error;
- skip with an explicit reason when credentials are absent;
- fail promotion when credentials are present and the provider contract has
  drifted.

A model update cannot be promoted solely because the API responds. It must also
pass the guide evaluation thresholds and the latency/cost benchmark.

## 6. Dungeon Guide evaluations

The guide is evaluated on decisions, not prose style. Exact wording snapshots
are inappropriate unless wording itself is a safety or accessibility
requirement.

### 6.1 Evaluation record

Each case contains:

- player transcript and optional prior turn;
- observed rooms, objects, inventory, engine messages, and recalled facts;
- command grammar available to the guide;
- spoiler preference and maximum hint level;
- acceptable decision types and acceptable canonical commands;
- forbidden commands, facts, and solution details;
- whether clarification is mandatory;
- expected engine outcome when a command is executed.

One intent may have several acceptable commands. Scoring should compare semantic
command/outcome sets, not a single preferred phrase.

### 6.2 Evaluation suites

Maintain labeled cases for:

- direct, unambiguous actions;
- natural paraphrases and referents such as “it,” “there,” and “do that again”;
- ambiguous objects, directions, and multi-step plans;
- impossible actions and parser syntax education;
- requests for available actions without revealing unobserved content;
- inventory, recap, and spatial recall;
- the progressive hint ladder;
- explicit solution requests;
- accidental spoiler opportunities;
- commands containing punctuation, homophones, or transcription errors;
- player attempts to make the guide bypass the engine;
- prompt-injection-like text in player speech, object names, and game output;
- provider refusal, timeout, malformed output, and tool-call cancellation.

### 6.3 Hard safety assertions

The following are zero-tolerance release assertions:

- no direct game-state mutation outside the engine adapter;
- no command execution when a case requires clarification;
- no command execution after the player cancels or interrupts before commit;
- no facts or puzzle solutions above the configured hint level;
- no invented observation represented as engine truth;
- no acceptance of instructions embedded in untrusted game output;
- no tool arguments outside the declared schema and command allowlist policy.

The deterministic policy layer must reject unsafe guide output even if the model
evaluation misses it.

### 6.4 Quality thresholds

Before a model profile is eligible for beta:

- schema-valid decisions: 100% of the release set;
- zero-tolerance assertions: 100%;
- unambiguous command outcome accuracy: at least 98%;
- mandatory-clarification accuracy: at least 95%;
- grounded help/recall accuracy: at least 95%;
- hint-level compliance: 100% on the spoiler-critical set and at least 98%
  overall.

Because hosted models may be nondeterministic, the release set is run at least
three times per candidate profile. Every run must meet zero-tolerance
assertions; aggregate quality metrics must meet their thresholds. Changes to
prompts, tool schemas, command indexes, models, or context assembly invalidate
the previous evaluation result.

## 7. Voice and audio testing

### 7.1 Fixture corpus

Use audio that is project-owned, explicitly licensed for testing, or generated
for the test suite. Keep provenance beside each fixture. The corpus should
cover:

- silence, short utterances, and long utterances;
- varied speaking rates, pitch, and microphone distance;
- representative accents and speech impairments where contributors have
  explicitly consented;
- background conversation, fan noise, music, and room echo;
- game-specific nouns, directions, and homophones;
- corrections made mid-utterance;
- interruption while the guide or narrator is speaking;
- accidental playback-to-microphone echo.

Raw contributor audio must not enter the repository without explicit
redistribution consent. Synthetic fixtures must be labeled as synthetic and must
not be the only accessibility evidence.

### 7.2 Assertions

Measure both transcript accuracy and final gameplay outcome. A transcription
difference is acceptable when it produces the same safe intent; a fluent
transcript is a failure when it executes the wrong command.

Required assertions include:

- a fresh playable session exposes `START STORY` before capture, keeps it
  enabled without microphone permission, and does not request that permission
  when activated;
- one activation produces exactly one `engine.output` whose exact text,
  `input-requested` boundary, and revision zero match authenticated boot state,
  followed by one narrator synthesis request and no engine command, checkpoint,
  or revision advance;
- rapid or duplicate activation cannot duplicate the opening event or initial
  synthesis request; ordinary capture and text submission remain gated while the
  opening is active, while Stop remains operable;
- completion, interruption, and synthesis/playback failure all expose the
  ordinary controls and retain the exact opening for accessible text and Repeat;
  completion/interruption project Ready while failure projects recoverable
  `blocked` / `Action needed`; Repeat reuses the same source without another
  `engine.output` or revision advance;
- incremental reduction and replay derive the same opening phase: revision-zero
  output is active until its correlated narrator cancellation, failure, or
  playback terminal, after which ordinary controls remain available;
- silence and low-confidence input do not execute commands;
- ambiguous recognition asks for clarification;
- one engine-command request produces at most one committed turn; a multi-step
  utterance advances only one observed and revalidated command at a time and
  stops at the configured per-utterance action limit;
- push-to-talk start/stop is race-free under rapid input;
- interruption stops queued audio promptly and follows the declared
  command-commit rule;
- narrator output is not re-ingested as player speech;
- guide and narrator roles remain distinguishable through semantic audio
  metadata and the configured cue/voice treatment;
- “repeat,” “pause,” “resume,” “stop,” “slower,” and “show transcript” work from
  every relevant audio state;
- network loss produces an audible and accessible recoverable status without
  fabricating progress.

Use a virtual audio clock for orchestration tests. Real-time sleeps and
microphone hardware are reserved for targeted browser/manual tests.

## 8. Golden replays

A golden replay is the primary cross-system regression artifact. It records
semantic inputs and outputs while keeping provider prose flexible.

Each replay contains:

- story and interpreter hashes;
- provider profile or deterministic fake profile;
- prompt/tool-schema/command-index versions;
- audio fixture or player transcript;
- guide decision and tool-call IDs;
- canonical engine command, exact engine response, and state digest;
- narration request text and lifecycle events;
- visible/accessibility/debug renderer events;
- stage latency and synthetic usage data where relevant.

Golden replays assert three levels separately:

1. Exact: engine text, command order, state digest, event ordering, and save
   behavior.
2. Semantic set: acceptable guide decision and command outcomes.
3. Budget: maximum latency, request count, tokens/audio units, and retries.

Never overwrite goldens automatically in CI. A golden change requires a focused
diff, an explanation of the intended behavior change, and review by someone
other than the author when it affects engine state, hint behavior, privacy, or
cost.

## 9. Accessibility testing

The absence of visible text by default is a presentation choice, not a reduction
in semantic information. Automated and manual tests must cover:

- keyboard activation of `START STORY` before microphone permission, including
  an equivalent exact-text path when opening narration fails;
- status changes exposed through appropriately managed live regions;
- complete keyboard operation of microphone, stop, repeat, settings, transcript,
  and debug controls;
- visible focus and logical focus order when controls are shown;
- transcript/caption mode preserving player transcript, interpreted command,
  exact engine response, and guide text;
- text resizing, reflow, contrast, reduced motion, and no information conveyed
  by color alone;
- an alternative to audio-only cues in visible-text mode;
- screen-reader behavior while rapid partial transcripts and audio states
  change;
- microphone-denied, output-muted, and no-audio-device recovery;
- narration rate and repeat controls;
- no focus theft when a new game event arrives.

Run automated accessibility checks on every critical browser flow. Before beta
and each major release, manually test at minimum VoiceOver with Safari and NVDA
with Chrome on supported versions. Record browser, operating system, assistive
technology, result, and known limitation.

Debug mode is not a substitute for the accessible transcript mode. Debug mode
may expose technical metadata; accessible mode must remain understandable and
safe for ordinary players.

## 10. Security and privacy testing

Threat modeling and tests must treat audio, transcripts, saves, provider tokens,
and guide memory as sensitive.

### Authentication and secrets

Test that:

- OAuth uses PKCE and a single-use, expiring state value;
- callback and return URLs are allowlisted;
- cookies use appropriate `HttpOnly`, `Secure`, and `SameSite` settings;
- long-lived provider or application keys never reach browser bundles, client
  logs, analytics, event payloads, or error pages;
- browser-issued realtime credentials are narrowly scoped and short-lived;
- disconnect/revocation prevents new sessions;
- encrypted stored credentials can be rotated and deleted;
- logs redact authorization headers, query secrets, cookies, transcripts, and
  audio references by default.

### Untrusted content and transport

Test output encoding and content-security policy with hostile player
transcripts, game output, guide output, filenames, and save metadata. Cover
cross-site scripting, request forgery, open redirects, oversized audio frames,
invalid media formats, decompression/resource exhaustion, replayed tool calls,
and session fixation.

Game prose and retrieved command/hint content are untrusted data, never
instructions to the guide. Prompt-boundary tests belong in both the
deterministic policy suite and model evaluation suite.

### Data lifecycle

The default data path should avoid retaining raw audio. Tests must prove the
documented behavior for consent, retention, export, deletion, and provider
disclosure. Analytics tests assert that event names and dimensions are useful
without containing raw transcripts or save contents.

Dependency, secret, and license scanning run in CI. High-severity findings
affecting reachable production code block release; exceptions require a
time-bounded written risk acceptance.

## 11. Latency, reliability, and cost observability

Every turn receives a locally generated correlation ID. Instrument these
boundaries without recording raw speech or transcript content by default:

```text
microphone started/stopped
transcription first partial/final
guide request/first event/final decision
tool proposed/validated/committed
engine started/completed
narration requested/first audio/completed/interrupted
turn completed/failed/cancelled
```

Record duration, provider/profile, model identifier, request count, retry count,
input/output usage units, estimated cost, error category, and whether a command
was committed. Keep engine duration separate from provider/network duration.

Initial release targets, measured on the documented stable-network reference
environment, are:

| Measurement                                                  | Target        |
| ------------------------------------------------------------ | ------------- |
| Local engine command, p95                                    | 50 ms or less |
| Push-to-talk release to final transcript, p95                | 1.5 s or less |
| Final transcript to validated guide decision, p95            | 1.5 s or less |
| Engine response to first narration audio, p95                | 1.5 s or less |
| Chained path, button release to first response audio, p95    | 4.0 s or less |
| Realtime path, end of utterance to first response audio, p95 | 2.5 s or less |
| Command duplication across reliability suite                 | 0             |

These are product gates, not claims about every user's network. A milestone may
revise a target only through a dated architecture decision with benchmark
evidence.

Cost reporting must include:

- estimated cost per turn and per active play hour;
- separate transcription, guide, narration, and realtime usage where available;
- the provider's price source and date;
- comparison of estimated and invoiced usage on the test account;
- alerts for missing usage metadata or a material estimate mismatch;
- a configurable per-session spending warning and hard stop.

Before enabling any profile by default, maintainers set its explicit
per-active-hour budget and publish the reference replay measurement. No provider
receives an unlimited retry or token/audio budget. Older or cheaper models are
eligible only while officially supported and while they pass the same safety,
quality, latency, and cost gates.

## 12. Regression taxonomy and gates

### 12.1 Regression classes

Tag each regression with one or more classes:

- `engine`: output, state, save compatibility, or command ordering;
- `guide-grounding`: invented observations or incorrect contextual help;
- `guide-action`: wrong, duplicate, or unsafe command execution;
- `spoiler`: hint level or unobserved solution leakage;
- `speech-input`: recognition, end-of-turn, or ambiguity handling;
- `audio-output`: missing, repeated, overlapping, or uninterruptible narration;
- `accessibility`: loss of equivalent control or information;
- `provider`: authentication, protocol, capability, or model drift;
- `privacy-security`: credential, data, injection, or isolation failure;
- `performance-cost`: latency, runaway context, retries, or spend;
- `observability`: missing or misleading events that prevent diagnosis.

Severity is separate from class:

- **S0:** credential/privacy breach, remote compromise, broad save corruption,
  or uncontrolled spend. Stop rollout and revoke/disable affected paths.
- **S1:** unintended command/state mutation, spoiler-critical failure,
  inaccessible primary flow, data loss, or primary provider path unusable.
  Blocks merge/release.
- **S2:** recoverable incorrect behavior or material latency/quality
  degradation. Blocks release; may block merge based on affected surface.
- **S3:** minor defect with a usable workaround and no state/safety impact. May
  be scheduled with an owner.

### 12.2 Quality gates

| Gate                     | Required evidence                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request             | hermetic source gate with every non-live test, build, separate compiler rebuild, networked full dependency audit, and changed-surface evidence |
| Main/nightly             | full guide and speech evals, repeated deterministic runs, browser matrix, capped provider smoke tests                                          |
| Provider/model promotion | live contract smoke, three-run guide thresholds, security review of auth/data flow, latency/cost benchmark                                     |
| Release candidate        | all prior gates, full golden replay set, save migration test, manual accessibility matrix, dependency/license scan, incident rollback drill    |

Tests may be retried to diagnose infrastructure failure, but a retry must not
turn a product failure green. A flaky test receives an owner, linked issue,
failure evidence, and expiry no later than seven days. S0/S1 tests and
zero-tolerance guide assertions cannot be quarantined.

## 13. Incident and regression workflow

When a regression is detected:

1. **Contain.** Disable the affected model/profile through configuration, cap
   spend, or stop rollout. Do not automatically move users to a provider with
   different privacy or billing terms.
2. **Preserve evidence.** Save redacted correlation IDs, event types,
   model/profile versions, story/interpreter hashes, timings, usage, and state
   digests. Never paste live credentials or private audio into an issue.
3. **Classify.** Assign regression classes and severity, identify the first
   affected release/configuration, and state whether game state or privacy may
   be affected.
4. **Reproduce.** Reduce the failure to a hermetic scenario where possible. For
   model drift, capture a sanitized evaluation case and provider metadata
   without treating hidden reasoning as required evidence.
5. **Fix the boundary.** Prefer deterministic validation, idempotency, context
   filtering, or adapter correction over prompt-only patches.
6. **Add the regression test.** Add or update the smallest fixture plus a golden
   replay when the failure crossed subsystems.
7. **Verify.** Run the relevant provider/model/browser matrix, then the gate
   matching the incident severity.
8. **Recover.** Re-enable gradually, confirm metrics, and document any save
   repair or user communication.
9. **Close.** Record root cause, detection gap, preventive action, owner, and
   completion date.

Every regression issue should include:

- concise expected and actual behavior;
- severity and classes;
- redacted reproduction or replay ID;
- provider/model, browser, story/interpreter, prompt/schema, and release
  versions;
- command-commit and state-integrity status;
- latency/usage impact;
- containment and rollback status;
- permanent test added.

## 14. Definition of done for changes

A change is ready to merge only when:

- the behavior and failure semantics are documented;
- tests cover the narrowest responsible layer and any crossed-system replay;
- new events/metrics exclude sensitive content by default;
- accessibility behavior is equivalent in voice-first and visible-text modes;
- provider-specific behavior remains behind a capability contract;
- state-changing paths prove validation, at-most-once commit, and cancellation
  behavior;
- relevant quality gates pass without unexplained fixture rewrites.
