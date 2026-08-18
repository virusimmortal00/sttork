import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(import.meta.dirname, "..");
const indexPath = resolve(root, "provenance/index.json");
const index = JSON.parse(await readFile(indexPath, "utf8"));
const recordSchema = JSON.parse(
  await readFile(resolve(root, "provenance/record.schema.json"), "utf8"),
);
const failures = [];
const coveredPaths = new Set();
const loadedRecords = [];
const recordsById = new Map();

const controlledArtifactRoots = ["."];
const ignoredArtifactDirectories = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const controlledArtifactExtensions = new Set([
  ".7z",
  ".a",
  ".aac",
  ".bfzs",
  ".bin",
  ".blorb",
  ".dll",
  ".dylib",
  ".exe",
  ".flac",
  ".gblorb",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".otf",
  ".pdf",
  ".png",
  ".quetzal",
  ".sav",
  ".so",
  ".svg",
  ".tar",
  ".tgz",
  ".ttf",
  ".ulx",
  ".wasm",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".z1",
  ".z2",
  ".z3",
  ".z4",
  ".z5",
  ".z6",
  ".z7",
  ".z8",
  ".zblorb",
  ".zip",
]);

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isUri(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol.length > 1;
  } catch {
    return false;
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  formats: {
    date: { type: "string", validate: isCalendarDate },
    uri: { type: "string", validate: isUri },
  },
  strict: true,
  strictRequired: false,
});
const validateRecord = ajv.compile(recordSchema);

if (index.schemaVersion !== 1 || !Array.isArray(index.records)) {
  failures.push("provenance/index.json must contain a v1 records array");
}

const recordPaths = Array.isArray(index.records) ? index.records : [];
if (new Set(recordPaths).size !== recordPaths.length) {
  failures.push("provenance/index.json contains duplicate records");
}

function repositoryFile(localPath, prefix) {
  if (typeof localPath !== "string" || localPath.length === 0) {
    failures.push(`${prefix} invalid local path`);
    return undefined;
  }

  const absolutePath = resolve(root, localPath);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    failures.push(`${prefix} local path escapes the repository: ${localPath}`);
    return undefined;
  }

  return absolutePath;
}

async function verifyLocalFile(prefix, localEntry, options = {}) {
  const localPath =
    typeof localEntry === "string" ? localEntry : localEntry?.path;
  const expectedSha256 =
    typeof localEntry === "object" ? localEntry?.sha256 : undefined;
  const absolutePath = repositoryFile(localPath, prefix);
  if (!absolutePath) return;

  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    failures.push(`${prefix} invalid SHA-256 for ${localPath}`);
    return;
  }

  try {
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      failures.push(
        `${prefix} local path must be a regular file: ${localPath}`,
      );
      return;
    }
    const contents = await readFile(absolutePath);
    if (options.cover) coveredPaths.add(relative(root, absolutePath));
    if (expectedSha256) {
      const actual = createHash("sha256").update(contents).digest("hex");
      if (actual !== expectedSha256) {
        failures.push(`${prefix} SHA-256 mismatch for ${localPath}`);
      }
    }
  } catch {
    failures.push(`${prefix} missing local path ${localPath}`);
  }
}

