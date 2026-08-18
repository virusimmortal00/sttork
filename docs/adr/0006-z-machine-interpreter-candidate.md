# ADR-0006: Evaluate a permissive-only Bocfel WebAssembly build

- Status: superseded
- Date: 2026-08-17
- Owners: maintainers
- Superseded by: ADR-0009

ADR-0009 replaces Bocfel as the primary candidate after this proposed path
proved disproportionately complex to package and adapt. Bocfel remains a
behavioral oracle and fallback, and the evidence recorded here remains
historically useful; none of it transfers to the Dork candidate.

The sections below preserve the decision and acceptance plan as they stood on
2026-08-17. Their references to the evidence ledger are historical; ADR-0009
reset that ledger for Dork and it can no longer accept this superseded ADR.

## Context

ADR-0002 requires the authoritative Z-machine to run in a dedicated browser
worker behind `EnginePort`. ADR-0003 requires opaque save bytes that survive a
worker restart. ADR-0001 requires third-party licenses and redistribution units
to remain distinguishable from project-owned MIT code.

The current browser-proven path is Bocfel compiled through Emglken, but its
stock API is a Glk browser application interface rather than the required engine
port. The aggregate `emglken@0.7.2` npm package also declares `GPL-2.0` and
contains GPL-licensed Scare and TADS builds, even though Bocfel and the relevant
Emglken/RemGlk components are individually MIT-licensed.

Research and primary sources are recorded in
[`docs/interpreter-research.md`](../interpreter-research.md). At the time, no
candidate interpreter code or artifact had been imported. A later disposable
worker/persistence spike was recorded separately as partial evidence; it did not
accept this ADR.

## Decision

At the time, the decision was to treat **Bocfel 2.5.1** as the M0 candidate,
using a custom Emglken-style JavaScript/WebAssembly build that contains only
audited permissively licensed components required for Bocfel. The aggregate
`emglken` npm package and the full Parchment distribution are not candidate
artifacts and must not be added to the dependency graph, vendored, or
redistributed by default.

Under that superseded decision, Bocfel could have become accepted only after all
six gates below passed for the same artifact. Until then:

- production packages may depend only on the repository's engine interfaces and
  test doubles;
- a later spike must remain isolated and disposable;
- no generated interpreter JavaScript/WebAssembly is a release artifact;
- no Zork story source or binary is implied or authorized by this decision; and
- documentation must continue to call Bocfel a candidate.

If Bocfel fails a gate or requires disproportionate maintenance, evaluate
**ifvms/ZVM 1.1.6** as the version 3 fallback behind the same `EnginePort`. The
fallback must pass the same six gates. Its `new Function` JIT and resulting
`unsafe-eval` CSP requirement are explicit security risks, not accepted
exceptions.

### Acceptance gates

1. **Dedicated worker.** A pinned candidate artifact boots and runs in a real
   Web Worker on the ADR-0005 Chrome and Safari baseline. The test must exercise
   the production CSP and prove that UI DOM, provider, guide, and persistence
   code cannot acquire mutable interpreter state. Stock Emglken's
   `ENVIRONMENT=node,web` setting is not evidence for this gate.
2. **Turn boundary.** The adapter must identify a stable request-for-input
   boundary, submit exactly one newline-free canonical command, and return
   exactly one complete `ExecuteResult`. Boot prose, status-window updates,
   parser errors, prompts, styled/multiline output, and the following input
   request must be classified without dropping, duplicating, paraphrasing, or
   leaking output into the next turn.
3. **Opaque save bytes.** `snapshot()` must return nonempty binary state without
   sending a visible game command or opening a player-facing file dialog.
   `restore()` must reject a mismatched or corrupt story/interpreter snapshot
   before mutating the active session. Save bytes, not command replay or a Glk
   UI projection, remain authoritative.
4. **Cold-restart equivalence.** After a committed turn, terminate the worker,
   create a new worker, restore the captured bytes, and run the same subsequent
   command sequence as an uninterrupted control. Exact normalized output, engine
   revisions, and state digests must agree, including a longer run that spans at
   least 50 committed version 3 turns.
5. **Interpreter conformance.** The pinned build must pass the applicable
   Z-machine standard suite plus repository-owned fixture scenarios for boot,
   input, parser failure, mutation, randomness policy, save/restore, restart,
   and termination. Any Zork compatibility run is additional and may occur only
   after separate story provenance approval. Failures may not be normalized or
   allowlisted without a documented compatibility decision.
6. **SBOM and redistribution.** A generated-artifact SBOM must identify every
   linked or emitted component, exact source revision and hash, license, local
   patch, build tool, and required notice. Automated review must prove the
   candidate artifact excludes Scare, TADS, and other unapproved GPL code, and
   that all licenses and notices are compatible with the intended distribution.

Passing a single gate or demonstrating gameplay in Parchment does not accept the
candidate. A gate failure remains visible in the evidence ledger. Maintainers
either repair and rerun the candidate, mark this ADR rejected, or propose a new
candidate; they do not weaken `EnginePort` or the licensing boundary around the
failure.

## Consequences

The preferred interpreter has mature Z-machine behavior and an actively used
browser path while the application remains isolated from Glk and provider
details. A custom build and bridge add ownership: the project must pin its
toolchain, maintain the worker-facing adapter, test save semantics, and audit
the complete generated artifact.

The project avoids accidentally importing the aggregate npm package's GPL
redistribution posture into an otherwise MIT distribution. It also delays
interpreter acceptance until persistence and restart behavior are measured
rather than inferred from normal in-game save support.

M1 implementation cannot begin against a production interpreter dependency until
this M0 decision is accepted. Interface work and repository-owned fixture work
may continue independently.

## Alternatives considered

- **Aggregate `emglken@0.7.2`.** Rejected as the candidate artifact because its
  package declares `GPL-2.0` and publishes GPL interpreter builds alongside
  Bocfel. Depending on it while using only one export does not change the
  redistributed package.
- **Full Parchment application.** Retained as a reference integration and test
  oracle, but not selected as a headless engine library. Its UI, Dialog, and
  multi-interpreter distribution are broader than `EnginePort`.
- **ifvms/ZVM 1.1.6.** Retained as the fallback because it is MIT, pure
  JavaScript, version 3 capable, and has Quetzal/autosave code. It is less
  preferred because its released API is old, untyped, Glk-oriented, incomplete
  for some standard behavior, and based on dynamic JIT compilation.
- **Newer TypeScript and Rust/WebAssembly interpreters.** Current candidates
  reviewed in the research snapshot have materially less release, packaging,
  conformance, or maintenance evidence. Their cleaner-looking APIs do not
  outweigh that gap yet.

## Validation

At the time, the intended normative validation record was the M0 evidence
ledger. The [2026-08-17 spike](../m0-bocfel-spike-2026-08-17.md) is preserved as
partial historical evidence. ADR-0009 has since reset
[`docs/m0-interpreter-evidence.md`](../m0-interpreter-evidence.md) for Dork, so
no result in the current ledger can accept ADR-0006.
