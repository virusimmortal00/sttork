# Providers

OpenRouter, OpenAI, and conditional Hugging Face capabilities live behind
normalized ports. No provider object or credential crosses into core domain
types.

The initial live-profile candidate is a bounded chained OpenAI adapter. It uses
speech-to-text, a schema-constrained guide decision, and speech synthesis as
three explicit capabilities. It deliberately does not let a voice model call the
engine directly. Hermetic contract tests inject `fetch`; live calls remain
opt-in and separately capped.
