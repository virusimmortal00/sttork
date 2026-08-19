# Guide core

This package implements provider-neutral runtime validation and the initial
bounded policy around the canonical guide decision contract. Provider output
remains `unknown` until it passes the strict union validator. The initial guide
can authorize one grounded command, clarify, or generate deterministic parser
help; all other paths fail closed.

The live model proposal carries only provider-side affordance and slot metadata,
not parser text. Guide core resolves that frame against current command
knowledge, rejects unknown or mismatched IDs, locally compiles one command, and
strips the metadata before producing the replayable canonical guide decision.
Risk-tiered semantic fallback covers global observation and `examine` of one
explicitly named observed object; it does not relax navigation or state-changing
object actions.

The package cannot access or mutate Z-machine memory directly. Execution is a
typed result for a later coordinator to submit through the authoritative engine
boundary. Observed memory, hints, mediated tools, and provider-specific prompts
remain later M2 work.
