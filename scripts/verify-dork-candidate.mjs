import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(resolve(root, "spikes/dork-worker/source-lock.json"), "utf8"),
);
const dorkProvenance = JSON.parse(
  await readFile(
    resolve(root, "provenance/records/dork-interpreter-e5fce5c.json"),
    "utf8",
  ),
);
const storyProvenance = JSON.parse(
  await readFile(
    resolve(root, "provenance/records/zork1-release-119-story.json"),
    "utf8",
  ),
);
const checkpointCodecSource = await readFile(
  resolve(root, "spikes/dork-worker/checkpoint-envelope.ts"),
  "utf8",
);
const thirdPartyNotices = await readFile(
  resolve(root, "LICENSES/THIRD-PARTY-NOTICES.md"),
  "utf8",
);
const expectedCandidate = {
  repository: "https://github.com/ntoskrnlexe/dork",
  commit: "e5fce5ca678660611b5d2daa94bbffdb3a84e622",
  tree: "73de3daa6c28926b0d9d628f064f9c0ffe7f0ab0",
  archiveUrl:
    "https://codeload.github.com/ntoskrnlexe/dork/tar.gz/e5fce5ca678660611b5d2daa94bbffdb3a84e622",
  archiveSha256:
    "12a93295d6b16b88eeee999c78a96aee2cc0d68070f61ffff8215133163ba541",
};
const expectedUpstreamSources = new Map([
  [
    "vendor/dork/src/zmachine/index.ts",
    {
      upstreamPath: "src/zmachine/index.ts",
      upstreamSha256:
        "cb4a0239fb09f6346d31b5dce712cb5028922eec34d954ba67bc045c68459079",
      localSha256:
        "29642e45451cc71200ae65ac0b5d39e8babca9b1cc6bbf5a9d5fb8b16aba3276",
    },
  ],
  [
    "vendor/dork/src/zmachine/io.ts",
    {
      upstreamPath: "src/zmachine/io.ts",
      upstreamSha256:
        "845ff234e89e383f6dc97e447cb1f3779bf85b757a9d6b1613d74121450f8a6d",
      localSha256:
        "845ff234e89e383f6dc97e447cb1f3779bf85b757a9d6b1613d74121450f8a6d",
    },
  ],
  [
    "vendor/dork/src/zmachine/machine.ts",
    {
      upstreamPath: "src/zmachine/machine.ts",
      upstreamSha256:
        "f2b82f9b7dd9cefb94af8f9d9df949b7736f4702782e124a11940c44072de1ec",
      localSha256:
        "630da1585f5e12d99a93b12ad35a4eaa8b13c2b218a9cc4f9e4e175ab007e944",
    },
  ],
  [
    "vendor/dork/src/zmachine/memory.ts",
    {
      upstreamPath: "src/zmachine/memory.ts",
      upstreamSha256:
        "a945c1eb3591892214547561c160283017e4480373afd36b3006fa161b01e7f5",
      localSha256:
        "a945c1eb3591892214547561c160283017e4480373afd36b3006fa161b01e7f5",
    },
  ],
  [
    "vendor/dork/src/zmachine/saves.ts",
    {
      upstreamPath: "src/zmachine/saves.ts",
      upstreamSha256:
        "bdb1c6806e2e8535e31ff07061caa0bf7ea4366dd5675fa86770aafcb481ead6",
      localSha256:
        "3aaf18eec09507ffe2fc2142d5178a1958cb10849308f245f44cf2b4e41d6be7",
    },
  ],
  [
    "vendor/dork/src/zmachine/text.ts",
    {
      upstreamPath: "src/zmachine/text.ts",
      upstreamSha256:
        "f13161088413dcfe392429c998bb3392ff9eae3b23e723e4d5fcfde17a7cc443",
      localSha256:
        "cc34bb4b34451f8811ca5dd1a3f46bc2ed222ed08c495a2ec23a18fef291b927",
    },
  ],
  [
    "vendor/dork/src/zmachine/vocab.ts",
    {
      upstreamPath: "src/zmachine/vocab.ts",
      upstreamSha256:
        "c3a25606e2190f4e10c7b9693414db8d22554557a8e8bc000e0d82e7dff9ee8b",
      localSha256:
        "bc4853e0d30709faf5369f4e1a9a665073d3e3431d29952e58eb5e5ac8ac7c6e",
    },
  ],
]);
const expectedSourcePaths = new Set(expectedUpstreamSources.keys());
const expectedNotices = new Map([
  [
    "LICENSES/dork/LICENSE",
    "2f5781c6d90c6390c06ab0048fbcb73db05a713b6f214d9a079dc7b895a2b735",
  ],
  [
    "LICENSES/dork/NOTICE.md",
    "d88be0fa1fbdf954fae2da277820d6d136521e77d539e2fa0c5fc7c03853199a",
  ],
]);
const expectedNoticePaths = new Set(expectedNotices.keys());
const expectedRuntimeCompatibilityId =
  "dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605";
