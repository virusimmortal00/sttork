# Providers

OpenRouter, OpenAI, and conditional Hugging Face capabilities live behind
normalized ports. No provider object or credential crosses into core domain
types.

The current live-profile candidate is a bounded chained OpenAI adapter using
`gpt-transcribe`, a schema-constrained `gpt-5.6-luna` guide decision, and
`gpt-4o-mini-tts` speech synthesis as three explicit capabilities. It
deliberately does not let a voice model call the engine directly. Hermetic
contract tests inject `fetch`; live calls remain opt-in and separately capped.
