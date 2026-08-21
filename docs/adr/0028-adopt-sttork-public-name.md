# ADR-0028: Adopt STTork as the independent public project name

- Status: accepted
- Date: 2026-08-21
- Owners: maintainers

## Context

`Zork Voice` was a development working title. The MIT grant for the admitted
Zork story covers code and game data but grants no rights to Zork trademarks or
brands. Using that mark as the leading project identity could imply a sponsored
or official adaptation even when an adjacent disclaimer denied endorsement.

The project needs a distinct name in the same posture as Dork: its own primary
identity, with third-party game names used only to identify compatibility,
provenance, and history.

## Decision

Adopt **STTork**, pronounced “stork,” as the project name. The spelling makes
speech-to-text visible without making a third-party game name part of the brand.
The public description is:

> A voice-native interface for classic text adventures.

Product explanations may say that STTork layers speech-to-text, a constrained
agentic Dungeon Guide, and text-to-speech over an authoritative Z-machine game.
Compatibility statements must say that the current target is Zork I Release 119
only. Zork II and Zork III are future possibilities, not current support.

Use `Zork`, `Infocom`, and related names only when needed to identify the
licensed story, compatibility, provenance, or history. Do not use third-party
logos, packaging, trade dress, or language implying sponsorship. Preserve the
project's explicit non-endorsement statement.

Use the `@sttork/*` workspace scope and `sttork` repository/package identity.
Pre-release developer-only environment variables, request headers, HTML
metadata, and temporary paths adopt the STTork name in the same change.

Do not rotate the existing `zork-voice-dork-checkpoint-v2` compatibility ID.
That value is part of a hash-locked candidate checkpoint wire contract, not a
public brand. Rotating it without a checkpoint semantic change would destroy
useful compatibility evidence. The legacy local voice-preference storage key and
dated Bocfel evidence paths likewise remain stable to avoid silent local
preference loss or rewriting historical evidence. Documentation labels these as
preserved legacy identifiers.

The Dork boundary must remain conspicuous: STTork vendors only the audited core
subset at the pinned commit, applies an identified local behavioral patch,
preserves Dork's MIT license and ancestry notice, and calls the result a
modified, unendorsed downstream fork. It must not imply upstream support or
production acceptance while an ADR-0009 gate remains non-pass.

## Consequences

STTork has an independent, pronounceable identity while retaining precise
descriptive references to the only currently supported game. Package and
developer-interface renames are breaking for unreleased local tooling, so they
land together before a public release.

The name's initial availability sweep found no exact GitHub, npm, or PyPI
software project. An unrelated industrial controller uses `STTORK`; that is not
treated as evidence of sponsorship or a conclusive trademark determination. The
project claims no exclusive trademark right from this ADR. A qualified clearance
review remains required before a promoted release or registered mark.

## Alternatives considered

- **Keep `Zork Voice`.** Rejected because the third-party mark would remain the
  project's primary identity.
- **AIventure.** Rejected because multiple games and businesses already use it,
  including a directly competing AI text-adventure product.
- **STTventure.** Rejected as difficult to pronounce and overly focused on one
  pipeline capability.
- **STTork as an internal codename only.** Rejected because its intended “stork”
  pronunciation supplies a usable independent public identity.

## Validation

- Public metadata and visible UI use STTork consistently.
- The README states the STT → Guide → authoritative game → TTS relationship,
  Zork I-only scope, and exact Dork fork boundary.
- Repository searches leave `Zork Voice` only in explicitly historical or
  compatibility evidence.
- Package, type, test, provenance, license, secret, and build checks pass.
- Reevaluate before a promoted release, trademark registration, logo launch,
  store listing, or expansion into another product category or jurisdiction.
