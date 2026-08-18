# Test fixtures

Fixtures must be project-owned, explicitly redistributable, synthetic, or
otherwise documented by a provenance record.

- `stories/` contains source for the repository-owned minimal interactive
  fiction story and its reproducibly generated Z-machine artifact.
- `audio/` will contain only synthetic or explicitly consented recordings with a
  fixture-level license and retention purpose.
- `providers/` will contain sanitized responses with only fields required by a
  provider contract.
- `replays/` will contain semantic events and hashes, never provider secrets or
  ordinary raw microphone audio.

Zork story files, solution content, and real player recordings are not generic
test fixtures and may not be added without the specific review required by
`AGENTS.md`.

The provenance check rejects every fixture file other than a local README unless
an approved, hash-locked record claims it.
