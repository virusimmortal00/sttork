import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  applyPinnedFileTransformations,
  assertDirectoryIdentity,
  assertForbiddenClosureAbsent,
  assertGitIdentity,
  assertSha256,
  captureDirectoryIdentity,
  createDockerEnvironment,
  createGitEnvironment,
  extractInspectedTarArchive,
  fetchPinnedBytes,
  HarnessError,
  inspectPinnedTarGzipArchive,
  loadSourceLock,
  parseArguments,
  readRegularFileWithinRoot,
  runCommand,
  sha256,
  validateWorkDirectory,
  verifyFileHashes,
} from "./harness-lib.mjs";

const harnessRoot = import.meta.dirname;
const repositoryRoot = resolve(harnessRoot, "../..");
const lockPath = resolve(harnessRoot, "source-lock.json");

function verifyBuilder(lock, environment) {
  const image = lock.experimentalBuilder.localImageId;
  const actualImage = runCommand(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", image],
    { env: environment },
  ).trim();
  if (actualImage !== image) {
    throw new HarnessError(
      `builder image mismatch: expected ${image}, received ${actualImage}`,
    );
  }

  const platform = runCommand(
    "docker",
    ["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image],
    { env: environment },
  ).trim();
  if (platform !== lock.experimentalBuilder.platform) {
    throw new HarnessError(
      `builder platform mismatch: expected ${lock.experimentalBuilder.platform}, received ${platform}`,
    );
  }
}

const gitConfiguration = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "http.followRedirects=false",
]);

function runGit(workDirectory, arguments_, environment) {
  return runCommand("git", [...gitConfiguration, ...arguments_], {
    cwd: workDirectory,
    env: environment,
  });
}

async function fetchGitCheckout(workDirectory, label, pin, environment) {
  await mkdir(workDirectory);
  runGit(workDirectory, ["init", "--quiet", "--template="], environment);
  runGit(
    workDirectory,
    ["remote", "add", "origin", pin.repositoryUrl],
    environment,
  );
  runGit(
    workDirectory,
    ["fetch", "--quiet", "--depth=1", "origin", pin.revision],
    environment,
  );
  runGit(
    workDirectory,
    ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
    environment,
  );

  const revision = runGit(
    workDirectory,
    ["rev-parse", "HEAD"],
    environment,
  ).trim();
  const tree = runGit(
    workDirectory,
    ["rev-parse", "HEAD^{tree}"],
    environment,
  ).trim();
  assertGitIdentity(label, revision, tree, pin);

  const status = runGit(
    workDirectory,
    ["status", "--porcelain=v1"],
    environment,
  ).trim();
  if (status !== "") {
    throw new HarnessError(`${label} checkout was not clean after checkout`);
  }
}

async function stageEmglkenGlue(checkout, target, selectedFiles) {
  for (const [relativePath, expectedHash] of Object.entries(selectedFiles)) {
    const contents = await readRegularFileWithinRoot(
      checkout,
      relativePath,
      `Emglken glue ${relativePath}`,
    );
    assertSha256(`Emglken glue ${relativePath}`, contents, expectedHash);
    const destination = resolve(target, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, { flag: "wx" });
  }
}

function dockerArguments(workDirectory, lock, command) {
  return [
    "run",
    "--rm",
    "--platform",
    lock.experimentalBuilder.platform,
    "--volume",
    `${workDirectory}:/work`,
    "--volume",
    `${harnessRoot}:/harness:ro`,
    "--workdir",
    "/work/checkouts/remglk",
    "--env",
    "CARGO_HOME=/work/cargo-home",
    "--env",
    "RUSTFLAGS=-Csymbol-mangling-version=v0",
    lock.experimentalBuilder.localImageId,
    "sh",
    "-euc",
    command,
  ];
}

