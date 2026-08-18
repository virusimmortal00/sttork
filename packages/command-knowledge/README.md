# Command knowledge

Parser vocabulary, reviewed syntax, observed affordances, and spoiler-tagged
hint material remain separate views. No hidden map or full walkthrough belongs
in ordinary guide context.

The initial implementation is deliberately small: reviewed movement,
observation, inventory, and observed-object grammar for the opening vertical
slice. Callers provide object names already exposed to the player. Grounding
requires the proposed action and object to appear in the player's utterance, and
deterministic help lists only this grammar and those supplied names.
