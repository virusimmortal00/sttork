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
global 30-request budget expire with the process. The server serves only the
known app, Worker, CSS, and authenticated Zork I paths and applies same-origin
CSP, microphone Permissions Policy, no-store, and bounded-body controls. It does
not log request bodies, transcripts, audio, or credentials.

## Remote-device developer smoke

The server always listens on `127.0.0.1`. With `ZORK_VOICE_PUBLIC_ORIGIN` unset,
it also uses its printed loopback HTTP origin as the browser origin. Setting the
variable opts into an external browser origin without exposing the listener:

```sh
ZORK_VOICE_PUBLIC_ORIGIN=https://voice-dev.example.test \
  pnpm openai:live:serve
```

Remote-device mode requires an exact HTTPS origin; do not include credentials, a
trailing slash or other path, a query, a fragment, or a wildcard host. An exact
loopback HTTP origin is accepted only for same-device use. The launcher prints
separate Browser and Upstream URLs. A same-machine private reverse proxy must
forward the Browser origin to that process's loopback Upstream URL. If the proxy
runs on another private host, use an authenticated encrypted tunnel whose
developer-machine endpoint reaches loopback; never publish the upstream port.

The proxy is part of the live-smoke security boundary. It must terminate TLS
with a certificate trusted by the test device, authenticate/restrict every path,
preserve the external raw `Host` exactly (including a non-default port), and
pass the browser's exact `Origin` and `x-zork-voice-live-session` headers
unchanged. `X-Forwarded-Host` is ignored. A missing or mismatched raw host is
rejected before static content, the session value, or an API route is served.
The proxy must honor `Cache-Control: no-store`, disable intermediary caching and
sensitive header/body logging, and avoid persisting buffered audio or JSON
bodies. The server independently enforces a 2 MiB transcription-audio limit with
16 KiB of multipart-envelope allowance and a 16 KiB guide/speech JSON limit. It
validates browser-supplied observed-object labels against the reviewed opening
vocabulary before deriving transcription prompt, keyword, and language hints.
Speech voice/rate preferences are allowlisted and bounded, and provider audio is
proxied as a cancellable stream rather than materialized into a vendor object.

The generated live-session value is not user authentication: an authorized page
load receives it in HTML. Plain LAN HTTP is unsupported because a non-loopback
HTTP origin is not a secure context for browser microphone capture, and the
server rejects it as a public origin. See
[`docs/development.md`](../../docs/development.md#testing-live-voice-from-another-device)
for the complete procedure and required manual evidence.
