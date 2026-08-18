import { glob, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];

for await (const path of glob(
  ["package.json", "apps/*/package.json", "packages/*/package.json"],
  { cwd: root },
)) {
  const manifest = JSON.parse(await readFile(resolve(root, path), "utf8"));
  if (manifest.license !== "MIT") {
    failures.push(`${path} must declare the project MIT license`);
  }
}

for (const path of [
  "LICENSE",
  "LICENSES/THIRD-PARTY-NOTICES.md",
  "provenance/index.json",
]) {
  try {
    await readFile(resolve(root, path));
  } catch {
    failures.push(`missing required license/provenance file: ${path}`);
  }
}

const policy = JSON.parse(
  await readFile(
    resolve(root, "provenance/dependency-license-policy.json"),
    "utf8",
  ),
);
const allowedExpressions = new Set(policy.allowedExpressions ?? []);
const exceptions = policy.exceptions ?? {};
const dependencyManifests = new Set();

for await (const path of glob(
  [
    "node_modules/.pnpm/*/node_modules/*/package.json",
    "node_modules/.pnpm/*/node_modules/@*/*/package.json",
  ],
  { cwd: root },
)) {
  dependencyManifests.add(path);
}

if (dependencyManifests.size === 0) {
  failures.push("no installed dependency manifests found; run pnpm install");
}

for (const path of [...dependencyManifests].sort()) {
  const manifest = JSON.parse(await readFile(resolve(root, path), "utf8"));
  const expression =
    typeof manifest.license === "string"
      ? manifest.license
      : Array.isArray(manifest.licenses)
        ? manifest.licenses.map((entry) => entry.type).join(" OR ")
        : undefined;
  const identity = `${manifest.name}@${manifest.version}`;

  if (typeof expression !== "string" || expression.length === 0) {
    failures.push(`${identity} has no machine-readable license expression`);
    continue;
  }
  if (
    !allowedExpressions.has(expression) &&
    exceptions[identity]?.license !== expression
  ) {
    failures.push(
      `${identity} uses unreviewed dependency license expression: ${expression}`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Validated project licensing and ${dependencyManifests.size} installed dependency manifests.`,
);
