# Guide core

This package implements provider-neutral runtime validation and the initial
bounded policy around the canonical guide decision contract. Provider output
remains `unknown` until it passes the strict union validator. The initial guide
can authorize one grounded command, clarify, or generate deterministic parser
help; all other paths fail closed.

The package cannot access or mutate Z-machine memory directly. Execution is a
typed result for a later coordinator to submit through the authoritative engine
boundary. Observed memory, hints, mediated tools, and provider-specific prompts
remain later M2 work.