const expectedCheckpointSchemaVersion = 2;
const expectedCheckpointAdapterId = "zork-voice-dork-checkpoint-v2";
const expectedCheckpointWireV2GoldenSha256 =
  "79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba";
const expectedDorkNoticeSectionSha256 =
  "cd7c82306b3c2f0c47aed3eabe7f316dd67143db1f2357075a4be49fe3ba9346";
const expectedAdaptationDescription =
  "This is a modified downstream fork. It retains two build/type-only adaptations and adds explicit behavioral changes for a validated Version 3 host checkpoint at the post-decode READ boundary, a finite per-turn instruction budget, enforcement of the story's parse-buffer token capacity, and checkpointable Z-machine RANDOM semantics with deterministic reseeding and unbiased tail-rejection sampling.";
const expectedChanges = [
  {
    changeId: "dork-nodenext-relative-imports-v1",
    classification: "build-only",
    purpose:
      "Use .js relative TypeScript import specifiers for this repository's NodeNext declaration and JavaScript build.",
    affectedPaths: [
      "vendor/dork/src/zmachine/index.ts",
      "vendor/dork/src/zmachine/machine.ts",
      "vendor/dork/src/zmachine/saves.ts",
      "vendor/dork/src/zmachine/text.ts",
      "vendor/dork/src/zmachine/vocab.ts",
    ],
  },
  {
    changeId: "dork-exact-optional-initial-seed-v1",
    classification: "type-only",
    purpose:
      "Spell initialSeed as number | undefined for exactOptionalPropertyTypes compatibility.",
    affectedPaths: ["vendor/dork/src/zmachine/machine.ts"],
  },
  {
    changeId: "dork-input-boundary-host-checkpoint-v1",
    classification: "behavioral-fork",
    purpose:
      "Capture, validate, detach, and resume a Version 3 post-decode READ checkpoint with dynamic memory, stacks, stream-3 state, PRNG state, instruction counters, pending-input continuation, and a finite per-turn instruction budget.",
    affectedPaths: [
      "vendor/dork/src/zmachine/index.ts",
      "vendor/dork/src/zmachine/machine.ts",
    ],
  },
  {
    changeId: "dork-parse-buffer-capacity-v1",
    classification: "behavioral-fork",
    purpose:
      "Stop tokenization at the story-declared parse-buffer capacity so interpreter input cannot overwrite adjacent dynamic memory.",
    affectedPaths: ["vendor/dork/src/zmachine/vocab.ts"],
  },
  {
    changeId: "dork-rng-correctness-v1",
    classification: "behavioral-fork",
    purpose:
      "Replace the checkpoint seed pair with schema-v2 RNG mode, gameplay, and reseed state; make RANDOM 0 and RESTART deterministically reseedable; interpret RANDOM operands as signed words; scale uint32 draws over 2^32; and export internal helpers for exact regression vectors.",
    affectedPaths: [
      "vendor/dork/src/zmachine/index.ts",
      "vendor/dork/src/zmachine/machine.ts",
    ],
  },
  {
    changeId: "dork-rng-tail-rejection-v1",
    classification: "behavioral-fork",
    purpose:
      "Replace single-draw RANDOM scaling with deterministic tail-rejection sampling so non-divisor ranges are unbiased while the checkpoint retains the final accepted gameplay state; export the exact draw helper for regression vectors.",
    affectedPaths: [
      "vendor/dork/src/zmachine/index.ts",
      "vendor/dork/src/zmachine/machine.ts",
    ],
  },
];
const expectedBehavioralPatchIdentity = {
  format: "git-diff-no-index-full-index-unified-3-v1",
  recipe:
    "Stage each immutable upstream blob as upstream/<upstreamPath> and its frozen local blob as local/<localPath>. In orderedLocalPaths order, concatenate stdout from LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git diff --no-index --no-color --no-ext-diff --full-index --unified=3 -- upstream/<upstreamPath> local/<localPath>; exit status 1 means differences and is expected.",
  orderedChangeIds: [
    "dork-input-boundary-host-checkpoint-v1",
    "dork-parse-buffer-capacity-v1",
    "dork-rng-correctness-v1",
    "dork-rng-tail-rejection-v1",
  ],
  orderedLocalPaths: [
    "vendor/dork/src/zmachine/index.ts",
    "vendor/dork/src/zmachine/machine.ts",
    "vendor/dork/src/zmachine/vocab.ts",
  ],
  byteLength: 28_043,
  sha256: "a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605",
};
const expectedBehavioralForkLedgerSemantics =
  "Behavioral fork records are append-only transitions. A record's localSha256 is the output when that change was introduced; selectedFiles contains the current cumulative fork hashes.";
