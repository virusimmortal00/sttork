# Delivery Milestones

Status: proposed execution roadmap

Scope: a free, open-source, voice-first Zork experience with a bounded Dungeon
Guide

## 1. Product direction

The primary interface is spoken conversation. The ordinary screen is a quiet
status surface; visible transcript/caption and developer-debug modes are
supported for accessibility and diagnosis, not as the primary game loop.

The original game engine remains authoritative. The Dungeon Guide helps
understand intent, teaches available parser actions, asks clarifying questions,
recalls observed facts, and offers consented progressive hints. It never edits
game state directly.

The initial provider scope is:

- OpenRouter, intended as the first open-model-oriented chained voice option;
- OpenAI API, using a current supported Realtime mini-class model when it meets
  quality and cost gates;
- Hugging Face, only if a discovery gate demonstrates a coherent supported
  experience.

Provider support is capability-based and configurable. There is no Wispr
integration in this roadmap.

## 2. Rules for advancing a milestone

A milestone exits only when:

- every listed deliverable is merged and documented;
- its exit criteria are demonstrated by automated tests or linked manual
  evidence;
- new external data flows have privacy, security, cost, and failure behavior
  documented;
- regressions discovered during the milestone have permanent tests;
- no S0/S1 issue remains open in the milestone's scope;
- deferred items are recorded rather than left as ambiguous partial
  implementations.

Feature flags may isolate unfinished later milestones, but they do not waive
criteria for a feature advertised as supported.

## 3. Milestone dependency map

```text
M0 Licensing and foundation
  -> M1 Deterministic engine
    -> M2 Dungeon Guide core
      -> M3 Provider-independent voice shell
        -> M4 OpenRouter reference path
        -> M5 OpenAI Realtime mini path
        -> M6 Hugging Face suitability gate (conditional)
          -> M7 Beta and 1.0 release
```

M4 and M5 may be developed in parallel after M3. M6 never blocks release when M4
or M5 supplies a supported production path.

### Initial developer voice-smoke checkpoints

The [initial voice vertical slices](initial-voice-slices.md) provide five narrow
integration checkpoints across this roadmap: a real Dork Worker bridge, a
minimal bounded guide, a semantic turn orchestrator, a deterministic browser
audio shell, and one budget-limited live provider profile. Slice 4 produces the
fake/recorded-audio end-to-end checkpoint; slice 5 produces the initial live
developer voice smoke. These checkpoints do not replace M0-M7 exits or accept
Dork as the production runtime.

## M0 — Licensing, decisions, and repository foundation

### Goal

Establish that the project can legally redistribute every committed asset and
can evolve without accidental coupling to a provider, UI, or unverified story
binary.

### Status — in progress (2026-08-18)

The project license, contribution/community/security documents, core
trust-boundary ADRs, threat model, TypeScript workspace, initial
contracts/events, and local policy checks are present. ADR-0007 accepts the
project-owned non-Zork fixture, pinned Inform source revision, two-build
reproducibility process, and checked binary hash. Pull-request CI and repository
operation policy are defined without provider credentials or release publishing.
The verify job runs the hermetic source gate plus build and a separately labeled
networked dependency audit; compiler reproducibility remains its own required
job.

