# Session backend

This package contains the narrow BFF described in ADR-0002. It never owns game
state and never exposes a deployment provider key to browser code.

The initial OpenAI live-smoke service requires one same-origin, ephemeral
session token and exposes only bounded transcription, guide-decision, and speech
routes. Provider errors are normalized, responses are `no-store`, and request
content is not logged. This is a local developer boundary, not provider
promotion or production authentication.
