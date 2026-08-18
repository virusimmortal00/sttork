import { createHash } from "node:crypto";

export const minimalStoryPaths = Object.freeze({
  artifact: "fixtures/stories/minimal/artifact/minimal.z3",
  license: "fixtures/stories/minimal/LICENSE",
  manifest: "fixtures/stories/minimal/artifact/manifest.json",
  source: "fixtures/stories/minimal/source/minimal.inf",
});

export const informCompiler = Object.freeze({
  banner: "Inform 6.44 (11th September 2025)",
  license: "Artistic-2.0",
  licenseUrl:
    "https://github.com/DavidKinder/Inform6/blob/973a81bebcbd613578b1cc6a1b23a009fe06abd8/licence.txt",
  name: "Inform",
  releaseDate: "2025-09-11",
  sourceRevision: "973a81bebcbd613578b1cc6a1b23a009fe06abd8",
  sourceTag: "v6.44",
  upstreamUrl: "https://github.com/DavidKinder/Inform6",
  version: "6.44",
});

export const minimalStoryBuild = Object.freeze({
  arguments: Object.freeze([
    "-v3",
    "-Cu",
    "$ZCODE_FILE_END_PADDING=0",
    "minimal.inf",
    "minimal.z3",
  ]),
  environment: Object.freeze({ LC_ALL: "C", TZ: "UTC" }),
});

const expectedHeader = Object.freeze({
  release: 1,
  serial: "260817",
  version: 3,
});

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function hexadecimalWord(value) {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

export function inspectMinimalStory(artifact) {
  if (!Buffer.isBuffer(artifact) || artifact.length < 64) {
    throw new Error("minimal story must contain a complete 64-byte header");
  }

  const version = artifact[0];
  const release = artifact.readUInt16BE(2);
  const serial = artifact.toString("ascii", 0x12, 0x18);
  const compilerVersion = artifact.toString("ascii", 0x3c, 0x40);
  const declaredByteLength = artifact.readUInt16BE(0x1a) * 2;
  const headerChecksum = artifact.readUInt16BE(0x1c);

  if (version !== expectedHeader.version) {
    throw new Error(`expected Z-machine version 3, received ${version}`);
  }
  if (release !== expectedHeader.release) {
    throw new Error(`expected story release 1, received ${release}`);
  }
  if (serial !== expectedHeader.serial) {
    throw new Error(`expected story serial 260817, received ${serial}`);
  }
  if (compilerVersion !== informCompiler.version) {
    throw new Error(
      `expected compiler header ${informCompiler.version}, received ${compilerVersion}`,
    );
  }
  if (declaredByteLength < 64 || declaredByteLength !== artifact.length) {
    throw new Error(
      `declared story length ${declaredByteLength} must equal the ${artifact.length}-byte artifact length`,
    );
  }

  let computedChecksum = 0;
  for (let offset = 0x40; offset < declaredByteLength; offset += 1) {
    computedChecksum = (computedChecksum + artifact[offset]) & 0xffff;
  }
  if (computedChecksum !== headerChecksum) {
    throw new Error(
      `header checksum mismatch: expected ${hexadecimalWord(headerChecksum)}, computed ${hexadecimalWord(computedChecksum)}`,
    );
  }

  const trailingPadding = artifact.subarray(declaredByteLength);
  if (!trailingPadding.every((byte) => byte === 0)) {
    throw new Error(
      "bytes after the declared story length must be zero padding",
    );
  }

  return {
    byteLength: artifact.length,
    compilerVersion,
    declaredByteLength,
    headerChecksum: hexadecimalWord(headerChecksum),
    release,
    serial,
    trailingPaddingBytes: trailingPadding.length,
    version,
  };
}

export function createMinimalStoryManifest(source, artifact) {
  const header = inspectMinimalStory(artifact);

  return {
    schemaVersion: 1,
    id: "minimal-zmachine-story",
    ownership: {
      kind: "project-owned-original",
      license: "MIT",
      licensePath: minimalStoryPaths.license,
      contentStatement:
        "Original test content only; contains no Zork source, story data, prose, map, objects, or solution material.",
    },
    source: {
      format: "Inform 6 source without the Inform library",
      path: minimalStoryPaths.source,
      sha256: sha256(source),
    },
    artifact: {
      format: "Z-machine story file",
      path: minimalStoryPaths.artifact,
      sha256: sha256(artifact),
      zMachineVersion: header.version,
      release: header.release,
      serial: header.serial,
      compilerVersion: header.compilerVersion,
      byteLength: header.byteLength,
      declaredByteLength: header.declaredByteLength,
      trailingPaddingBytes: header.trailingPaddingBytes,
      trailingPaddingValue: 0,
      headerChecksum: header.headerChecksum,
      checksumAlgorithm:
        "Sum bytes from 0x40 through the declared story length modulo 65536.",
      specification:
        "https://inform-fiction.org/zmachine/standards/z1point1/sect11.html",
    },
    compiler: {
      name: informCompiler.name,
      version: informCompiler.version,
      releaseDate: informCompiler.releaseDate,
      banner: informCompiler.banner,
      upstreamUrl: informCompiler.upstreamUrl,
      sourceTag: informCompiler.sourceTag,
      sourceRevision: informCompiler.sourceRevision,
      license: informCompiler.license,
      licenseUrl: informCompiler.licenseUrl,
    },
    build: {
      script: "scripts/build-minimal-story.mjs",
      command:
        "inform -v3 -Cu '$ZCODE_FILE_END_PADDING=0' minimal.inf minimal.z3",
      arguments: [...minimalStoryBuild.arguments],
      environment: { ...minimalStoryBuild.environment },
      fileEndPaddingArgument: "$ZCODE_FILE_END_PADDING=0",
      warningsAllowed: false,
      reproducibility: {
        independentBuilds: 2,
        comparison: "byte-for-byte",
        requiredResult: "identical",
      },
      attestationScope:
        "The source revision and compiler banner are pinned. No compiler executable hash or container digest is asserted.",
    },
    provenanceRecords: [
      "provenance/records/inform6-compiler-v6-44.json",
      "provenance/records/minimal-story-artifact.json",
    ],
  };
}

export function serializeMinimalStoryManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
