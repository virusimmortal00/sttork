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
