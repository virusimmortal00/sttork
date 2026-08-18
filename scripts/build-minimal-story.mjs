import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  createMinimalStoryManifest,
  informCompiler,
  minimalStoryBuild,
  minimalStoryPaths,
  serializeMinimalStoryManifest,
} from "./minimal-story-manifest.mjs";

const root = resolve(import.meta.dirname, "..");

function compilerFromArguments(arguments_) {
  let compiler = process.env.INFORM6;
  let check = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--compiler") {
      compiler = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--compiler=")) {
      compiler = argument.slice("--compiler=".length);
      continue;
    }
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (argument === "--") {
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (!compiler) {
    throw new Error(
      "provide the pinned Inform 6.44 executable with --compiler /absolute/path/to/inform or INFORM6",
    );
  }

  return { check, compilerPath: resolve(compiler) };
}

async function compileOnce(compilerPath) {
  const buildDirectory = await mkdtemp(
    join(tmpdir(), "zork-voice-minimal-story-"),
  );

  try {
    const sourceName = basename(minimalStoryPaths.source);
    const outputName = basename(minimalStoryPaths.artifact);
    await copyFile(
      resolve(root, minimalStoryPaths.source),
      resolve(buildDirectory, sourceName),
    );

    const result = spawnSync(
      compilerPath,
      [...minimalStoryBuild.arguments.slice(0, -2), sourceName, outputName],
      {
        cwd: buildDirectory,
        encoding: "utf8",
        env: { ...minimalStoryBuild.environment },
      },
    );
    const diagnostics = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Inform exited with status ${result.status}${diagnostics ? `:\n${diagnostics}` : ""}`,
      );
    }
    if (!diagnostics.includes(informCompiler.banner)) {
      throw new Error(
        `compiler banner did not match pinned ${informCompiler.banner}`,
      );
    }
    if (/\bwarnings?\b/iu.test(diagnostics)) {
      throw new Error(`fixture compilation emitted a warning:\n${diagnostics}`);
    }

    return await readFile(resolve(buildDirectory, outputName));
  } finally {
    await rm(buildDirectory, { force: true, recursive: true });
  }
}

try {
  const { check, compilerPath } = compilerFromArguments(process.argv.slice(2));
  await access(compilerPath, constants.X_OK);

  const [firstBuild, secondBuild] = await Promise.all([
    compileOnce(compilerPath),
    compileOnce(compilerPath),
  ]);
  if (!firstBuild.equals(secondBuild)) {
    throw new Error("two clean Inform builds were not byte-identical");
  }

  const source = await readFile(resolve(root, minimalStoryPaths.source));
  const manifest = createMinimalStoryManifest(source, firstBuild);
  const artifactPath = resolve(root, minimalStoryPaths.artifact);
  const manifestPath = resolve(root, minimalStoryPaths.manifest);

  if (check) {
    const [committedArtifact, committedManifestSource] = await Promise.all([
      readFile(artifactPath),
      readFile(manifestPath, "utf8"),
    ]);
    const committedManifest = JSON.parse(committedManifestSource);
    if (!firstBuild.equals(committedArtifact)) {
      throw new Error(
        "clean rebuild does not match the checked-in minimal.z3 artifact",
      );
    }
    if (!isDeepStrictEqual(manifest, committedManifest)) {
      throw new Error(
        "clean rebuild does not match the checked-in artifact manifest",
      );
    }
  } else {
    await mkdir(resolve(artifactPath, ".."), { recursive: true });
    await writeFile(artifactPath, firstBuild);
    await writeFile(manifestPath, serializeMinimalStoryManifest(manifest));
  }

  console.log(
    `${check ? "Rebuilt and matched" : "Built"} two byte-identical copies of ${minimalStoryPaths.artifact} (${manifest.artifact.sha256}).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
