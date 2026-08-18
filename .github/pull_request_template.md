## Outcome

Describe the player- or maintainer-visible result. Lead with behavior, not the
implementation sequence.

## Milestone and invariant

- Milestone:
- Invariant or contract advanced:
- ADR added or superseded, if applicable:

## Verification

- [ ] `pnpm run ci`
- [ ] A regression test was added for a bug, or the reason one is not possible
      is documented below.
- [ ] Manual accessibility, browser, audio, or provider evidence is attached
      when the affected surface requires it.

Commands not run and why:

## Risk review

- [ ] No game state can change outside a validated engine command or lifecycle
      operation.
- [ ] Cancellation, retries, and at-most-once command behavior were considered.
- [ ] No credential, private audio/transcript, or sensitive save content enters
      logs, fixtures, snapshots, telemetry, or the browser bundle.
- [ ] New third-party code, content, models, voices, or assets have provenance
      and license evidence.
- [ ] The voice-first and visible accessibility surfaces remain equivalent in
      control and meaning.
- [ ] Provider-specific objects and assumptions remain behind normalized ports.

## Notes for reviewers

Call out golden changes, save/event migrations, spoiler-policy changes, manual
steps, follow-up work, or known limitations.
