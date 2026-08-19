# Session backend

This package contains the narrow BFF described in ADR-0002. It never owns game
state and never exposes a deployment provider key to browser code.

The initial OpenAI live-smoke service requires one same-origin, ephemeral
session token and exposes only bounded transcription, guide-decision, and speech
routes. Provider errors are normalized, responses are `no-store`, and request
content is not logged. This is a local developer boundary, not provider
promotion or production authentication.

For the manual Slice 5 developer harness, the loopback server loads a usable key
from its process environment or an ignored, regular, current-user-owned,
nonempty mode-0600 `.env.local`, creates one random browser-session token, and
injects only that token into the served HTML. The token and the provider's
global 12-request budget expire with the process. The server serves only the
known app, Worker, CSS, and authenticated Zork I paths and applies same-origin
CSP, microphone Permissions Policy, no-store, and bounded-body controls. It does
not log request bodies, transcripts, audio, or credentials.
