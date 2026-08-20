# Provider and upstream research snapshot

Status: informative, not a runtime contract  
Last verified: 2026-08-20

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

- transcription: `gpt-transcribe`, using the completed-file Transcriptions API;
- schema-constrained initial guide: `gpt-5.6-luna` with `reasoning.effort` set
  to `none`, `reasoning.context` set to `current_turn`, and low output verbosity
  for the bounded, latency-sensitive intent-classification decision;
- narration: `gpt-4o-mini-tts` through the request-based Speech API, preserving
  `nova` guide and `onyx` narrator defaults, with the current documented voice
  catalog available as bounded player preferences.

The profile is dated configuration for a budget-limited smoke, not a promoted
default. It has no automatic fallback, makes no provider request in hermetic
tests, and keeps the deployment API key on the server. Current OpenAI model
catalog and pricing must be rechecked before every live run.

The 2026-08-19 transcription revision keeps the existing bounded file-upload
architecture. Current official documentation lists `gpt-transcribe` at $0.0045
per input minute and returns reliable detections as `languages: [{ code }]`, or
an empty array when it cannot detect one. The adapter normalizes the bounded
list of detected codes without collapsing multilingual audio into one language.
The 2026-08-20 revision sends a short static task prompt, reviewed parser
aliases, and object labels from the client's canonical observed-object
projection through the documented `prompt`, repeated `keywords[]`, and plural
`languages[]` fields. The trusted server rejects labels outside the reviewed
opening vocabulary before the provider boundary. Duration-billed usage is
normalized as input-audio seconds while the provider boundary retains
compatibility with token-billed transcription usage.

