# ADR-0012: Resolve natural language through structured command intents

- Status: accepted
- Date: 2026-08-19
- Owners: maintainers

## Context

The bounded opening guide originally validated a model-proposed parser command
by requiring a literal command alias to occur in the player's transcript. This
was a safe bootstrap, but device testing exposed the architectural flaw:
equivalent requests such as “what do I see around me?”, “what do I see in front
of me?”, and “tell me where I am” required separate allowlist patches even when
the guide correctly selected `look`.

Aliases describe parser vocabulary. They cannot be an exhaustive
natural-language understanding layer. Removing validation entirely would create
the opposite problem: a model could authorize an arbitrary parser command,
hidden object, or materially different action.

## Decision

Provider-facing guide output will evolve from a free-form parser command to a
strict semantic command-intent frame. The model selects a currently offered
affordance ID and bounded slot value IDs. Command knowledge validates the IDs,
slot schema, observed referents, current revision, and local risk policy, then
deterministically compiles exactly one canonical parser command. The provider
does not create `CanonicalCommand` and does not assign risk.

The target frame is:

```ts
interface CommandIntentFrameV1 {
  affordanceId: string;
  slots: readonly {
    slotId: string;
    valueId: string;
  }[];
}
```

Aliases remain high-precision parser examples and deterministic fast paths. They
are not the exhaustive authorization list for natural paraphrases.

Rollout is risk-tiered and story-specific:

- T0 performs no engine turn and uses source-backed help or observed memory.
- T1 contains certified global observations, initially `look` and `inventory`.
- T2 contains contextual observation of one uniquely observed object.
- T3 contains navigation and ordinary state-changing actions.
- T4 contains consequential, lifecycle, hazardous, or unclassified actions.

The first compatibility slice added a required `affordanceId` to the OpenAI live
model's execute proposal and enabled zero-slot T1 observation. The next slice
adopts the target frame for the live path: the model returns an `affordanceId`
and bounded slots, while command knowledge alone compiles the parser string. T2
semantic fallback is enabled only for `examine` with one explicitly named,
currently offered observed-object ID. T3 navigation and state-changing actions
are compiled from the same frame but still require lexical authorization. Guide
core strips all provider-only intent metadata before recording the canonical
decision. Legacy hermetic model fixtures without an affordance ID retain the
lexical path.

All existing transcript-confidence, model-confidence, negation, multi-step,
cancellation, observed-state, revision, idempotency, and engine commit gates
stay in force. T3 and higher tiers retain lexical grounding until their
contextual and confirmation policies land.

## Consequences

Natural phrasings for the same low-consequence observation no longer require a
new alias and release for each sentence. The model performs semantic
classification while deterministic code retains authority over available actions
and the exact parser string.

Deterministic validation can prove that a selected intent is bounded, currently
offered, structurally valid, and permitted by policy. It cannot prove semantic
understanding without implementing another language model. Wrong classification
is controlled through risk-tiered rollout, clarification thresholds, repeated
provider evaluations, and conservative local policy. Unknown intent defaults to
the highest risk tier and does not execute.

The OpenAI live path no longer accepts a provider-authored parser command.
Existing provider-neutral events remain stable because guide core materializes
only the locally compiled canonical command.

## Alternatives considered

- Continue adding aliases for every observed paraphrase. This is deterministic
  but unbounded, language-specific, and fails the active-guide requirement.
- Trust any high-confidence model command. This is adaptable but permits
  materially different or hallucinated commands without a local affordance
  boundary.
- Use a second model as a semantic judge. This adds latency, cost, correlated
  failure, and still does not provide a deterministic authority boundary.
- Enable semantic fallback for every current verb immediately. This moves too
  much risk before typed object, direction, polarity, and confirmation slots are
  implemented and evaluated.

## Validation

Hermetic tests must prove local canonical derivation, exact slot validation,
legacy compatibility, transcript and model confidence gates, negation,
multi-step rejection, and absence of engine mutation on invalid frames. Real
Dork/Zork I integrations must show “tell me where I am” producing one canonical
`look`, and natural observed-object descriptions producing one canonical
`examine`, one committed revision, and exact engine narration.

Provider contract tests must prove the live structured schema requires the
affordance ID and rejects malformed or extra fields. The guide evaluation corpus
must test paraphrase families and contrast cases rather than accumulating one
golden sentence per alias. Reevaluate before enabling each higher risk tier and
whenever the model, command index, observed-memory schema, or story build
changes.
