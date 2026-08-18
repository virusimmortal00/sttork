import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const gitObjectPattern = /^[a-f0-9]{40}$/u;
const tarBlockBytes = 512;
const tarEndBlockCount = 2;

export class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessError";
  }
}

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function assertSha256(label, contents, expected) {
  if (!sha256Pattern.test(expected)) {
    throw new HarnessError(`${label} has an invalid pinned SHA-256`);
  }

  const actual = sha256(contents);
  if (actual !== expected) {
    throw new HarnessError(
      `${label} SHA-256 mismatch: expected ${expected}, received ${actual}`,
    );
  }

  return actual;
}

function requireHttps(label, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HarnessError(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new HarnessError(`${label} must use HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new HarnessError(`${label} must not contain URL credentials`);
  }
  return parsed;
}

const minimalEnvironmentKeys = Object.freeze([
  "PATH",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
]);

function copyAllowedEnvironment(source, keys) {
  const environment = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }
  if (!environment.PATH) {
    throw new HarnessError(
      "a nonempty PATH is required to resolve build tools",
    );
  }
  environment.LANG = "C";
  environment.LC_ALL = "C";
  return environment;
}

export function createMinimalToolEnvironment(source = process.env) {
  return copyAllowedEnvironment(source, minimalEnvironmentKeys);
}

export function createGitEnvironment(source = process.env) {
  const environment = createMinimalToolEnvironment(source);
  for (const key of ["GIT_SSL_CAINFO", "GIT_SSL_CAPATH"]) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_SYSTEM = "/dev/null";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

export function createDockerEnvironment(source = process.env, options = {}) {
  const environment = createMinimalToolEnvironment(source);
  const dockerHost = source.DOCKER_HOST;
  if (typeof dockerHost === "string" && dockerHost.length > 0) {
    let parsed;
    try {
      parsed = new URL(dockerHost);
    } catch {
      throw new HarnessError("DOCKER_HOST must be a valid local Unix URL");
    }
    if (
      parsed.protocol !== "unix:" ||
      parsed.hostname !== "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !parsed.pathname.startsWith("/") ||
      parsed.href !== dockerHost
    ) {
      throw new HarnessError(
        "DOCKER_HOST must be a canonical local Unix socket URL",
      );
    }
    environment.DOCKER_HOST = dockerHost;
  }
  if (options.configDirectory !== undefined) {
    if (!isAbsolute(options.configDirectory)) {
      throw new HarnessError("Docker config directory must be absolute");
    }
    environment.DOCKER_CONFIG = resolve(options.configDirectory);
  }
  return environment;
}

function validateAllowedOrigins(allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new HarnessError("redirect origin allowlist must not be empty");
  }
  for (const origin of allowedOrigins) {
    const parsedOrigin = requireHttps("redirect allowlist origin", origin);
    if (origin !== parsedOrigin.origin) {
      throw new HarnessError(
        "redirect allowlist entries must be canonical HTTPS origins without paths",
      );
    }
  }
  if (new Set(allowedOrigins).size !== allowedOrigins.length) {
    throw new HarnessError(
      "redirect origin allowlist must not contain duplicates",
    );
  }
  return allowedOrigins;
}

function validateAllowedHttpsUrl(label, value, allowedOrigins) {
  const parsed = requireHttps(label, value);
  validateAllowedOrigins(allowedOrigins);
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new HarnessError(`${label} origin is not allowed: ${parsed.origin}`);
  }
  return parsed;
}

export function validateRedirectTarget(currentUrl, location, allowedOrigins) {
  const current = requireHttps("redirect source", currentUrl);
  validateAllowedOrigins(allowedOrigins);
  let target;
  try {
    target = new URL(location, current);
  } catch {
    throw new HarnessError("redirect location must be a valid URL");
  }
  requireHttps("redirect target", target.href);
  if (!allowedOrigins.includes(target.origin)) {
    throw new HarnessError(
      `redirect target origin is not allowed: ${target.origin}`,
    );
  }
  return target;
}

export async function readExactResponseBody(body, expectedByteLength, label) {
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength <= 0) {
    throw new HarnessError(`${label} expected byte length must be positive`);
  }
  if (!body || typeof body.getReader !== "function") {
    throw new HarnessError(`${label} response did not contain a readable body`);
  }

  const reader = body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new HarnessError(`${label} response yielded a non-byte chunk`);
      }
      received += value.byteLength;
      if (received > expectedByteLength) {
        try {
          await reader.cancel("response exceeded its pinned byte length");
        } catch {
          // Preserve the fail-closed size error if stream cancellation fails.
        }
        throw new HarnessError(
          `${label} response exceeded ${expectedByteLength} bytes`,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  if (received !== expectedByteLength) {
    throw new HarnessError(
      `${label} byte length mismatch: expected ${expectedByteLength}, received ${received}`,
    );
  }
  return Buffer.concat(chunks, received);
}

export async function fetchPinnedBytes(
  initialUrl,
  {
    allowedOrigins,
    expectedByteLength,
    fetchImplementation = fetch,
    label,
    maxRedirects = 3,
  },
) {
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new HarnessError(`${label} maximum redirects must be nonnegative`);
  }
  let requestUrl = validateAllowedHttpsUrl(
    `${label} URL`,
    initialUrl,
    allowedOrigins,
  );

  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImplementation(requestUrl.href, {
      headers: {
        accept: "application/gzip, application/octet-stream",
        "accept-encoding": "identity",
      },
      redirect: "manual",
    });
    if (response.redirected) {
      throw new HarnessError(`${label} fetch followed a redirect unexpectedly`);
    }
    if (response.url) {
      validateAllowedHttpsUrl(
        `${label} response URL`,
        response.url,
        allowedOrigins,
      );
    }
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (isRedirect) {
      if (redirects >= maxRedirects) {
        throw new HarnessError(`${label} exceeded ${maxRedirects} redirects`);
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new HarnessError(`${label} redirect omitted its location`);
      }
      try {
        await response.body?.cancel();
      } catch {
        // The response is discarded; redirect validation remains authoritative.
      }
      requestUrl = validateRedirectTarget(
        requestUrl.href,
        location,
        allowedOrigins,
      );
      continue;
    }
    if (!response.ok) {
      throw new HarnessError(
        `${label} download failed with HTTP ${response.status}`,
      );
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
        throw new HarnessError(`${label} Content-Length was not canonical`);
      }
      const declaredLength = Number.parseInt(contentLength, 10);
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength !== expectedByteLength
      ) {
        throw new HarnessError(
          `${label} Content-Length mismatch: expected ${expectedByteLength}, received ${contentLength}`,
        );
      }
    }
    return readExactResponseBody(response.body, expectedByteLength, label);
  }
}

function validateHashMap(label, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be a nonempty path-to-hash object`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new HarnessError(`${label} must not be empty`);
  }
  for (const [path, hash] of entries) {
    assertSafeRelativePath(`${label}.${path}`, path);
    if (typeof hash !== "string" || !sha256Pattern.test(hash)) {
      throw new HarnessError(`${label}.${path} must be a SHA-256`);
    }
  }
}

function validateTransformationFiles(label, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must contain transformed files`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new HarnessError(`${label} must not be empty`);
  }

  for (const [path, transformation] of entries) {
    assertSafeRelativePath(`${label}.${path}`, path);
    if (!sha256Pattern.test(transformation?.inputSha256 ?? "")) {
      throw new HarnessError(`${label}.${path}.inputSha256 must be a SHA-256`);
    }
    if (!sha256Pattern.test(transformation?.outputSha256 ?? "")) {
      throw new HarnessError(`${label}.${path}.outputSha256 must be a SHA-256`);
    }
    if (
      !Array.isArray(transformation?.operations) ||
      transformation.operations.length === 0
    ) {
      throw new HarnessError(`${label}.${path}.operations must not be empty`);
    }

    const ranges = [];
    const operationIds = new Set();
    for (const operation of transformation.operations) {
      if (
        typeof operation?.id !== "string" ||
        !/^[a-z0-9][a-z0-9-]*$/u.test(operation.id) ||
        operationIds.has(operation.id)
      ) {
        throw new HarnessError(
          `${label}.${path} transformation operation IDs must be unique slugs`,
        );
      }
      operationIds.add(operation.id);
      if (!Number.isSafeInteger(operation.offset) || operation.offset < 0) {
        throw new HarnessError(
          `${label}.${path}.${operation.id}.offset must be a nonnegative safe integer`,
        );
      }
      if (!Number.isSafeInteger(operation.length) || operation.length <= 0) {
        throw new HarnessError(
          `${label}.${path}.${operation.id}.length must be a positive safe integer`,
        );
      }
      if (!sha256Pattern.test(operation.segmentSha256 ?? "")) {
        throw new HarnessError(
          `${label}.${path}.${operation.id}.segmentSha256 must be a SHA-256`,
        );
      }
      if (typeof operation.replacementUtf8 !== "string") {
        throw new HarnessError(
          `${label}.${path}.${operation.id}.replacementUtf8 must be a string`,
        );
      }
      const end = operation.offset + operation.length;
      if (!Number.isSafeInteger(end)) {
        throw new HarnessError(
          `${label}.${path}.${operation.id} byte range is not a safe integer`,
        );
      }
      ranges.push([operation.offset, end]);
    }

    ranges.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index][0] < ranges[index - 1][1]) {
        throw new HarnessError(
          `${label}.${path} transformation operations must not overlap`,
        );
      }
    }
  }
}

export function validateSourceLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    throw new HarnessError("source lock must be an object");
  }
  if (lock.schemaVersion !== 1) {
    throw new HarnessError("source lock schemaVersion must be 1");
  }
  if (lock.candidate !== "bocfel-noz6-2.5.1-m0-spike") {
    throw new HarnessError("source lock candidate is not the reviewed spike");
  }

  const archiveUrl = requireHttps("bocfel.archiveUrl", lock.bocfel?.archiveUrl);
  if (!sha256Pattern.test(lock.bocfel?.archiveSha256 ?? "")) {
    throw new HarnessError("bocfel.archiveSha256 must be a SHA-256");
  }
  if (lock.bocfel?.archiveRoot !== "bocfel-2.5.1") {
    throw new HarnessError("bocfel.archiveRoot must be bocfel-2.5.1");
  }
  validateAllowedOrigins(lock.bocfel?.allowedOrigins);
  if (!lock.bocfel.allowedOrigins.includes(archiveUrl.origin)) {
    throw new HarnessError(
      "bocfel.allowedOrigins must contain the archive URL origin",
    );
  }
  for (const field of [
    "archiveByteLength",
    "directoryCount",
    "materialMemberCount",
    "metadataMemberCount",
    "regularFileCount",
    "uncompressedByteLength",
  ]) {
    if (
      !Number.isSafeInteger(lock.bocfel?.[field]) ||
      lock.bocfel[field] <= 0
    ) {
      throw new HarnessError(`bocfel.${field} must be a positive safe integer`);
    }
  }
  if (!sha256Pattern.test(lock.bocfel?.shapeSha256 ?? "")) {
    throw new HarnessError("bocfel.shapeSha256 must be a SHA-256");
  }
  if (
    lock.bocfel.directoryCount + lock.bocfel.regularFileCount !==
    lock.bocfel.materialMemberCount
  ) {
    throw new HarnessError(
      "bocfel material member counts must describe only directories and regular files",
    );
  }
  validateHashMap("bocfel.verifiedFiles", lock.bocfel?.verifiedFiles);

  for (const [label, source] of [
    ["remglk", lock.remglk],
    ["emglkenGlue", lock.emglkenGlue],
  ]) {
    requireHttps(`${label}.repositoryUrl`, source?.repositoryUrl);
    if (!gitObjectPattern.test(source?.revision ?? "")) {
      throw new HarnessError(`${label}.revision must be a full Git object ID`);
    }
    if (!gitObjectPattern.test(source?.tree ?? "")) {
      throw new HarnessError(`${label}.tree must be a full Git tree ID`);
    }
  }
  validateHashMap("remglk.verifiedFiles", lock.remglk?.verifiedFiles);
  validateHashMap("emglkenGlue.selectedFiles", lock.emglkenGlue?.selectedFiles);

  const transformations = lock.transformations;
  const requiredTransformationFiles = {
    "bocfel-autosave-v1": ["options.h", "osdep.cpp"],
    "remglk-no-image-metadata-v1": [
      "Cargo.lock",
      "remglk/Cargo.toml",
      "remglk/src/blorb/mod.rs",
    ],
  };
  const requiredTransformationIds = Object.keys(requiredTransformationFiles);
  if (
    !transformations ||
    typeof transformations !== "object" ||
    Array.isArray(transformations) ||
    JSON.stringify(Object.keys(transformations).sort()) !==
      JSON.stringify([...requiredTransformationIds].sort())
  ) {
    throw new HarnessError(
      "source lock must contain exactly the reviewed transformation IDs",
    );
  }
  for (const requiredId of requiredTransformationIds) {
    validateTransformationFiles(
      `transformations.${requiredId}.files`,
      transformations?.[requiredId]?.files,
    );
    if (
      JSON.stringify(Object.keys(transformations[requiredId].files).sort()) !==
      JSON.stringify([...requiredTransformationFiles[requiredId]].sort())
    ) {
      throw new HarnessError(
        `transformations.${requiredId}.files must contain exactly the reviewed paths`,
      );
    }
  }

  if (
    !/^sha256:[a-f0-9]{64}$/u.test(lock.experimentalBuilder?.localImageId ?? "")
  ) {
    throw new HarnessError(
      "experimentalBuilder.localImageId must be an immutable local image ID",
    );
  }
  if (lock.experimentalBuilder?.platform !== "linux/arm64") {
    throw new HarnessError("experimentalBuilder.platform must be linux/arm64");
  }
  const requiredForbiddenNames = ["pb-imgsize", "scare", "tads"];
  if (
    !Array.isArray(lock.forbiddenClosureNames) ||
    JSON.stringify([...lock.forbiddenClosureNames].sort()) !==
      JSON.stringify(requiredForbiddenNames.sort())
  ) {
    throw new HarnessError(
      "forbiddenClosureNames must explicitly block pb-imgsize, Scare, and TADS",
    );
  }

  return lock;
}

export async function loadSourceLock(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new HarnessError(
      `could not read source lock: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateSourceLock(parsed);
}

export function parseArguments(arguments_) {
  const result = {
    allowBuild: false,
    allowNetwork: false,
    workDirectory: undefined,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--allow-build") {
      if (result.allowBuild) {
        throw new HarnessError("--allow-build may be provided only once");
      }
      result.allowBuild = true;
      continue;
    }
    if (argument === "--allow-network") {
      if (result.allowNetwork) {
        throw new HarnessError("--allow-network may be provided only once");
      }
      result.allowNetwork = true;
      continue;
    }
    if (argument === "--work-dir") {
      if (result.workDirectory !== undefined) {
        throw new HarnessError("--work-dir may be provided only once");
      }
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        throw new HarnessError("--work-dir requires an absolute path");
      }
      result.workDirectory = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--work-dir=")) {
      if (result.workDirectory !== undefined) {
        throw new HarnessError("--work-dir may be provided only once");
      }
      result.workDirectory = argument.slice("--work-dir=".length);
      continue;
    }
    throw new HarnessError(`unknown argument: ${argument}`);
  }

  if (!result.workDirectory) {
    throw new HarnessError("--work-dir is required");
  }
  if (!result.allowNetwork || !result.allowBuild) {
    throw new HarnessError(
      "this opt-in spike requires both --allow-network and --allow-build",
    );
  }

  return result;
}

