# AGENTS.md

This file governs work throughout the repository. More specific `AGENTS.md`
files may add local rules but may not weaken the invariants below.

## Mission

Build a free, open-source, voice-native interface to the MIT-licensed Zork
trilogy. A conversational Dungeon Guide helps players express intent and learn
the game while the original Z-machine remains the only authority over world
state.

The primary experience is nearly screenless. Visible transcripts, text input,
captions, and diagnostics are supported accessibility/debug surfaces, not the
default presentation.

## Read before changing code

Read the documents relevant to the change:

- `docs/strategy.md` for scope and product priorities.
- `docs/architecture.md` for component and trust boundaries.
- `docs/guide-agent.md` for agent behavior, tools, memory, and spoiler policy.
- `docs/experience.md` for audio-first UX and accessibility.
- `docs/testing.md` for required verification and regression handling.
- `docs/milestones.md` for sequencing and exit criteria.
- `docs/project-decisions.md` for settled choices and open questions.
- `docs/provider-research.md` before changing provider, model, authentication,
  pricing, or upstream-game assumptions; revalidate time-sensitive facts.

If a requested implementation contradicts a settled decision, identify the
conflict and update the decision through an ADR rather than silently drifting.

## Non-negotiable invariants

1. The Z-machine is authoritative. AI code must not mutate game memory, object
   locations, flags, inventory, score, RNG, or saves outside the engine's
   command/save interfaces.
2. Only a canonical engine command may cause an ordinary in-world mutation.
   Explicit lifecycle operations such as restore or restart use separately
   validated engine-adapter APIs and confirmation policy. Clarifying,
   explaining, recalling, and hinting are non-mutating operations.
3. AI output, original game output, player speech, and system messages remain
   distinct typed events. Never blend them into an unattributed string.
4. Ambiguous or low-confidence intent asks for clarification. Do not choose an
   irreversible or materially different action on the player's behalf.
5. The guide may use only player-observed facts unless the player explicitly
   requests a hint at a level that permits more information.
6. Never expose secrets, long-lived provider keys, OAuth refresh tokens, raw
   authorization codes, or unredacted sensitive audio in client logs, events,
   fixtures, snapshots, or telemetry.
7. Provider adapters may not leak vendor response objects into core domain
   types. Normalize at the boundary.
8. The default UI remains voice-first and visually minimal. New persistent
   visual elements require a demonstrated state, safety, or accessibility need.
9. Accessibility surfaces are product features. They must not be removed to
   simplify the default visual design.
10. Do not import Zork code, story artifacts, artwork, packaging, logos, or
    names without recording provenance and verifying the exact license scope.

## Architectural boundaries

Keep the core organized around these conceptual packages even if names evolve:

- `game-engine`: deterministic Z-machine adapter, command execution, saves.
- `guide-core`: provider-neutral decisions, policy, hint limits, memory.
- `command-knowledge`: parser vocabulary, syntax, and observed affordances.
- `events`: versioned domain event schemas and replay.
- `providers`: speech, reasoning, and narration capability adapters.
- `experience`: audio session state and optional transcript/debug renderers.
- `server`: OAuth exchange, ephemeral credentials, optional encrypted sync.

Dependencies point inward toward domain contracts. The engine must not import AI
providers. Provider implementations must not own saves or canonical game state.
UI components must not parse vendor responses.

## Agent behavior rules

- Treat the guide as a constrained interpreter and companion, not an alternate
  game master.
- Prefer a small explicit tool set. `execute` is the sole mutating gameplay
  tool.
- Validate every proposed engine command against schema and policy before
  execution.
- Preserve original engine output verbatim in its event. A narrator may speak
  it, but an LLM must not silently rewrite the canonical record.
- Make spoiler level explicit in state and in hint evaluation fixtures.
- Do not expose a full walkthrough or unseen map in ordinary guide context.
- Bound conversational memory. Store structured observed facts and summaries,
  not an ever-growing provider transcript.
- On provider failure, preserve the last confirmed state and emit a recoverable
  system event. Never guess whether a command executed.

## Provider rules

- Implement capability contracts for transcription, guide reasoning/tool use,
  narration, streaming, cancellation, usage reporting, and authentication.
- A profile may combine providers; do not assume one vendor supplies all
  capabilities.
- OpenRouter is the first user-connected/open-model integration.
- OpenAI Realtime begins with the current supported lower-cost mini model and
  short-lived browser credentials minted by a trusted server. Do not select a
  deprecated model merely because an old price appears attractive.
- Hugging Face is enabled only for capabilities that pass the same conformance,
  latency, accessibility, and security gates as other profiles.
- Wispr Flow and local inference are currently out of scope.
- Put model IDs, limits, and feature availability in configuration. Never bake
  time-sensitive pricing or provider catalog assumptions into domain logic.

## Event and state rules

- Domain events are versioned, serializable, and attributable.
- Record the normalized transcript, guide decision, canonical command, engine
  result, and correlation ID needed to replay a semantic turn.