async function buildCandidate(workDirectory, lock, environment) {
  const cargoClosureCommand = [
    "cargo tree --locked --package remglk_capi",
    "--target wasm32-unknown-emscripten --edges normal,build",
  ].join(" ");
  const cargoTree = runCommand(
    "docker",
    dockerArguments(workDirectory, lock, cargoClosureCommand),
    { env: environment },
  );
  for (const forbidden of lock.forbiddenClosureNames) {
    if (cargoTree.toLowerCase().includes(forbidden.toLowerCase())) {
      throw new HarnessError(
        `resolved Cargo tree contains forbidden component ${forbidden}`,
      );
    }
  }
  await writeFile(resolve(workDirectory, "cargo-tree.txt"), cargoTree, {
    flag: "wx",
  });

  runCommand(
    "docker",
    dockerArguments(
      workDirectory,
      lock,
      "cargo build --release --locked --package remglk_capi --target wasm32-unknown-emscripten",
    ),
    { env: environment, inherit: true },
  );

  const configureCommand = [
    "emcmake cmake -S /harness/cmake -B /work/build",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DZV_BOCFEL_SOURCE_DIR=/work/sources/bocfel-2.5.1",
    "-DZV_REMGLK_SOURCE_DIR=/work/checkouts/remglk",
    "-DZV_EMGLKEN_GLUE_DIR=/work/sources/emglken-glue",
    "-DZV_REMGLK_LIBRARY=/work/checkouts/remglk/target/wasm32-unknown-emscripten/release/libremglk_capi.a",
  ].join(" ");
  runCommand("docker", dockerArguments(workDirectory, lock, configureCommand), {
    env: environment,
    inherit: true,
  });
  runCommand(
    "docker",
    dockerArguments(
      workDirectory,
      lock,
      "cmake --build /work/build --target bocfel-noz6 --parallel 1",
    ),
    { env: environment, inherit: true },
  );
}

