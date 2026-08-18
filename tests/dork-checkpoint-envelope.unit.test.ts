import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DORK_CHECKPOINT_ADAPTER_ID,
  DORK_CHECKPOINT_FIXED_HEADER_BYTES,
  DORK_CHECKPOINT_MAGIC,
  DORK_CHECKPOINT_MAX_CALL_FRAMES,
  DORK_CHECKPOINT_MAX_FRAME_STACK_WORDS,
  DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES,
  DORK_CHECKPOINT_MAX_LOCALS,
  DORK_CHECKPOINT_MAX_STORY_ID_BYTES,
  DORK_CHECKPOINT_MAX_STREAM_DEPTH,
  DORK_CHECKPOINT_MAX_TOTAL_BYTES,
  DORK_CHECKPOINT_MAX_TOTAL_STACK_WORDS,
  DORK_CHECKPOINT_RUNTIME_ID,
  DORK_CHECKPOINT_WIRE_V2_GOLDEN_SHA256,
  DorkCheckpointCodecError,
  decodeDorkCheckpointEnvelope,
  encodeDorkCheckpointEnvelope,
  type DorkCheckpointCodecErrorCode,
  type DorkCheckpointEnvelope,
} from "../spikes/dork-worker/checkpoint-envelope.js";

const REVISION = 0x0102_0304_0506;

function createEnvelope(): DorkCheckpointEnvelope {
  const dynamicMemory = Uint8Array.from(
    { length: 128 },
    (_value, index) => index,
  );
  dynamicMemory[0] = 3;
  dynamicMemory[2] = 0;
  dynamicMemory[3] = 119;
  dynamicMemory.set(new TextEncoder().encode("880429"), 18);
  dynamicMemory[28] = 0x12;
  dynamicMemory[29] = 0x34;
  dynamicMemory[16] = 0x80;
  dynamicMemory[17] = 0x01;
  dynamicMemory[32] = 16;
  dynamicMemory[64] = 5;
  dynamicMemory[100] = 228;
  return {
    schemaVersion: 2,
    runtimeId: DORK_CHECKPOINT_RUNTIME_ID,
    adapterId: DORK_CHECKPOINT_ADAPTER_ID,
    storyId: "zork1-release-119",
    artifactSha256:
      "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79",
    revision: REVISION,
    lastOutput: "West of House\nYou are standing in an open field.\n\n> ",
    machine: {
      schemaVersion: 2,
      story: {
        version: 3,
        byteSwapped: false,
        release: 119,
        serial: "880429",
        checksum: 0x1234,
        byteLength: 512,
        staticMemoryBase: dynamicMemory.byteLength,
      },
      config: {
        isTandy: false,
        strict: true,
        maxInstructions: 10_000,
        maxInstructionsPerTurn: 1000,
        ioCapabilities: 0b1011,
      },
      dynamicMemory,
      dataStack: [0, -1, 32_767, -32_768],
      callStack: [
        {
          pc: 96,
          local: [1, -2, 3],
          ds: [4, -5],
          discardResult: false,
          argCount: 2,
        },
        {
          pc: 112,
          local: [],
          ds: [6],
          discardResult: true,
          argCount: 0,
        },
      ],
      rngMode: 0,
      gameplayState: 0x89ab_cdef,
      reseedState: 0x0123_4567,
      savedFlags: -32_767,
      stream3: [{ base: 80, cursor: 84 }],
      instructionCount: 750,
      turnInstructionCount: 75,
      pendingRead: {
        kind: "line",
        instructionPc: 100,
        continuationPc: 104,
        textBuffer: 32,
        parseBuffer: 64,
        maxLength: 16,
      },
    },
  };
}

function expectCodecError(
  operation: () => unknown,
  code: DorkCheckpointCodecErrorCode,
): DorkCheckpointCodecError {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DorkCheckpointCodecError);
  expect(thrown).toMatchObject({ code });
  return thrown as DorkCheckpointCodecError;
}

function shortFieldOffset(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return offset + 2 + view.getUint16(offset, false);
}

