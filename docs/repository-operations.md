# Repository operations

This document separates configuration committed in the repository from settings
that maintainers must apply on the GitHub repository. A workflow file cannot
protect its own branch, grant a review, or make a release trustworthy by itself.

## Pull-request CI

`.github/workflows/ci.yml` is the only initial workflow. It:

- runs on pull requests, pushes to `main`, and explicit manual dispatches;
- has read-only repository contents permission;
- checks out without persisting a credential;
- pins GitHub Actions by full commit SHA;
- installs Node 24.19.0 and pnpm 11.19.0 exactly;
- installs only the committed lockfile;
- runs `pnpm run ci`, which is the hermetic source gate followed by the
  TypeScript build (the explicit `run` avoids pnpm's unrelated built-in clean
  install command);
- runs a networked high-severity audit of all locked dependencies after the
  deterministic gate;
- builds Inform 6.44 from its pinned source revision in a separate job and uses
  the non-writing story comparison command;
- receives no provider credentials and cannot make a paid provider call.

Dependency installation and the full advisory audit use the npm registry on a
cold runner. The source gate, build, and ordinary tests are local and
non-billable. `pnpm audit:production` remains available as the narrower
production-only query; neither audit is disguised as a hermetic test.

## Required GitHub settings

After the repository and default branch exist, maintainers configure a branch
ruleset for `main` with:

- pull requests required before merge;
- at least one approval and CODEOWNER review;
- stale approvals dismissed when the diff changes;
- all review conversations resolved;
- required status checks `CI / Verify repository` and
  `CI / Rebuild minimal story`;
- force pushes and branch deletion disabled;
- linear history required if the selected merge policy supports it.

Repository Actions permissions remain read-only by default. Workflow write
permissions are granted to an individual job only when its implemented task
requires them. `pull_request_target` is not used for untrusted code. Enable
GitHub secret scanning and push protection when the hosting plan provides them.

`CODEOWNERS` assigns the initial maintainer globally and repeats ownership for
workflow, security, contract, ADR, license, and provenance paths so later
area-owner changes do not accidentally remove trust-boundary review.

## Dependency updates

Dependabot checks the pnpm workspace and GitHub Actions weekly. Routine
development dependency minor/patch releases may be grouped; major updates stay
separate. An update must pass the same checks as an ordinary pull request.
Action updates retain a full commit SHA and a human-readable release comment.

## Releases

There is deliberately no publishing workflow during M0. Before the first release
workflow is added, maintainers must have real reproducible artifacts,
SBOM/checksum generation, a protected `release` environment, protected version
tags, least-privilege write permissions, and an artifact attestation design.

Do not publish a source-only placeholder release to claim the release pipeline
works. The accepted fixture build is test infrastructure, not a production game
release. M0 remains incomplete until the production interpreter and
repository-protection evidence in `docs/milestones.md` are satisfied.

## Incident intake

The regression issue form follows the severity/classes and evidence fields in
`docs/testing.md`. Public reports must be sanitized. Credential exposure,
private player data, exploitable vulnerabilities, or ongoing uncontrolled spend
use the private process in `SECURITY.md`, followed by credential revocation or
provider disablement before public diagnosis.