function sameOrBelow(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function canRenameChildrenThrough(mode, writeBit, executeBit) {
  return (mode & writeBit) !== 0 && (mode & executeBit) !== 0;
}

async function validateRenameSafeAncestry(path, currentUserId) {
  let childPath = path;
  let ancestorPath = dirname(childPath);

  while (true) {
    const [childInfo, ancestorInfo] = await Promise.all([
      lstat(childPath),
      lstat(ancestorPath),
    ]);
    if (
      childInfo.isSymbolicLink() ||
      !childInfo.isDirectory() ||
      ancestorInfo.isSymbolicLink() ||
      !ancestorInfo.isDirectory()
    ) {
      throw new HarnessError(
        "--work-dir resolved ancestry must contain only real directories",
      );
    }

    if (ancestorInfo.uid !== 0 && ancestorInfo.uid !== currentUserId) {
      throw new HarnessError(
        `--work-dir ancestor is replaceable by another owner: ${ancestorPath}`,
      );
    }

    const sharedUserCanRename =
      canRenameChildrenThrough(ancestorInfo.mode, 0o020, 0o010) ||
      canRenameChildrenThrough(ancestorInfo.mode, 0o002, 0o001);
    if (sharedUserCanRename) {
      const sticky = (ancestorInfo.mode & 0o1000) !== 0;
      if (!sticky || childInfo.uid !== currentUserId) {
        throw new HarnessError(
          `--work-dir ancestor permits another user to replace its child: ${ancestorPath}`,
        );
      }
    }

    if (ancestorPath === resolve("/")) break;
    childPath = ancestorPath;
    ancestorPath = dirname(ancestorPath);
  }
}

export async function validateWorkDirectory(
  candidate,
  { homeDirectory = homedir(), repositoryRoot },
) {
  if (!isAbsolute(candidate)) {
    throw new HarnessError("--work-dir must be absolute");
  }

  const requested = resolve(candidate);
  if (requested === resolve("/")) {
    throw new HarnessError("--work-dir must not be the filesystem root");
  }
  if (requested === resolve(homeDirectory)) {
    throw new HarnessError("--work-dir must not be the home directory");
  }

  let info;
  try {
    info = await lstat(requested);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HarnessError(
        "--work-dir must already exist; create an empty temporary directory first",
      );
    }
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new HarnessError("--work-dir must not be a symbolic link");
  }
  if (!info.isDirectory()) {
    throw new HarnessError("--work-dir must be a directory");
  }
  if ((info.mode & 0o022) !== 0) {
    throw new HarnessError(
      "--work-dir must not be writable by the group or other users",
    );
  }

  const [actual, actualRepositoryRoot] = await Promise.all([
    realpath(requested),
    realpath(repositoryRoot),
  ]);
  if (typeof process.getuid !== "function") {
    throw new HarnessError(
      "--work-dir ownership validation requires a POSIX host",
    );
  }
  const currentUserId = process.getuid();
  const actualInfo = await lstat(actual);
  if (
    actualInfo.isSymbolicLink() ||
    !actualInfo.isDirectory() ||
    actualInfo.uid !== currentUserId
  ) {
    throw new HarnessError(
      "--work-dir must resolve to a real directory owned by the current user",
    );
  }
  if ((actualInfo.mode & 0o022) !== 0) {
    throw new HarnessError(
      "--work-dir must not be writable by the group or other users",
    );
  }
  if (
    sameOrBelow(actualRepositoryRoot, actual) ||
    sameOrBelow(actual, actualRepositoryRoot)
  ) {
    throw new HarnessError(
      "--work-dir must be outside and must not contain the repository",
    );
  }
  await validateRenameSafeAncestry(actual, currentUserId);

  const entries = await readdir(actual);
  if (entries.length !== 0) {
    throw new HarnessError("--work-dir must be empty");
  }

  return actual;
}