const expectedBehavioralForks = [
  {
    changeId: "dork-input-boundary-host-checkpoint-v1",
    baseKind: "upstream",
    purpose:
      "Provide a validated input-boundary state handoff that a project-owned host can encode and restore into a replacement session without replaying the already-decoded READ instruction.",
    affectedFiles: [
      {
        upstreamPath: "src/zmachine/index.ts",
        upstreamSha256:
          "cb4a0239fb09f6346d31b5dce712cb5028922eec34d954ba67bc045c68459079",
        localPath: "vendor/dork/src/zmachine/index.ts",
        localSha256:
          "7370bb8f6ce4b2c747369ce2527c03a61ab978d7cf06b81822ca0274e3059651",
      },
      {
        upstreamPath: "src/zmachine/machine.ts",
        upstreamSha256:
          "f2b82f9b7dd9cefb94af8f9d9df949b7736f4702782e124a11940c44072de1ec",
        localPath: "vendor/dork/src/zmachine/machine.ts",
        localSha256:
          "d6172bb7268fcc226e086f279fed76e1ae3a9deda9d6666551b5d25a35c55b69",
      },
    ],
    patchIdentity: {
      format: "git-diff-no-index-full-index-unified-3-v1",
      orderedLocalPaths: [
        "vendor/dork/src/zmachine/index.ts",
        "vendor/dork/src/zmachine/machine.ts",
      ],
      byteLength: 21_619,
      sha256:
        "881e4e9d6932691410454eb5fce7b049ece2bf0e73871a10665bafc3529f6eb0",
    },
  },
  {
    changeId: "dork-parse-buffer-capacity-v1",
    baseKind: "upstream",
    purpose:
      "Honor the story-declared parse-buffer token limit before appending another token record.",
    affectedFiles: [
      {
        upstreamPath: "src/zmachine/vocab.ts",
        upstreamSha256:
          "c3a25606e2190f4e10c7b9693414db8d22554557a8e8bc000e0d82e7dff9ee8b",
        localPath: "vendor/dork/src/zmachine/vocab.ts",
        localSha256:
          "bc4853e0d30709faf5369f4e1a9a665073d3e3431d29952e58eb5e5ac8ac7c6e",
      },
    ],
    patchIdentity: {
      format: "git-diff-no-index-full-index-unified-3-v1",
      orderedLocalPaths: ["vendor/dork/src/zmachine/vocab.ts"],
      byteLength: 1_293,
      sha256:
        "8365b0715a889b6d2665492bc95b4d8e61fc861d5a317de794f0d354fb1390ac",
    },
  },
  {
    changeId: "dork-rng-correctness-v1",
    baseKind: "prior-fork",
    purpose:
      "Make the interpreter's random-mode selection, gameplay stream, and entropy-reseed stream explicit and checkpointable while correcting signed RANDOM operands and unbiased uint32 scaling.",
    affectedFiles: [
      {
        upstreamPath: "src/zmachine/index.ts",
        upstreamSha256:
          "cb4a0239fb09f6346d31b5dce712cb5028922eec34d954ba67bc045c68459079",
        baseLocalSha256:
          "7370bb8f6ce4b2c747369ce2527c03a61ab978d7cf06b81822ca0274e3059651",
        localPath: "vendor/dork/src/zmachine/index.ts",
        localSha256:
          "5ccceca2c003dc79a95b0a85409a1ded86817b778efa5441a9d076b89494dae0",
      },
      {
        upstreamPath: "src/zmachine/machine.ts",
        upstreamSha256:
          "f2b82f9b7dd9cefb94af8f9d9df949b7736f4702782e124a11940c44072de1ec",
        baseLocalSha256:
          "d6172bb7268fcc226e086f279fed76e1ae3a9deda9d6666551b5d25a35c55b69",
        localPath: "vendor/dork/src/zmachine/machine.ts",
        localSha256:
          "3b99f70ebfc9fcb96f1c26e1b3bfda8e3f31e0934df411e7d20a596ab545341b",
      },
    ],
    patchIdentity: {
      format: "git-diff-no-index-full-index-unified-3-v1",
      baseChangeId: "dork-input-boundary-host-checkpoint-v1",
      recipe:
        "Stage each base fork blob as previous/<localPath> and its frozen successor as local/<localPath>. In orderedLocalPaths order, concatenate stdout from LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git diff --no-index --no-color --no-ext-diff --full-index --unified=3 -- previous/<localPath> local/<localPath>; exit status 1 means differences and is expected.",
      orderedLocalPaths: [
        "vendor/dork/src/zmachine/index.ts",
        "vendor/dork/src/zmachine/machine.ts",
      ],
      byteLength: 10_519,
      sha256:
        "1cb1b0e2901844e9b2128a99d4301dc4a7d1b961aad455ed02e41fe3e3a83f98",
    },
  },
  {
    changeId: "dork-rng-tail-rejection-v1",
    baseKind: "prior-fork",
    purpose:
      "Draw uniformly from each positive RANDOM range by consuming deterministic gameplay states until one lies below the largest range-aligned uint32 acceptance limit, and retain the accepted state for checkpoint equivalence.",
    correctsHistoricalClaim:
      "The preceding dork-rng-correctness-v1 record's description of its single-draw 2^32 scaling as unbiased was incomplete for non-divisor ranges; this successor supplies the required rejection step.",
    affectedFiles: [
      {
        upstreamPath: "src/zmachine/index.ts",
        upstreamSha256:
          "cb4a0239fb09f6346d31b5dce712cb5028922eec34d954ba67bc045c68459079",
        baseLocalSha256:
          "5ccceca2c003dc79a95b0a85409a1ded86817b778efa5441a9d076b89494dae0",
        localPath: "vendor/dork/src/zmachine/index.ts",
        localSha256:
          "29642e45451cc71200ae65ac0b5d39e8babca9b1cc6bbf5a9d5fb8b16aba3276",
      },
      {
        upstreamPath: "src/zmachine/machine.ts",
        upstreamSha256:
          "f2b82f9b7dd9cefb94af8f9d9df949b7736f4702782e124a11940c44072de1ec",
        baseLocalSha256:
          "3b99f70ebfc9fcb96f1c26e1b3bfda8e3f31e0934df411e7d20a596ab545341b",
        localPath: "vendor/dork/src/zmachine/machine.ts",
        localSha256:
          "630da1585f5e12d99a93b12ad35a4eaa8b13c2b218a9cc4f9e4e175ab007e944",
      },
    ],
    patchIdentity: {
      format: "git-diff-no-index-full-index-unified-3-v1",
      baseChangeId: "dork-rng-correctness-v1",
      recipe:
        "Stage each base fork blob as previous/<localPath> and its frozen successor as local/<localPath>. In orderedLocalPaths order, concatenate stdout from LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git diff --no-index --no-color --no-ext-diff --full-index --unified=3 -- previous/<localPath> local/<localPath>; exit status 1 means differences and is expected.",
      orderedLocalPaths: [
        "vendor/dork/src/zmachine/index.ts",
        "vendor/dork/src/zmachine/machine.ts",
      ],
      byteLength: 2_391,
      sha256:
        "60056c6fb6842563a264bc438d4ab7800efac54d698e06b0a957c1ab2b4be8d8",
    },
  },
];
const expectedProjectOwnedPaths = [
  "spikes/dork-worker/checkpoint-envelope.ts",
  "spikes/dork-worker/dork-candidate-session.ts",
];
const expectedDorkRedistributionConditions = [
  "Redistribute only the selected interpreter-core files claimed by this record, not the Bun server, xterm UI, upstream test fixtures, walkthrough transcript, or unrelated npm package.",
  "Preserve the Dork MIT license and JSZM ancestry notice.",
  "Keep the exact upstream and locally adapted hashes in spikes/dork-worker/source-lock.json; record and review every further fork change.",
  "Mark the vendored interpreter as a modified downstream fork and do not imply that Dork's authors sponsor or endorse it.",
  "Rotate the checkpoint runtime compatibility identity whenever selected fork bytes or checkpoint semantics change, and version the project-owned envelope and adapter when their wire contract changes.",
  "Do not describe the imported source as an accepted production interpreter until every ADR-0009 gate passes for the emitted bundle.",
];
const expectedDorkNotes = [
  "The upstream candidate has no tag, release, or package version; the full commit and tree are the identity.",
  "The codeload archive at the recorded commit was 154389 bytes and matched the recorded SHA-256.",
  "The vendored core is an intentionally modified, unendorsed downstream fork. Source-lock change dork-input-boundary-host-checkpoint-v1 adds a validated Version 3 post-decode READ checkpoint/resume seam and a finite per-turn instruction budget; dork-parse-buffer-capacity-v1 enforces the story-declared parse-buffer token capacity; dork-rng-correctness-v1 makes RNG mode, gameplay state, and reseed state checkpointable and corrects signed RANDOM operands and deterministic reseeding; dork-rng-tail-rejection-v1 makes positive non-divisor ranges unbiased while retaining the accepted gameplay state.",
  "The current cumulative upstream-to-local behavioral transition is SHA-256 a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605 under the canonical diff recipe in spikes/dork-worker/source-lock.json; every selected upstream and local blob remains hashed separately.",
  "The append-only RNG successor transition from the preceding local checkpoint fork is SHA-256 1cb1b0e2901844e9b2128a99d4301dc4a7d1b961aad455ed02e41fe3e3a83f98 and retains the preceding local hashes as its explicit base.",
  "The append-only tail-rejection successor transition from the RNG correctness fork is SHA-256 60056c6fb6842563a264bc438d4ab7800efac54d698e06b0a957c1ab2b4be8d8 and retains the preceding local hashes as its explicit base.",
  "The schema-v2 checkpoint envelope, v2 adapter, and candidate-session orchestration under spikes/dork-worker are project-owned integration code outside vendor/dork and are not claimed as Dork-derived source.",
  "Dork attributes its interpreter ancestry to public-domain JSZM.",
  "The current upstream save encoding is private rather than Quetzal, is story-opcode driven, and omits PRNG state; redistribution approval does not accept those runtime semantics.",
];
const expectedStory = {
  repository: "https://github.com/historicalsource/zork1",
  commit: "97b7b3d68c075dd9af7da499c3e9690ada3471fd",
  upstreamPath: "COMPILED/zork1.z3",
  localPath: "vendor/zork1/zork1.z3",
  sha256: "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79",
  byteLength: 86_838,
  zMachineVersion: 3,
  release: 119,
  serial: "880429",
  licensePath: "LICENSES/zork1/LICENSE",
  licenseSha256:
    "98a96c38494df4963951e32b81ec4effebe4c8a812ab8d9e7d185d59e86fe2fc",
};

