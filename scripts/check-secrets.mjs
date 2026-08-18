import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([
  ".git",
  ".pnpm-store",
  "coverage",
  "dist",
  "node_modules",
]);
const ignoredFiles = new Set(["pnpm-lock.yaml"]);
const patterns = [
  ["private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/u],
  ["OpenAI/OpenRouter key", /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{32,}\b/u],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{32,}\b/u],
  ["GitHub token", /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/u],
  ["AWS access key", /\bAKIA[A-Z0-9]{16}\b/u],
];
const failures = [];

async function walk(directory) {
  for (const entry of await readdir(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const absolute = resolve(directory, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      await walk(absolute);
      continue;
    }
    const path = relative(root, absolute);
    if (ignoredFiles.has(path) || info.size > 2_000_000) continue;
    if (/^\.env(?:\.|$)/u.test(entry) && entry !== ".env.example") {
      failures.push(`credential file must not be committed: ${path}`);
      continue;
    }
    let contents;
    try {
      contents = await readFile(absolute, "utf8");
    } catch {
      continue;
    }
    for (const [name, pattern] of patterns) {
      if (pattern.test(contents))
        failures.push(`${name} pattern found in ${path}`);
    }
  }
}

await walk(root);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("No high-confidence credential patterns found.");