The 2026-08-19 narration revision replaces the profile's earlier `tts-1`
selection with `gpt-4o-mini-tts`. Current official documentation describes it as
OpenAI's newest and most reliable text-to-speech model and lists it as the
speech-generation model in the primary catalog. `tts-1` remains available in the
full catalog and remains recorded in the earlier Slice 5 smoke evidence; it was
not removed from that historical record or relabeled as deprecated. The
2026-08-20 revision keeps the same Speech endpoint and MP3 format while adding
the current documented voices (`alloy`, `ash`, `ballad`, `coral`, `echo`,
`fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, and `cedar`) as an
allowlisted preference catalog. Guide and narrator choices and rates are
independent, locally persisted, and bounded to 0.75–1.25×. Static role delivery
instructions affect speaking style only and explicitly forbid adding, omitting,
or paraphrasing the selected text. One deterministic, tested pronunciation map
supplies the exact narrator title line `ZORK I: The Great Underground Empire` to
synthesis as `ZORK One: The Great Underground Empire`; canonical events and
visible text retain `ZORK I`, and near matches are untouched. The same exact
opening mapping adds terminal punctuation and a blank line after the standalone
`West of House` heading so synthesis pauses before the description without
adding prose. The provider response remains a bounded, cancellable stream
through the BFF; browsers use incremental MediaSource playback for supported MP3
environments and a bounded in-memory fallback otherwise. The optional settings
surface identifies the voices as AI-generated and identifies samples as billable
requests.

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
and T2 examination of one uniquely mentioned observed object in a direct
affirmative observation request, and removes all provider-only metadata before
canonical guide events are recorded. T3 and higher actions additionally require
lexical grounding and a deterministic imperative, direct second-person request,
explicit first-person intent or delegation, or `let's` speech act. Command words
in questions about command behavior, hypothetical or conditional statements,
exclusions, advice, comparisons, reports, or quoted mentions do not authorize
execution. Later contextual and confirmation policies in
[ADR-0012](adr/0012-structured-semantic-command-intents.md) remain open.

The 2026-08-19 observed-content clarification below records the fixed
EXAMINE/READ policy that first established the action-authority boundary. Its
fixed suggestion pair is superseded by
[ADR-0016](adr/0016-separate-contextual-suggestions-from-parser-authority.md);
the later refinement following this historical description is current.

The 2026-08-19 observed-content clarification makes the distinction between
`grammar.examine` and `grammar.read` explicit in guide instructions and command
knowledge. Nonlexical content, writing, and inscription requests about one
explicitly named current object always clarify between the two actions,
independent of whether the provider proposes EXAMINE, READ, or `clarify`. The
exact reviewed “what does [object] say?” matcher is a deterministic
clarification fast path rather than an expanding phrase allowlist.
Provider-authored clarification prose and choices are not surfaced. Only local
recognition or provider choices that exactly validate as the current object's
EXAMINE/READ pair becomes the deterministic local question with typed choices;
all other provider clarifications become a deterministic generic question with
only locally inferred pending state. Local policy sends no command until the
player explicitly chooses; it explains that EXAMINE observes without taking
while the Release 119 READ action may implicitly take the object. Explicit
EXAMINE and lexical READ execute through their ordinary gates only when the
speech-act guard also recognizes an imperative, direct second-person request,
explicit first-person intent or delegation, or `let's`. Appearance, description,
inspection, and “check out” requests remain least-effect T2 EXAMINE
observations; READ remains T3 with no semantic fallback. Because this changes
guide instructions and affordance semantics, earlier guide-evaluation evidence
does not qualify the revised profile; the affected paraphrase, clarification,
follow-up, and contrast suites must be rerun before promotion.

A content question without an object retains the typed `content-object` intent
while the guide requests one current object. Once supplied, that object produces
the EXAMINE-versus-READ clarification rather than execution. Its session-memory
choice stores only the current object value ID and allowed actions `examine` and
`read`; neither state is written to an event or save. A next-turn `READ`,
`read it`, `EXAMINE`, or `examine it` is rebound and revalidated against current
knowledge before execution. Stale objects fail closed. Command help clears the
pending choice unless that help is scoped to the active READ-versus-EXAMINE
options. Scoped help preserves the same revalidated object frame; an unrelated
fresh command or explicit global help supersedes it. The OpenAI request may
serialize this validated frame as bounded dialogue focus. It is not game state
or command authority. An unseen scoped-help paraphrase qualifies only when the
provider returns `command-help` with exactly `grammar.examine` and
`grammar.read`; guide core replaces provider prose with the deterministic local
clarification and choices.

The 2026-08-20 contextual-suggestion refinement separates that advice from the
broader parser grammar. A trusted current `OpeningSceneProjection` now supplies
the exact object-specific pair: EXAMINE/OPEN for the closed mailbox and
EXAMINE/READ for the revealed leaflet. The session serializes a bounded
`contextual-object-action-choice` with one current object ID and exactly two
distinct `suggestedActions`; the legacy `read-examine-choice` remains accepted
during migration. The field describes recommendations, not authorization. A
direct affirmative `READ MAILBOX` or `read it` may use the single revalidated
mailbox focus even though READ was not suggested, but READ still requires its
ordinary lexical T3 speech act, risk, revision, and commit checks.

The provider may classify unseen scoped-help wording only by returning the exact
grammar source IDs corresponding to the current suggestions. It cannot broaden
the pair, supply scene facts, or turn a suggestion into command authority; guide
core discards provider prose and renders deterministic copy. Missing or stale
scene context produces a generic non-mutating clarification rather than a pair
inferred from the object label or global grammar. This changes the serialized
context and guide instructions, so all earlier guide-evaluation evidence remains
insufficient for the refined profile until the mailbox/leaflet, no-scene,
stale-focus, provider-broadening, and explicit-outside-suggestion contrast
families are rerun. No fresh live-provider or device result is claimed here.

Command-comparison questions and alternative-oriented meta questions that do not
choose an action are non-mutating `explain` decisions with basis `command-help`,
never implicit execute choices. The guard also covers single-command effect
questions (“what does READ do?” and “does READ take it?”), safer/different
advice, should-I and instead-of questions, and hypothetical wording. These
examples do not make the resolver an exhaustive natural-language classifier. The
bounded local resolver recognizes reviewed forms and derives their current
command-knowledge source IDs directly. Other meta wording may reach the
provider, which must return only relevant IDs from the current command
knowledge. Guide core validates every provider-selected ID and replaces provider
prose with deterministic help. The reviewed READ-versus-EXAMINE comparison
states that EXAMINE observes without taking while READ may implicitly take the
object. Mentioning a command lexically inside these questions, a conditional,
exclusion, reported speech, or quoted discussion never authorizes T3 execution.
An imperative, direct second-person request, explicit first-person intent or
delegation, or `let's` remains eligible on a later turn. Provider qualification
must cover effect, advice, hypothetical, comparison, and alternative questions;
conditionals, exclusions, reports, and quotations; every supported direct-action
form; invented or stale source IDs; zero-mutation behavior; generic
clarification replacement; exact typed clarification choices; pending-state
preservation, clearing, and supersession; stale objects; and the subsequent
direct choice. This prompt/context change invalidates earlier guide-evaluation
evidence until the scoped-help and global-help contrast families are rerun.

- [Chained voice-agent architecture](https://developers.openai.com/api/docs/guides/voice-agents)
- [GPT Transcribe model](https://developers.openai.com/api/docs/models/gpt-transcribe)
- [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [GPT-4o mini TTS model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
- [Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
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
