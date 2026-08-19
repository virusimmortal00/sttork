# Provider and upstream research snapshot

Status: informative, not a runtime contract  
Last verified: 2026-08-19

This document records the external facts that informed the initial strategy.
Provider catalogs, prices, authentication flows, and model status change. Each
provider milestone must re-check the linked official documentation and record a
new dated benchmark before enabling or promoting a profile.

## Zork source and licensing

Microsoft, Team Xbox, and Activision announced that the Zork I, II, and III
source repositories were made available under the MIT License. The announcement
also states that the release covers code, not commercial packaging, marketing
materials, trademarks, or brands.

- [Microsoft open-source announcement](https://opensource.microsoft.com/blog/2025/11/20/preserving-code-that-shaped-generations-zork-i-ii-and-iii-go-open-source/)
- [Historical Zork I source repository](https://github.com/historicalsource/zork1)

This is a research pointer, not the repository's eventual provenance record. M0
requires exact revisions, copied license text, build tools, patches, and
artifact hashes before importing or distributing game material.

## OpenRouter

OpenRouter is the strongest initial candidate for a user-connected, hosted
open-model profile because its documented PKCE flow lets a user authorize a
user-controlled API key. Its current API documentation also exposes dedicated
speech-to-text and text-to-speech endpoints in addition to multimodal audio.

- [OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth)
- [Speech-to-text](https://openrouter.ai/docs/guides/overview/multimodal/stt)
- [Text-to-speech API](https://openrouter.ai/docs/api/api-reference/speech/create-audio-speech)
- [Audio input and output](https://openrouter.ai/docs/guides/overview/multimodal/audio)

OpenRouter exposes models from multiple sources. The application must not call
every model on the service an “open model.” A qualified profile records the
exact model, model license/weight availability, underlying processor, routing
policy, data handling, and price date. Automatic provider fallback must remain
inside that reviewed boundary.

## OpenAI API

OpenAI's voice-agent guidance supports both live speech-to-speech sessions and
chained speech pipelines. It describes browser Realtime sessions using a
short-lived client secret created by the application server, with WebRTC in the
browser and tool support inside the voice session.

- [Voice-agent architecture](https://developers.openai.com/api/docs/guides/voice-agents)
- [Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Realtime tools](https://developers.openai.com/api/docs/guides/realtime-mcp)

The current lower-cost candidate is
[`gpt-realtime-2.1-mini`](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini).
At the verification date, its model page lists text input/output at $0.60/$2.40
per million tokens and audio input/output at $10/$20 per million audio tokens.
Those figures are a planning snapshot, not a budget constant. Model status and
pricing must be read from current official documentation during M5 and captured
with the benchmark date.

For the narrower initial developer voice smoke, the official voice-agent guide
also supports a chained architecture when an application needs transcripts,
predictable control, and structured workflows. The experimental chained profile
therefore evaluates these explicit server-side capabilities without changing the
settled OpenRouter-first or optional-Realtime delivery milestones:

- transcription: `gpt-4o-mini-transcribe`;
- schema-constrained initial guide: `gpt-5.6-luna` with `reasoning.effort` set
  to `none`, `reasoning.context` set to `current_turn`, and low output verbosity
  for the bounded, latency-sensitive intent-classification decision;
- narration: `tts-1`, avoiding the now-deprecated GPT-4o mini TTS model.

The profile is dated configuration for a budget-limited smoke, not a promoted
default. It has no automatic fallback, makes no provider request in hermetic
tests, and keeps the deployment API key on the server. Current OpenAI model
catalog and pricing must be rechecked before every live run.

Each guide request is deliberately stateless (`store: false`) and independently
grounded in the current reviewed command knowledge. It does not carry a
`previous_response_id`, expose engine tools, or enable pro mode, hosted tools,
multi-agent, or programmatic tool calling: those features add state, latency, or
authority that this single-decision boundary does not need. The adapter retains
strict Structured Outputs, a hard output-token limit, optional caller-supplied
privacy-preserving `safety_identifier`, and cached-input/cache-write/reasoning
token telemetry. Implicit prompt caching remains available; explicit cache
writes are deferred until measured reuse offsets their higher write price. The
evaluation baseline is reasoning `none`; `low` is promoted only if guide evals
show a material grounding or ambiguity-handling gain at acceptable latency and
cost.

The guide response uses a required root object whose `decision` property is a
nested `anyOf` over the enabled decision branches. This follows the current
Structured Outputs subset: the root remains an object rather than an `anyOf`,
every object field is required, and nested `anyOf` branches are supported.
Keeping branch-specific fields inside those variants prevents a schema-valid
response from pairing a decision kind with null or unrelated fields; the
provider-neutral runtime validator remains the final authority.

The live execute branch requires a bounded `affordanceId` and bounded slots
selected from current command knowledge; it no longer accepts provider-authored
parser text. Aliases and grammar strings are prompt examples, not an exhaustive
paraphrase list. Guide core validates current slot IDs, compiles the canonical
command locally, permits semantic fallback only for certified T1 observations
and T2 examination of an explicitly named observed object, and removes all
provider-only metadata before canonical guide events are recorded. T3 and higher
contextual and confirmation policies in
[ADR-0012](adr/0012-structured-semantic-command-intents.md) remain open.

- [Chained voice-agent architecture](https://developers.openai.com/api/docs/guides/voice-agents)
- [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Responses API migration and state](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Safety identifiers](https://developers.openai.com/api/docs/guides/safety-best-practices)
- [Current model catalog](https://developers.openai.com/api/docs/models)

Use the current supported mini-class model that passes the shared evaluations;
do not select a deprecated snapshot merely because historical pricing appears
lower. ChatGPT and Codex consumer login/subscription are not part of the
documented third-party API authorization design.

## Hugging Face

Hugging Face documents OAuth/OpenID Connect for applications, including an
`inference-api` scope that permits inference requests on behalf of the user.
Inference Providers support account-routed models, and the HF Inference service
documents automatic speech recognition, including Whisper examples.

- [Sign in with Hugging Face and OAuth scopes](https://huggingface.co/docs/hub/en/oauth)
- [Inference Providers](https://huggingface.co/docs/hub/en/models-inference)
- [HF Inference automatic speech recognition](https://huggingface.co/docs/inference-providers/providers/hf-inference)

This establishes potential suitability, not a complete supported voice profile.
M6 must demonstrate delegated billing/authentication, transcription, structured
guide decisions or tool use, narration or an explicitly disclosed approved
composition, cancellation, latency, model licensing, and cost visibility. A
documented no-go result is an acceptable M6 outcome.

## Revalidation checklist

Before a provider profile changes maturity or becomes a default:

1. Open the current official authentication, modality, model, pricing, data, and
   deprecation pages.
2. Record the date, exact model IDs, adapters, routing policy, and processors.
3. Confirm OAuth scopes and where each credential may be stored.
4. Run hermetic contracts and capped live authentication/tool/cancellation smoke
   tests.
5. Run the three-pass guide evaluation, voice outcome suite, reference replay,
   latency benchmark, and cost reconciliation in `testing.md`.
6. Update the profile manifest, disclosures, provenance/model registry, and an
   ADR when the architectural consequences changed.
