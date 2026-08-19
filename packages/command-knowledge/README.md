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
than an exhaustive paraphrase list. Navigation and state-changing object actions
retain lexical grounding. Deterministic help lists only this grammar and the
supplied observed names.

Historical observed-object memory is distinct from the objects offered for the
current scene. A committed movement keeps prior observations in memory but
removes them from current object slots when its engine output arrives; only
reviewed disclosures in authenticated engine output repopulate those slots. This
keeps provider choices current without deleting player-observed history.
