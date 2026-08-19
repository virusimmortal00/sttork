# ADR-0008: Pinned Node, pnpm, and TypeScript foundation

- Status: superseded by [ADR-0010](0010-node-26-current-toolchain.md)
- Date: 2026-08-17
- Owners: maintainers

## Context

M0 needs one reproducible workspace toolchain before engine, guide, browser, or
provider code expands. The repository must run the same real checks locally and
in pull-request CI without relying on globally installed TypeScript tools,
editor-bundled dependencies, a paid provider, or a successful placeholder
script.

The package boundaries are already defined in `docs/architecture.md`. The first
implementation code is small enough that a task-graph product would add
configuration and supply-chain surface without improving correctness.

## Decision

The implementation workspace uses:

- Node.js 24.19.0, pinned by `.node-version`, `.nvmrc`, `package.json`, and CI;
- pnpm 11.19.0, pinned by `packageManager`, runtime checks, and CI;
- pnpm workspaces with a committed frozen lockfile;
- ESM packages and TypeScript 6.0.3 with the repository's strict compiler
  options;
- ESLint for code correctness and Prettier for deterministic formatting;
- Vitest for unit, contract, and local integration suites;
- root scripts in `package.json` as the canonical command surface.

Dependency versions are exact. Workspaces reference each other with
`workspace:*` and import through package entry points rather than TypeScript
path aliases. pnpm alone orchestrates the initial workspace; Turbo, Nx, and a
custom task graph are not introduced.

Pull-request CI installs the exact Node and pnpm versions, installs the
committed lockfile, runs `pnpm check`, then runs `pnpm build`. It receives no
provider credentials. Network-dependent advisory lookup remains a separate
explicit command and is not disguised as a hermetic test.

Patch/minor tool upgrades that preserve this decision update the pins and
lockfile together and do not require a new ADR. A Node major, package manager,
module-system, test-runner, or workspace-orchestrator change requires a
superseding ADR.

## Consequences

Clean installations require the npm registry, but repository checks are local
after dependencies are present. Exact runtime pins reduce environmental drift at
the cost of coordinated version updates.

The ordinary check suite cannot silently pass without tests because Vitest's
`passWithNoTests` setting is false. Planned workspaces do not receive fake
build/test scripts before they contain behavior. The real minimal-story build is
governed separately by ADR-0007. Browser, live-provider, and release commands
will be added only with their actual implementations and gates.

pnpm recursive/task behavior is sufficient for the current repository. If build
time or package count later justifies caching/orchestration, measurements must
support that change and dependency boundaries must remain enforceable.

## Alternatives considered

- npm workspaces would avoid installing pnpm but provide weaker workspace
  ergonomics for the planned package graph and strict internal version links.
- Bun combines runtime, package management, and testing, but would make browser
  and Node service compatibility depend on a less conservative runtime choice.
- Turbo or Nx can add caching and affected-task execution, but neither solves a
  current bottleneck and both add an additional executable/configuration layer.
- Floating LTS or package-manager ranges are convenient but undermine exact
  reproduction while the engine and story build baselines are being proven.

## Validation

A clean environment using only the pinned runtime and lockfile must pass:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm story:verify
```

The GitHub workflow repeats those commands with read-only repository permission.
Reevaluate before the Node 24 support window ends, when a supported dependency
requires a different runtime, or when measured workspace scale makes pnpm-only
orchestration materially inadequate.
