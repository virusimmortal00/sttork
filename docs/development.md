# Development

The repository foundation is intentionally strict: the same runtime, lockfile,
and commands are used locally and in pull-request CI. Ordinary checks are
hermetic after dependencies are installed and never call a voice or model
provider.

## Prerequisites

- Node.js 26.7.0, pinned by `.node-version` and `.nvmrc`.
- pnpm 11.19.0, pinned by `package.json`.

The runtime check rejects a different Node patch or pnpm major/minor. This is
deliberate while the first deterministic fixtures and build pipeline are being
established. Runtime upgrades are reviewed dependency changes and update all
pins together.

## Install

```sh
pnpm install --frozen-lockfile
```

The first install requires access to the npm registry. With a populated pnpm
store, the equivalent offline verification is:

```sh
pnpm install --offline --frozen-lockfile
```

Do not reuse dependencies bundled with an editor or agent runtime. Add a direct
dependency to the owning workspace and commit the resulting lockfile change.

## Canonical commands

| Command                                     | Purpose                                                     | Network |
| ------------------------------------------- | ----------------------------------------------------------- | ------- |
| `pnpm format:check`                         | Verify formatting without changing files                    | no      |
| `pnpm format`                               | Apply repository formatting                                 | no      |
| `pnpm lint`                                 | Run ESLint with zero warnings allowed                       | no      |
| `pnpm typecheck`                            | Run strict TypeScript checking                              | no      |
| `pnpm test:unit`                            | Run pure unit tests                                         | no      |
| `pnpm test:contract`                        | Run domain/provider-neutral contract tests                  | no      |
| `pnpm test:integration`                     | Run local cross-package integration tests                   | no      |
| `pnpm test`                                 | Run every current non-live Vitest test                      | no      |
| `pnpm story:verify`                         | Authenticate the checked-in minimal story and manifest      | no      |
| `pnpm dork:verify`                          | Authenticate the Dork core and bundled Zork I artifact      | no      |
| `pnpm dork:worker:build`                    | Build the ignored Dork browser-Worker smoke module graph    | no      |
| `pnpm dork:worker:serve`                    | Serve the built smoke on loopback with restrictive CSP      | no      |
| `pnpm voice:shell:build`                    | Build the deterministic browser audio shell and Worker      | no      |
| `pnpm voice:shell:serve`                    | Serve that shell on loopback with restrictive CSP           | no      |
| `pnpm openai:live:build`                    | Build the opt-in OpenAI live shell, server, and Worker      | no      |
| `pnpm openai:live:serve`                    | Serve the budget-limited live shell on loopback             | yes†    |
| `pnpm story:build -- --compiler PATH`       | Rebuild twice and write the deterministic story artifact    | no\*    |
| `pnpm story:build:check -- --compiler PATH` | Rebuild twice and compare without writing                   | no\*    |
| `pnpm check:provenance`                     | Validate upstream records and admitted files                | no      |
| `pnpm check:licenses`                       | Validate project and installed dependency licenses          | no      |
| `pnpm check:secrets`                        | Scan the working tree for high-confidence secret patterns   | no      |
| `pnpm check`                                | Run the hermetic source gate, including every non-live test | no      |
| `pnpm build`                                | Emit the current TypeScript package build                   | no      |
| `pnpm run ci`                               | Run `check` and then `build`, as the CI verify job does     | no      |
| `pnpm audit:all`                            | Query advisories for all locked dependencies                | yes     |
| `pnpm audit:production`                     | Query current production dependency advisories              | yes     |

`pnpm check` deliberately invokes broad `pnpm test`, not only today's named test
categories. Any future non-live test matching the root Vitest configuration
therefore enters the source gate automatically. Focused test commands remain
available for fast local iteration.

The Dork Worker smoke is manual browser evidence, not a production build or an
M0 pass. Run `pnpm dork:worker:build`, then `pnpm dork:worker:serve`, and open
the printed loopback URL in the browser under test. A passing page records the
Worker-isolation flags and exact restore flow. Record the browser version and
console/CSP result separately; Safari and the full release matrix remain
required even after one Chrome pass.

