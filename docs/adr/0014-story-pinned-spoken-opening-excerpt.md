# ADR-0014: Allow a story-pinned spoken opening excerpt

- Status: accepted
- Date: 2026-08-19
- Owners: maintainers

## Context

`START STORY` currently speaks the complete authenticated Zork I Release 119
boot output before the player can begin an ordinary turn. That is safe and
faithful, but device testing found the credits and release metadata too long for
the first audio interaction. The complete opening is 67 words; the
player-relevant title and initial scene are 32 words.

The engine record cannot be shortened. `BootResult.output`, the revision-zero
`engine.output`, transcript, accessibility projection, observed-fact input, and
replay evidence all depend on the exact authenticated bytes. A general-purpose
summary would also blur the distinction between original game prose and
generated speech.

## Decision

The complete authenticated `BootResult` remains authoritative. `START STORY`
must append one byte-exact revision-zero `engine.output`, and optional
transcript and accessibility surfaces must expose that full output unchanged.

Only the spoken opening may select a shorter form. A selection is valid only
when a reviewed mapping matches all of the following:

- story ID `zork1-release-119`;
- story artifact SHA-256
  `37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79`;
- the complete known Release 119 opening exactly, not a prefix, normalized
  comparison, or heuristic match.

The known full opening has SHA-256
`66435cdd21de9b6c59dbad4e65c037975bc5e9103d935b34941ab226baa9a8ab` as an
additional review aid; selection still requires exact text equality. The
reviewed 32-word spoken excerpt consists only of whole original lines:

```text
ZORK I: The Great Underground Empire

West of House
You are standing in an open field west of a white house, with a boarded front door.
There is a small mailbox here.
```

The selector may omit lines but may not rewrite, reorder, concatenate within a
line, or add prose. It is deterministic configuration, not a guide or narration
provider decision. No LLM, generated summary, dynamic boilerplate detector, or
provider-specific transform may choose the words.

If the story ID, artifact hash, or complete opening differs in any way, or a
reviewed mapping is absent, narration falls back to the complete
`BootResult.output`. This fail-safe permits a new or modified story to remain
playable without silently applying another build's excerpt.

`narration.requested.text` records the text actually offered for speech, whether
excerpt or fallback. Its `sourceEventId` continues to point to the full
revision-zero `engine.output`. Repeat retains and reuses that same selected
text; it does not rerun a model, select a different excerpt, republish engine
output, or advance the engine.

The provider boundary applies one documented pronunciation normalization to that
otherwise unchanged request: the exact whole title line
`ZORK I: The Great Underground Empire` is supplied to narrator synthesis as
`ZORK One: The Great Underground Empire`. This prevents probabilistic
letter-versus-number readings. For this same authenticated opening, it also
supplies the standalone `West of House` heading with terminal punctuation and a
blank line before the room description. That punctuation-only padding gives the
location heading its own short beat without adding connective prose. Both
mappings are exact-line and narrator-only; they do not alter
`narration.requested`, engine output, visible text, Guide speech, near matches,
or unrelated uses of `I`.

Ordinary command-result narration remains exact. This decision is a narrow
first-run presentation exception, not permission to summarize parser responses
or later game prose.

## Consequences

The first spoken interaction is shorter while canonical history, accessibility,
observed-world derivation, replay, and engine authority remain unchanged. A
listener hears original lines only, but may need the transcript to inspect the
credits, release metadata, and prompt omitted from speech.

Each supported story/build/opening combination needs an explicitly reviewed
mapping and regression fixture. Updating a story artifact or its boot text
automatically disables the excerpt until that exact tuple is reviewed. Golden
replays distinguish full engine source text from actual narrator request text.

The narrator contract now distinguishes byte-exact canonical prose from a
deterministic whole-line spoken selection. Implementations and documentation
must not describe the excerpt as a paraphrase or generated summary.

## Alternatives considered

- Speak the complete opening. This preserves one universal narration rule but
  makes the first interaction longer than the player-relevant scene requires.
- Ask a model to summarize the opening. This is nondeterministic, adds cost and
  latency, and risks generated or omitted game facts.
- Strip credits or prompts using regular expressions. A heuristic can silently
  change behavior when story text or formatting changes and is not bound to
  reviewed provenance.
- Omit opening narration entirely. This weakens the voice-first first-run path
  and makes the initial scene depend on visible text.

## Validation

Hermetic tests must prove the exact Release 119 tuple selects exactly the
32-word excerpt, every story-ID/hash/output mismatch falls back to the complete
output, and no input is partially matched or normalized. Integration and replay
tests must prove one full revision-zero `engine.output`, one
`narration.requested` containing the actual selected text and linked source ID,
no command or revision advance, and identical selected text on Repeat. Provider
contract coverage must prove only the exact narrator title receives the
`I`-to-`One` pronunciation mapping, only the authenticated opening location and
description pair receives punctuation padding, and near matches remain
unchanged.

Accessibility tests must prove the full exact opening remains available when the
player cannot hear the excerpt. A future manual browser smoke should record that
the reviewed excerpt is understandable and materially shorter, but this ADR and
its hermetic coverage do not claim that live evidence.

Reevaluate the mapping whenever the story ID, artifact, known opening, or
first-run narration requirements change.