function fail(message) {
  throw new Error(`Dork candidate verification failed: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireExactPaths(entries, expected, label) {
  if (!Array.isArray(entries) || entries.length !== expected.size) {
    fail(`${label} must contain exactly ${expected.size} entries`);
  }
  const paths = entries.map((entry) => entry?.localPath);
  if (new Set(paths).size !== paths.length) {
    fail(`${label} contains duplicate local paths`);
  }
  for (const path of paths) {
    if (!expected.has(path)) fail(`${label} contains unexpected path ${path}`);
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

function requireDeepEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${label} does not match the verifier-pinned value`);
  }
}

function requireExactKeys(actual, expected, label) {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    fail(`${label} must be an object`);
  }
  requireDeepEqual(
    Object.keys(actual).sort(),
    [...expected].sort(),
    `${label} keys`,
  );
}

function markdownSection(document, heading) {
  const marker = `## ${heading}\n`;
  const start = document.indexOf(marker);
  if (start < 0) fail(`missing ${heading} notice section`);
  const end = document.indexOf("\n## ", start + marker.length);
  return document.slice(start, end < 0 ? undefined : end).trimEnd() + "\n";
}

function requireProvenancePaths(entries, expected, label) {
  if (!Array.isArray(entries) || entries.length !== expected.size) {
    fail(`${label} must contain exactly ${expected.size} entries`);
  }
  const actual = new Map(entries.map((entry) => [entry?.path, entry?.sha256]));
  if (actual.size !== entries.length) fail(`${label} contains duplicate paths`);
  for (const [path, sha] of expected) {
    requireEqual(actual.get(path), sha, `${label} ${path}`);
  }
}

