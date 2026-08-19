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
