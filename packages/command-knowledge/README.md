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
named, currently offered object always clarify between EXAMINE and READ,
regardless of whether the provider proposes either action or a clarification.
The exact reviewed “what does [object] say?” matcher is a deterministic
clarification fast path, not an execution shortcut. Provider-authored
clarification prose and choices are discarded. Only local recognition or an
exact validated current-object EXAMINE/READ pair produces the deterministic
question and typed choices. Every other provider clarification becomes a
deterministic generic question with only locally inferred pending state. Local
policy sends no command until the player explicitly chooses. The guide explains
that EXAMINE observes without taking while the Zork I Release 119 READ action
may implicitly take the object. Explicit EXAMINE and lexical READ choices
execute through ordinary grounding only when they are also imperatives, direct
second-person requests, explicit first-person intent or delegation, or `let's`.
Appearance, description, inspection, and “check out” requests remain
least-effect T2 EXAMINE observations; `grammar.read` remains T3 with no semantic
fallback.

Content wording that omits an object retains the typed `content-object` intent
while the guide requests one current object. Naming it produces the
EXAMINE-versus-READ clarification, not an action. Its session-memory choice
stores only the current object value ID and allowed actions `examine` and
`read`; neither state is written to an event or save. A following `READ`,
`read it`, `EXAMINE`, or `examine it` is rebound and revalidated against current
knowledge before it can execute. Stale objects fail closed; command help clears
the pending choice, and an unrelated fresh command supersedes it.

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