function repositoryPath(path) {
  const absolute = resolve(root, path);
  const local = relative(root, absolute);
  if (local === "" || local.startsWith("..")) {
    fail(`path escapes the repository: ${path}`);
  }
  return absolute;
}

async function verifyFile(path, expectedSha256) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    fail(`invalid recorded SHA-256 for ${path}`);
  }
  const bytes = await readFile(repositoryPath(path));
  const actual = sha256(bytes);
  if (actual !== expectedSha256) {
    fail(
      `${path} SHA-256 mismatch: expected ${expectedSha256}, received ${actual}`,
    );
  }
  return bytes;
}

if (lock.schemaVersion !== 3) {
  fail("source lock has an invalid schema version");
}
requireExactKeys(
  lock,
  ["schemaVersion", "candidate", "adaptation", "story"],
  "source lock",
);
requireExactKeys(
  lock.candidate,
  ["repository", "commit", "tree", "archiveUrl", "archiveSha256"],
  "Dork candidate identity",
);
requireExactKeys(
  lock.adaptation,
  [
    "forkStatus",
    "description",
    "runtimeCompatibilityId",
    "changes",
    "behavioralPatchIdentity",
    "behavioralForkLedgerSemantics",
    "behavioralForks",
    "projectOwnedPathsExcludedFromForkProvenance",
    "selectedFiles",
    "notices",
  ],
  "Dork adaptation",
);
requireExactKeys(
  lock.story,
  [
    "repository",
    "commit",
    "upstreamPath",
    "localPath",
    "sha256",
    "byteLength",
    "zMachineVersion",
    "release",
    "serial",
    "licensePath",
    "licenseSha256",
  ],
  "story identity",
);
for (const [field, expected] of Object.entries(expectedCandidate)) {
  requireEqual(lock.candidate?.[field], expected, `candidate ${field}`);
}

