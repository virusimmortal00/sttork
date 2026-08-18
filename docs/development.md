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

`pnpm run ci` does not install dependencies and does not include an advisory
query. The explicit `run` is required: pnpm 11 owns a separate built-in
`pnpm ci` command that performs a clean dependency installation. The GitHub
`Verify repository` job runs the package script with `pnpm run ci`, then
separately runs the networked full dependency audit. The production-only audit
remains available for deployment-focused diagnosis.

\* The story build commands are local after the exact Inform 6.44 compiler is
available. Obtaining its pinned source revision requires network access; the
compiler path is explicit and the build scripts never download tools.

There is no live-provider, browser, or release command yet. Those commands will
be added only alongside real implementations and non-empty tests; the repository
never uses a successful placeholder command to imply a milestone gate exists.

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
