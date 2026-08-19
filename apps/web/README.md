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
revoked after completion, stop, or failure. Only typed semantic events are
available to the optional transcript/debug projections. The real microphone
browser checkpoint is still pending and this shell is not production provider
support.

The live playback adapter synchronously primes one persistent browser audio
element from `START STORY`, speaking, text-submit, and Repeat gestures before
any speech fetch. It reuses that element for later responses and revokes every
local or synthesized object URL. A denied browser play request is recoverable
through Repeat and remains distinct from the process request limit; neither
failure exposes provider response text or moves focus into the optional
transcript.

For another phone, tablet, or computer, configure an exact HTTPS browser origin
before serving:

```sh
ZORK_VOICE_PUBLIC_ORIGIN=https://voice-dev.example.test \
  pnpm openai:live:serve
```

Open the printed Browser URL, not the loopback Upstream URL, on the device. Its
DNS and TLS certificate must be trusted there, and the page must report a secure
context before requesting microphone permission. A private authenticated proxy
for the whole origin forwards to the developer machine through loopback or an
encrypted tunnel while preserving `Host`, `Origin`, and
`x-zork-voice-live-session`. Direct `http://<LAN-IP>` access is deliberately
unsupported because ordinary LAN HTTP is not a secure microphone context.

The proxy must not cache the injected HTML or API responses, persist request
bodies, or log audio, transcripts, credentials, cookies, or the live-session
header. It must retain the server's body limits and access restriction. Full
setup and evidence requirements are in
[`docs/development.md`](../../docs/development.md#testing-live-voice-from-another-device).
