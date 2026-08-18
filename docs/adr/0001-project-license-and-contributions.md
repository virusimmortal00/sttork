# ADR-0001: MIT license and inbound contribution terms

- Status: accepted
- Date: 2026-08-17
- Owners: maintainers

## Context

The project is intended to remain free and open source. Contributors and
self-hosters need clear rights before implementation begins, while third-party
story, interpreter, compiler, and asset licenses must remain distinguishable
from project-owned code.

## Decision

Project-owned source and documentation use the MIT License unless a file says
otherwise. Contributions use the same inbound license without a copyright
assignment or separate contributor license agreement. Contributors certify that
they have the right to submit their work under those terms.

Third-party work retains its original license, notices, provenance, and local
separation. The project license grants no trademark rights and does not absorb
Zork source or compiled artifacts into the project's copyright.

## Consequences

The code can be used, modified, redistributed, and self-hosted with minimal
license friction. Maintainers must preserve notices and cannot describe the
whole distribution as MIT when a bundled component has different terms.

## Alternatives considered

- Apache-2.0 provides an explicit patent grant but differs from the upstream
  story's simple MIT posture and adds notice mechanics not currently needed.
- GPL-family licensing would guarantee reciprocal source availability for
  derivatives but could complicate embedding interpreters and deployment
  integrations before their licenses are audited.
- Deferring the license would prevent meaningful outside contribution.

## Validation

CI checks that the root license, contribution terms, third-party notices, and
provenance registry exist. Reevaluate only if a required dependency is legally
incompatible or maintainers deliberately choose a new licensing strategy in a
superseding ADR.