requireEqual(
  lock.adaptation?.forkStatus,
  "modified-unendorsed",
  "Dork fork status",
);
requireEqual(
  lock.adaptation?.description,
  expectedAdaptationDescription,
  "Dork adaptation description",
);
requireEqual(
  lock.adaptation?.runtimeCompatibilityId,
  expectedRuntimeCompatibilityId,
  "Dork runtime compatibility ID",
);
requireDeepEqual(
  lock.adaptation?.changes,
  expectedChanges,
  "Dork change ledger",
);
requireDeepEqual(
  lock.adaptation?.behavioralPatchIdentity,
  expectedBehavioralPatchIdentity,
  "Dork behavioral patch identity",
);
requireEqual(
  lock.adaptation?.behavioralForkLedgerSemantics,
  expectedBehavioralForkLedgerSemantics,
  "Dork behavioral fork ledger semantics",
);
requireDeepEqual(
  lock.adaptation?.behavioralForks,
  expectedBehavioralForks,
  "Dork behavioral fork ledger",
);
requireDeepEqual(
  lock.adaptation?.projectOwnedPathsExcludedFromForkProvenance,
  expectedProjectOwnedPaths,
  "project-owned Dork integration boundary",
);

const runtimeIdMatch =
  /export const DORK_CHECKPOINT_RUNTIME_ID\s*=\s*"([^"]+)" as const;/u.exec(
    checkpointCodecSource,
  );
