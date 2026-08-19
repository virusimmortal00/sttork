# Project decisions

This is a lightweight decision register. It prevents settled product choices
from being accidentally reopened or silently changed during implementation. For
a decision with broad architectural consequences, add a dated ADR before
changing it.

## Settled decisions

### Voice is the primary interface

The ordinary play loop is voice input and spoken output. The default visual
surface contains only essential status and controls. It is not a terminal with
voice bolted on.

[ADR-0011](adr/0011-transient-command-and-activity-status.md) treats a single
event-derived `Command: …` cue as essential trust status. It is transient, comes
only from the canonical engine-request boundary, and clears through semantic
events rather than becoming persistent prose. Decorative activity may animate
active states, but stable status text remains authoritative and reduced motion
disables animation.

Visible transcript and text input remain supported accessibility capabilities.
Detailed raw state, tool calls, provider timing, and cost data belong in an
explicit debug mode.

### The original engine is authoritative

The Z-machine determines legal actions and all world mutations. The guide can
translate, clarify, explain, recall observed information, and request that a
canonical command be executed. It cannot write inventory, locations, flags,
score, or save memory directly.

### The AI is an active Dungeon Guide

The guide is more than transcription. It understands player intent, explains the
command language, resolves references from observed context, asks for
clarification, remembers previously observed facts, and provides graduated hints
when requested.

It does not silently solve puzzles, invent game facts, or expose unseen world
state.

### Original output and AI speech are distinct

Players must be able to tell whether a statement came from the game, the Dungeon
Guide, or the application. This distinction is represented in typed events and
conveyed through voice, earcons, captions, or labels as appropriate.

### Provider-neutral core

Game state, guide policy, command grounding, event history, saves, and tests do
not depend on one inference vendor. Provider adapters declare capabilities
rather than being selected through scattered conditionals.

Initial provider posture:

- OpenRouter: primary user-connected open-model path using its supported OAuth
  flow and a curated model allowlist.
- OpenAI API: integrated Realtime path, starting evaluation with the current
  lower-cost Realtime mini model rather than a deprecated snapshot.
- Hugging Face: conditional open-model path, enabled only after the chosen
  speech, tool-use, narration, latency, and OAuth flow pass the same contracts.

Wispr Flow and local inference are out of scope for the initial roadmap.

### Authentication is not the game architecture

Local game saves and the core play loop must not depend on a project account.
Provider authorization and optional cloud save identity are separate concerns.
ChatGPT or Codex consumer credentials are not treated as third-party API
credentials.

### Hints require explicit spoiler control

The player chooses how much help to receive. The default guide may offer parser
help and ask whether a hint is wanted, but it must not cross the configured
spoiler level.

### Replayability is a first-class requirement

Normalized player turns, guide decisions, canonical commands, engine outputs,
and relevant state identifiers are captured as typed events. Provider audio may
be non-deterministic; the semantic turn must be replayable without calling an
external model.

## Provisional decisions under evidence gates

### Dork is the interpreter candidate, not yet the selected runtime

[ADR-0009](adr/0009-dork-typescript-interpreter-candidate.md) supersedes the
proposed Bocfel path and selects exact Dork commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622` plus behavioral patch SHA-256
`a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605` as the
primary M0 candidate. The runtime compatibility ID binds both identities. This
is a modified, unendorsed project fork; it does not become a production runtime
until every gate passes.

Do not install the npm package named `dork`: it is unrelated software. The
candidate repository has no release tag or package version and is consumed only
from the pinned source identity recorded in provenance.

Dork must pass the dedicated-worker, turn-boundary, opaque-save-byte,
cold-restart, conformance, and redistribution/SBOM gates in
[the M0 evidence ledger](m0-interpreter-evidence.md). The bounded fork now
captures Version 3 post-decode READ checkpoints, including interpreter PRNG
mode, gameplay state, and a checkpointable reseed stream, and stages an
in-process replacement session before an atomic swap. Its machine checkpoint and
envelope are schema v2 with adapter compatibility ID
`zork-voice-dork-checkpoint-v2`. Its complete wire encoding is locked by a codec
regression and the candidate verifier to golden SHA-256
`79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba`. An in-memory
project-owned Version 3 test proves positive RANDOM—including deterministic tail
rejection for unbiased non-divisor ranges—RANDOM 0, negative predictable mode,
and RESTART equivalence across cold restore. Automatic snapshot and cold-restore
evidence is `running`, not `pass`.

The isolated Slice 1 spike now has a real Worker/factory swap, outer
`EngineSnapshot` SHA-256 check, bounded receipt journal, exact-retry quarantine,
and one Chrome 151 restrictive-CSP smoke. It still lacks Safari and full
browser-matrix evidence, watchdog termination, an operand-zero READ fixture, the
complete status/style/general-restart matrix, a 50-turn cold-worker restore,
exact-fork conformance, and final bundle/SBOM closure. Dork's separate
story-driven save bytes are not Quetzal despite its README wording and are not
the project checkpoint. SHA-256 checks integrity, not authenticity.

Bocfel 2.5.1 remains the independent behavioral oracle and fallback. The
[2026-08-17 disposable spike](m0-bocfel-spike-2026-08-17.md) remains useful
historical evidence, but none of its gate results transfers to Dork.

## Assumptions to validate

- The bounded Dork Worker bridge can complete Safari, watchdog, long cold-run,
  conformance, and release-artifact evidence without weakening `EnginePort` or
  growing into disproportionate private interpreter maintenance.
- The admitted Zork I Release 119 story remains bound to its immutable
  historical-acquisition record; any future reconstruction or Zork II/III
  artifact needs its own reproducible build or approved acquisition evidence.
- OpenRouter's available open-model stack can meet the initial turn-latency and
  structured-decision requirements.
- One audio session can provide acceptable differentiation between narrator and
  guide, or separate synthesis paths can do so without unacceptable delay.
- The browser is an acceptable initial delivery surface for microphone,
  playback, credentials, saves, and accessibility requirements.

An assumption becoming false should trigger an ADR and roadmap adjustment, not
an undocumented workaround.

## Open questions

- Will the pinned Dork fork pass all six M0 gates with a bounded maintenance
  delta, or must the Bocfel fallback be reinstated?
- For Zork II/III or any replacement reconstruction, should licensed story
  artifacts be committed, fetched reproducibly, or built in release automation?
- Which open models form the first curated OpenRouter profile?
- Can Hugging Face satisfy narration as well as transcription and guide
  reasoning, or should its supported profile be intentionally hybrid?
- Is push-to-talk the launch interaction, or can voice-activity detection meet
  privacy, reliability, and cost targets in time?
- How are guide and narrator identities differentiated in the first release: two
  voices, one voice plus earcons, or another accessible convention? A 2026-08-19
  device smoke found the hardcoded Nova-to-Onyx handoff perceptible but
  initially confusing: the player interpreted it as one guide changing voice.
  Preserve the distinct semantic roles, but treat the current voice pair as
  prototype configuration and require an intentional first-run sample, cue, or
  preference before settling this presentation choice.
- What measured latency and cost budgets are achievable on representative
  desktop and mobile networks?
- Which project name can be used without implying trademark sponsorship?

Resolve these questions with prototypes, measurements, license review, or user
testing. Do not settle them by assumption alone.

`Zork Voice` is a development working title only. The
[`zork-working-name-review`](../provenance/records/zork-working-name-review.json)
record blocks treating it as an approved public brand until qualified review or
a rename resolves the trademark question.
