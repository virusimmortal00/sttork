# ADR-0010: Pin the workspace to Node 26 Current

- Status: accepted
- Date: 2026-08-19
- Owners: maintainers
- Supersedes: [ADR-0008](0008-node-pnpm-typescript-toolchain.md)

## Context

ADR-0008 established an exact Node 24 LTS, pnpm, and TypeScript foundation and
requires a superseding decision for a Node major change. On 2026-08-19,
[Node 26.7.0](https://nodejs.org/en/download/current) is the latest official
Node release and is in the Current release line; Node 24.19.0 remains the latest
Active LTS release. Node's
[release guidance](https://nodejs.org/en/about/previous-releases) recommends an
Active or Maintenance LTS release for production applications.

The project is still in a bounded development and browser-smoke phase rather
than production deployment. The maintainers have chosen to track the latest Node
release now, accepting the shorter Current-line stability window in return for
exercising the current runtime and toolchain before release. The exact pin
remains important: “latest” is a reviewed upgrade target, not a floating
version.

The local failure that prompted this review came from an EOL Node 20 shell
preceding the installed current Node in `PATH`. pnpm 11.22.0 requires Node 22.13
or newer and attempted to load `node:sqlite`, which Node 20 did not provide.
That local mismatch is separate from pnpm's project version selection.

## Decision

The implementation workspace uses:

- Node.js 26.7.0, pinned by `.node-version`, `.nvmrc`, `package.json`, the
  runtime check, and CI;
- pnpm 11.19.0, unchanged and pinned by `packageManager`, the runtime check, and
  CI;
- TypeScript 6.0.3 and the remaining workspace choices from ADR-0008.

CI and local development must run the exact Node patch. The package engine range
admits Node 26 starting at 26.7.0, while the preinstall runtime check enforces
the exact repository pin. Historical evidence records keep the Node version
under which they were actually produced.

## Consequences

Contributors need Node 26.7.0 even while it is a Current release. This is less
conservative than staying on Node 24 Active LTS and may expose compatibility
regressions sooner; it also prevents the development shell and CI from silently
using different Node majors.

The repository does not automatically move to later Node 26 patches or to
Node 27. Each update remains a reviewed change with a full source-gate run. A
future production deployment must reconsider the release line if Node 26 has not
yet reached LTS.

pnpm remains independently pinned. A globally installed newer pnpm may select
the repository's `packageManager` version; this does not relax the exact project
check or require Corepack.

## Alternatives considered

- Stay on Node 24.19.0 Active LTS. This remains the conservative production
  choice, but does not meet the explicit decision to use the latest official
  Node release.
- Fix only the local shell and leave the repository on Node 24. That would
  resolve the immediate error but preserve a local/CI major-version mismatch.
- Float on `node` or `current`. This would make builds change without review and
  conflicts with the reproducibility goal.
- Upgrade pnpm at the same time. The installed pnpm can already select the
  repository's compatible 11.19.0 pin, so combining an unrelated package manager
  change would make this major-runtime upgrade harder to isolate.

## Validation

The upgrade is accepted only after the exact Node and pnpm versions pass:

```text
pnpm install --frozen-lockfile
pnpm openai:live:build
pnpm run ci
```

The first command exercises the engine-strict and preinstall guards. The live
browser build directly covers the command that exposed the stale Node 20 path;
the source gate and build cover all non-live tests and artifacts without paid
provider calls.

Reevaluate this decision when Node 26 changes release status, before a
production deployment, when a supported dependency rejects Node 26, or before
moving to another Node major.