if (!runtimeIdMatch) fail("checkpoint codec runtime ID declaration is missing");
requireEqual(
  runtimeIdMatch[1],
  expectedRuntimeCompatibilityId,
  "checkpoint codec runtime ID",
);
const checkpointSchemaMatch =
  /export const DORK_CHECKPOINT_SCHEMA_VERSION\s*=\s*(\d+) as const;/u.exec(
    checkpointCodecSource,
  );
if (!checkpointSchemaMatch) {
  fail("checkpoint codec schema declaration is missing");
}
requireEqual(
  Number(checkpointSchemaMatch[1]),
  expectedCheckpointSchemaVersion,
  "checkpoint codec schema version",
);
const checkpointAdapterMatch =
  /export const DORK_CHECKPOINT_ADAPTER_ID\s*=\s*"([^"]+)" as const;/u.exec(
    checkpointCodecSource,
  );
if (!checkpointAdapterMatch) {
  fail("checkpoint codec adapter declaration is missing");
}
requireEqual(
  checkpointAdapterMatch[1],
  expectedCheckpointAdapterId,
  "checkpoint codec adapter ID",
);
const checkpointWireGoldenMatch =
  /export const DORK_CHECKPOINT_WIRE_V2_GOLDEN_SHA256\s*=\s*"([a-f0-9]{64})" as const;/u.exec(
    checkpointCodecSource,
  );
if (!checkpointWireGoldenMatch) {
  fail("checkpoint codec wire-v2 golden declaration is missing");
}
requireEqual(
  checkpointWireGoldenMatch[1],
  expectedCheckpointWireV2GoldenSha256,
  "checkpoint codec wire-v2 golden SHA-256",
);
requireEqual(
  sha256(markdownSection(thirdPartyNotices, "Dork TypeScript Z-machine core")),
  expectedDorkNoticeSectionSha256,
  "Dork project notice section SHA-256",
);

const selectedFiles = lock.adaptation?.selectedFiles;
const notices = lock.adaptation?.notices;
requireExactPaths(selectedFiles, expectedSourcePaths, "selected Dork sources");
requireExactPaths(notices, expectedNoticePaths, "Dork notices");

for (const entry of selectedFiles) {
  requireExactKeys(
    entry,
    ["upstreamPath", "upstreamSha256", "localPath", "localSha256"],
    "selected Dork source",
  );
  const expected = expectedUpstreamSources.get(entry.localPath);
  if (expected === undefined) fail(`unexpected source ${entry.localPath}`);
  requireEqual(
    entry.upstreamPath,
    expected.upstreamPath,
    `${entry.localPath} upstream path`,
  );
  requireEqual(
    entry.upstreamSha256,
    expected.upstreamSha256,
    `${entry.localPath} upstream SHA-256`,
  );
  requireEqual(
    entry.localSha256,
    expected.localSha256,
    `${entry.localPath} local SHA-256`,
  );
  await verifyFile(entry.localPath, expected.localSha256);
}
for (const entry of notices) {
  requireExactKeys(entry, ["localPath", "sha256"], "Dork notice");
  const expectedSha256 = expectedNotices.get(entry.localPath);
  if (expectedSha256 === undefined)
    fail(`unexpected notice ${entry.localPath}`);
  requireEqual(entry.sha256, expectedSha256, `${entry.localPath} SHA-256`);
  await verifyFile(entry.localPath, expectedSha256);
}

