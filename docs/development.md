# Development

The repository foundation is intentionally strict: the same runtime, lockfile,
and commands are used locally and in pull-request CI. Ordinary checks are
hermetic after dependencies are installed and never call a voice or model
provider.

## Prerequisites

- Node.js 24.19.0, pinned by `.node-version` and `.nvmrc`.
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
loopback URL. The server accepts `OPENAI_API_KEY` from its process environment
or from an ignored, regular, current-user-owned, nonempty mode-0600
`.env.local`; it never injects that key into browser code. The browser receives
only a random session token that expires when the local server stops.
Push-to-talk audio is bounded, kept only in memory, consumed once by
transcription, and not logged or placed in test fixtures. The serve script uses
port 4175 by default; an optional positional port may be `0` (allocate one) or
an integer from 1024 through 65535.

The 2026-08-19 smoke profile uses `gpt-4o-mini-transcribe`, `gpt-5.6-luna`, and
`tts-1`, with one global maximum of 12 provider requests for the server process.
A normal spoken turn uses three requests; Repeat uses another speech request.
This is a request ceiling, not a dollar-denominated spend cap. Browser actions
can incur API charges, so stop the server when the smoke is complete. This
harness is not provider promotion, production authentication, or a substitute
for the hermetic source gate.

For the pending manual checkpoint, say an unambiguous single action such as
“look” and confirm one revision plus audible exact engine narration. Then say an
ambiguous request such as “open it” and confirm that the guide asks for
clarification without advancing the engine. Exercise Stop during capture or
playback, and inspect the optional transcript/debug surfaces only to confirm
attribution, Worker isolation, and absence of sensitive audio or credentials.
Record the browser version and console/CSP result. The harness implementation
and its hermetic tests are present, but Slice 5 is not complete until this real
microphone evidence is recorded.

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