export async function captureDirectoryIdentity(path, label) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new HarnessError(`${label} must be a real directory`);
  }
  const actual = await realpath(path);
  const actualInfo = await lstat(actual);
  return Object.freeze({
    device: actualInfo.dev,
    inode: actualInfo.ino,
    path: actual,
  });
}

export async function assertDirectoryIdentity(identity, label) {
  const info = await lstat(identity.path);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    info.dev !== identity.device ||
    info.ino !== identity.inode ||
    (await realpath(identity.path)) !== identity.path
  ) {
    throw new HarnessError(`${label} changed during the build`);
  }
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function assertSafeRelativePath(label, value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    containsControlCharacter(value) ||
    value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new HarnessError(`${label} must be a safe relative path`);
  }
  return value;
}

function tarText(header, offset, length, label) {
  const field = header.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  const end = nul === -1 ? field.length : nul;
  if (nul !== -1 && !field.subarray(nul).every((byte) => byte === 0)) {
    throw new HarnessError(`${label} has non-NUL bytes after its terminator`);
  }
  const valueBytes = field.subarray(0, end);
  if (
    !valueBytes.every((byte) => byte >= 0x20 && byte <= 0x7e) ||
    !Buffer.from(valueBytes.toString("utf8"), "utf8").equals(valueBytes)
  ) {
    throw new HarnessError(`${label} must contain printable ASCII`);
  }
  return valueBytes.toString("utf8");
}