requireEqual(dorkProvenance.schemaVersion, 1, "Dork provenance schema");
requireEqual(
  dorkProvenance.id,
  "dork-interpreter-e5fce5c",
  "Dork provenance ID",
);
requireEqual(
  dorkProvenance.name,
  "Dork TypeScript Z-machine interpreter core",
  "Dork provenance name",
);
requireEqual(dorkProvenance.origin, "third-party", "Dork provenance origin");
requireEqual(dorkProvenance.kind, "interpreter", "Dork provenance kind");
requireEqual(
  dorkProvenance.importStatus,
  "imported",
  "Dork provenance import status",
);
requireEqual(dorkProvenance.license?.spdx, "MIT", "Dork provenance SPDX");
requireEqual(
  dorkProvenance.license?.sourceUrl,
  `https://github.com/ntoskrnlexe/dork/blob/${expectedCandidate.commit}/LICENSE`,
  "Dork provenance license URL",
);
requireEqual(
  dorkProvenance.redistribution?.decision,
  "approved",
  "Dork redistribution decision",
);
requireEqual(
  dorkProvenance.redistribution?.trademarkGrant,
  false,
  "Dork trademark grant",
);
requireDeepEqual(
  dorkProvenance.redistribution?.conditions,
  expectedDorkRedistributionConditions,
  "Dork redistribution conditions",
);
requireEqual(
  dorkProvenance.verifiedAt,
  "2026-08-18",
  "Dork provenance verification date",
);
requireDeepEqual(
  dorkProvenance.notes,
  expectedDorkNotes,
  "Dork provenance notes",
);
requireEqual(
  dorkProvenance.upstream?.url,
  lock.candidate.repository,
  "Dork provenance URL",
);
requireEqual(
  dorkProvenance.upstream?.revision,
  lock.candidate.commit,
  "Dork provenance revision",
);
requireEqual(
  dorkProvenance.upstream?.artifactSha256,
  lock.candidate.archiveSha256,
  "Dork provenance archive SHA-256",
);
requireProvenancePaths(
  dorkProvenance.localPaths,
  new Map(
    [...expectedUpstreamSources].map(([path, identity]) => [
      path,
      identity.localSha256,
    ]),
  ),
  "Dork provenance paths",
);
requireExactPaths(
  dorkProvenance.license?.localNoticePaths?.map((localPath) => ({ localPath })),
  expectedNoticePaths,
  "Dork provenance notices",
);

for (const [field, expected] of Object.entries(expectedStory)) {
  requireEqual(lock.story?.[field], expected, `story ${field}`);
}
const story = await verifyFile(expectedStory.localPath, expectedStory.sha256);
await verifyFile(expectedStory.licensePath, expectedStory.licenseSha256);

requireEqual(
  storyProvenance.upstream?.url,
  expectedStory.repository,
  "story provenance URL",
);
requireEqual(
  storyProvenance.upstream?.revision,
  expectedStory.commit,
  "story provenance revision",
);
requireEqual(
  storyProvenance.upstream?.artifactSha256,
  expectedStory.sha256,
  "story provenance artifact SHA-256",
);
requireProvenancePaths(
  storyProvenance.localPaths,
  new Map([[expectedStory.localPath, expectedStory.sha256]]),
  "story provenance paths",
);
requireExactPaths(
  storyProvenance.license?.localNoticePaths?.map((localPath) => ({
    localPath,
  })),
  new Set([expectedStory.licensePath]),
  "story provenance notices",
);

if (story.byteLength !== expectedStory.byteLength) {
  fail(
    `story length mismatch: expected ${expectedStory.byteLength}, received ${story.byteLength}`,
  );
}
if (story[0] !== expectedStory.zMachineVersion) {
  fail(
    `story version mismatch: expected ${expectedStory.zMachineVersion}, received ${story[0]}`,
  );
}
const release = (story[2] << 8) | story[3];
if (release !== expectedStory.release) {
  fail(
    `story release mismatch: expected ${expectedStory.release}, received ${release}`,
  );
}
const serial = Buffer.from(story.subarray(18, 24)).toString("ascii");
if (serial !== expectedStory.serial) {
  fail(
    `story serial mismatch: expected ${expectedStory.serial}, received ${serial}`,
  );
}
const declaredLength = ((story[26] << 8) | story[27]) * 2;
if (declaredLength !== story.byteLength) {
  fail(
    `story header length ${declaredLength} does not match ${story.byteLength} bytes`,
  );
}
let checksum = 0;
for (const byte of story.subarray(64, declaredLength)) {
  checksum = (checksum + byte) & 0xffff;
}
const declaredChecksum = (story[28] << 8) | story[29];
if (checksum !== declaredChecksum) {
  fail(
    `story checksum mismatch: expected ${declaredChecksum.toString(16)}, received ${checksum.toString(16)}`,
  );
}

console.log(
  `Verified Dork ${expectedCandidate.commit.slice(0, 12)} core and Zork I ${expectedStory.release}/${expectedStory.serial}.`,
);
