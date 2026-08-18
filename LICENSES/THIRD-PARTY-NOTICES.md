# Third-party notices

## Dork TypeScript Z-machine core

Selected files adapted from Dork commit
`e5fce5ca678660611b5d2daa94bbffdb3a84e622` are included under `vendor/dork/` for
the ADR-0009 interpreter integration. This source is a modified downstream fork,
not an upstream Dork distribution, and is not sponsored or endorsed by Dork's
authors. Its build-only adaptations, intentional behavioral changes, exact
upstream/local hashes, and canonical patch identity are recorded in the
[source lock](../spikes/dork-worker/source-lock.json). Dork is Copyright (c)
2026 Keenan Hellyer and licensed under the MIT License. The complete preserved
license and ancestry notice are in [`dork/LICENSE`](dork/LICENSE) and
[`dork/NOTICE.md`](dork/NOTICE.md).

The checkpoint envelope codec and candidate-session orchestration outside
`vendor/dork/` are project-owned integration code, not upstream Dork source.

The selected core began as a TypeScript port of Aaron Black's public-domain
JSZM. Dork's notice preserves the upstream attribution and source links.

## Zork I Release 119 story

`vendor/zork1/zork1.z3` is the 86,838-byte Z-machine version 3 story from
`COMPILED/zork1.z3` at historicalsource commit
`97b7b3d68c075dd9af7da499c3e9690ada3471fd`. It is Release 119, serial `880429`,
SHA-256 `37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79`.

The code and game data are Copyright (c) 2025 Microsoft and licensed under the
MIT License preserved in [`zork1/LICENSE`](zork1/LICENSE).

Development dependencies installed from the package lockfile are reported by the
repository's license check; they are not copied into source control.

The names **Zork** and **Infocom** identify third-party works and their history.
Neither MIT license grants rights to trademarks, logos, commercial packaging, or
marketing assets. This project is unaffiliated with and is not presented as
sponsored or endorsed by Microsoft, Xbox, Activision, or Infocom.