function tarOctal(header, offset, length, label) {
  const field = header.subarray(offset, offset + length);
  if ((field[0] ?? 0) >= 0x80) {
    throw new HarnessError(`${label} must not use base-256 encoding`);
  }
  const value = field.toString("ascii").replaceAll("\0", "").trim();
  if (value === "") return 0;
  if (!/^[0-7]+$/u.test(value)) {
    throw new HarnessError(`${label} must be an octal integer`);
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HarnessError(`${label} is outside the safe integer range`);
  }
  return parsed;
}

function tarChecksum(header) {
  let checksum = 0;
  for (let index = 0; index < header.length; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  return checksum;
}

function archiveMemberPath(rawPath, archiveRoot, type) {
  if (
    rawPath.length === 0 ||
    rawPath.includes("\\") ||
    containsControlCharacter(rawPath) ||
    rawPath.startsWith("/")
  ) {
    throw new HarnessError(`unsafe archive member path: ${rawPath}`);
  }
  const path =
    type === "directory" && rawPath.endsWith("/")
      ? rawPath.slice(0, -1)
      : rawPath;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new HarnessError(`unsafe archive member path: ${rawPath}`);
  }
  if (path !== archiveRoot && !path.startsWith(`${archiveRoot}/`)) {
    throw new HarnessError(`archive member escaped ${archiveRoot}: ${rawPath}`);
  }
  if (type === "directory" && !rawPath.endsWith("/")) {
    throw new HarnessError(`archive directory must end with /: ${rawPath}`);
  }
  if (type === "file" && rawPath.endsWith("/")) {
    throw new HarnessError(`archive file must not end with /: ${rawPath}`);
  }
  return path;
}