function storyIdBytesOffset(bytes: Uint8Array): number {
  let offset = DORK_CHECKPOINT_FIXED_HEADER_BYTES;
  offset = shortFieldOffset(bytes, offset);
  offset = shortFieldOffset(bytes, offset);
  return offset + 2;
}

function findSequence(bytes: Uint8Array, sequence: readonly number[]): number {
  for (
    let offset = 0;
    offset <= bytes.byteLength - sequence.length;
    offset += 1
  ) {
    if (sequence.every((value, index) => bytes[offset + index] === value)) {
      return offset;
    }
  }
  throw new Error("Expected byte sequence was not found");
}

function revisionOffset(bytes: Uint8Array): number {
  let offset = DORK_CHECKPOINT_FIXED_HEADER_BYTES;
  offset = shortFieldOffset(bytes, offset);
  offset = shortFieldOffset(bytes, offset);
  offset = shortFieldOffset(bytes, offset);
  return offset + 32;
}

function lastOutputLengthOffset(bytes: Uint8Array): number {
  return revisionOffset(bytes) + 8;
}

function dataStackCountOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = lastOutputLengthOffset(bytes);
  const outputLength = view.getUint32(offset, false);
  offset += 4 + outputLength;
  offset += 4; // machine schema + reserved
  const serialLength = view.getUint8(offset + 4);
  offset += 16 + serialLength; // story fields + serial
  offset += 24; // config
  const dynamicMemoryLength = view.getUint32(offset, false);
  return offset + 4 + dynamicMemoryLength;
}

function replaceMachine(
  envelope: DorkCheckpointEnvelope,
  machine: DorkCheckpointEnvelope["machine"],
): DorkCheckpointEnvelope {
  return { ...envelope, machine };
}