M0 is not complete. ADR-0009 now proposes the pinned Dork TypeScript core as the
primary interpreter candidate, with Bocfel retained as an oracle/fallback. The
approved Zork I Release 119 artifact and the audited Dork core are available for
the isolated compatibility work, but no production interpreter has been
accepted. A modified, unendorsed fork now binds upstream commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622` to behavioral patch SHA-256
`a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605` and proves a
bounded Version 3 host-checkpoint and in-process replacement-session slice. The
machine checkpoint and envelope are schema v2 and the adapter compatibility ID
is `zork-voice-dork-checkpoint-v2`; the complete wire encoding is regression-
and verifier-locked to golden SHA-256
`79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`. A
project-owned in-memory test now proves positive RANDOM—including deterministic
tail rejection for unbiased non-divisor ranges—RANDOM 0, negative predictable
mode, and RESTART remain exact across cold restore. Opaque-save and cold-restart
evidence are only `running`: the isolated bridge now has real Worker/factory
swap, outer `EngineSnapshot` SHA-256 validation, bounded receipt/idempotency,
exact-retry quarantine, and one Chrome 151 restrictive-CSP smoke. It still lacks
watchdog termination, complete status/style/operand-zero READ/general-restart
fixtures, a 50-turn cold-worker restore, Safari and the full browser matrix,
fork conformance rerun, and final bundle/SBOM evidence. The working-name record
remains blocked pending a qualified trademark review or rename. GitHub
branch/protection settings must be applied and evidenced, and the remaining
security/provenance exit review must complete. A committed workflow file alone
is not evidence that remote repository protections are active.

### Deliverables

- Project license, contribution terms, code of conduct, and third-party notices.
- A provenance record for each Zork source tree, compiled story, interpreter
  dependency, name/logo usage, and bundled asset, including upstream URL,
  revision/hash, license text, and redistribution decision.
- A clear separation between project code, third-party engine/interpreter code,
  story source/binaries, generated files, and test fixtures.
- A repository-owned minimal interactive-fiction test story with an explicit
  compatible license.
- A proposed interpreter ADR, sourced browser-interpreter research snapshot, and
  evidence ledger that keeps candidate status distinct from an accepted
  dependency.
- Initial architecture decisions covering:
  - engine/interpreter boundary;
  - canonical event model;
  - provider capability interfaces;
  - browser/server trust boundary;
  - save format and versioning;
  - default audio/transcript retention;
  - supported browser baseline.
- Threat model and provider data-flow diagram for microphone audio, transcripts,
  guide context, saves, credentials, metrics, and deletion.
- Monorepo/package skeleton, formatting/type-check/test scripts, CI,
  dependency/license/secret scanning, and protected release configuration.
- Contributor-facing `AGENTS.md` and development documentation consistent with
  the decisions above.

### Exit criteria

- Every tracked third-party file has auditable provenance and preserved required
  notices.
- No Zork source, binary, trademarked artwork, packaging, audio, or solution
  content is redistributed until its exact license and scope permit it.
- The test story compiles reproducibly and its binary hash is checked in CI.
- The exact interpreter candidate passes the dedicated-worker, turn-boundary,
  opaque-save-byte, cold-restart, conformance, and generated-artifact
  SBOM/license gates in `docs/m0-interpreter-evidence.md`; its ADR and immutable
  provenance record are accepted before it enters the production dependency
  graph or a release bundle. Provenance-approved source may remain isolated for
  the candidate evaluation without implying acceptance.
- A clean checkout can run format, type-check, unit test, and license/provenance
  checks using documented commands.
- CI executes without provider credentials and cannot spend provider money. Its
  dependency install/audit and pinned-source checkout are the only M0 networked
  gates; ordinary tests remain hermetic.
- Security review confirms that planned long-lived provider secrets remain
  server-side.

### Deferred

Full game compatibility beyond the M0 fixture/conformance gate, guide behavior,
microphone UI, and live provider calls.

## M1 — Deterministic game-engine core

### Goal

Wrap the selected Z-machine interpreter behind a deterministic,
provider-independent API and canonical event stream.

### Deliverables

- An engine adapter that can initialize a pinned story, accept one canonical
  command, emit exact game output, and expose a state digest.
- Save, restore, restart, and session lifecycle APIs with versioned metadata and
  clear incompatibility errors.
- Injected clock/entropy or an equivalent replay mechanism for random behavior.
- A single serialized command queue with command IDs and at-most-once commit
  semantics.
- Canonical event types for player transcript, guide decision, engine
  command/result, audio lifecycle, system status, error, cancellation, usage,
  and save lifecycle.
- Deterministic fixture scenarios using the repository-owned test story.
- Zork I compatibility fixtures only after M0 provenance permits them.
- A developer-only command harness for diagnosis; it is not a text-first product
  mode.

### Exit criteria

- Core fixture scenarios produce byte-for-byte equivalent normalized output and
  identical state digests over 20 consecutive runs.
- Save/restore followed by the same command produces the same result as
  uninterrupted play.
- Cancellation before commit and duplicate delivery both result in zero
  duplicate state mutations.
- Parser errors are preserved as engine results and do not corrupt the session.
- Canonical engine output survives the event pipeline without paraphrase or
  loss.
- Unit, component, integration, and golden engine replay suites pass in CI.
- If Zork I is included, a maintainer can build or acquire the pinned story
  through the documented provenance-compliant process and pass the same
  compatibility suite.

### Deferred

Natural-language interpretation, hints, speech, provider authentication, cloud
saves, and polished UI.

## M2 — Bounded Dungeon Guide core

### Goal

Add an agent that understands player intent and helps with the parser while
preserving the engine as the sole state authority.

### Status — initial bounded subset landed (2026-08-18)

Initial Voice Slice 2 provides strict runtime validation for the canonical
decision union, reviewed opening grammar, observed-object grounding,
deterministic parser help, a fake guide model, and guide-to-engine safety
regressions. Slice 3 adds an idempotent semantic-turn coordinator with typed
events, checkpoint/narration ports, and exact uncertain-command recovery. M2
remains incomplete: observed memory, mediated tools, contextual referents, hint
policy/content, full grammar generation, the release evaluation corpus, and
provider qualification are still required by the deliverables and exit criteria
below.

### Deliverables

- The canonical strict guide decision schema from `docs/guide-agent.md` for
  `execute`, `clarify`, `explain`, `request_hint`, `session_control`, and
  `cannot_comply` outcomes.
- Mediated, validated tools for observation, canonical command execution,
  inventory, observed-memory recall, command help, and progressive hints.
- A context assembler that includes only observed game facts, relevant command
  grammar, recent events, and the player's spoiler preference.
- A command/grammar knowledge index generated from licensed source where
  feasible, with a versioned curated fallback.
- A four-step hint ladder: syntax help, gentle nudge, strong hint, explicit
  solution.
- Separate canonical engine facts, guide interpretation, player-stated beliefs,
  and uncertain memories.
- An at-most-once tool-call boundary and deterministic validation that can
  reject malformed, ungrounded, or disallowed model output.
- A deterministic fake guide plus a provider-neutral `GuideModel` contract.
- Guide evaluations and adversarial cases described in `docs/testing.md`.

### Exit criteria

- All state-changing guide behavior passes through the engine command queue.
- Direct actions, contextual help, referents, ambiguity, impossible actions,
  repeat/recap, and each hint level have golden scenarios.
- Zero-tolerance guide assertions pass on every run.
- The release evaluation set reaches:
  - 100% schema validity;
  - at least 98% unambiguous command-outcome accuracy;
  - at least 95% mandatory-clarification accuracy;
  - at least 95% grounded help/recall accuracy;
  - 100% spoiler-critical compliance and at least 98% overall hint compliance.
- Hostile instructions in game output and player requests to bypass the engine
  cannot cause an unvalidated action.
- A complete guide-to-engine-to-response flow works through the developer
  harness without a live provider.

### Deferred

Elaborate companion personality, unsolicited puzzle solutions, autonomous play,
background goals, long-term cross-save memory, and generated game content.

## M3 — Provider-independent voice shell

### Goal

Deliver the voice-first interaction and minimal visual surface using
deterministic fake and recorded test adapters, before adding provider-specific
complexity.

### Deliverables

- A tested audio state machine covering idle, permission request, listening,
  end-of-turn, processing, guide speech, narrator speech, interruption, paused,
  recoverable error, and terminal error.
- Push-to-talk as the initial input interaction, with clear audible and
  accessible state changes.
- Separate semantic roles for original game narration and guide speech, with
  configurable voice/cue treatment.
- A nearly text-free default surface showing only essential state and controls.
- Optional visible-text accessibility mode containing player transcript,
  interpreted command, exact game output, guide response, and errors.
- Separate developer-debug mode showing raw provider events, tool decisions,
  state digests, versions, latency, retries, and cost estimates without
  revealing secrets.
- Keyboard controls and voice controls for stop, repeat, pause, resume,
  narration speed, help, and transcript visibility.
- Fake streaming transcription/narration adapters, virtual audio clock, and
  browser end-to-end tests.
- Local, versioned saves suitable for later migration.

### Exit criteria

- The critical flow—from fixture audio through guide decision and engine
  mutation to spoken response—passes end to end with no visible transcript
  required.
- Rapid start/stop, cancellation, double delivery, reconnect, and interruption
  tests produce zero duplicate commands.
- Silence and low-confidence input never mutate game state.
- Narrator playback is not re-ingested as player speech in the supported test
  setup.
- The visible-text and debug modes render from the canonical event stream and do
  not change game behavior.
- Automated accessibility checks pass, and VoiceOver/Safari plus NVDA/Chrome
  manual smoke tests complete with no blocker.
- Latest supported Chrome and Safari versions pass the declared critical-path
  browser suite; any narrower support policy is documented before
  implementation.
- No live provider, provider login, or paid request is required to pass this
  milestone.

### Deferred

Always-listening wake words, background microphone capture, native mobile
applications, cloud save sync, and final visual polish.

## M4 — OpenRouter open-model reference path

### Goal

Ship the first user-connectable, chained provider profile using suitable models
available through OpenRouter.

### Discovery checkpoint

Before implementation, verify against current official APIs and terms:

- supported user authorization/account-connect flow;
- browser-versus-server token handling requirements;
- streaming transcription, structured guide inference, and narration
  capabilities;
- model licenses and whether “open model” is an accurate description for each
  allowlisted model;
- usage metadata, pricing, cancellation, data retention, and regional
  constraints.

Do not infer support for one modality from support for another. Do not silently
add a fourth provider to complete the chain.

### Deliverables

- Secure account connection and disconnection with PKCE/state validation where
  supported by the provider flow.
- `Transcriber`, `GuideModel`, and `Narrator` adapters for the selected profile,
  or an explicitly documented composition using only the providers in this
  roadmap.
- A capability manifest and server-controlled allowlist of qualified model
  combinations.
- Model/profile version pinning, health state, rate-limit handling,
  cancellation, and safe reconnect behavior.
- Per-stage latency, usage, and estimated-cost reporting.
- User-facing disclosure of account/billing responsibility and provider data
  flow.
- Hermetic adapter conformance tests and capped live smoke tests.

### Exit criteria

- A connected user completes a 30-minute reference replay including direct
  actions, clarification, contextual help, all hint levels, interruption,
  save/restore, and an injected provider error.
- Revocation, expired authorization, denied consent, and rate limiting recover
  without leaking credentials or duplicating commands.
- The selected model profile passes the guide thresholds across three runs and
  the audio outcome suite.
- The chained-path p95 targets in `docs/testing.md` are met on the documented
  reference environment, or a revised target is approved with evidence before
  beta.
- Estimated usage is within 10% of provider-reported/invoiced test usage when
  comparable usage data is available; discrepancies are surfaced rather than
  hidden.
- A per-session warning and hard cost cap is tested, and the profile's measured
  cost per active play hour is published before it can become the default.
- No long-lived credential appears in a browser bundle, URL, client log,
  analytics event, or committed fixture.

### Deferred

Unqualified model combinations, automatic cross-provider failover, and support
for models that fail command safety or spoiler tests regardless of price.

## M5 — OpenAI Realtime mini path

### Goal

Offer a lower-latency integrated voice experience using the OpenAI API when a
supported Realtime mini-class model meets the same product gates.

### Deliverables

- Server-minted, short-lived client credentials and a browser realtime transport
  using the provider's currently supported pattern.
- Realtime session lifecycle, tool schemas, tool-call correlation,
  interruption/barge-in, cancellation, reconnection, and clean shutdown.
- A strict boundary that validates every engine command before at-most-once
  commit.
- Separate guide and narrator semantics; original engine output remains
  canonical and is not silently rewritten.
- Context compaction that preserves observed facts, command results, spoiler
  preference, and unresolved clarification without sending an unbounded
  transcript.
- Current-model capability detection and a server-controlled allowlist.
  Deprecated models are rejected even if they appear cheaper.
- Usage/cost telemetry, configurable session caps, and a comparison benchmark
  against the OpenRouter reference path.
- Clear API-account and billing documentation. A ChatGPT or Codex
  subscription/login is not represented as API authorization unless OpenAI
  provides and documents that capability for third-party apps.

### Exit criteria

- A 30-minute reference replay and interruption stress run complete with no
  duplicate or unvalidated engine command.
- The candidate passes guide safety/quality thresholds three times and all
  applicable realtime provider contracts.
- The realtime p95 target in `docs/testing.md` is met in the reference
  environment.
- Session close stops audio transfer and provider usage; credential
  expiry/reconnect paths are proven.
- Estimated cost per active play hour is published, the hard session cap works,
  and the profile is not the default if it exceeds the budget selected by
  maintainers after comparative benchmarking.
- A provider outage leaves the game state recoverable and offers an explicit
  provider-selection/retry path; it does not silently change billing or privacy
  terms.

### Deferred

Unsupported legacy models, ChatGPT/Codex consumer-login reuse, voice cloning,
and always-open background sessions.

## M6 — Hugging Face suitability gate (conditional)

### Goal

Determine whether Hugging Face can provide a supportable open-model voice
profile without lowering safety, latency, accessibility, or operational
standards.

This milestone is conditional and is not a blocker for M7 when another provider
path is production-ready.

### Discovery criteria

Verify current official support for:

- delegated user authorization with the minimum inference scope;
- usable transcription, structured/tool-capable guide inference, and narration,
  either within Hugging Face or through an explicitly approved combination
  limited to this roadmap's providers;
- streaming and cancellation semantics;
- predictable model/provider selection and availability;
- model and dataset licensing appropriate for project claims;
- usage visibility, account billing, data handling, and token revocation;
- latency and quality under the same reference replays.

### Go decision

Proceed only if a candidate profile:

- can satisfy the provider contracts without private or reverse-engineered APIs;
- passes all zero-tolerance guide assertions and reaches the same quality
  thresholds;
- meets the documented chained latency target or has a compelling, explicitly
  accepted accessibility/cost tradeoff;
- exposes enough usage information to enforce or conservatively estimate a hard
  session budget;
- has a clear supported authentication and credential-storage design;
- is maintainable without pinning abandoned or unstable endpoints.

If any criterion fails, record a dated no-go decision with evidence, keep the
generic interfaces intact, and defer the integration without blocking release.

### Deliverables after a go decision

- Capability manifest and qualified model profile.
- Provider auth plus applicable transcription, guide, and narration adapters.
- Shared contract/evaluation coverage, capped live smoke tests, cost/latency
  metrics, and provider disclosure.
- An `experimental` label until the 30-minute reference replay, revocation/error
  paths, and three-run guide thresholds pass.

### Exit criteria

- Either the no-go decision is documented and no partial user-facing integration
  remains, or the completed profile meets the same M4 security, replay, quality,
  latency/cost, and disclosure gates.

## M7 — Beta hardening and 1.0 release

### Goal

Turn the qualified engine, guide, voice shell, and provider paths into a
supportable open-source release.

### Deliverables

- First-run microphone/provider setup with plain-language privacy and billing
  disclosure.
- Resilient local save/resume, format migration, corrupt-save recovery, export,
  import, and deletion.
- Provider selector showing capability, health, experimental status, and cost
  basis without automatically changing provider.
- Settings for spoiler level, narration rate, guide/narrator treatment,
  transcript visibility, reduced motion, and data retention.
- Production observability dashboards and alerts for safety rejects, command
  duplication, provider errors, latency, missing usage, and spend anomalies.
- Operational kill switches for individual providers/models and a rehearsed
  rollback procedure.
- Contributor setup, self-hosting, architecture, privacy, security-reporting,
  accessibility, model-qualification, and release documentation.
- Reproducible builds, release artifacts, checksums/SBOM, dependency/license
  reports, and signed/tagged release process where supported.
- Public beta feedback flow that does not require collection of raw audio or
  transcripts.

### Beta exit criteria

- At least one complete provider path is qualified; a second path may remain
  optional or experimental.
- Full golden replays, guide/speech evaluations, supported browser end-to-end
  tests, save migration tests, and provider smoke tests pass.
- The security checklist and manual VoiceOver/Safari plus NVDA/Chrome
  accessibility matrix have no open blocker.
- The incident drill demonstrates model disablement, spend containment,
  state-safe retry, and restoration from a pre-incident save.
- Reference latency and cost results are published with model identifiers, test
  date, network assumptions, and price source.
- No S0/S1 issue is open; all accepted S2/S3 issues have documented impact and
  owners.

### 1.0 exit criteria

- Beta telemetry shows zero duplicate command commits and no unresolved
  state-integrity defect across the defined observation period.
- Qualified model profiles continue to pass the three-run evaluation threshold
  immediately before release.
- Installation/self-hosting succeeds from a clean environment using only
  documented steps.
- License/provenance records match the exact release contents.
- Saves produced by the latest beta restore successfully in the release
  candidate.
- The release can be rolled back without invalidating or losing existing local
  saves.

## 4. Explicitly out of scope for 1.0

- Wispr Flow or other unlisted voice providers.
- Local/offline speech or language models.
- A text-first gameplay experience; visible text remains an accessibility and
  debug capability.
- Reuse of ChatGPT or Codex consumer login/subscription as OpenAI API
  authorization unless an official supported integration becomes available.
- Cloud accounts and cross-device save synchronization.
- Always-listening microphones and wake-word detection.
- Native iOS, Android, or desktop applications.
- Multiplayer, spectators, shared worlds, or guide-to-guide interaction.
- Autonomous agent play, generated rooms/puzzles, or any guide mutation outside
  canonical game commands.
- Zork II/III or other story files until Zork I, provenance, and save
  compatibility are stable.
- Voice cloning, celebrity voices, or redistribution of unlicensed game
  artwork/audio.

Out-of-scope work can be proposed after 1.0 through a new architecture decision
and milestone. It must not be smuggled into provider adapters or the guide
prompt as an undocumented dependency.

## 5. Release strategy summary

Build from the deterministic center outward:

1. Prove legal provenance and reproducible foundations.
2. Make the engine replayable and state-safe.
3. Bound and evaluate the Dungeon Guide before giving it a microphone.
4. Prove the voice UX with deterministic fakes.
5. Qualify providers one profile at a time against shared contracts.
6. Release only after accessibility, privacy, latency, cost, rollback, and
   regression evidence agree.

This ordering keeps provider experimentation reversible and ensures that the
game remains recoverable even when speech recognition, model behavior, pricing,
or provider APIs change.
