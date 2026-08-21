# Web application

This package contains the voice-first browser surface and its minimal,
accessible, and debug event projections.

The initial Slice 4 shell is a deterministic developer smoke: it uses scripted
audio/transcription and virtual playback while exercising the real isolated Dork
Worker, guide, session coordinator, checkpoint, and event projections. It is not
a production microphone/provider implementation. Transcript, accessible text
entry, and debug evidence are hidden by default but keyboard reachable.

Build with `pnpm voice:shell:build`, serve with `pnpm voice:shell:serve`, and
open the printed loopback URL. The server applies a restrictive same-origin CSP;
the generated `.ci` output is ignored and is not a production bundle.

The opt-in Slice 5 shell replaces only the scripted capture/provider/playback
ports with bounded browser microphone and same-origin OpenAI BFF adapters. It
uses the bundled, authenticated Zork I Release 119 story and the same Dork
Worker and semantic coordinator. Build with `pnpm openai:live:build`, then serve
with `pnpm openai:live:serve`. Raw capture and synthesized audio remain
in-memory; capture is consumed once, and synthesized-audio object URLs are
revoked after completion, stop, or failure. Supported MP3 MediaSource browsers
begin bounded playback as response chunks arrive; other browsers use a bounded
in-memory compatibility path. Only typed semantic events are available to the
optional transcript/debug projections. The real microphone browser checkpoint is
still pending and this shell is not production provider support.

The semantic event record remains complete, while the hot experience projection
keeps only its recent working set (128 transcript items and 256 debug/source
entries). Closed transcript and debug dialogs create no rows or serialized JSON.
When opened, they render bounded pages and can page backward through the
canonical event record; closing them releases that optional presentation state.

For an accelerated long-session browser check, build and serve the deterministic
shell, then open `http://127.0.0.1:4174/?projection-soak=50000`. This opt-in
mode feeds 50,000 synthetic final-transcript events through the real browser
projection in 1,000-event animation-frame batches. It also exercises eight
Older/Newer page cycles and twenty transcript/debug open-close cycles. Results
are recorded in `window.__VOICE_SHELL_SMOKE__.projectionSoak` and the existing
`data-smoke-evidence` body attribute. The check fails its evidence if hidden
views render content, a projection or DOM bound is exceeded, or closing leaves
the temporary presentation attached. Timing and browser-provided heap deltas are
evidence rather than fixed pass/fail budgets; production-build budgets belong in
the dedicated performance gate.

Open `http://127.0.0.1:4174/?spoken-benchmark` to measure the progressive
spoken-text presentation with short (12-word), typical (120-word), and maximum
(800-word/3,999-character) narration. Machine-readable results are stored in
`window.__VOICE_SHELL_SMOKE__.spokenTranscriptBenchmark` and the existing
`data-smoke-evidence` body attribute. The benchmark executes its scheduler on a
virtual clock, verifies that only one callback is active, confirms every word is
revealed without presentation selector queries, and removes its temporary DOM
when complete. Durations are diagnostic evidence rather than CI budgets.

The hidden Voices panel provides separate, locally persisted Guide/Narrator
voice and rate preferences across the reviewed OpenAI TTS catalog. Its sample
buttons are explicitly marked as billable AI-generated speech. Rate-slider input
updates the current session and its own visible value immediately; the final
normalized preference is persisted on the slider's change boundary, when the
panel closes, or when the page is left. A storage failure leaves the valid
session preference active for a later retry. Transcription uploads include only
current observed-object labels; the server, not the browser, derives the
reviewed command-vocabulary hints.

The live playback adapter synchronously primes one persistent browser audio
element from `START STORY`, speaking, text-submit, and Repeat gestures before
any speech fetch. It uses a short valid local clip, bounds both prime settlement
and the first synthesized `playing` event, and never lets an unsettled prime
block speech indefinitely. It reuses that element for later responses and
revokes every local or synthesized object URL. Stop invalidates pending priming;
a denied or stalled browser play request is recoverable through Repeat and
remains distinct from the process request limit. Neither failure exposes
provider response text or moves focus into the optional transcript.

For another phone, tablet, or computer, configure an exact HTTPS browser origin
before serving:

```sh
STTORK_PUBLIC_ORIGIN=https://voice-dev.example.test \
  pnpm openai:live:serve
```

Open the printed Browser URL, not the loopback Upstream URL, on the device. Its
DNS and TLS certificate must be trusted there, and the page must report a secure
context before requesting microphone permission. A private authenticated proxy
for the whole origin forwards to the developer machine through loopback or an
encrypted tunnel while preserving `Host`, `Origin`, and `x-sttork-live-session`.
Direct `http://<LAN-IP>` access is deliberately unsupported because ordinary LAN
HTTP is not a secure microphone context.

The proxy must not cache the injected HTML or API responses, persist request
bodies, or log audio, transcripts, credentials, cookies, or the live-session
header. It must retain the server's body limits and access restriction. Full
setup and evidence requirements are in
[`docs/development.md`](../../docs/development.md#testing-live-voice-from-another-device).
