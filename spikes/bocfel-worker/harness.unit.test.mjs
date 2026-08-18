import {
  chmod,
  link as createHardLink,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyPinnedFileTransformations,
  applyPinnedTransformation,
  assertDirectoryIdentity,
  assertForbiddenClosureAbsent,
  assertGitIdentity,
  assertSafeRelativePath,
  assertSha256,
  cargoPackageNames,
  captureDirectoryIdentity,
  createDockerEnvironment,
  createGitEnvironment,
  createMinimalToolEnvironment,
  extractInspectedTarArchive,
  fetchPinnedBytes,
  inspectPinnedTarGzipArchive,
  inspectTarGzipArchive,
  loadSourceLock,
  parseArguments,
  runCommand,
  sha256,
  validateWorkDirectory,
  verifyFileHashes,
} from "./harness-lib.mjs";

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "zv-bocfel-harness-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeTarText(header, offset, length, value) {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.byteLength > length) throw new Error("test tar field is too long");
  bytes.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const encoded = `${value.toString(8).padStart(length - 1, "0")}\0`;
  writeTarText(header, offset, length, encoded);
}

function tarMember({
  contents = Buffer.alloc(0),
  linkName = "",
  mode,
  path,
  type = "0",
}) {
  const data = Buffer.from(contents);
  const header = Buffer.alloc(512);
  writeTarText(header, 0, 100, path);
  writeTarOctal(header, 100, 8, mode ?? (type === "5" ? 0o755 : 0o644));
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, data.byteLength);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeTarText(header, 156, 1, type);
  writeTarText(header, 157, 100, linkName);
  writeTarText(header, 257, 6, "ustar\0");
  writeTarText(header, 263, 2, "00");
  writeTarOctal(header, 329, 8, 0);
  writeTarOctal(header, 337, 8, 0);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const padding = Buffer.alloc((512 - (data.byteLength % 512)) % 512);
  return [header, data, padding];
}

function testTarGzip(entries) {
  return gzipSync(
    Buffer.concat([
      ...entries.flatMap((entry) => tarMember(entry)),
      Buffer.alloc(1024),
    ]),
  );
}

function inspectTestArchive(archive) {
  return inspectTarGzipArchive(archive, {
    archiveRoot: "fixture",
    compressedByteLimit: 1024 * 1024,
    uncompressedByteLimit: 1024 * 1024,
  });
}

