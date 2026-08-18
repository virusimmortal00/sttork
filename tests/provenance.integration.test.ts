import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("fixture provenance admission", () => {
  it("rejects an unrecorded fixture file", async () => {
    const fixtureDirectory = await mkdtemp(
      resolve(root, "fixtures/provenance-regression-"),
    );
    const fixturePath = resolve(fixtureDirectory, "unrecorded.z3");

    try {
      await writeFile(fixturePath, Buffer.from([0x03, 0x00, 0x00, 0x00]));

      const result = spawnSync(
        process.execPath,
        ["scripts/check-provenance.mjs"],
        { cwd: root, encoding: "utf8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("unrecorded fixture file:");
      expect(result.stderr).toContain("unrecorded.z3");
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it("rejects an unrecorded interpreter artifact outside fixture and vendor roots", async () => {
    const artifactPath = resolve(
      root,
      "packages/game-engine/unrecorded-regression.wasm",
    );

    try {
      await writeFile(artifactPath, Buffer.from([0x00, 0x61, 0x73, 0x6d]));

      const result = spawnSync(
        process.execPath,
        ["scripts/check-provenance.mjs"],
        { cwd: root, encoding: "utf8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("unrecorded controlled artifact:");
      expect(result.stderr).toContain("unrecorded-regression.wasm");
    } finally {
      await rm(artifactPath, { force: true });
    }
  });

  it("rejects review-only, unhashed, unapproved, and unknown record fields", async () => {
    const schema = JSON.parse(
      await readFile(resolve(root, "provenance/record.schema.json"), "utf8"),
    );
    const validate = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    }).compile(schema);
    const admittedRecord = {
      schemaVersion: 1,
      id: "admitted-test-input",
      name: "Admitted test input",
      origin: "third-party",
      kind: "other",
      importStatus: "imported",
      upstream: {
        url: "https://example.com/source",
        revision: "immutable-revision",
      },
      license: {
        spdx: "MIT",
        sourceUrl: "https://example.com/license",
        localNoticePaths: ["LICENSE"],
      },
      redistribution: {
        decision: "approved",
        trademarkGrant: false,
        conditions: ["Retain the license."],
      },
      localPaths: [
        {
          path: "fixtures/example.bin",
          sha256: "a".repeat(64),
        },
      ],
      verifiedAt: "2026-08-17",
      notes: [],
    };

    expect(validate(admittedRecord)).toBe(true);
    expect(validate({ ...admittedRecord, importStatus: "reviewed" })).toBe(
      false,
    );
    expect(
      validate({ ...admittedRecord, localPaths: ["fixtures/example.bin"] }),
    ).toBe(false);
    expect(
      validate({
        ...admittedRecord,
        redistribution: {
          ...admittedRecord.redistribution,
          decision: "eligible-after-audit",
        },
      }),
    ).toBe(false);
    expect(validate({ ...admittedRecord, vendorPayload: {} })).toBe(false);
  });
});
