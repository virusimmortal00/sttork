# Zork Voice

Zork Voice is a free, open-source, voice-native way to experience the
open-source Zork trilogy. A conversational Dungeon Guide sits between the player
and the original game: it understands natural intent, teaches the parser, asks
clarifying questions, and offers spoiler-controlled guidance. The original
Z-machine remains the sole authority over the world.

The primary experience is audio-first and nearly screenless. Visible
transcripts, text input, captions, and detailed diagnostics remain available as
explicit accessibility and debug capabilities.

This repository is in M0 foundation work. Its provider-neutral contracts,
ordered-event primitives, provenance policy, hermetic TypeScript checks, and
project-owned reproducible Z-machine fixture are implemented. ADR-0009 selects
the source-pinned Dork TypeScript core as the production candidate, but it is
not yet accepted.

## Product invariants

- Voice is the default interface; visuals are optional context.
- The Dungeon Guide may propose commands but cannot mutate game state.
- Every in-world action passes through the game-engine command boundary;
  explicit lifecycle operations such as restore stay inside the engine adapter.
- Original game output is preserved and distinguishable from AI commentary.
- Ambiguity triggers clarification rather than an invented action.
- Hints are opt-in and governed by an explicit spoiler ladder.
- Provider-specific behavior stays behind capability-based interfaces.
- OpenRouter is the first user-funded open-model path, OpenAI Realtime is the
  integrated premium path, and Hugging Face is conditional on conformance and
  latency testing.
- The game remains usable without a project-operated inference subsidy.

## Documentation

Start with the [documentation index](docs/README.md).

- [High-level strategy](docs/strategy.md)
- [System architecture](docs/architecture.md)
- [Dungeon Guide contract](docs/guide-agent.md)
- [Voice-first experience](docs/experience.md)
- [Testing and regression strategy](docs/testing.md)
- [Milestones](docs/milestones.md)
- [Settled decisions and open questions](docs/project-decisions.md)
- [Provider and upstream research](docs/provider-research.md)
- [Development setup and commands](docs/development.md)
- [Repository operations](docs/repository-operations.md)
- [Architecture decision records](docs/adr/README.md)
- [Instructions for coding agents](AGENTS.md)

## Project status

M0 is in progress and is not complete. The repository has selected its project
license, pinned Node/pnpm/TypeScript foundation, and accepted a deterministic
minimal-story compiler/artifact pipeline. The repository now includes the
audited Dork core and MIT-licensed Zork I Release 119 story. The candidate
inputs therefore include the game data needed for Zork I, and the planned
release is intended to require no separate story download.

The exact candidate is a modified, unendorsed fork: upstream Dork commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622` plus behavioral patch SHA-256
`a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605`. A bounded
Version 3 schema-v2 checkpoint and cold-restore slice, including
RANDOM/reseed/RESTART equivalence, has landed. The isolated Slice 1 bridge now
adds real browser Worker/factory restore, outer snapshot integrity, bounded
receipts, exact-retry quarantine, and one Chrome 151 restrictive-CSP smoke, but
all six M0 interpreter gates remain non-pass. Safari, watchdog behavior, 50-turn
and full behavioral/conformance coverage, and final bundle/SBOM evidence remain.
The working-title review, GitHub protection settings, and remaining security
evidence must also pass. See [milestones](docs/milestones.md) and the
[M0 interpreter evidence ledger](docs/m0-interpreter-evidence.md). The
[dated Dork spike](docs/m0-dork-spike-2026-08-18.md) records the bounded Worker,
checkpoint, receipt, and RNG evidence. The earlier
[Bocfel spike](docs/m0-bocfel-spike-2026-08-17.md) remains oracle/fallback
evidence.

Initial Voice Slice 2 has also landed as a bounded, provider-neutral guide
checkpoint: strict decision validation, opening grammar, observed-object command
grounding, deterministic parser help, and fake-model guide-to-engine
regressions. This is not M2 completion or live-model qualification; observed
memory, hint policy, full grammar generation, and provider evaluation remain.

## Development

Use Node 24.19.0 and pnpm 11.19.0, then run:

```sh
pnpm install --frozen-lockfile
pnpm run ci
```

The initial install requires the npm registry. `pnpm run ci` itself makes no
provider calls and requires no provider credentials. Pull-request CI also runs a
networked high-severity audit of all locked dependencies and rebuilds the
minimal story in a separate required job. See the
[development guide](docs/development.md) for focused commands, networked audits,
and test conventions.

## Licensing note

The Zork I, II, and III source releases are available under the MIT License.
This repository bundles the exact Zork I Release 119 compiled story with its
verbatim Microsoft MIT notice and hash-locked provenance. That grant does not
include trademarks, commercial packaging, logos, or other excluded assets. Zork
II/III remain outside the initial compatibility slice and require their own
artifact records before import.

Project-owned code and documentation use the [MIT License](LICENSE). Third-party
work retains its own license, notices, and provenance.
