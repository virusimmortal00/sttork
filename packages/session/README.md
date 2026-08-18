# Session

This package owns deterministic semantic-turn ordering across final transcript,
guide policy, authoritative engine execution, checkpoints, and narration
requests. It is the only allocator of persisted event sequence numbers.

The coordinator never interprets provider-specific responses and never mutates
game state directly. An uncertain engine submission is quarantined until the
same interaction retries the exact request ID, expected revision, and canonical
command.