describe("Dork checkpoint envelope codec", () => {
  it("locks the complete schema-v2 wire encoding to a golden digest", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    const digest = createHash("sha256").update(encoded).digest("hex");
    expect(digest).toBe(DORK_CHECKPOINT_WIRE_V2_GOLDEN_SHA256);
  });

  it("round-trips every field and detaches encoded and decoded dynamic memory", () => {
    const source = createEnvelope();
    const originalFirstByte = source.machine.dynamicMemory[0];
    const encoded = encodeDorkCheckpointEnvelope(source);

    source.machine.dynamicMemory[0] = 0xff;
    const decoded = decodeDorkCheckpointEnvelope(encoded);
    expect(decoded).toEqual(createEnvelope());
    expect(decoded.machine.dynamicMemory[0]).toBe(originalFirstByte);
    expect(decoded.machine.dynamicMemory).not.toBe(
      source.machine.dynamicMemory,
    );

    encoded.fill(0);
    expect(decoded.machine.dynamicMemory[1]).toBe(1);
    const secondEncoding = encodeDorkCheckpointEnvelope(decoded);
    const secondDecoded = decodeDorkCheckpointEnvelope(secondEncoding);
    decoded.machine.dynamicMemory[1] = 0xee;
    expect(secondDecoded.machine.dynamicMemory[1]).toBe(1);
  });

  it("writes its magic, total length, and safe 64-bit revision in big-endian order", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    const view = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    );

    expect(new TextDecoder().decode(encoded.subarray(0, 8))).toBe(
      DORK_CHECKPOINT_MAGIC,
    );
    expect(view.getUint32(12, false)).toBe(encoded.byteLength);
    expect(
      Array.from(
        encoded.subarray(revisionOffset(encoded), revisionOffset(encoded) + 8),
      ),
    ).toEqual([0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  });

  it("rejects truncation even when the attacker rewrites the declared total", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    const truncated = encoded.slice(0, -1);
    new DataView(truncated.buffer).setUint32(12, truncated.byteLength, false);

    expectCodecError(
      () => decodeDorkCheckpointEnvelope(truncated),
      "truncated",
    );
  });

  it("preserves a per-turn counter when the uncapped global counter is intentionally disabled", () => {
    const envelope = createEnvelope();
    const candidate = replaceMachine(envelope, {
      ...envelope.machine,
      config: { ...envelope.machine.config, maxInstructions: null },
      instructionCount: 0,
      turnInstructionCount: 75,
    });

    expect(
      decodeDorkCheckpointEnvelope(encodeDorkCheckpointEnvelope(candidate)),
    ).toEqual(candidate);
  });

  it("rejects trailing bytes even when the attacker rewrites the declared total", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    const extended = new Uint8Array(encoded.byteLength + 1);
    extended.set(encoded);
    extended[extended.length - 1] = 0xa5;
    new DataView(extended.buffer).setUint32(12, extended.byteLength, false);

    expectCodecError(
      () => decodeDorkCheckpointEnvelope(extended),
      "trailing-bytes",
    );
  });

  it("rejects a declared total that does not match the supplied bytes", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    new DataView(encoded.buffer).setUint32(12, encoded.byteLength - 1, false);

    expectCodecError(
      () => decodeDorkCheckpointEnvelope(encoded),
      "invalid-total-length",
    );
  });

  it("rejects nonzero reserved fields and unsupported schemas", () => {
    const reserved = encodeDorkCheckpointEnvelope(createEnvelope());
    new DataView(reserved.buffer).setUint16(10, 1, false);
    expectCodecError(
      () => decodeDorkCheckpointEnvelope(reserved),
      "nonzero-reserved",
    );

    const version = encodeDorkCheckpointEnvelope(createEnvelope());
    new DataView(version.buffer).setUint16(8, 1, false);
    expectCodecError(
      () => decodeDorkCheckpointEnvelope(version),
      "unsupported-version",
    );
  });

  it("rejects noncanonical RNG mode and reserved state bytes while decoding", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    const rngStateOffset = findSequence(
      encoded,
      [0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x80, 0x01, 0x00, 0x00],
    );

    const invalidMode = new Uint8Array(encoded);
    invalidMode[rngStateOffset + 10] = 2;
    expectCodecError(
      () => decodeDorkCheckpointEnvelope(invalidMode),
      "invalid-value",
    );

    const nonzeroReserved = new Uint8Array(encoded);
    nonzeroReserved[rngStateOffset + 11] = 1;
    expectCodecError(
      () => decodeDorkCheckpointEnvelope(nonzeroReserved),
      "nonzero-reserved",
    );
  });

  it("rejects an invalid magic value", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    encoded[0] = encoded[0]! ^ 1;

    expectCodecError(
      () => decodeDorkCheckpointEnvelope(encoded),
      "invalid-magic",
    );
  });

  it.each([
    ["runtime", "incompatible-runtime"],
    ["adapter", "incompatible-adapter"],
  ] as const)("rejects a %s identity mismatch", (identity, code) => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    let fieldOffset = DORK_CHECKPOINT_FIXED_HEADER_BYTES;
    if (identity === "adapter")
      fieldOffset = shortFieldOffset(encoded, fieldOffset);
    encoded[fieldOffset + 2] = encoded[fieldOffset + 2]! ^ 1;

    expectCodecError(() => decodeDorkCheckpointEnvelope(encoded), code);
  });

  it("uses fatal UTF-8 decoding for string fields", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    encoded[storyIdBytesOffset(encoded)] = 0xff;

    expectCodecError(
      () => decodeDorkCheckpointEnvelope(encoded),
      "invalid-utf8",
    );
  });

  it("rejects a count bomb before reading or allocating stack entries", () => {
    const encoded = encodeDorkCheckpointEnvelope(createEnvelope());
    new DataView(encoded.buffer).setUint32(
      dataStackCountOffset(encoded),
      0xffff_ffff,
      false,
    );

    expectCodecError(
      () => decodeDorkCheckpointEnvelope(encoded),
      "limit-exceeded",
    );
  });

  it("rejects oversized checkpoint input and oversized output fields", () => {
    expectCodecError(
      () =>
        decodeDorkCheckpointEnvelope(
          new Uint8Array(DORK_CHECKPOINT_MAX_TOTAL_BYTES + 1),
        ),
      "limit-exceeded",
    );

    const oversizedOutput = {
      ...createEnvelope(),
      lastOutput: "x".repeat(DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES + 1),
    };
    expectCodecError(
      () => encodeDorkCheckpointEnvelope(oversizedOutput),
      "limit-exceeded",
    );

    const corruptOutputLength = encodeDorkCheckpointEnvelope(createEnvelope());
    new DataView(corruptOutputLength.buffer).setUint32(
      lastOutputLengthOffset(corruptOutputLength),
      DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES + 1,
      false,
    );
    expectCodecError(
      () => decodeDorkCheckpointEnvelope(corruptOutputLength),
      "limit-exceeded",
    );
  });

  it("enforces story-id, frame, stack, local, and stream limits during encoding", () => {
    expectCodecError(
      () =>
        encodeDorkCheckpointEnvelope({
          ...createEnvelope(),
          storyId: "x".repeat(DORK_CHECKPOINT_MAX_STORY_ID_BYTES + 1),
        }),
      "limit-exceeded",
    );

    const frame = createEnvelope().machine.callStack[0]!;
    const frameOverflow = createEnvelope();
    expectCodecError(
      () =>
        encodeDorkCheckpointEnvelope(
          replaceMachine(frameOverflow, {
            ...frameOverflow.machine,
            callStack: Array.from(
              { length: DORK_CHECKPOINT_MAX_CALL_FRAMES + 1 },
              () => frame,
            ),
          }),
        ),
      "limit-exceeded",
    );

    const aggregateOverflow = createEnvelope();
    expectCodecError(
      () =>
        encodeDorkCheckpointEnvelope(
          replaceMachine(aggregateOverflow, {
            ...aggregateOverflow.machine,
            dataStack: new Array<number>(
              DORK_CHECKPOINT_MAX_TOTAL_STACK_WORDS + 1,
            ).fill(0),
          }),
        ),
      "limit-exceeded",
    );

    const frameStackOverflow = createEnvelope();
    expectCodecError(
      () =>
        encodeDorkCheckpointEnvelope(
          replaceMachine(frameStackOverflow, {
            ...frameStackOverflow.machine,
            callStack: [
              {
                ...frame,
                ds: new Array<number>(
                  DORK_CHECKPOINT_MAX_FRAME_STACK_WORDS + 1,
                ).fill(0),
              },
            ],
          }),
        ),
      "limit-exceeded",
    );

    const localOverflow = createEnvelope();
    expectCodecError(
      () =>
        encodeDorkCheckpointEnvelope(
          replaceMachine(localOverflow, {
            ...localOverflow.machine,
            callStack: [
              {
                ...frame,
                local: new Array<number>(DORK_CHECKPOINT_MAX_LOCALS + 1).fill(
                  0,
                ),
              },
            ],
          }),
        ),
      "limit-exceeded",
    );

    const streamOverflow = createEnvelope();
    expectCodecError(
      () =>
        encodeDorkCheckpointEnvelope(
          replaceMachine(streamOverflow, {
            ...streamOverflow.machine,
            stream3: Array.from(
              { length: DORK_CHECKPOINT_MAX_STREAM_DEPTH + 1 },
              () => ({ base: 80, cursor: 84 }),
            ),
          }),
        ),
      "limit-exceeded",
    );
  });

  it.each([
    ["unsafe revision", { revision: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative gameplay state", { machineField: "gameplayState", value: -1 }],
    [
      "oversized reseed state",
      { machineField: "reseedState", value: 0x1_0000_0000 },
    ],
    ["invalid RNG mode", { machineField: "rngMode", value: 2 }],
    ["oversized signed flags", { machineField: "savedFlags", value: 0x8000 }],
  ] as const)("rejects an invalid integer: %s", (_name, mutation) => {
    const envelope = createEnvelope();
    const candidate =
      "revision" in mutation
        ? { ...envelope, revision: mutation.revision }
        : replaceMachine(envelope, {
            ...envelope.machine,
            [mutation.machineField]: mutation.value,
          });

    expectCodecError(
      () => encodeDorkCheckpointEnvelope(candidate),
      "invalid-value",
    );
  });
});