async function main() {
  const lock = await loadSourceLock(lockPath);
  const arguments_ = parseArguments(process.argv.slice(2));
  const workDirectory = await validateWorkDirectory(arguments_.workDirectory, {
    repositoryRoot,
  });
  const workDirectoryIdentity = await captureDirectoryIdentity(
    workDirectory,
    "work directory",
  );
  const dockerConfigDirectory = resolve(workDirectory, "docker-config");
  await mkdir(dockerConfigDirectory, { mode: 0o700 });
  await writeFile(resolve(dockerConfigDirectory, "config.json"), "{}\n", {
    flag: "wx",
    mode: 0o600,
  });
  const dockerEnvironment = createDockerEnvironment(process.env, {
    configDirectory: dockerConfigDirectory,
  });
  const gitEnvironment = createGitEnvironment();

  // Refuse network access before proving that this exact local, immutable
  // experimental builder is available.
  verifyBuilder(lock, dockerEnvironment);
  await assertDirectoryIdentity(workDirectoryIdentity, "work directory");

  const downloads = resolve(workDirectory, "downloads");
  const checkouts = resolve(workDirectory, "checkouts");
  const sources = resolve(workDirectory, "sources");
  await Promise.all([mkdir(downloads), mkdir(checkouts), mkdir(sources)]);

  const archive = await fetchPinnedBytes(lock.bocfel.archiveUrl, {
    allowedOrigins: lock.bocfel.allowedOrigins,
    expectedByteLength: lock.bocfel.archiveByteLength,
    label: "Bocfel archive",
  });
  await assertDirectoryIdentity(workDirectoryIdentity, "work directory");
  const archiveInspection = inspectPinnedTarGzipArchive(archive, lock.bocfel);
  const archivePath = resolve(downloads, "bocfel-2.5.1.tar.gz");
  await writeFile(archivePath, archive, { flag: "wx" });

  await extractInspectedTarArchive(archiveInspection, sources);
  const bocfelRoot = resolve(sources, lock.bocfel.archiveRoot);
  await verifyFileHashes(
    bocfelRoot,
    lock.bocfel.verifiedFiles,
    "Bocfel source",
  );
  try {
    await access(resolve(bocfelRoot, "static-patches.h"));
    throw new HarnessError(
      "official Bocfel source unexpectedly contained static-patches.h",
    );
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }

  const remglkRoot = resolve(checkouts, "remglk");
  const emglkenRoot = resolve(checkouts, "emglken");
  await fetchGitCheckout(remglkRoot, "RemGlk", lock.remglk, gitEnvironment);
  await verifyFileHashes(
    remglkRoot,
    lock.remglk.verifiedFiles,
    "RemGlk source",
  );
  await fetchGitCheckout(
    emglkenRoot,
    "Emglken",
    lock.emglkenGlue,
    gitEnvironment,
  );
  await verifyFileHashes(
    emglkenRoot,
    lock.emglkenGlue.selectedFiles,
    "Emglken source",
  );
  await assertDirectoryIdentity(workDirectoryIdentity, "work directory");

  const glueRoot = resolve(sources, "emglken-glue");
  await mkdir(glueRoot);
  await stageEmglkenGlue(emglkenRoot, glueRoot, lock.emglkenGlue.selectedFiles);
  const cargoLock = await readRegularFileWithinRoot(
    glueRoot,
    "Cargo.lock",
    "staged Emglken Cargo.lock",
  );
  await writeFile(resolve(remglkRoot, "Cargo.lock"), cargoLock, { flag: "wx" });

  const transformedFiles = {
    "bocfel-autosave-v1": await applyPinnedFileTransformations(
      bocfelRoot,
      lock.transformations["bocfel-autosave-v1"].files,
      "Bocfel autosave transformation",
    ),
    "remglk-no-image-metadata-v1": await applyPinnedFileTransformations(
      remglkRoot,
      lock.transformations["remglk-no-image-metadata-v1"].files,
      "RemGlk no-image-metadata transformation",
    ),
  };

  const transformedCargoLock = (
    await readRegularFileWithinRoot(
      remglkRoot,
      "Cargo.lock",
      "transformed RemGlk Cargo.lock",
    )
  ).toString("utf8");
  assertForbiddenClosureAbsent(
    transformedCargoLock,
    lock.forbiddenClosureNames,
  );
  const remglkManifest = (
    await readRegularFileWithinRoot(
      remglkRoot,
      "remglk/Cargo.toml",
      "transformed RemGlk manifest",
    )
  ).toString("utf8");
  const blorbSource = (
    await readRegularFileWithinRoot(
      remglkRoot,
      "remglk/src/blorb/mod.rs",
      "transformed RemGlk Blorb source",
    )
  ).toString("utf8");
  if (
    /pb-imgsize|pb_imgsize|imgsize/iu.test(`${remglkManifest}\n${blorbSource}`)
  ) {
    throw new HarnessError(
      "pb-imgsize removal transformation did not close the source",
    );
  }

  await assertDirectoryIdentity(workDirectoryIdentity, "work directory");
  await buildCandidate(workDirectory, lock, dockerEnvironment);
  await assertDirectoryIdentity(workDirectoryIdentity, "work directory");

  const artifactPaths = ["build/bocfel-noz6.js", "build/bocfel-noz6.wasm"];
  const artifacts = {};
  for (const artifactPath of artifactPaths) {
    const contents = await readRegularFileWithinRoot(
      workDirectory,
      artifactPath,
      `built artifact ${artifactPath}`,
    );
    artifacts[artifactPath] = {
      bytes: contents.byteLength,
      sha256: sha256(contents),
    };
  }

  const result = {
    schemaVersion: 1,
    status: "experimental-non-release",
    candidate: lock.candidate,
    sources: {
      bocfelArchiveByteLength: archive.byteLength,
      bocfelArchiveSha256: lock.bocfel.archiveSha256,
      bocfelArchiveShapeSha256: archiveInspection.summary.shapeSha256,
      bocfelUncompressedByteLength:
        archiveInspection.summary.uncompressedByteLength,
      emglkenRevision: lock.emglkenGlue.revision,
      remglkRevision: lock.remglk.revision,
    },
    builder: {
      localImageId: lock.experimentalBuilder.localImageId,
      platform: lock.experimentalBuilder.platform,
      warning: lock.experimentalBuilder.acceptanceWarning,
    },
    transformations: transformedFiles,
    excluded: [
      "Garglk static-patches.h",
      "pb-imgsize",
      "Scare",
      "TADS",
      "aggregate emglken npm package",
    ],
    artifacts,
    limitations: [
      "This result is not an accepted interpreter or release artifact.",
      "The builder image was created with a mutable rustup installer.",
      "No generated SBOM or complete notice bundle is produced by this scaffold.",
      "Removing image metadata is valid only for this initial no-Z6/V3 spike scope and needs upstream or maintainer review before broader use.",
    ],
  };
  await writeFile(
    resolve(workDirectory, "build-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" },
  );

  console.log(
    `Built an experimental non-release Bocfel artifact in ${workDirectory}.`,
  );
  console.log(JSON.stringify(result.artifacts, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