function parsePaxComment(contents) {
  let offset = 0;
  let count = 0;
  while (offset < contents.length) {
    const space = contents.indexOf(0x20, offset);
    if (space === -1) {
      throw new HarnessError("PAX record is missing its length separator");
    }
    const lengthText = contents.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(lengthText)) {
      throw new HarnessError("PAX record length must be canonical decimal");
    }
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > contents.length) {
      throw new HarnessError("PAX record length exceeds its metadata member");
    }
    const record = contents.subarray(space + 1, end);
    if (record.at(-1) !== 0x0a) {
      throw new HarnessError("PAX record must end with a newline");
    }
    const assignment = record.subarray(0, -1).toString("utf8");
    if (!Buffer.from(assignment, "utf8").equals(record.subarray(0, -1))) {
      throw new HarnessError("PAX record must contain valid UTF-8");
    }
    const equals = assignment.indexOf("=");
    if (equals <= 0 || assignment.slice(0, equals) !== "comment") {
      throw new HarnessError(
        "PAX metadata may contain only a non-path-shaping comment",
      );
    }
    count += 1;
    offset = end;
  }
  if (count !== 1) {
    throw new HarnessError("PAX metadata must contain exactly one comment");
  }
}

function zeroTarBlock(block) {
  return block.every((byte) => byte === 0);
}

