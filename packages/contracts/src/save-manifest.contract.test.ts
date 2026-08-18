import { describe, expect, expectTypeOf, it } from "vitest";

import type { SaveManifestV1 } from "./save-manifest.js";

const saveManifestFixture = {
  formatVersion: 1,
  saveId: "save-1",
  createdAt: "2026-08-17T21:30:00.000Z",
  committedSequence: 42,
  engineRevision: 7,
  story: {
    id: "minimal-zmachine-story",
    sourceRevision: "fixture-release-1",
    artifactSha256:
      "67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389",
  },
  interpreter: {
    id: "bocfel",
    version: "2.5.1",
    artifactSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    provenanceRecordId: "bocfel-browser-wasm-2-5-1",
  },
  engineAdapter: {
    id: "browser-worker-engine",
    version: "1.0.0",
  },
  engineSnapshot: {
    schemaVersion: 1,
    encoding: "binary",
    sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    byteLength: 4096,
  },
  guideMemory: {
    schemaVersion: 1,
    sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
} as const satisfies SaveManifestV1;

describe("SaveManifestV1 contract", () => {
  it("binds a save to exact interpreter, adapter, and snapshot identities", () => {
    expect(saveManifestFixture.interpreter).toStrictEqual({
      id: "bocfel",
      version: "2.5.1",
      artifactSha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      provenanceRecordId: "bocfel-browser-wasm-2-5-1",
    });
    expect(saveManifestFixture.engineAdapter).toStrictEqual({
      id: "browser-worker-engine",
      version: "1.0.0",
    });
    expect(saveManifestFixture.engineSnapshot.schemaVersion).toBe(1);
  });

  it("keeps every compatibility identity field required", () => {
    expectTypeOf<SaveManifestV1["interpreter"]>().toEqualTypeOf<{
      readonly id: string;
      readonly version: string;
      readonly artifactSha256: string;
      readonly provenanceRecordId: string;
    }>();
    expectTypeOf<SaveManifestV1["engineAdapter"]>().toEqualTypeOf<{
      readonly id: string;
      readonly version: string;
    }>();
    expectTypeOf<SaveManifestV1["engineSnapshot"]>().toEqualTypeOf<{
      readonly schemaVersion: number;
      readonly encoding: "binary";
      readonly sha256: string;
      readonly byteLength: number;
    }>();
  });
});
