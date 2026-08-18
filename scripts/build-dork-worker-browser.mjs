import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(repositoryRoot, ".ci/dork-worker");
if (relative(repositoryRoot, outputDirectory) !== join(".ci", "dork-worker")) {
  throw new Error("refusing to clean an unexpected browser build directory");
}

await rm(outputDirectory, { recursive: true, force: true });
const compiler = resolve(repositoryRoot, "node_modules/.bin/tsc");
const result = spawnSync(
  compiler,
  ["-p", "spikes/dork-worker/tsconfig.browser.json"],
  {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  },
);
if (result.error !== undefined) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
