import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(repositoryRoot, ".ci/openai-live-shell");
if (
  relative(repositoryRoot, outputDirectory) !== join(".ci", "openai-live-shell")
) {
  throw new Error("refusing to clean an unexpected live-shell build directory");
}
await rm(outputDirectory, { recursive: true, force: true });

function run(command, arguments_) {
  const environment = { ...process.env };
  delete environment.OPENAI_API_KEY;
  delete environment.OPENROUTER_API_KEY;
  delete environment.HF_TOKEN;
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const compiler = resolve(repositoryRoot, "node_modules/.bin/tsc");
run(compiler, ["-p", "tsconfig.build.json"]);
run(process.execPath, ["scripts/build-dork-worker-browser.mjs"]);
run(compiler, ["-p", "apps/web/tsconfig.openai-live-shell.json"]);