function paxRecord(key, value) {
  const assignment = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(assignment) + 1;
  while (Buffer.byteLength(`${length}${assignment}`) !== length) {
    length = Buffer.byteLength(`${length}${assignment}`);
  }
  return Buffer.from(`${length}${assignment}`, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Bocfel spike harness validation", () => {
  it("loads the reviewed source lock", async () => {
    const lock = await loadSourceLock(
      resolve(import.meta.dirname, "source-lock.json"),
    );

    expect(lock.bocfel.archiveSha256).toHaveLength(64);
    expect(lock.bocfel.archiveByteLength).toBe(171_007);
    expect(lock.bocfel.materialMemberCount).toBe(69);
    expect(lock.bocfel.regularFileCount).toBe(66);
    expect(lock.bocfel.allowedOrigins).toEqual(["https://cspiegel.github.io"]);
    expect(lock.remglk.revision).toHaveLength(40);
    expect(lock.emglkenGlue.revision).toHaveLength(40);
    expect(lock.forbiddenClosureNames).toContain("pb-imgsize");
  });

  it("requires explicit network, build, and work-directory consent", () => {
    expect(() => parseArguments([])).toThrow("--work-dir is required");
    expect(() =>
      parseArguments(["--work-dir", "/private/tmp/example"]),
    ).toThrow("both --allow-network and --allow-build");
    expect(() =>
      parseArguments([
        "--allow-network",
        "--allow-build",
        "--work-dir",
        "/private/tmp/example",
        "--surprise",
      ]),
    ).toThrow("unknown argument");

    expect(
      parseArguments([
        "--allow-network",
        "--allow-build",
        "--work-dir=/private/tmp/example",
      ]),
    ).toEqual({
      allowBuild: true,
      allowNetwork: true,
      workDirectory: "/private/tmp/example",
    });
  });

  it("accepts only an empty, real directory outside the repository", async () => {
    const base = await temporaryDirectory();
    const repository = join(base, "repository");
    const work = join(base, "work");
    await Promise.all([mkdir(repository), mkdir(work)]);

    await expect(
      validateWorkDirectory(work, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).resolves.toBe(await realpath(work));

    await writeFile(join(work, "existing"), "do not overwrite");
    await expect(
      validateWorkDirectory(work, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).rejects.toThrow("must be empty");
  });

  it("rejects symlinks and paths that overlap the repository", async () => {
    const base = await temporaryDirectory();
    const repository = join(base, "repository");
    const outside = join(base, "outside");
    const link = join(base, "link");
    await Promise.all([mkdir(repository), mkdir(outside)]);
    await symlink(outside, link);

    await expect(
      validateWorkDirectory(link, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).rejects.toThrow("symbolic link");
    await expect(
      validateWorkDirectory(repository, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).rejects.toThrow("outside");
    await expect(
      validateWorkDirectory(base, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).rejects.toThrow("must not contain");
  });

  it("rejects a work directory writable by other users", async () => {
    const base = await temporaryDirectory();
    const repository = join(base, "repository");
    const work = join(base, "shared-work");
    await Promise.all([mkdir(repository), mkdir(work)]);
    await chmod(work, 0o777);

    await expect(
      validateWorkDirectory(work, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).rejects.toThrow("group or other users");
  });

  it("rejects replaceable ancestors but permits a sticky temp parent", async () => {
    const base = await temporaryDirectory();
    const repository = join(base, "repository");
    const unsafeParent = join(base, "unsafe-parent");
    const unsafeWork = join(unsafeParent, "work");
    const stickyParent = join(base, "sticky-parent");
    const stickyWork = join(stickyParent, "work");
    await Promise.all([
      mkdir(repository),
      mkdir(unsafeParent),
      mkdir(stickyParent),
    ]);
    await Promise.all([mkdir(unsafeWork), mkdir(stickyWork)]);
    await Promise.all([
      chmod(unsafeParent, 0o777),
      chmod(stickyParent, 0o1777),
    ]);

    await expect(
      validateWorkDirectory(unsafeWork, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).rejects.toThrow("ancestor permits another user to replace");
    await expect(
      validateWorkDirectory(stickyWork, {
        homeDirectory: join(base, "home"),
        repositoryRoot: repository,
      }),
    ).resolves.toBe(await realpath(stickyWork));
  });

  it("detects replacement of the validated work directory", async () => {
    const base = await temporaryDirectory();
    const work = join(base, "work");
    const moved = join(base, "moved-work");
    await mkdir(work);
    const identity = await captureDirectoryIdentity(work, "work directory");
    await rename(work, moved);
    await mkdir(work);

    await expect(
      assertDirectoryIdentity(identity, "work directory"),
    ).rejects.toThrow("changed during the build");
  });

  it("fails closed on source hashes and Git identities", () => {
    const contents = Buffer.from("candidate source", "utf8");
    const expected = sha256(contents);
    expect(assertSha256("source", contents, expected)).toBe(expected);
    expect(() => assertSha256("source", contents, "0".repeat(64))).toThrow(
      "SHA-256 mismatch",
    );

    const pin = { revision: "1".repeat(40), tree: "2".repeat(40) };
    expect(() =>
      assertGitIdentity("source", pin.revision, pin.tree, pin),
    ).not.toThrow();
    expect(() =>
      assertGitIdentity("source", "3".repeat(40), pin.tree, pin),
    ).toThrow("revision mismatch");
    expect(() =>
      assertGitIdentity("source", pin.revision, "3".repeat(40), pin),
    ).toThrow("tree mismatch");
  });

  it("accepts and directly extracts only regular files and directories", async () => {
    const archive = testTarGzip([
      { path: "fixture/", type: "5" },
      { path: "fixture/src/", type: "5" },
      { contents: "safe source", path: "fixture/src/file.c" },
    ]);
    const inspection = inspectTestArchive(archive);
    expect(inspection.summary).toMatchObject({
      directoryCount: 2,
      materialMemberCount: 3,
      metadataMemberCount: 0,
      regularFileCount: 1,
    });

    const destination = await temporaryDirectory();
    await extractInspectedTarArchive(inspection, destination);
    await expect(
      readFile(join(destination, "fixture/src/file.c"), "utf8"),
    ).resolves.toBe("safe source");
  });

  it.each([
    ["hard link", "1", "fixture/source"],
    ["symbolic link", "2", "fixture/source"],
    ["character device", "3", ""],
    ["block device", "4", ""],
    ["FIFO", "6", ""],
    ["GNU long name", "L", ""],
    ["per-file PAX metadata", "x", ""],
  ])("rejects a %s tar member", (_name, type, linkName) => {
    const archive = testTarGzip([
      { path: "fixture/", type: "5" },
      { linkName, path: "fixture/unsafe", type },
    ]);
    expect(() => inspectTestArchive(archive)).toThrow(
      /link targets are forbidden|unsupported non-regular archive member/u,
    );
  });

  it("rejects traversal and path-shaping PAX metadata", () => {
    const traversal = testTarGzip([
      { path: "fixture/", type: "5" },
      { contents: "escape", path: "fixture/../escape" },
    ]);
    expect(() => inspectTestArchive(traversal)).toThrow(
      "unsafe archive member path",
    );

    const paxPath = testTarGzip([
      {
        contents: paxRecord("path", "fixture/replaced"),
        path: "pax_global_header",
        type: "g",
      },
      { path: "fixture/", type: "5" },
    ]);
    expect(() => inspectTestArchive(paxPath)).toThrow(
      "only a non-path-shaping comment",
    );
  });

  it("requires the pinned archive hash, length, and complete member shape", () => {
    const archive = testTarGzip([
      { path: "fixture/", type: "5" },
      { contents: "safe source", path: "fixture/file.c" },
    ]);
    const inspection = inspectTestArchive(archive);
    const pin = {
      archiveByteLength: archive.byteLength,
      archiveRoot: "fixture",
      archiveSha256: sha256(archive),
      ...inspection.summary,
    };
    expect(inspectPinnedTarGzipArchive(archive, pin).summary).toEqual(
      inspection.summary,
    );
    expect(() =>
      inspectPinnedTarGzipArchive(archive, {
        ...pin,
        regularFileCount: 2,
      }),
    ).toThrow("archive regularFileCount mismatch");
    expect(() =>
      inspectPinnedTarGzipArchive(archive, {
        ...pin,
        archiveSha256: "0".repeat(64),
      }),
    ).toThrow("SHA-256 mismatch");
  });

  it("rejects link, directory, and symlink-parent hash targets", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real/source"), "verified");
    const expected = sha256(Buffer.from("verified"));
    await symlink("real/source", join(root, "link"));
    await symlink("real", join(root, "linked-parent"));
    await createHardLink(join(root, "real/source"), join(root, "hard-link"));

    await expect(
      verifyFileHashes(root, { link: expected }, "selected source"),
    ).rejects.toThrow(/symbolic links|non-symlink regular file/u);
    await expect(
      verifyFileHashes(root, { real: expected }, "selected source"),
    ).rejects.toThrow("regular file");
    await expect(
      verifyFileHashes(root, { "hard-link": expected }, "selected source"),
    ).rejects.toThrow("single-link regular file");
    await expect(
      verifyFileHashes(
        root,
        { "linked-parent/source": expected },
        "selected source",
      ),
    ).rejects.toThrow("symbolic links");
  });

  it("rejects a symlink transformation target before writing", async () => {
    const root = await temporaryDirectory();
    const original = Buffer.from("original");
    const changed = Buffer.from("changed");
    await writeFile(join(root, "real"), original);
    await symlink("real", join(root, "linked"));

    await expect(
      applyPinnedFileTransformations(
        root,
        {
          linked: {
            inputSha256: sha256(original),
            operations: [
              {
                id: "replace",
                length: original.byteLength,
                offset: 0,
                replacementUtf8: "changed",
                segmentSha256: sha256(original),
              },
            ],
            outputSha256: sha256(changed),
          },
        },
        "synthetic transformation",
      ),
    ).rejects.toThrow("symbolic links");
    await expect(readFile(join(root, "real"), "utf8")).resolves.toBe(
      "original",
    );
  });

  it("allowlists subprocess variables and requires an explicit environment", () => {
    const hostileEnvironment = {
      DOCKER_CERT_PATH: "/host/docker-certs",
      DOCKER_CONFIG: "/host/docker-config",
      DOCKER_CONTEXT: "host-context",
      DOCKER_HOST: "unix:///safe/docker.sock",
      DOCKER_TLS_VERIFY: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_GLOBAL: "/host/gitconfig",
      GIT_TEMPLATE_DIR: "/host/templates",
      HOME: "/host/home",
      LD_PRELOAD: "/host/injected.so",
      NODE_OPTIONS: "--require=/host/injected.js",
      PATH: process.env.PATH,
      TAR_OPTIONS: "--checkpoint-action=exec=sh",
      TMPDIR: "/host/temporary-directory",
    };
    const minimal = createMinimalToolEnvironment(hostileEnvironment);
    const git = createGitEnvironment(hostileEnvironment);
    const docker = createDockerEnvironment(hostileEnvironment);

    expect(minimal).toMatchObject({ LANG: "C", LC_ALL: "C" });
    for (const forbidden of [
      "DOCKER_CONFIG",
      "DOCKER_CERT_PATH",
      "DOCKER_TLS_VERIFY",
      "GIT_CONFIG_COUNT",
      "GIT_TEMPLATE_DIR",
      "HOME",
      "LD_PRELOAD",
      "NODE_OPTIONS",
      "TAR_OPTIONS",
      "TMPDIR",
    ]) {
      expect(minimal).not.toHaveProperty(forbidden);
      expect(git).not.toHaveProperty(forbidden);
      expect(docker).not.toHaveProperty(forbidden);
    }
    expect(git).toMatchObject({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(docker.DOCKER_HOST).toBe("unix:///safe/docker.sock");
    expect(
      createDockerEnvironment(hostileEnvironment, {
        configDirectory: "/private/tmp/zv-empty-docker-config",
      }).DOCKER_CONFIG,
    ).toBe("/private/tmp/zv-empty-docker-config");
    expect(() =>
      createDockerEnvironment(hostileEnvironment, {
        configDirectory: "relative/docker-config",
      }),
    ).toThrow("Docker config directory must be absolute");
    expect(() =>
      createDockerEnvironment({
        ...hostileEnvironment,
        DOCKER_HOST: "ssh://builder.example",
      }),
    ).toThrow("local Unix socket URL");
    expect(() => runCommand(process.execPath, ["--version"])).toThrow(
      "explicit sanitized subprocess environment",
    );
    expect(
      runCommand(
        process.execPath,
        [
          "-e",
          'process.stdout.write(process.env.TAR_OPTIONS ?? "not inherited")',
        ],
        { env: minimal },
      ),
    ).toBe("not inherited");
  });

  it("allows only bounded same-origin manual archive redirects", async () => {
    const calls = [];
    const fetchImplementation = vi.fn(async (url, options) => {
      calls.push({ options, url });
      if (calls.length === 1) {
        return new Response(null, {
          headers: { location: "/artifact.tar.gz" },
          status: 302,
        });
      }
      return new Response(Buffer.from("data"), {
        headers: { "content-length": "4" },
        status: 200,
      });
    });
    await expect(
      fetchPinnedBytes("https://downloads.example/source.tar.gz", {
        allowedOrigins: ["https://downloads.example"],
        expectedByteLength: 4,
        fetchImplementation,
        label: "test archive",
      }),
    ).resolves.toEqual(Buffer.from("data"));
    expect(calls.map((call) => call.url)).toEqual([
      "https://downloads.example/source.tar.gz",
      "https://downloads.example/artifact.tar.gz",
    ]);
    expect(calls.every((call) => call.options.redirect === "manual")).toBe(
      true,
    );

    const crossOriginFetch = vi.fn(
      async () =>
        new Response(null, {
          headers: { location: "https://evil.example/archive" },
          status: 302,
        }),
    );
    await expect(
      fetchPinnedBytes("https://downloads.example/source.tar.gz", {
        allowedOrigins: ["https://downloads.example"],
        expectedByteLength: 4,
        fetchImplementation: crossOriginFetch,
        label: "test archive",
      }),
    ).rejects.toThrow("redirect target origin is not allowed");
    expect(crossOriginFetch).toHaveBeenCalledTimes(1);

    await expect(
      fetchPinnedBytes("https://downloads.example/source.tar.gz", {
        allowedOrigins: ["https://downloads.example"],
        expectedByteLength: 4,
        fetchImplementation: async () =>
          new Response(Buffer.alloc(5), { status: 200 }),
        label: "test archive",
      }),
    ).rejects.toThrow("response exceeded 4 bytes");

    const unreachableFetch = vi.fn();
    await expect(
      fetchPinnedBytes("http://downloads.example/source.tar.gz", {
        allowedOrigins: ["https://downloads.example"],
        expectedByteLength: 4,
        fetchImplementation: unreachableFetch,
        label: "test archive",
      }),
    ).rejects.toThrow("must use HTTPS");
    await expect(
      fetchPinnedBytes("https://user@downloads.example/source.tar.gz", {
        allowedOrigins: ["https://downloads.example"],
        expectedByteLength: 4,
        fetchImplementation: unreachableFetch,
        label: "test archive",
      }),
    ).rejects.toThrow("must not contain URL credentials");
    await expect(
      fetchPinnedBytes("https://downloads.example/source.tar.gz", {
        allowedOrigins: ["https://downloads.example/"],
        expectedByteLength: 4,
        fetchImplementation: unreachableFetch,
        label: "test archive",
      }),
    ).rejects.toThrow("canonical HTTPS origins");
    expect(unreachableFetch).not.toHaveBeenCalled();
  });

  it("requires exact transformation input, segment, and output hashes", () => {
    const input = Buffer.from("alpha beta gamma", "utf8");
    const expectedOutput = Buffer.from("alpha delta gamma", "utf8");
    const transformation = {
      inputSha256: sha256(input),
      outputSha256: sha256(expectedOutput),
      operations: [
        {
          id: "replace-middle",
          offset: 6,
          length: 4,
          segmentSha256: sha256(Buffer.from("beta", "utf8")),
          replacementUtf8: "delta",
        },
      ],
    };

    expect(
      applyPinnedTransformation(input, transformation, "synthetic"),
    ).toEqual(expectedOutput);
    expect(() =>
      applyPinnedTransformation(
        Buffer.from("alpha zeta gamma", "utf8"),
        transformation,
        "synthetic",
      ),
    ).toThrow("input SHA-256 mismatch");
    expect(() =>
      applyPinnedTransformation(
        input,
        {
          ...transformation,
          operations: [
            {
              ...transformation.operations[0],
              segmentSha256: "0".repeat(64),
            },
          ],
        },
        "synthetic",
      ),
    ).toThrow("segment SHA-256 mismatch");
    expect(() =>
      applyPinnedTransformation(
        input,
        { ...transformation, outputSha256: "0".repeat(64) },
        "synthetic",
      ),
    ).toThrow("output SHA-256 mismatch");
  });

  it("rejects path traversal and forbidden Cargo packages", () => {
    expect(() => assertSafeRelativePath("input", "../escape")).toThrow(
      "safe relative path",
    );
    expect(() => assertSafeRelativePath("input", "/absolute")).toThrow(
      "safe relative path",
    );
    expect(() => assertSafeRelativePath("input", "src//file")).toThrow(
      "safe relative path",
    );
    expect(() => assertSafeRelativePath("input", "src/./file")).toThrow(
      "safe relative path",
    );
    expect(() => assertSafeRelativePath("input", "src\\file")).toThrow(
      "safe relative path",
    );
    expect(assertSafeRelativePath("input", "src/preamble.js")).toBe(
      "src/preamble.js",
    );

    const lockSource = [
      "version = 3",
      "",
      "[[package]]",
      'name = "remglk"',
      'version = "0.1.0"',
      "",
      "[[package]]",
      'name = "pb-imgsize"',
      'version = "0.2.5"',
      "",
    ].join("\n");
    expect(cargoPackageNames(lockSource)).toEqual(["remglk", "pb-imgsize"]);
    expect(() =>
      assertForbiddenClosureAbsent(lockSource, ["pb-imgsize"]),
    ).toThrow("forbidden Cargo closure");
    expect(() =>
      assertForbiddenClosureAbsent(lockSource, ["scare", "tads"]),
    ).not.toThrow();
  });
});