export function inspectTarGzipArchive(
  archive,
  { archiveRoot, compressedByteLimit, uncompressedByteLimit },
) {
  if (!Buffer.isBuffer(archive)) {
    throw new HarnessError("archive must be a Buffer");
  }
  if (
    !Number.isSafeInteger(compressedByteLimit) ||
    compressedByteLimit <= 0 ||
    archive.byteLength > compressedByteLimit
  ) {
    throw new HarnessError("compressed archive exceeds its byte limit");
  }
  if (
    !Number.isSafeInteger(uncompressedByteLimit) ||
    uncompressedByteLimit <= tarBlockBytes * tarEndBlockCount
  ) {
    throw new HarnessError("uncompressed archive byte limit is invalid");
  }
  assertSafeRelativePath("archive root", archiveRoot);
  if (archiveRoot.includes("/") || archiveRoot.includes("\\")) {
    throw new HarnessError("archive root must be one path segment");
  }

  let uncompressed;
  try {
    uncompressed = gunzipSync(archive, {
      maxOutputLength: uncompressedByteLimit,
    });
  } catch (error) {
    throw new HarnessError(
      `could not decompress archive within its byte limit: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (uncompressed.byteLength % tarBlockBytes !== 0) {
    throw new HarnessError(
      "tar payload length must be a multiple of 512 bytes",
    );
  }

  const members = [];
  const shapeRecords = [];
  const materialPaths = new Map();
  const caseFoldedPaths = new Set();
  let metadataMemberCount = 0;
  let offset = 0;
  let foundEnd = false;

  while (offset < uncompressed.byteLength) {
    const header = uncompressed.subarray(offset, offset + tarBlockBytes);
    if (zeroTarBlock(header)) {
      const remaining = uncompressed.subarray(offset);
      if (
        remaining.byteLength < tarBlockBytes * tarEndBlockCount ||
        !zeroTarBlock(remaining)
      ) {
        throw new HarnessError(
          "tar must end with at least two zero blocks and no trailing data",
        );
      }
      foundEnd = true;
      break;
    }

    const expectedChecksum = tarOctal(header, 148, 8, "tar checksum");
    const actualChecksum = tarChecksum(header);
    if (actualChecksum !== expectedChecksum) {
      throw new HarnessError(`tar header checksum mismatch at byte ${offset}`);
    }
    if (
      tarText(header, 257, 6, "tar magic") !== "ustar" ||
      tarText(header, 263, 2, "tar version") !== "00"
    ) {
      throw new HarnessError("archive members must use POSIX ustar headers");
    }

    const name = tarText(header, 0, 100, "tar member name");
    const prefix = tarText(header, 345, 155, "tar member prefix");
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const mode = tarOctal(header, 100, 8, "tar member mode");
    const size = tarOctal(header, 124, 12, "tar member size");
    const typeFlag = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const linkName = tarText(header, 157, 100, "tar link target");
    const deviceMajor = tarOctal(header, 329, 8, "tar device major");
    const deviceMinor = tarOctal(header, 337, 8, "tar device minor");
    if ((mode & ~0o777) !== 0 || deviceMajor !== 0 || deviceMinor !== 0) {
      throw new HarnessError(
        `archive member has special mode or device fields: ${rawPath}`,
      );
    }
    if (linkName !== "") {
      throw new HarnessError(
        `archive member link targets are forbidden: ${rawPath}`,
      );
    }

    const dataOffset = offset + tarBlockBytes;
    const dataEnd = dataOffset + size;
    const paddedEnd =
      dataOffset + Math.ceil(size / tarBlockBytes) * tarBlockBytes;
    if (
      dataEnd > uncompressed.byteLength ||
      paddedEnd > uncompressed.byteLength
    ) {
      throw new HarnessError(
        `archive member exceeds the tar payload: ${rawPath}`,
      );
    }
    if (!zeroTarBlock(uncompressed.subarray(dataEnd, paddedEnd))) {
      throw new HarnessError(`archive member padding is not zero: ${rawPath}`);
    }
    const data = uncompressed.subarray(dataOffset, dataEnd);

    if (typeFlag === "g") {
      if (
        offset !== 0 ||
        metadataMemberCount !== 0 ||
        rawPath !== "pax_global_header"
      ) {
        throw new HarnessError(
          "only one leading PAX global comment header is permitted",
        );
      }
      parsePaxComment(data);
      metadataMemberCount += 1;
      shapeRecords.push({
        dataSha256: sha256(data),
        linkName,
        mode,
        path: rawPath,
        size,
        type: "pax-global-comment",
      });
      offset = paddedEnd;
      continue;
    }

    const type =
      typeFlag === "0" ? "file" : typeFlag === "5" ? "directory" : undefined;
    if (!type) {
      throw new HarnessError(
        `unsupported non-regular archive member type ${JSON.stringify(typeFlag)}: ${rawPath}`,
      );
    }
    if (type === "directory" && size !== 0) {
      throw new HarnessError(`archive directory has data: ${rawPath}`);
    }
    const path = archiveMemberPath(rawPath, archiveRoot, type);
    const folded = path.toLocaleLowerCase("en-US");
    if (materialPaths.has(path) || caseFoldedPaths.has(folded)) {
      throw new HarnessError(`duplicate archive member path: ${path}`);
    }
    if (path === archiveRoot) {
      if (type !== "directory" || materialPaths.size !== 0) {
        throw new HarnessError(
          "archive root must be the first material directory",
        );
      }
    } else {
      const parent = dirname(path);
      if (materialPaths.get(parent) !== "directory") {
        throw new HarnessError(
          `archive member parent was not a prior directory: ${path}`,
        );
      }
    }
    materialPaths.set(path, type);
    caseFoldedPaths.add(folded);
    members.push({ dataOffset, mode, path, size, type });
    shapeRecords.push({
      dataSha256: type === "file" ? sha256(data) : null,
      linkName,
      mode,
      path,
      size,
      type,
    });
    offset = paddedEnd;
  }

  if (!foundEnd || members.length === 0) {
    throw new HarnessError("tar archive is missing members or its end marker");
  }
  const regularFileCount = members.filter(
    (member) => member.type === "file",
  ).length;
  const directoryCount = members.filter(
    (member) => member.type === "directory",
  ).length;
  const shapeSha256 = sha256(
    Buffer.from(
      `${shapeRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    ),
  );

  return {
    members,
    summary: {
      directoryCount,
      materialMemberCount: members.length,
      metadataMemberCount,
      regularFileCount,
      shapeSha256,
      uncompressedByteLength: uncompressed.byteLength,
    },
    uncompressed,
  };
}

export function inspectPinnedTarGzipArchive(archive, pin) {
  assertSha256("Bocfel archive", archive, pin.archiveSha256);
  const inspection = inspectTarGzipArchive(archive, {
    archiveRoot: pin.archiveRoot,
    compressedByteLimit: pin.archiveByteLength,
    uncompressedByteLimit: pin.uncompressedByteLength,
  });
  if (archive.byteLength !== pin.archiveByteLength) {
    throw new HarnessError(
      `archive byte length mismatch: expected ${pin.archiveByteLength}, received ${archive.byteLength}`,
    );
  }
  for (const field of [
    "directoryCount",
    "materialMemberCount",
    "metadataMemberCount",
    "regularFileCount",
    "shapeSha256",
    "uncompressedByteLength",
  ]) {
    if (inspection.summary[field] !== pin[field]) {
      throw new HarnessError(
        `archive ${field} mismatch: expected ${pin[field]}, received ${inspection.summary[field]}`,
      );
    }
  }
  return inspection;
}

export async function extractInspectedTarArchive(inspection, destination) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new HarnessError("archive extraction requires O_NOFOLLOW support");
  }
  const destinationInfo = await lstat(destination);
  if (destinationInfo.isSymbolicLink() || !destinationInfo.isDirectory()) {
    throw new HarnessError("archive destination must be a real directory");
  }
  if ((await readdir(destination)).length !== 0) {
    throw new HarnessError("archive destination must be empty");
  }
  const destinationRoot = await realpath(destination);

  for (const member of inspection.members) {
    const absolutePath = resolve(destinationRoot, member.path);
    if (!sameOrBelow(destinationRoot, absolutePath)) {
      throw new HarnessError(`archive extraction path escaped: ${member.path}`);
    }
    if (member.type === "directory") {
      await mkdir(absolutePath, { mode: member.mode });
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new HarnessError(
          `archive directory was not created safely: ${member.path}`,
        );
      }
      continue;
    }

    const parent = dirname(absolutePath);
    const [parentInfo, parentRealPath] = await Promise.all([
      lstat(parent),
      realpath(parent),
    ]);
    if (
      parentInfo.isSymbolicLink() ||
      !parentInfo.isDirectory() ||
      !sameOrBelow(destinationRoot, parentRealPath)
    ) {
      throw new HarnessError(`archive file parent is unsafe: ${member.path}`);
    }
    const file = await open(
      absolutePath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      member.mode,
    );
    try {
      const data = inspection.uncompressed.subarray(
        member.dataOffset,
        member.dataOffset + member.size,
      );
      await file.writeFile(data);
      await file.sync();
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1) {
        throw new HarnessError(
          `archive member was not created as a single-link regular file: ${member.path}`,
        );
      }
    } finally {
      await file.close();
    }
  }
}

