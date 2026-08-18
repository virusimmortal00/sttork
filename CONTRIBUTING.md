# Contributing

Thank you for helping build a free, voice-native interface to classic
interactive fiction.

## Before contributing

Read [AGENTS.md](AGENTS.md) and the documents linked from
[docs/README.md](docs/README.md). The engine-authority, spoiler, accessibility,
credential, privacy, and provenance rules apply to every change.

Use the pinned runtime and canonical commands in
[docs/development.md](docs/development.md). Repository checks and review
protections are described in
[docs/repository-operations.md](docs/repository-operations.md).

Do not add Zork source, compiled story files, artwork, packaging, audio,
walkthroughs, provider recordings, or other third-party material without an
approved provenance record and all required notices.

## Contribution terms

Unless a file says otherwise, contributions are licensed under this repository's
[MIT License](LICENSE). By submitting a contribution, you confirm that you have
the right to provide it under those terms. No contributor license agreement or
copyright assignment is required.

Third-party work must remain under its original license and be clearly separated
from project-owned work. Record its source, exact revision, license, local
paths, modifications, and redistribution decision under `provenance/`.

## Change workflow

1. Identify the milestone and invariant the change advances.
2. Add or update an ADR when changing a settled decision or trust boundary.
3. Add the narrowest automated test, including a regression fixture for a bug.
4. Run the documented format, type, test, provenance, license, and secret
   checks.
5. Review the diff for game assets, credentials, private audio/transcripts,
   inaccessible behavior, and provider objects crossing a domain boundary.

Live provider tests are opt-in, budget-capped, and never part of the ordinary
pull-request suite.

## Reporting problems

Use ordinary issues for non-sensitive bugs and design proposals. Follow
[SECURITY.md](SECURITY.md) for vulnerabilities, leaked credentials, or private
player data. Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community
conduct concerns.
