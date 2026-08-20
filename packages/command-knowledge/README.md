# Command knowledge

Parser vocabulary, reviewed syntax, observed affordances, and spoiler-tagged
hint material remain separate views. No hidden map or full walkthrough belongs
in ordinary guide context.

The initial implementation is deliberately small: reviewed movement,
observation, inventory, and observed-object grammar for the opening vertical
slice. Callers provide object names already exposed to the player. Grounding
normally requires the proposed action and object to appear in the player's
utterance. The live semantic lane resolves provider-selected affordance IDs and
current slot-value IDs, then compiles the canonical parser command locally.
Zero-slot `look` and `inventory` and T2 `examine` of one explicitly named
observed object may use semantic paraphrases. Aliases remain examples rather
than an exhaustive paraphrase list. T2 fallback still requires one uniquely
mentioned current object and a direct affirmative observation request; quoted,
reported, hypothetical, conditional, excluded, multi-action, or competing T3
requests fail closed. Navigation and state-changing object actions retain
lexical grounding and must also be imperatives, direct second-person requests,
explicit first-person intent or delegation, or `let's`. A command word in a
question about command behavior, hypothetical or conditional statement,
exclusion, advice, comparison, report, or quoted mention does not authorize
execution. Deterministic help lists only this grammar and the supplied observed
names.

Nonlexical content, writing, and inscription questions about one explicitly
named, currently offered object request contextual guidance; they do not
authorize an action. When the trusted current scene supplies an exact pair, the
closed mailbox offers EXAMINE/OPEN and the revealed leaflet offers EXAMINE/READ.
The exact reviewed “what does [object] say?” matcher is a deterministic
clarification fast path, not an execution shortcut. Without a trusted current
pair, local policy emits a generic non-mutating clarification rather than
deriving suggestions from an object label or the global grammar.
Provider-authored clarification prose and choices are discarded.

Suggestions do not narrow parser support. An explicit affirmative action may use
the one revalidated focused object even when its verb was not suggested, but it
executes only through ordinary grounding. EXAMINE remains T2 observation;
lexical READ remains T3 with no semantic fallback and still requires an
imperative, direct second-person request, explicit first-person intent or
delegation, or `let's`. Thus explicit `READ MAILBOX` and direct `read it` remain
eligible even though READ is not recommended for the mailbox. Appearance,
description, inspection, and “check out” requests remain least-effect T2 EXAMINE
observations.

Content wording that omits an object retains the typed `content-object` intent
while the guide requests one current object. Naming it produces the current
contextual clarification, not an action. Its session-memory choice has kind
`contextual-object-action-choice`, one current object value ID, and exactly two
distinct `suggestedActions`; neither state is written to an event or save. The
legacy `read-examine-choice` remains accepted during migration. A following
explicit or pronominal direct action uses the object focus only after current
knowledge and the ordinary action gates are revalidated; suggestion membership
neither authorizes nor forbids it. Missing or stale scene context fails closed.
Scoped help preserves the same revalidated object-bound pair; global help clears
it, and an unrelated fresh command supersedes it. A bounded provider fallback
may classify unseen scoped-help wording, but local policy accepts only the exact
grammar source IDs for the current suggestions and renders reviewed prose.

Questions that compare offered commands or ask about alternatives without
choosing one are non-mutating command help and never execute. The bounded local
resolver recognizes reviewed command-effect, advice, comparison, and
hypothetical forms, including what READ does, whether it takes an object,
safer/different questions, and should-I or instead-of wording. These examples do
not form an exhaustive natural-language allowlist. The resolver derives current
command-knowledge source IDs directly. A provider handling other meta wording
may return `explain` only with relevant source IDs from the current knowledge.
Local policy validates provider-selected IDs and always emits deterministic
prose. The READ-versus-EXAMINE comparison states that EXAMINE observes without
taking while READ may implicitly take the object. A later explicit choice enters
the ordinary grounding path as a new turn only when it is an imperative, direct
second-person request, explicit first-person intent or delegation, or `let's`.

Historical observed-object memory is distinct from the objects offered for the
current scene. A committed movement keeps prior observations in memory but
removes them from current object slots when its engine output arrives; only
reviewed disclosures in authenticated engine output repopulate those slots. This
keeps provider choices current without deleting player-observed history.

## Bounded opening scene projection

`OpeningSceneProjection` is the first story-specific scene model. It is enabled
only for the exact authenticated Zork I Release 119 story ID and artifact hash,
then rebuilt by folding canonical semantic events in sequence. It learns
reviewed entities, the opening location, and relations only from exact complete
`engine.output` payloads at a newer revision and, for command results, their
correlated committed command. Transcript text, guide/provider prose, partial
matches, and quoted game output cannot create facts.

The projection stores source-backed history separately from the entity,
location, and relation IDs that are current. Relations directly stated by the
engine are explicit (`observed` in the projection). Reviewed inverse relations
remain `inferred` and retain the same engine source; for example, “the house is
east of you” is derived from the explicit statement that the player is west of
the house. Movement output clears the prior current scene even if the attempted
movement was blocked, while exact later location output can confirm it again. A
committed command by itself never proves success.

Ranked contextual affordances are concise things the player can try, not claims
that the parser will accept them or that an action will succeed. They may power
local, non-mutating help for an already-present object, a request for up to
three relevant actions, or a source-backed direction recall. They cannot
authorize a command, compile an inferred relation into movement, expose a hidden
map, or relax the existing navigation and risk-tier gates. This projection uses
the existing guide decisions and semantic events and adds no event or save
schema.

For object-scoped content guidance, `resolveOpeningSceneObjectActionSuggestion`
returns exactly two distinct ranked actions only from the trusted current
projection. A committed command alone does not determine whether its target
moved or was taken; its correlated exact output updates the scene. In
particular, Release 119's exact rejection of `READ MAILBOX` keeps the mailbox
current. This preserves the parser's awkward response without turning READ into
a mailbox recommendation.