export function assertGitIdentity(label, actualRevision, actualTree, pin) {
  if (actualRevision !== pin.revision) {
    throw new HarnessError(
      `${label} revision mismatch: expected ${pin.revision}, received ${actualRevision}`,
    );
  }
  if (actualTree !== pin.tree) {
    throw new HarnessError(
      `${label} tree mismatch: expected ${pin.tree}, received ${actualTree}`,
    );
  }
}

export function cargoPackageNames(lockSource) {
  const names = [];
  let inPackage = false;
  for (const line of lockSource.split(/\r?\n/u)) {
    if (line === "[[package]]") {
      inPackage = true;
      continue;
    }
    if (line.startsWith("[[")) {
      inPackage = false;
      continue;
    }
    const match = inPackage ? /^name = "([^"]+)"$/u.exec(line) : undefined;
    if (match?.[1]) {
      names.push(match[1]);
      inPackage = false;
    }
  }
  return names;
}

export function assertForbiddenClosureAbsent(lockSource, forbiddenNames) {
  const packageNames = new Set(cargoPackageNames(lockSource));
  const present = forbiddenNames.filter((name) => packageNames.has(name));
  if (present.length > 0) {
    throw new HarnessError(
      `forbidden Cargo closure package(s): ${present.join(", ")}`,
    );
  }
}

export async function readRegularFile(path, label) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new HarnessError(
      `${label} cannot be opened safely because O_NOFOLLOW is unavailable`,
    );
  }
  let pathInfo;
  try {
    pathInfo = await lstat(path);
  } catch (error) {
    throw new HarnessError(
      `${label} must resolve to a regular file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (pathInfo.isSymbolicLink() || !pathInfo.isFile() || pathInfo.nlink !== 1) {
    throw new HarnessError(
      `${label} must be a non-symlink, single-link regular file`,
    );
  }
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new HarnessError(
      `${label} must open as a non-symlink regular file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.dev !== pathInfo.dev ||
      info.ino !== pathInfo.ino
    ) {
      throw new HarnessError(`${label} must be a regular file`);
    }
    return await file.readFile();
  } finally {
    await file.close();
  }
}