The Slice 4 voice shell is also bounded manual browser evidence. Run
`pnpm voice:shell:build`, then `pnpm voice:shell:serve`, and open the printed
loopback URL. Its scripted clips are metadata-only fixtures: no recorded player
audio, microphone permission, paid API, or provider credential is used. Verify
the default-hidden transcript/debug surfaces, one committed spoken turn, a
non-mutating clarification and silence turn, session controls, Worker-isolation
flags, and a clean console. This smoke does not qualify a live provider or the
supported-browser matrix.

`pnpm run ci` does not install dependencies and does not include an advisory
query. The explicit `run` is required: pnpm 11 owns a separate built-in
`pnpm ci` command that performs a clean dependency installation. The GitHub
`Verify repository` job runs the package script with `pnpm run ci`, then
separately runs the networked full dependency audit. The production-only audit
remains available for deployment-focused diagnosis.

The Slice 5 OpenAI harness is opt-in developer evidence. First run
`pnpm openai:live:build`, then `pnpm openai:live:serve`, and open the printed
Browser URL, which is loopback by default. The server accepts `OPENAI_API_KEY`
from its process environment or from an ignored, regular, current-user-owned,
nonempty mode-0600 `.env.local`; it never injects that key into browser code.
The browser receives only a random session token that expires when the local
server stops. Push-to-talk audio is bounded, kept only in memory, consumed once
by transcription, and not logged or placed in test fixtures. The serve script
uses port 4175 by default; an optional positional port may be `0` (allocate one)
or an integer from 1024 through 65535.

### Testing live voice from another device

Loopback remains the safe default. With `ZORK_VOICE_PUBLIC_ORIGIN` unset, the
harness listens on `127.0.0.1` and its browser and upstream origin is
`http://127.0.0.1:<port>`. Loopback HTTP is treated as a potentially trustworthy
browser origin, so microphone capture can work without adding a TLS proxy.

An opt-in remote-device smoke keeps that listener on loopback but gives the
browser an exact HTTPS origin served through a trusted reverse proxy. For
example:

```sh
pnpm openai:live:build
ZORK_VOICE_PUBLIC_ORIGIN=https://voice-dev.example.test \
  pnpm openai:live:serve
```

For remote-device mode, the value must be one exact, serialized HTTPS origin:
scheme, hostname, and an optional non-default port only. Credentials, a path
(including a trailing slash), query, fragment, and wildcard host are rejected.
An explicit exact loopback HTTP origin is also accepted for same-device use, but
it does not make the harness reachable from another device. The launcher prints
separate Browser and Upstream URLs. Open the Browser URL on the test device;
configure the proxy to forward it to the loopback Upstream URL printed by this
specific process.

The supported topology has either a same-machine proxy or a private,
authenticated proxy connected to the developer machine by an encrypted tunnel.
The backend's HTTP port remains loopback-only in both cases. Do not bind or
forward that port directly onto the LAN or public internet. The proxy must:

- terminate HTTPS with a certificate trusted by the test device and restrict
  every path to explicitly authorized users/devices on the private network;
- preserve the original raw `Host` header exactly, including any non-default
  port, and preserve the browser's `Origin` and `x-zork-voice-live-session`
  headers without rewriting or stripping them; `X-Forwarded-Host` is ignored and
  cannot substitute for the raw header;
- forward the origin at `/` without a host-changing redirect, path prefix, or
  alternate origin;
- honor `Cache-Control: no-store`, disable intermediary/CDN caching, and avoid
  request/response-body, transcript, audio, credential, cookie, and live-session
  header logging;
- retain bounded uploads. The harness rejects transcription bodies over 2 MiB
  and guide/speech JSON bodies over 16 KiB; a proxy may enforce equal or tighter
  per-route limits but must not buffer accepted bodies to persistent storage.

The injected process-lifetime session value is a same-origin request control,
not user authentication: anyone allowed to load the page receives it. External
access control therefore belongs in front of the entire origin, not only the API
paths. Stop the process and close or revoke the tunnel after the smoke.

Plain `http://<LAN-IP>:<port>` is intentionally unsupported. Unlike loopback, an
ordinary LAN HTTP origin is not a secure browser context, so microphone APIs are
unavailable or rejected; the harness also rejects it as a configured public
origin. HTTPS is required even when the test device and developer machine share
a trusted home network.

