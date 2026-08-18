import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertForbiddenClosureAbsent,
  loadSourceLock,
} from "./harness-lib.mjs";

const root = import.meta.dirname;

describe("Bocfel no-Z6 spike build contract", () => {
  it("pins a type-safe archive shape and avoids the host tar implementation", async () => {
    const [build, lock] = await Promise.all([
      readFile(resolve(root, "build.mjs"), "utf8"),
      loadSourceLock(resolve(root, "source-lock.json")),
    ]);

    expect(lock.bocfel).toMatchObject({
      allowedOrigins: ["https://cspiegel.github.io"],
      archiveByteLength: 171_007,
      directoryCount: 3,
      materialMemberCount: 69,
      metadataMemberCount: 1,
      regularFileCount: 66,
      uncompressedByteLength: 675_840,
    });
    expect(lock.bocfel.shapeSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(build).toContain("fetchPinnedBytes");
    expect(build).toContain("inspectPinnedTarGzipArchive");
    expect(build).toContain("extractInspectedTarArchive");
    expect(build).toContain("core.hooksPath=/dev/null");
    expect(build).toContain('"--template="');
    expect(build).not.toContain('runCommand("tar"');
    expect(build).not.toContain('redirect: "follow"');
    expect(build).not.toContain("arrayBuffer()");
  });

  it("defines one interpreter target and omits the Garglk static patch", async () => {
    const cmake = await readFile(resolve(root, "cmake/CMakeLists.txt"), "utf8");
    const executableTargets = [
      ...cmake.matchAll(/add_executable\(([^\s)]+)/gu),
    ].map((match) => match[1]);

    expect(executableTargets).toEqual(["bocfel-noz6"]);
    expect(cmake).toContain("ZTERP_NO_V6");
    expect(cmake).toContain("-sENVIRONMENT=node,web,worker");
    expect(cmake).not.toContain("ZTERP_STATIC_PATCH_FILE");
    expect(cmake).not.toMatch(/add_executable\((?:scare|tads)\b/iu);
  });

  it("makes pb-imgsize removal an executable source-and-lock requirement", async () => {
    const lock = await loadSourceLock(resolve(root, "source-lock.json"));
    const transformation = lock.transformations["remglk-no-image-metadata-v1"];

    expect(lock.forbiddenClosureNames).toContain("pb-imgsize");
    expect(Object.keys(transformation.files)).toEqual([
      "Cargo.lock",
      "remglk/Cargo.toml",
      "remglk/src/blorb/mod.rs",
    ]);
    expect(
      transformation.files["Cargo.lock"].operations.map(
        (operation) => operation.id,
      ),
    ).toContain("remove-pb-imgsize-lock-package");
    for (const file of Object.values(transformation.files)) {
      expect(file.inputSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(file.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(file.inputSha256).not.toBe(file.outputSha256);
    }
    expect(() =>
      assertForbiddenClosureAbsent("version = 3\n", ["pb-imgsize"]),
    ).not.toThrow();
  });
});