async function openRegularFileWithinRoot(root, relativePath, label, flags) {
  assertSafeRelativePath(label, relativePath);
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new HarnessError(
      `${label} cannot be opened safely because O_NOFOLLOW is unavailable`,
    );
  }

  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new HarnessError(`${label} source root must be a real directory`);
  }
  const actualRoot = await realpath(root);
  let current = actualRoot;
  let finalInfo;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new HarnessError(`${label} path must not contain symbolic links`);
    }
    if (index === segments.length - 1) {
      if (!info.isFile() || info.nlink !== 1) {
        throw new HarnessError(`${label} must be a single-link regular file`);
      }
      finalInfo = info;
    } else if (!info.isDirectory()) {
      throw new HarnessError(`${label} parent must be a directory`);
    }
    const actual = await realpath(current);
    if (!sameOrBelow(actualRoot, actual)) {
      throw new HarnessError(`${label} path escaped its source root`);
    }
  }

  const file = await open(current, flags | constants.O_NOFOLLOW);
  try {
    const openedInfo = await file.stat();
    if (
      !openedInfo.isFile() ||
      openedInfo.nlink !== 1 ||
      openedInfo.dev !== finalInfo.dev ||
      openedInfo.ino !== finalInfo.ino
    ) {
      throw new HarnessError(`${label} changed while it was being opened`);
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

export async function readRegularFileWithinRoot(root, relativePath, label) {
  const file = await openRegularFileWithinRoot(
    root,
    relativePath,
    label,
    constants.O_RDONLY,
  );
  try {
    return await file.readFile();
  } finally {
    await file.close();
  }
}

export function applyPinnedTransformation(contents, transformation, label) {
  assertSha256(`${label} input`, contents, transformation.inputSha256);
  let output = Buffer.from(contents);
  const descendingOperations = [...transformation.operations].sort(
    (left, right) => right.offset - left.offset,
  );

  for (const operation of descendingOperations) {
    const end = operation.offset + operation.length;
    if (end > contents.byteLength) {
      throw new HarnessError(`${label}.${operation.id} exceeds the input`);
    }
    const segment = contents.subarray(operation.offset, end);
    assertSha256(
      `${label}.${operation.id} segment`,
      segment,
      operation.segmentSha256,
    );
    output = Buffer.concat([
      output.subarray(0, operation.offset),
      Buffer.from(operation.replacementUtf8, "utf8"),
      output.subarray(end),
    ]);
  }

  assertSha256(`${label} output`, output, transformation.outputSha256);
  return output;
}

export async function applyPinnedFileTransformations(
  root,
  transformations,
  label,
) {
  const results = {};
  for (const [relativePath, transformation] of Object.entries(
    transformations,
  )) {
    assertSafeRelativePath(`${label}.${relativePath}`, relativePath);
    const fileLabel = `${label}.${relativePath}`;
    const file = await openRegularFileWithinRoot(
      root,
      relativePath,
      fileLabel,
      constants.O_RDWR,
    );
    let transformed;
    try {
      const input = await file.readFile();
      transformed = applyPinnedTransformation(input, transformation, fileLabel);
      await file.truncate(0);
      let written = 0;
      while (written < transformed.byteLength) {
        const result = await file.write(
          transformed,
          written,
          transformed.byteLength - written,
          written,
        );
        if (result.bytesWritten <= 0) {
          throw new HarnessError(`${fileLabel} transformation write stalled`);
        }
        written += result.bytesWritten;
      }
      await file.sync();
      const writtenInfo = await file.stat();
      if (writtenInfo.size !== transformed.byteLength) {
        throw new HarnessError(`${fileLabel} transformation size changed`);
      }
      const confirmed = Buffer.alloc(transformed.byteLength);
      let confirmedBytes = 0;
      while (confirmedBytes < confirmed.byteLength) {
        const result = await file.read(
          confirmed,
          confirmedBytes,
          confirmed.byteLength - confirmedBytes,
          confirmedBytes,
        );
        if (result.bytesRead <= 0) {
          throw new HarnessError(`${fileLabel} transformation read stalled`);
        }
        confirmedBytes += result.bytesRead;
      }
      assertSha256(
        `${fileLabel} written output`,
        confirmed,
        transformation.outputSha256,
      );
    } finally {
      await file.close();
    }
    results[relativePath] = transformation.outputSha256;
  }
  return results;
}

export async function verifyFileHashes(root, expectedFiles, label) {
  for (const [relativePath, expectedHash] of Object.entries(expectedFiles)) {
    assertSafeRelativePath(`${label}.${relativePath}`, relativePath);
    const contents = await readRegularFileWithinRoot(
      root,
      relativePath,
      `${label}.${relativePath}`,
    );
    assertSha256(`${label}.${relativePath}`, contents, expectedHash);
  }
}

export function runCommand(command, arguments_, options = {}) {
  if (!options.env || typeof options.env !== "object") {
    throw new HarnessError(
      `${command} requires an explicit sanitized subprocess environment`,
    );
  }
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    env: options.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const diagnostics = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new HarnessError(
      `${command} exited with status ${result.status}${diagnostics ? `:\n${diagnostics}` : ""}`,
    );
  }
  return result.stdout;
}
