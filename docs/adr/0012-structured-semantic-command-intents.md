# ADR-0012: Resolve natural language through structured command intents

- Status: accepted
- Date: 2026-08-19
- Owners: maintainers

The blanket pending-help clearing rule below is superseded by
[ADR-0015](0015-preserve-object-focus-through-scoped-help.md) for help scoped to
the active READ-versus-EXAMINE object.

The fixed READ-versus-EXAMINE content suggestion and focus clauses below are
superseded by
[ADR-0016](0016-separate-contextual-suggestions-from-parser-authority.md).
Contextual recommendations now come from the trusted current scene and do not
restrict a player's explicit parser command.

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
currently offered observed-object ID and a direct affirmative observation speech
act. The model supplies the semantic paraphrase classification; local policy
rejects quotations, reports, hypotheticals, conditions, exclusions, multi-action
wording, stale or overlapping targets, and a directly grounded competing T3
action. The local observation grammar is compositional and separate from the
parser's alias list; both the semantic selection and that grammar must agree,
and accepted paraphrases need not reproduce a canonical parser phrase. T3
navigation and state-changing actions are compiled from the same frame but still
require lexical authorization and a deterministic direct-action speech act: an
imperative, a direct second-person request, explicit first-person intent or
delegation, or `let's`. Guide core strips all provider-only intent metadata
before recording the canonical decision. Legacy hermetic model fixtures without
an affordance ID retain the lexical path.

All existing transcript-confidence, model-confidence, negation, multi-step,
cancellation, observed-state, revision, idempotency, and engine commit gates
stay in force. T3 and higher tiers retain lexical grounding until their
contextual and confirmation policies land.

### Clarification: content observation and READ choice (2026-08-19)

A nonlexical request to discover writing, an inscription, or other content on
one explicitly named, currently offered object is ambiguous between EXAMINE and
READ. It always produces a clarification, regardless of whether the provider
proposes `grammar.examine`, `grammar.read`, or `clarify`; neither action is
silently selected. The exact reviewed “what does [the] `<observed object>` say?”
matcher is a deterministic clarification fast path, not an execution shortcut or
an exhaustive sentence allowlist. Provider-authored clarification prose and
choices are not surfaced. Only a locally recognized ambiguity or a provider
clarification whose choices exactly validate as the current object's EXAMINE and
READ pair becomes the deterministic local question with typed `examine <object>`
and `read <object>` choices. Every other provider clarification becomes
deterministic generic clarification, retaining only pending state inferred
locally from the player's words.

The guide explains that EXAMINE observes without taking while the Zork I Release
119 READ action may implicitly take the object, then asks the player to choose.
A subsequent explicit answer is processed as a new turn through the ordinary
grounding and risk gates. Explicit EXAMINE executes `grammar.examine`; explicit
lexical READ executes `grammar.read` only when a deterministic speech-act guard
also identifies a direct action. Imperatives, direct second-person requests,
explicit first-person intent or delegation, and `let's` remain eligible. Command
words inside questions about command behavior, hypotheticals, conditionals,
exclusions, advice, comparisons, reported speech, or quoted mentions do not
authorize execution. Appearance, description, inspection, and “check out”
requests remain least-effect T2 EXAMINE observations. READ remains T3 with no
semantic fallback. This clarification weakens none of the existing confidence,
polarity, referent, or one-action gates.

If content wording omits the object, the guide retains the typed
`content-object` intent while asking which current object the player means.
Naming one currently offered object produces the EXAMINE-versus-READ
clarification; it does not execute. Its session-memory choice retains only the
current object value ID and the allowed actions `examine` and `read`; it is not
written to an event or save. A next-turn `READ`, `read it`, `EXAMINE`, or
`examine it` may select one action only after the object and action are
revalidated against current knowledge. Stale objects fail closed. Intervening
command help clears the pending choice, and an unrelated fresh command
supersedes it.

A question comparing currently offered commands, or asking about alternative
commands without choosing one, is T0 command help rather than a game action or
an implicit choice. It never submits an engine command. A bounded local resolver
handles reviewed command-effect, advice, comparison, and hypothetical forms,
including questions such as “what does READ do?”, “does READ take it?”, which
option is safer or different, and whether one should be used instead of another.
These examples do not define an exhaustive natural-language allowlist. Other
meta wording may be classified by the provider as `explain` with basis
`command-help` and relevant current command-knowledge source IDs. Local policy
validates those IDs and emits deterministic reviewed prose instead of
provider-authored help. A READ-versus-EXAMINE comparison states that EXAMINE
observes without taking while READ may implicitly take the object. A later
explicit player choice is a new turn subject to the ordinary grounding and risk
gates and must use one of the supported direct-action forms before it can
execute.

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