The 2026-08-19 smoke profile uses `gpt-4o-mini-transcribe`, `gpt-5.6-luna`, and
`tts-1`, with one global maximum of 12 provider requests for the server process.
The initial `START STORY` narration uses one speech request without requesting
microphone permission. A normal spoken turn uses three requests; Repeat uses
another speech request, including when it retries the retained opening source.
All of them count against the same global ceiling. This is a request ceiling,
not a dollar-denominated spend cap. Browser actions can incur API charges, so
stop the server when the smoke is complete. This harness is not provider
promotion, production authentication, or a substitute for the hermetic source
gate.

For the pending manual checkpoint, first activate `START STORY` without granting
microphone permission. Confirm that the authenticated opening is narrated once
at revision zero, that Stop is available during playback, and that the normal
speaking control appears after a completed, interrupted, or failed opening. An
unclassified failed case should remain `Action needed`, with speaking, text, and
Repeat still usable. On Safari and other browsers that require explicit media
authorization, the status should instead say `Tap Repeat to enable audio`;
`Request limit reached` identifies the process-global smoke cap. Repeat must
show Processing while it is synthesizing rather than retaining a stale blocked
heading. The initial path should consume one TTS request; Repeat should consume
another while reusing the same opening event. Then say an unambiguous single
action such as “look” and confirm one revision plus audible exact engine
narration. Say an ambiguous request such as “open it” and confirm that the guide
asks for clarification without advancing the engine. Exercise Stop during
capture or playback, and inspect the optional transcript/debug surfaces only to
confirm attribution, Worker isolation, and absence of sensitive audio or
credentials. Record the browser version and console/CSP result. The harness
implementation and its hermetic tests are present, but Slice 5 is not complete
until this real microphone evidence is recorded.

For a remote-device run, additionally record the device operating system and
browser, that `window.isSecureContext` is true, the exact configured origin and
proxy/tunnel class, and successful microphone permission. Confirm that an
unauthenticated client cannot load any path, the raw upstream port is not
reachable from the LAN, all browser API requests retain the one public origin,
and a missing or mismatched `Host` receives `403` before content is served.
Proxy/cache/log inspection must contain no API key, live-session header value,
transcript, or raw audio. Evidence may redact a private hostname, but it must
retain enough configuration detail to reproduce the trust and routing model.

\* The story build commands are local after the exact Inform 6.44 compiler is
available. Obtaining its pinned source revision requires network access; the
compiler path is explicit and the build scripts never download tools.

† Serving the shell itself is local. Browser actions make bounded live provider
requests and can incur API charges.

There is no automated live-provider test or release command yet. The manual
OpenAI live harness is backed by non-empty hermetic adapter/server tests; it is
not a successful placeholder and is excluded from ordinary provider calls.

The minimal story pipeline is accepted by ADR-0007 and proves a deterministic,
legal fixture. `dork:verify` authenticates the ADR-0009 candidate inputs but
does not accept its runtime behavior or substitute for the open Worker/save
gates.

## Test placement

- `*.unit.test.ts` covers pure behavior.
- `*.contract.test.ts` covers a versioned boundary shared by implementations.
- `tests/*.integration.test.ts` covers local interactions across packages.
- `*.live.test.ts` is reserved for future opt-in, capped provider smoke tests
  and is excluded from every ordinary command.

Tests must not call the public internet or paid APIs. Provider adapters will use
recorded/synthetic fixtures in pull requests and a separately protected live
workflow only after the provider milestone begins. Never use `passWithNoTests`,
unconditional skips, or `|| true` to make a required suite green.

## Adding a workspace

Use one package for one architectural responsibility. Domain packages expose a
small public entry point and depend on other workspaces using `workspace:*`. Do
not use TypeScript path aliases to bypass a package boundary. The dependency
directions in `docs/architecture.md` remain authoritative.

An implementation workspace includes real source and proportionate tests in the
same change. The existing README-only workspaces mark planned boundaries; do not
give them successful build/test scripts until they contain behavior to verify.

## Before opening a pull request

Run:

```sh
pnpm run ci
```

When network access is available, also run `pnpm audit:all`; pull-request CI
enforces it independently. Then complete the pull-request risk review. A bug fix
includes a failing regression test unless the pull request documents why one
cannot be created. Provider, browser, accessibility, audio, security, and
provenance changes may require additional evidence described in
`docs/testing.md`.
