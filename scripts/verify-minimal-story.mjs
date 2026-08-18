import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createMinimalStoryManifest,
  minimalStoryPaths,
} from "./minimal-story-manifest.mjs";

const root = resolve(import.meta.dirname, "..");

try {
  const [source, artifact, manifestSource] = await Promise.all([
    readFile(resolve(root, minimalStoryPaths.source)),
    readFile(resolve(root, minimalStoryPaths.artifact)),
    readFile(resolve(root, minimalStoryPaths.manifest), "utf8"),
  ]);
  const actualManifest = JSON.parse(manifestSource);
  const expectedManifest = createMinimalStoryManifest(source, artifact);

  if (!isDeepStrictEqual(actualManifest, expectedManifest)) {
    throw new Error(
      `${minimalStoryPaths.manifest} does not exactly describe the checked-in source and artifact; rebuild it with the pinned compiler`,
    );
  }

  console.log(
    `Verified ${minimalStoryPaths.artifact}: SHA-256 ${expectedManifest.artifact.sha256}, Z-machine V${expectedManifest.artifact.zMachineVersion}, release ${expectedManifest.artifact.release}, serial ${expectedManifest.artifact.serial}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
