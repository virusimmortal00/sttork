import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const verifierInputs = [
  "scripts/verify-dork-candidate.mjs",
  "spikes/dork-worker/source-lock.json",
  "spikes/dork-worker/checkpoint-envelope.ts",
  "provenance/records/dork-interpreter-e5fce5c.json",
  "provenance/records/zork1-release-119-story.json",
  "LICENSES/THIRD-PARTY-NOTICES.md",
] as const;

describe("Dork source-fork verifier", () => {
  it("rejects coordinated source-lock metadata drift before trusting its hashes", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "zork-voice-dork-lock-"));
    try {
      for (const path of verifierInputs) {
        const destination = resolve(fixtureRoot, path);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(resolve(repositoryRoot, path), destination);
      }

      const lockPath = resolve(
        fixtureRoot,
        "spikes/dork-worker/source-lock.json",
      );
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      lock.adaptation.forkStatus = "upstream-unmodified";
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

      const result = spawnSync(
        process.execPath,
        [resolve(fixtureRoot, "scripts/verify-dork-candidate.mjs")],
        { encoding: "utf8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Dork fork status mismatch");
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});
