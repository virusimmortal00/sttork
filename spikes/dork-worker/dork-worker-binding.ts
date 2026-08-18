/**
 * Pure host/worker compatibility constants for the isolated ADR-0009 spike.
 * This module deliberately imports neither the interpreter nor worker runtime.
 */
export const DORK_WORKER_RUNTIME_ID =
  "dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605" as const;

/** Candidate source/fork identity, not a release-bundle digest. */
export const DORK_WORKER_RUNTIME_ARTIFACT_SHA256 =
  "a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605" as const;

export const DORK_WORKER_BINDING = {
  runtime: {
    id: DORK_WORKER_RUNTIME_ID,
    version: "candidate-1",
    artifactSha256: DORK_WORKER_RUNTIME_ARTIFACT_SHA256,
  },
  adapter: {
    id: "zork-voice-dork-worker-spike",
    version: "1",
  },
  snapshotSchemaVersion: 1,
} as const;
