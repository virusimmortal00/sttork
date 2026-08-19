# Command knowledge

Parser vocabulary, reviewed syntax, observed affordances, and spoiler-tagged
hint material remain separate views. No hidden map or full walkthrough belongs
in ordinary guide context.

The initial implementation is deliberately small: reviewed movement,
observation, inventory, and observed-object grammar for the opening vertical
slice. Callers provide object names already exposed to the player. Grounding
normally requires the proposed action and object to appear in the player's
utterance. The first semantic lane may instead resolve the locally certified
zero-slot `look` and `inventory` affordances from a provider-selected rule ID;
command knowledge verifies the ID/command pair and compiles the canonical verb.
Aliases remain examples rather than an exhaustive paraphrase list. Navigation
and object actions retain lexical grounding until their typed slot policy lands.
Deterministic help lists only this grammar and the supplied observed names.
