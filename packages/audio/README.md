# Audio

This package owns capture, transcription handoff, playback, interruption, and
narrator/guide role treatment. Raw audio is not retained by default.

The initial Slice 4 implementation uses explicit push-to-talk contracts and
deterministic scripted adapters. Scripted clips carry opaque fixture IDs rather
than recorded player audio. The same controller boundary can later host browser
microphone and provider adapters without changing the semantic-turn or event
contracts.
