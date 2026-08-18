import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(repositoryRoot, ".ci/voice-shell");
if (relative(repositoryRoot, outputDirectory) !== join(".ci", "voice-shell")) {
  throw new Error(
    "refusing to clean an unexpected voice-shell build directory",
  );
}
await rm(outputDirectory, { recursive: true, force: true });

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/build-dork-worker-browser.mjs"]);
run(resolve(repositoryRoot, "node_modules/.bin/tsc"), [
  "-p",
  "apps/web/tsconfig.voice-shell.json",
]);
