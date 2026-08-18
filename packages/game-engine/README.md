# Game engine

This package contains the repository-owned, interpreter-neutral typed worker
protocol and client adapter spike. It is the sole ordinary mutation boundary:
one already-canonical command enters each execute request, and only a complete
worker turn can become an engine result.

The version 1 request/reply protocol covers boot, execute, snapshot, restore,
and public-state inspection. The adapter validates story/runtime/adapter
compatibility, preserves output strings without normalization, and permits at
most one stateful operation in flight. Overlap is rejected rather than queued.
Snapshot bytes remain opaque, are copied before asynchronous work, and have
their declared SHA-256 verified before they cross the adapter boundary.

The adapter tracks the confirmed input boundary. A terminated engine rejects new
commands until a compatible snapshot successfully restores an input-requested
boundary or the worker is replaced and booted again. A rejected restore
preserves the current revision and boundary.

Cancellation before transport submission is reported as `not-submitted`. Failure
or cancellation after execute submission is reported as `unknown`. Until that
state is reconciled, only the exact request tuple may be retried. Public-state
inspection refreshes diagnostic revision and boundary information, but cannot
recover the correlated receipt or authorize subsequent work; the exact retry is
still required. A submitted boot or restore whose result is unknown quarantines
that adapter. Boot recovery requires a fresh adapter and worker. After an
uncertain restore, inspection remains diagnostic while execute, snapshot, and
restore stay blocked until replacement. No path claims an uncertain operation
rolled back.

Request receipts in the deterministic fake are snapshot-scoped. The fake's
opaque snapshot envelope includes its full-width revision, boundary, visible
output state, and receipt journal. Restoring it replaces the active journal:
requests captured by the snapshot retain their cached receipts, while requests
created later belong to the discarded branch and may execute again on the
restored branch. A snapshot with mismatched story, runtime, adapter, or schema
identity—or with bytes that fail its digest—is rejected before any restore
message reaches the worker.

The deterministic contract suite uses a fake transport to exercise these
protocol and recovery invariants. It is not an interpreter and does not
establish game compatibility.

There is currently **no browser Worker codec or accepted production interpreter
binding** in this package. ADR-0009 proposes the pinned Dork TypeScript core as
the candidate. The narrow turn-session proof lives under `spikes/dork-worker/`
and is intentionally absent from this package's public export/build graph. It
may use the provenance-approved core and Zork I story, but Dork cannot implement
the full port until its host-checkpoint, restore, worker, and failure semantics
pass the open gates. Bocfel remains the behavioral oracle/fallback.