- Audio blobs are optional, separately retained, and excluded from normal test
  fixtures and telemetry.
- A save identifies the game/story build and schema versions needed to restore
  it safely.
- Migration failures must be explicit and non-destructive.
- Cancellation and interruption are states, not exceptional afterthoughts.

## Testing requirements

Follow `docs/testing.md`. At minimum:

- Engine changes require deterministic command/output and save/restore tests.
- Guide changes require intent, ambiguity, command-grounding, memory, and
  spoiler-boundary evaluations.
- Provider changes require recorded contract tests that run without billable
  network calls, plus separately tagged live smoke tests when credentials exist.
- Experience changes require keyboard, screen-reader, transcript, interruption,
  and reduced-motion checks appropriate to the affected surface.
- Event-schema changes require replay and migration fixtures.
- A bug fix requires a failing regression test or a documented reason that one
  cannot be created.

Canonical repository commands are:

- `pnpm format:check` verifies formatting; `pnpm format` applies it.
- `pnpm lint` runs ESLint with zero warnings allowed.
- `pnpm typecheck` runs the strict TypeScript configuration.
- `pnpm test:unit`, `pnpm test:contract`, and `pnpm test:integration` run the
  current focused suites.
- `pnpm test` runs every current non-live Vitest test.
- `pnpm check:provenance`, `pnpm check:licenses`, and `pnpm check:secrets` run
  the repository policy checks.
- `pnpm story:verify` authenticates the checked-in minimal story without a
  compiler. `pnpm story:build` rebuilds it twice with the pinned Inform 6.44
  compiler; `pnpm story:build:check` compares that rebuild without writing.
- `pnpm dork:verify` authenticates the source-pinned Dork core, preserved
  notices, and bundled Zork I Release 119 story without network access.
- `pnpm dork:worker:build` emits the ignored Slice 1 browser-Worker smoke graph;
  `pnpm dork:worker:serve` serves it on loopback under restrictive CSP for a
  manual browser run. Neither command accepts Dork or produces a release bundle.
- `pnpm check` is the hermetic source gate: formatting, linting, typechecking,
  every non-live test, fixture verification, provenance, licenses, and secrets.
- `pnpm build` emits the current TypeScript build; `pnpm run ci` runs `check`
  and then `build`, matching the deterministic part of the CI verify job. The
  explicit `run` is required because pnpm itself owns a different built-in
  `pnpm ci` clean-install command.
- `pnpm audit:all` and `pnpm audit:production` query the live advisory service
  for all or production-only dependencies. They require network access and are
  not part of the hermetic source gate. The GitHub verify job runs the full
  audit after `pnpm run ci`.

There is no provider-live, automated browser-test, or release command until its
real implementation and non-empty tests land. Do not invent competing or
successful placeholder scripts. See `docs/development.md` for setup and command
details.

## External calls and test fixtures

- Unit and normal integration tests must not call paid APIs.
- Sanitize recorded provider responses and keep only fields required by the
  contract.
- Live tests are opt-in, clearly labeled, budget-limited, and safe to skip when
  credentials are absent.
- Never commit real player audio without explicit consent and a documented
  retention purpose. Prefer generated or openly licensed test speech.

## Security and privacy

- Use OAuth Authorization Code with PKCE where supported.
- Keep long-lived credentials server-side and encrypted at rest. Browser
  sessions receive only the narrowest short-lived credential available.
- Treat transcripts and voice recordings as sensitive user data.
- Default to not retaining raw audio.
- Redact credentials and personal data before logs leave the process.
- Preserve an auditable distinction between provider authorization, project
  identity, and optional cloud-save identity.
- Fail closed when tool authorization or command provenance is uncertain.

## Licensing and attribution

- Preserve upstream license text and copyright notices verbatim.
- Record source URL, revision, build steps, patches, and artifact hashes for
  imported game material.
- The source-code grant does not imply trademark, logo, packaging, or marketing
  rights.
- Audit interpreter and build-tool licenses before selection. Avoid introducing
  a dependency whose redistribution obligations conflict with the intended
  project distribution without documenting and accepting that decision.
- Keep third-party notices reproducible from repository metadata.

## Change workflow

1. Read the relevant docs and current implementation before editing.
2. State the invariant or milestone the change advances.
3. Make the smallest coherent change across domain code, adapters, UI, tests,
   and docs.
4. Add or update regression coverage before declaring the work complete.
5. Run the narrow checks first, then the repository's full required suite.
6. Review diffs for secrets, accidental game assets, provider coupling,
   inaccessible UI, and undocumented decision changes.
7. Update milestone status only when its exit criteria are actually met.

## Definition of done

A change is done when it:

- preserves all non-negotiable invariants;
- has proportionate automated verification and any required manual evidence;
- handles cancellation, retries, and failure without corrupting confirmed game
  state;
- is observable without logging sensitive audio or credentials;
- updates affected contracts and decision docs;
- introduces no unexplained provider, licensing, accessibility, latency, or
  recurring-cost regression.

Passing a happy-path demo alone is not done.