for (const recordPath of recordPaths) {
  const absoluteRecordPath = resolve(root, "provenance", recordPath);
  const record = JSON.parse(await readFile(absoluteRecordPath, "utf8"));
  const prefix = `${recordPath}:`;
  loadedRecords.push({ prefix, record });

  if (!validateRecord(record)) {
    for (const error of validateRecord.errors ?? []) {
      failures.push(
        `${prefix} schema ${error.instancePath || "/"} ${error.message ?? "validation failed"}`,
      );
    }
  }

  for (const field of [
    "schemaVersion",
    "id",
    "name",
    "origin",
    "kind",
    "importStatus",
    "license",
    "redistribution",
    "localPaths",
    "verifiedAt",
    "notes",
  ]) {
    if (!Object.hasOwn(record, field)) {
      failures.push(`${prefix} missing ${field}`);
    }
  }

  if (record.schemaVersion !== 1) failures.push(`${prefix} unsupported schema`);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(record.id ?? "")) {
    failures.push(`${prefix} invalid id`);
  } else if (recordsById.has(record.id)) {
    failures.push(`${prefix} duplicate id ${record.id}`);
  } else {
    recordsById.set(record.id, record);
  }
  if (!["third-party", "project-owned"].includes(record.origin)) {
    failures.push(`${prefix} invalid origin`);
  }
  if (record.origin === "third-party" && !record.upstream) {
    failures.push(`${prefix} third-party work requires upstream provenance`);
  }
  if (
    record.origin === "project-owned" &&
    record.kind === "story-artifact" &&
    !record.generation
  ) {
    failures.push(
      `${prefix} project-owned story artifacts require generation metadata`,
    );
  }
  if (
    record.upstream?.url?.startsWith("https://github.com/") &&
    !/^[a-f0-9]{40}$/u.test(record.upstream?.revision ?? "")
  ) {
    failures.push(`${prefix} GitHub revision must be a full commit SHA`);
  }
  if (!record.license?.sourceUrl && !record.license?.sourcePath) {
    failures.push(`${prefix} license requires sourceUrl or sourcePath`);
  }
  if (record.license?.sourcePath) {
    await verifyLocalFile(prefix, record.license.sourcePath, { cover: true });
  }
  for (const noticePath of record.license?.localNoticePaths ?? []) {
    await verifyLocalFile(prefix, noticePath, { cover: true });
  }

  if (!Array.isArray(record.localPaths)) {
    failures.push(`${prefix} localPaths must be an array`);
    continue;
  }
  if (record.importStatus !== "imported" && record.localPaths.length !== 0) {
    failures.push(`${prefix} only imported records may claim local paths`);
  }
  if (
    record.localPaths.length > 0 &&
    (record.importStatus !== "imported" ||
      record.redistribution?.decision !== "approved" ||
      !Array.isArray(record.license?.localNoticePaths) ||
      record.license.localNoticePaths.length === 0)
  ) {
    failures.push(
      `${prefix} claimed local files require imported status, redistribution approval, and local notices`,
    );
  }

  for (const localEntry of record.localPaths) {
    if (
      typeof localEntry !== "object" ||
      localEntry === null ||
      !localEntry.sha256
    ) {
      failures.push(`${prefix} claimed local files require SHA-256 metadata`);
      continue;
    }
    await verifyLocalFile(prefix, localEntry, { cover: true });
  }
}

for (const { prefix, record } of loadedRecords) {
  if (!record.generation) continue;

  if (
    !Array.isArray(record.generation.sourcePaths) ||
    record.generation.sourcePaths.length === 0
  ) {
    failures.push(`${prefix} generation requires hashed sourcePaths`);
  } else {
    for (const sourceEntry of record.generation.sourcePaths) {
      if (typeof sourceEntry !== "object" || !sourceEntry?.sha256) {
        failures.push(`${prefix} generated source paths require SHA-256`);
        continue;
      }
      await verifyLocalFile(prefix, sourceEntry, { cover: true });
    }
  }

  if (
    !Array.isArray(record.generation.toolRecordIds) ||
    record.generation.toolRecordIds.length === 0
  ) {
    failures.push(`${prefix} generation requires toolRecordIds`);
  } else {
    for (const toolRecordId of record.generation.toolRecordIds) {
      const toolRecord = recordsById.get(toolRecordId);
      if (!toolRecord) {
        failures.push(`${prefix} unknown tool record ${toolRecordId}`);
      } else if (toolRecord.kind !== "build-tool") {
        failures.push(`${prefix} ${toolRecordId} is not a build-tool record`);
      }
    }
  }

  const localPaths = new Set(
    (record.localPaths ?? []).map((entry) => {
      const localPath = typeof entry === "string" ? entry : entry?.path;
      return typeof localPath === "string"
        ? relative(root, resolve(root, localPath))
        : localPath;
    }),
  );
  const manifestPath =
    typeof record.generation.manifestPath === "string"
      ? relative(root, resolve(root, record.generation.manifestPath))
      : record.generation.manifestPath;
  if (!localPaths.has(manifestPath)) {
    failures.push(`${prefix} generation manifest must be a claimed local path`);
  }
}

async function filesBelow(directory) {
  const absoluteDirectory = resolve(root, directory);
  const results = [];
  try {
    for (const entry of await readdir(absoluteDirectory)) {
      const absolute = resolve(absoluteDirectory, entry);
      const info = await lstat(absolute);
      const path = relative(root, absolute);
      if (info.isDirectory()) {
        if (!ignoredArtifactDirectories.has(entry)) {
          results.push(...(await filesBelow(path)));
        }
      } else results.push(path);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return results;
}

for (const path of await filesBelow("vendor")) {
  if (path !== "vendor/README.md" && !coveredPaths.has(path)) {
    failures.push(`unrecorded vendored file: ${path}`);
  }
}

for (const path of await filesBelow("fixtures")) {
  if (path.endsWith("/README.md") || coveredPaths.has(path)) {
    continue;
  }
  failures.push(`unrecorded fixture file: ${path}`);
}

const controlledArtifactPaths = new Set();
for (const directory of controlledArtifactRoots) {
  for (const path of await filesBelow(directory)) {
    if (controlledArtifactExtensions.has(extname(path).toLowerCase())) {
      controlledArtifactPaths.add(path);
    }
  }
}

for (const path of controlledArtifactPaths) {
  if (!coveredPaths.has(path)) {
    failures.push(`unrecorded controlled artifact: ${path}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Validated ${recordPaths.length} provenance records.`);
