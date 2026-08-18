import type { ZMachineCheckpoint } from "../../vendor/dork/src/zmachine/machine.js";

export const DORK_CHECKPOINT_MAGIC = "ZVDORKCP";
export const DORK_CHECKPOINT_SCHEMA_VERSION = 2 as const;
export const DORK_CHECKPOINT_RUNTIME_ID =
  "dork-e5fce5ca678660611b5d2daa94bbffdb3a84e622-fork-a0a31ec97a78771229615c4311ea4209813e29a65df421f0e020b161447f1605" as const;
export const DORK_CHECKPOINT_ADAPTER_ID =
  "zork-voice-dork-checkpoint-v2" as const;
export const DORK_CHECKPOINT_WIRE_V2_GOLDEN_SHA256 =
  "79a7c7ff2a31ed69d2cd7045e91e84189e9fa967bab240424e6a8633c20471ba" as const;

export const DORK_CHECKPOINT_MAX_TOTAL_BYTES = 1024 * 1024;
export const DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES = 256 * 1024;
export const DORK_CHECKPOINT_MAX_STORY_ID_BYTES = 128;
export const DORK_CHECKPOINT_MAX_CALL_FRAMES = 1024;
export const DORK_CHECKPOINT_MAX_TOTAL_STACK_WORDS = 65_535;
export const DORK_CHECKPOINT_MAX_FRAME_STACK_WORDS = 4096;
export const DORK_CHECKPOINT_MAX_LOCALS = 15;
export const DORK_CHECKPOINT_MAX_STREAM_DEPTH = 16;

export const DORK_CHECKPOINT_FIXED_HEADER_BYTES = 16;

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffff_ffff;
const INT16_MIN = -0x8000;
const INT16_MAX = 0x7fff;
const MAX_SAFE_U64_HIGH_WORD = 0x001f_ffff;
const U32_FACTOR = 0x1_0000_0000;
const MAX_IDENTITY_BYTES = 128;
const SERIAL_BYTES = 6;
const MACHINE_SCHEMA_VERSION = 2;
const PENDING_READ_LINE = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const magicBytes = textEncoder.encode(DORK_CHECKPOINT_MAGIC);

export type DorkCheckpointCodecErrorCode =
  | "invalid-input"
  | "limit-exceeded"
  | "truncated"
  | "trailing-bytes"
  | "invalid-magic"
  | "unsupported-version"
  | "nonzero-reserved"
  | "invalid-total-length"
  | "invalid-utf8"
  | "incompatible-runtime"
  | "incompatible-adapter"
  | "invalid-value";

export class DorkCheckpointCodecError extends Error {
  public readonly code: DorkCheckpointCodecErrorCode;
  public readonly offset: number | undefined;

  public constructor(
    code: DorkCheckpointCodecErrorCode,
    message: string,
    offset?: number,
  ) {
    super(message);
    this.name = "DorkCheckpointCodecError";
    this.code = code;
    this.offset = offset;
  }
}

export interface DorkCheckpointEnvelope {
  readonly schemaVersion: typeof DORK_CHECKPOINT_SCHEMA_VERSION;
  readonly runtimeId: typeof DORK_CHECKPOINT_RUNTIME_ID;
  readonly adapterId: typeof DORK_CHECKPOINT_ADAPTER_ID;
  readonly storyId: string;
  readonly artifactSha256: string;
  readonly revision: number;
  readonly lastOutput: string;
  readonly machine: ZMachineCheckpoint;
}

interface PreparedEnvelope {
  readonly input: DorkCheckpointEnvelope;
  readonly runtimeId: Uint8Array;
  readonly adapterId: Uint8Array;
  readonly storyId: Uint8Array;
  readonly artifactSha256: Uint8Array;
  readonly lastOutput: Uint8Array;
  readonly serial: Uint8Array;
  readonly totalBytes: number;
}

function fail(
  code: DorkCheckpointCodecErrorCode,
  message: string,
  offset?: number,
): never {
  throw new DorkCheckpointCodecError(code, message, offset);
}

function requireObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    fail("invalid-input", `${field} must be an object`);
  }
}

function requireBoolean(
  value: unknown,
  field: string,
): asserts value is boolean {
  if (typeof value !== "boolean") {
    fail("invalid-value", `${field} must be a boolean`);
  }
}

function requireArray(
  value: unknown,
  field: string,
): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    fail("invalid-value", `${field} must be an array`);
  }
}

function requireIntegerRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(
      "invalid-value",
      `${field} must be a safe integer from ${minimum} through ${maximum}`,
    );
  }
}

function requireU16(value: unknown, field: string): asserts value is number {
  requireIntegerRange(value, 0, UINT16_MAX, field);
}

function requireU32(value: unknown, field: string): asserts value is number {
  requireIntegerRange(value, 0, UINT32_MAX, field);
}

function requireSafeUint(
  value: unknown,
  field: string,
): asserts value is number {
  requireIntegerRange(value, 0, Number.MAX_SAFE_INTEGER, field);
}

function requirePositiveSafeUint(
  value: unknown,
  field: string,
): asserts value is number {
  requireIntegerRange(value, 1, Number.MAX_SAFE_INTEGER, field);
}

function requireInt16(value: unknown, field: string): asserts value is number {
  requireIntegerRange(value, INT16_MIN, INT16_MAX, field);
}

function requireExactString(
  value: unknown,
  expected: string,
  field: string,
): void {
  if (value !== expected) {
    fail("invalid-value", `${field} must equal ${expected}`);
  }
}

function encodeBoundedUtf8(
  value: unknown,
  maximumBytes: number,
  field: string,
  allowEmpty = true,
): Uint8Array {
  if (typeof value !== "string") {
    fail("invalid-value", `${field} must be a string`);
  }
  if (!allowEmpty && value.length === 0) {
    fail("invalid-value", `${field} must not be empty`);
  }
  // UTF-8 cannot contain fewer bytes than UTF-16 code units. This cheap guard
  // avoids encoding an already-oversized attacker-controlled string.
  if (value.length > maximumBytes) {
    fail("limit-exceeded", `${field} exceeds its ${maximumBytes}-byte limit`);
  }
  const encoded = textEncoder.encode(value);
  if (encoded.byteLength > maximumBytes) {
    fail("limit-exceeded", `${field} exceeds its ${maximumBytes}-byte limit`);
  }
  // TextEncoder replaces unpaired UTF-16 surrogates. Refuse that lossy form so
  // encode/decode always preserves the caller's exact string.
  if (decodeFatalUtf8(encoded, field) !== value) {
    fail("invalid-value", `${field} contains an unpaired UTF-16 surrogate`);
  }
  return encoded;
}

function decodeFatalUtf8(bytes: Uint8Array, field: string): string {
  try {
    return fatalTextDecoder.decode(bytes);
  } catch {
    fail("invalid-utf8", `${field} is not valid UTF-8`);
  }
}

function hexToBytes(value: unknown, field: string): Uint8Array {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("invalid-value", `${field} must be a lowercase SHA-256 digest`);
  }
  const result = new Uint8Array(32);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function addSize(total: number, amount: number): number {
  const next = total + amount;
  if (!Number.isSafeInteger(next) || next > DORK_CHECKPOINT_MAX_TOTAL_BYTES) {
    fail(
      "limit-exceeded",
      `checkpoint exceeds the ${DORK_CHECKPOINT_MAX_TOTAL_BYTES}-byte limit`,
    );
  }
  return next;
}

function validateAddress(
  value: unknown,
  byteLength: number,
  field: string,
): void {
  requireU32(value, field);
  if (value >= byteLength) {
    fail("invalid-value", `${field} is outside the story image`);
  }
}

function prepareEnvelope(input: DorkCheckpointEnvelope): PreparedEnvelope {
  requireObject(input, "checkpoint envelope");
  if (input.schemaVersion !== DORK_CHECKPOINT_SCHEMA_VERSION) {
    fail("unsupported-version", "unsupported checkpoint envelope schema");
  }
  requireExactString(input.runtimeId, DORK_CHECKPOINT_RUNTIME_ID, "runtimeId");
  requireExactString(input.adapterId, DORK_CHECKPOINT_ADAPTER_ID, "adapterId");
  requireSafeUint(input.revision, "revision");

  const runtimeId = encodeBoundedUtf8(
    input.runtimeId,
    MAX_IDENTITY_BYTES,
    "runtimeId",
    false,
  );
  const adapterId = encodeBoundedUtf8(
    input.adapterId,
    MAX_IDENTITY_BYTES,
    "adapterId",
    false,
  );
  const storyId = encodeBoundedUtf8(
    input.storyId,
    DORK_CHECKPOINT_MAX_STORY_ID_BYTES,
    "storyId",
    false,
  );
  const artifactSha256 = hexToBytes(input.artifactSha256, "artifactSha256");
  const lastOutput = encodeBoundedUtf8(
    input.lastOutput,
    DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES,
    "lastOutput",
  );

  const machine = input.machine;
  requireObject(machine, "machine");
  if (machine.schemaVersion !== MACHINE_SCHEMA_VERSION) {
    fail("unsupported-version", "unsupported machine checkpoint schema");
  }

  const story = machine.story;
  requireObject(story, "machine.story");
  if (story.version !== 3) {
    fail("invalid-value", "machine.story.version must be 3");
  }
  requireBoolean(story.byteSwapped, "machine.story.byteSwapped");
  requireU16(story.release, "machine.story.release");
  const serial = encodeBoundedUtf8(
    story.serial,
    SERIAL_BYTES,
    "machine.story.serial",
  );
  if (
    serial.byteLength !== SERIAL_BYTES ||
    !serial.every((byte) => byte <= 0x7f)
  ) {
    fail(
      "invalid-value",
      "machine.story.serial must contain exactly six ASCII bytes",
    );
  }
  requireU16(story.checksum, "machine.story.checksum");
  requireU32(story.byteLength, "machine.story.byteLength");
  requireU16(story.staticMemoryBase, "machine.story.staticMemoryBase");
  if (story.byteLength < 64) {
    fail(
      "invalid-value",
      "machine.story.byteLength must contain a full header",
    );
  }
  if (
    story.staticMemoryBase < 64 ||
    story.staticMemoryBase > story.byteLength
  ) {
    fail(
      "invalid-value",
      "machine.story.staticMemoryBase is outside the story image",
    );
  }

  const config = machine.config;
  requireObject(config, "machine.config");
  requireBoolean(config.isTandy, "machine.config.isTandy");
  requireBoolean(config.strict, "machine.config.strict");
  if (config.maxInstructions !== null) {
    requirePositiveSafeUint(
      config.maxInstructions,
      "machine.config.maxInstructions",
    );
  }
  requirePositiveSafeUint(
    config.maxInstructionsPerTurn,
    "machine.config.maxInstructionsPerTurn",
  );
  requireU32(config.ioCapabilities, "machine.config.ioCapabilities");

  if (!(machine.dynamicMemory instanceof Uint8Array)) {
    fail("invalid-value", "machine.dynamicMemory must be a Uint8Array");
  }
  if (machine.dynamicMemory.byteLength !== story.staticMemoryBase) {
    fail(
      "invalid-value",
      "machine.dynamicMemory length must equal machine.story.staticMemoryBase",
    );
  }

  requireArray(machine.dataStack, "machine.dataStack");
  if (machine.dataStack.length > DORK_CHECKPOINT_MAX_TOTAL_STACK_WORDS) {
    fail(
      "limit-exceeded",
      "machine.dataStack exceeds the aggregate stack-word limit",
    );
  }
  let aggregateStackWords = machine.dataStack.length;
  machine.dataStack.forEach((word, index) =>
    requireInt16(word, `machine.dataStack[${index}]`),
  );

  requireArray(machine.callStack, "machine.callStack");
  if (machine.callStack.length > DORK_CHECKPOINT_MAX_CALL_FRAMES) {
    fail("limit-exceeded", "machine.callStack exceeds the frame limit");
  }
  machine.callStack.forEach((candidate, frameIndex) => {
    requireObject(candidate, `machine.callStack[${frameIndex}]`);
    validateAddress(
      candidate.pc,
      story.byteLength,
      `machine.callStack[${frameIndex}].pc`,
    );
    requireArray(candidate.local, `machine.callStack[${frameIndex}].local`);
    requireArray(candidate.ds, `machine.callStack[${frameIndex}].ds`);
    if (candidate.local.length > DORK_CHECKPOINT_MAX_LOCALS) {
      fail(
        "limit-exceeded",
        `machine.callStack[${frameIndex}].local exceeds the limit`,
      );
    }
    if (candidate.ds.length > DORK_CHECKPOINT_MAX_FRAME_STACK_WORDS) {
      fail(
        "limit-exceeded",
        `machine.callStack[${frameIndex}].ds exceeds the limit`,
      );
    }
    aggregateStackWords += candidate.local.length + candidate.ds.length;
    if (aggregateStackWords > DORK_CHECKPOINT_MAX_TOTAL_STACK_WORDS) {
      fail(
        "limit-exceeded",
        "machine stacks exceed the aggregate stack-word limit",
      );
    }
    candidate.local.forEach((word, wordIndex) =>
      requireInt16(
        word,
        `machine.callStack[${frameIndex}].local[${wordIndex}]`,
      ),
    );
    candidate.ds.forEach((word, wordIndex) =>
      requireInt16(word, `machine.callStack[${frameIndex}].ds[${wordIndex}]`),
    );
    requireBoolean(
      candidate.discardResult,
      `machine.callStack[${frameIndex}].discardResult`,
    );
    requireIntegerRange(
      candidate.argCount,
      0,
      7,
      `machine.callStack[${frameIndex}].argCount`,
    );
  });

  requireIntegerRange(machine.rngMode, 0, 1, "machine.rngMode");
  requireU32(machine.gameplayState, "machine.gameplayState");
  requireU32(machine.reseedState, "machine.reseedState");
  requireInt16(machine.savedFlags, "machine.savedFlags");
  const dynamicMemoryView = new DataView(
    machine.dynamicMemory.buffer,
    machine.dynamicMemory.byteOffset,
    machine.dynamicMemory.byteLength,
  );
  if (
    dynamicMemoryView.getInt16(16, story.byteSwapped) !== machine.savedFlags
  ) {
    fail(
      "invalid-value",
      "machine.savedFlags does not match machine.dynamicMemory",
    );
  }

  requireArray(machine.stream3, "machine.stream3");
  if (machine.stream3.length > DORK_CHECKPOINT_MAX_STREAM_DEPTH) {
    fail("limit-exceeded", "machine.stream3 exceeds the stream-depth limit");
  }
  machine.stream3.forEach((candidate, index) => {
    requireObject(candidate, `machine.stream3[${index}]`);
    requireU32(candidate.base, `machine.stream3[${index}].base`);
    requireU32(candidate.cursor, `machine.stream3[${index}].cursor`);
    if (
      candidate.base + 2 > machine.dynamicMemory.byteLength ||
      candidate.cursor < candidate.base + 2 ||
      candidate.cursor > machine.dynamicMemory.byteLength
    ) {
      fail(
        "invalid-value",
        `machine.stream3[${index}] is outside dynamic memory`,
      );
    }
  });

  requireSafeUint(machine.instructionCount, "machine.instructionCount");
  requireSafeUint(machine.turnInstructionCount, "machine.turnInstructionCount");
  if (
    config.maxInstructions !== null &&
    machine.turnInstructionCount > machine.instructionCount
  ) {
    fail(
      "invalid-value",
      "machine.turnInstructionCount exceeds instructionCount",
    );
  }
  if (
    config.maxInstructions !== null &&
    machine.instructionCount > config.maxInstructions
  ) {
    fail(
      "invalid-value",
      "machine.instructionCount exceeds its configured limit",
    );
  }
  if (machine.turnInstructionCount > config.maxInstructionsPerTurn) {
    fail(
      "invalid-value",
      "machine.turnInstructionCount exceeds its configured limit",
    );
  }

  const pendingRead = machine.pendingRead;
  requireObject(pendingRead, "machine.pendingRead");
  if (pendingRead.kind !== "line") {
    fail("invalid-value", "machine.pendingRead.kind must be line");
  }
  validateAddress(
    pendingRead.instructionPc,
    story.byteLength,
    "machine.pendingRead.instructionPc",
  );
  validateAddress(
    pendingRead.continuationPc,
    story.byteLength,
    "machine.pendingRead.continuationPc",
  );
  validateAddress(
    pendingRead.textBuffer,
    machine.dynamicMemory.byteLength,
    "machine.pendingRead.textBuffer",
  );
  validateAddress(
    pendingRead.parseBuffer,
    machine.dynamicMemory.byteLength,
    "machine.pendingRead.parseBuffer",
  );
  if (pendingRead.parseBuffer === 0) {
    fail("invalid-value", "machine.pendingRead.parseBuffer must not be zero");
  }
  requireIntegerRange(
    pendingRead.maxLength,
    1,
    0xff,
    "machine.pendingRead.maxLength",
  );
  if (
    pendingRead.continuationPc <= pendingRead.instructionPc ||
    (pendingRead.instructionPc < machine.dynamicMemory.byteLength &&
      machine.dynamicMemory[pendingRead.instructionPc] !== 228)
  ) {
    fail(
      "invalid-value",
      "machine.pendingRead instruction metadata is invalid",
    );
  }
  if (machine.dynamicMemory[pendingRead.textBuffer] !== pendingRead.maxLength) {
    fail(
      "invalid-value",
      "machine.pendingRead.maxLength does not match machine.dynamicMemory",
    );
  }
  if (
    pendingRead.textBuffer + pendingRead.maxLength + 1 >
    machine.dynamicMemory.byteLength
  ) {
    fail(
      "invalid-value",
      "machine.pendingRead text buffer exceeds dynamic memory",
    );
  }
  const maximumTokens = machine.dynamicMemory[pendingRead.parseBuffer]!;
  if (
    pendingRead.parseBuffer + 2 + maximumTokens * 4 >
    machine.dynamicMemory.byteLength
  ) {
    fail(
      "invalid-value",
      "machine.pendingRead parse buffer exceeds dynamic memory",
    );
  }

  let totalBytes = DORK_CHECKPOINT_FIXED_HEADER_BYTES;
  totalBytes = addSize(totalBytes, 2 + runtimeId.byteLength);
  totalBytes = addSize(totalBytes, 2 + adapterId.byteLength);
  totalBytes = addSize(totalBytes, 2 + storyId.byteLength);
  totalBytes = addSize(totalBytes, artifactSha256.byteLength + 8);
  totalBytes = addSize(totalBytes, 4 + lastOutput.byteLength);
  totalBytes = addSize(totalBytes, 4);
  totalBytes = addSize(totalBytes, 16 + serial.byteLength);
  totalBytes = addSize(totalBytes, 24);
  totalBytes = addSize(totalBytes, 4 + machine.dynamicMemory.byteLength);
  totalBytes = addSize(totalBytes, 4 + machine.dataStack.length * 2);
  totalBytes = addSize(totalBytes, 4);
  for (const frame of machine.callStack) {
    totalBytes = addSize(
      totalBytes,
      12 + (frame.local.length + frame.ds.length) * 2,
    );
  }
  totalBytes = addSize(totalBytes, 12);
  totalBytes = addSize(totalBytes, 4 + machine.stream3.length * 8);
  totalBytes = addSize(totalBytes, 16);
  totalBytes = addSize(totalBytes, 24);

  return {
    input,
    runtimeId,
    adapterId,
    storyId,
    artifactSha256,
    lastOutput,
    serial,
    totalBytes,
  };
}

class BinaryWriter {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  public constructor(byteLength: number) {
    this.#bytes = new Uint8Array(byteLength);
    this.#view = new DataView(this.#bytes.buffer);
  }

  public get offset(): number {
    return this.#offset;
  }

  public finish(): Uint8Array {
    if (this.#offset !== this.#bytes.byteLength) {
      fail("invalid-input", "internal checkpoint size mismatch");
    }
    return this.#bytes;
  }

  public bytes(value: Uint8Array): void {
    this.#bytes.set(value, this.#offset);
    this.#offset += value.byteLength;
  }

  public u8(value: number): void {
    this.#view.setUint8(this.#offset, value);
    this.#offset += 1;
  }

  public i16(value: number): void {
    this.#view.setInt16(this.#offset, value, false);
    this.#offset += 2;
  }

  public u16(value: number): void {
    this.#view.setUint16(this.#offset, value, false);
    this.#offset += 2;
  }

  public u32(value: number): void {
    this.#view.setUint32(this.#offset, value, false);
    this.#offset += 4;
  }

  public u64(value: number): void {
    const high = Math.floor(value / U32_FACTOR);
    const low = value - high * U32_FACTOR;
    this.u32(high);
    this.u32(low);
  }

  public shortBytes(value: Uint8Array): void {
    this.u16(value.byteLength);
    this.bytes(value);
  }
}

export function encodeDorkCheckpointEnvelope(
  input: DorkCheckpointEnvelope,
): Uint8Array {
  const prepared = prepareEnvelope(input);
  const { machine } = input;
  const writer = new BinaryWriter(prepared.totalBytes);

  writer.bytes(magicBytes);
  writer.u16(DORK_CHECKPOINT_SCHEMA_VERSION);
  writer.u16(0);
  writer.u32(prepared.totalBytes);
  writer.shortBytes(prepared.runtimeId);
  writer.shortBytes(prepared.adapterId);
  writer.shortBytes(prepared.storyId);
  writer.bytes(prepared.artifactSha256);
  writer.u64(input.revision);
  writer.u32(prepared.lastOutput.byteLength);
  writer.bytes(prepared.lastOutput);

  writer.u16(MACHINE_SCHEMA_VERSION);
  writer.u16(0);
  writer.u8(machine.story.version);
  writer.u8(machine.story.byteSwapped ? 1 : 0);
  writer.u16(machine.story.release);
  writer.u8(prepared.serial.byteLength);
  writer.u8(0);
  writer.u16(machine.story.checksum);
  writer.u32(machine.story.byteLength);
  writer.u32(machine.story.staticMemoryBase);
  writer.bytes(prepared.serial);

  writer.u8(machine.config.isTandy ? 1 : 0);
  writer.u8(machine.config.strict ? 1 : 0);
  writer.u8(machine.config.maxInstructions === null ? 0 : 1);
  writer.u8(0);
  writer.u64(machine.config.maxInstructions ?? 0);
  writer.u64(machine.config.maxInstructionsPerTurn);
  writer.u32(machine.config.ioCapabilities);

  writer.u32(machine.dynamicMemory.byteLength);
  writer.bytes(machine.dynamicMemory);
  writer.u32(machine.dataStack.length);
  for (const word of machine.dataStack) writer.i16(word);
  writer.u32(machine.callStack.length);
  for (const frame of machine.callStack) {
    writer.u32(frame.pc);
    writer.u8(frame.local.length);
    writer.u8(frame.discardResult ? 1 : 0);
    writer.u8(frame.argCount);
    writer.u8(0);
    writer.u32(frame.ds.length);
    for (const word of frame.local) writer.i16(word);
    for (const word of frame.ds) writer.i16(word);
  }

  writer.u32(machine.gameplayState);
  writer.u32(machine.reseedState);
  writer.i16(machine.savedFlags);
  writer.u8(machine.rngMode);
  writer.u8(0);
  writer.u32(machine.stream3.length);
  for (const stream of machine.stream3) {
    writer.u32(stream.base);
    writer.u32(stream.cursor);
  }
  writer.u64(machine.instructionCount);
  writer.u64(machine.turnInstructionCount);

  writer.u8(PENDING_READ_LINE);
  writer.u8(0);
  writer.u16(0);
  writer.u32(machine.pendingRead.instructionPc);
  writer.u32(machine.pendingRead.continuationPc);
  writer.u32(machine.pendingRead.textBuffer);
  writer.u32(machine.pendingRead.parseBuffer);
  writer.u32(machine.pendingRead.maxLength);

  return writer.finish();
}

class BinaryReader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  public constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public get offset(): number {
    return this.#offset;
  }

  public get remaining(): number {
    return this.#bytes.byteLength - this.#offset;
  }

  #require(byteLength: number): void {
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > this.remaining
    ) {
      fail(
        "truncated",
        "checkpoint ends before a declared field is complete",
        this.#offset,
      );
    }
  }

  public bytes(byteLength: number): Uint8Array {
    this.#require(byteLength);
    const result = this.#bytes.subarray(
      this.#offset,
      this.#offset + byteLength,
    );
    this.#offset += byteLength;
    return result;
  }

  public u8(): number {
    this.#require(1);
    const result = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return result;
  }

  public i16(): number {
    this.#require(2);
    const result = this.#view.getInt16(this.#offset, false);
    this.#offset += 2;
    return result;
  }

  public u16(): number {
    this.#require(2);
    const result = this.#view.getUint16(this.#offset, false);
    this.#offset += 2;
    return result;
  }

  public u32(): number {
    this.#require(4);
    const result = this.#view.getUint32(this.#offset, false);
    this.#offset += 4;
    return result;
  }

  public safeU64(field: string): number {
    const offset = this.#offset;
    const high = this.u32();
    const low = this.u32();
    if (high > MAX_SAFE_U64_HIGH_WORD) {
      fail("invalid-value", `${field} exceeds Number.MAX_SAFE_INTEGER`, offset);
    }
    return high * U32_FACTOR + low;
  }
}

function readBoolean(reader: BinaryReader, field: string): boolean {
  const offset = reader.offset;
  const value = reader.u8();
  if (value !== 0 && value !== 1) {
    fail("invalid-value", `${field} is not a canonical boolean`, offset);
  }
  return value === 1;
}

function readReservedU8(reader: BinaryReader, field: string): void {
  const offset = reader.offset;
  if (reader.u8() !== 0)
    fail("nonzero-reserved", `${field} must be zero`, offset);
}

function readReservedU16(reader: BinaryReader, field: string): void {
  const offset = reader.offset;
  if (reader.u16() !== 0)
    fail("nonzero-reserved", `${field} must be zero`, offset);
}

function readBoundedUtf8(
  reader: BinaryReader,
  byteLength: number,
  maximumBytes: number,
  field: string,
  allowEmpty = true,
): string {
  if (byteLength > maximumBytes) {
    fail(
      "limit-exceeded",
      `${field} exceeds its ${maximumBytes}-byte limit`,
      reader.offset,
    );
  }
  if (!allowEmpty && byteLength === 0) {
    fail("invalid-value", `${field} must not be empty`, reader.offset);
  }
  return decodeFatalUtf8(reader.bytes(byteLength), field);
}

function readShortUtf8(
  reader: BinaryReader,
  maximumBytes: number,
  field: string,
  allowEmpty = true,
): string {
  return readBoundedUtf8(reader, reader.u16(), maximumBytes, field, allowEmpty);
}

function assertMagic(actual: Uint8Array): void {
  if (
    actual.byteLength !== magicBytes.byteLength ||
    !actual.every((byte, index) => byte === magicBytes[index])
  ) {
    fail("invalid-magic", "checkpoint magic does not match", 0);
  }
}

function assertAddress(
  value: number,
  byteLength: number,
  field: string,
  offset: number,
): void {
  if (value >= byteLength) {
    fail("invalid-value", `${field} is outside the story image`, offset);
  }
}

function parseEnvelope(
  bytes: Uint8Array,
  materialize: boolean,
): DorkCheckpointEnvelope | undefined {
  const reader = new BinaryReader(bytes);
  assertMagic(reader.bytes(magicBytes.byteLength));
  const schemaOffset = reader.offset;
  if (reader.u16() !== DORK_CHECKPOINT_SCHEMA_VERSION) {
    fail(
      "unsupported-version",
      "unsupported checkpoint envelope schema",
      schemaOffset,
    );
  }
  readReservedU16(reader, "envelope reserved field");
  const declaredTotalOffset = reader.offset;
  const declaredTotal = reader.u32();
  if (declaredTotal !== bytes.byteLength) {
    fail(
      "invalid-total-length",
      `declared checkpoint length ${declaredTotal} does not match ${bytes.byteLength}`,
      declaredTotalOffset,
    );
  }

  const runtimeOffset = reader.offset;
  const runtimeId = readShortUtf8(
    reader,
    MAX_IDENTITY_BYTES,
    "runtimeId",
    false,
  );
  if (runtimeId !== DORK_CHECKPOINT_RUNTIME_ID) {
    fail(
      "incompatible-runtime",
      "checkpoint runtimeId is incompatible",
      runtimeOffset,
    );
  }
  const adapterOffset = reader.offset;
  const adapterId = readShortUtf8(
    reader,
    MAX_IDENTITY_BYTES,
    "adapterId",
    false,
  );
  if (adapterId !== DORK_CHECKPOINT_ADAPTER_ID) {
    fail(
      "incompatible-adapter",
      "checkpoint adapterId is incompatible",
      adapterOffset,
    );
  }
  const storyId = readShortUtf8(
    reader,
    DORK_CHECKPOINT_MAX_STORY_ID_BYTES,
    "storyId",
    false,
  );
  const artifactSha256 = bytesToHex(reader.bytes(32));
  const revision = reader.safeU64("revision");
  const lastOutputLength = reader.u32();
  const lastOutput = readBoundedUtf8(
    reader,
    lastOutputLength,
    DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES,
    "lastOutput",
  );

  const machineSchemaOffset = reader.offset;
  if (reader.u16() !== MACHINE_SCHEMA_VERSION) {
    fail(
      "unsupported-version",
      "unsupported machine checkpoint schema",
      machineSchemaOffset,
    );
  }
  readReservedU16(reader, "machine schema reserved field");
  const storyVersionOffset = reader.offset;
  const storyVersion = reader.u8();
  if (storyVersion !== 3) {
    fail(
      "invalid-value",
      "machine story version must be 3",
      storyVersionOffset,
    );
  }
  const byteSwapped = readBoolean(reader, "machine.story.byteSwapped");
  const release = reader.u16();
  const serialLength = reader.u8();
  readReservedU8(reader, "story reserved field");
  const checksum = reader.u16();
  const byteLength = reader.u32();
  const staticMemoryBase = reader.u32();
  if (byteLength < 64) {
    fail(
      "invalid-value",
      "machine.story.byteLength must contain a full header",
    );
  }
  if (
    staticMemoryBase < 64 ||
    staticMemoryBase > UINT16_MAX ||
    staticMemoryBase > byteLength
  ) {
    fail(
      "invalid-value",
      "machine.story.staticMemoryBase is outside the story image",
    );
  }
  const serial = readBoundedUtf8(
    reader,
    serialLength,
    SERIAL_BYTES,
    "machine.story.serial",
  );
  if (
    serialLength !== SERIAL_BYTES ||
    serial.length !== SERIAL_BYTES ||
    ![...serial].every((character) => character.charCodeAt(0) <= 0x7f)
  ) {
    fail(
      "invalid-value",
      "machine.story.serial must contain exactly six ASCII bytes",
    );
  }

  const isTandy = readBoolean(reader, "machine.config.isTandy");
  const strict = readBoolean(reader, "machine.config.strict");
  const maxInstructionsOffset = reader.offset;
  const hasMaxInstructions = reader.u8();
  if (hasMaxInstructions !== 0 && hasMaxInstructions !== 1) {
    fail(
      "invalid-value",
      "machine.config.maxInstructions marker is invalid",
      maxInstructionsOffset,
    );
  }
  readReservedU8(reader, "config reserved field");
  const encodedMaxInstructions = reader.safeU64(
    "machine.config.maxInstructions",
  );
  if (hasMaxInstructions === 0 && encodedMaxInstructions !== 0) {
    fail("invalid-value", "null maxInstructions must use a zero payload");
  }
  if (hasMaxInstructions === 1 && encodedMaxInstructions < 1) {
    fail("invalid-value", "finite maxInstructions must be positive");
  }
  const maxInstructions =
    hasMaxInstructions === 1 ? encodedMaxInstructions : null;
  const maxInstructionsPerTurn = reader.safeU64(
    "machine.config.maxInstructionsPerTurn",
  );
  if (maxInstructionsPerTurn < 1) {
    fail(
      "invalid-value",
      "machine.config.maxInstructionsPerTurn must be positive",
    );
  }
  const ioCapabilities = reader.u32();

  const dynamicMemoryLengthOffset = reader.offset;
  const dynamicMemoryLength = reader.u32();
  if (dynamicMemoryLength !== staticMemoryBase) {
    fail(
      "invalid-value",
      "machine.dynamicMemory length must equal machine.story.staticMemoryBase",
      dynamicMemoryLengthOffset,
    );
  }
  if (dynamicMemoryLength > DORK_CHECKPOINT_MAX_TOTAL_BYTES) {
    fail(
      "limit-exceeded",
      "machine.dynamicMemory exceeds the checkpoint limit",
    );
  }
  const dynamicMemoryView = reader.bytes(dynamicMemoryLength);

  let aggregateStackWords = 0;
  const dataStackCountOffset = reader.offset;
  const dataStackCount = reader.u32();
  if (dataStackCount > DORK_CHECKPOINT_MAX_TOTAL_STACK_WORDS) {
    fail(
      "limit-exceeded",
      "machine.dataStack exceeds the aggregate limit",
      dataStackCountOffset,
    );
  }
  aggregateStackWords += dataStackCount;
  const dataStack = materialize ? new Array<number>(dataStackCount) : undefined;
  for (let index = 0; index < dataStackCount; index += 1) {
    const word = reader.i16();
    if (dataStack !== undefined) dataStack[index] = word;
  }

  const callStackCountOffset = reader.offset;
  const callStackCount = reader.u32();
  if (callStackCount > DORK_CHECKPOINT_MAX_CALL_FRAMES) {
    fail(
      "limit-exceeded",
      "machine.callStack exceeds the frame limit",
      callStackCountOffset,
    );
  }
  const callStack = materialize
    ? new Array<ZMachineCheckpoint["callStack"][number]>(callStackCount)
    : undefined;
  for (let frameIndex = 0; frameIndex < callStackCount; frameIndex += 1) {
    const pcOffset = reader.offset;
    const pc = reader.u32();
    assertAddress(
      pc,
      byteLength,
      `machine.callStack[${frameIndex}].pc`,
      pcOffset,
    );
    const localCountOffset = reader.offset;
    const localCount = reader.u8();
    if (localCount > DORK_CHECKPOINT_MAX_LOCALS) {
      fail(
        "limit-exceeded",
        `machine.callStack[${frameIndex}].local exceeds the limit`,
        localCountOffset,
      );
    }
    const discardResult = readBoolean(
      reader,
      `machine.callStack[${frameIndex}].discardResult`,
    );
    const argCountOffset = reader.offset;
    const argCount = reader.u8();
    if (argCount > 7) {
      fail(
        "invalid-value",
        `machine.callStack[${frameIndex}].argCount exceeds 7`,
        argCountOffset,
      );
    }
    readReservedU8(reader, `machine.callStack[${frameIndex}] reserved field`);
    const frameStackCountOffset = reader.offset;
    const frameStackCount = reader.u32();
    if (frameStackCount > DORK_CHECKPOINT_MAX_FRAME_STACK_WORDS) {
      fail(
        "limit-exceeded",
        `machine.callStack[${frameIndex}].ds exceeds the limit`,
        frameStackCountOffset,
      );
    }
    aggregateStackWords += localCount + frameStackCount;
    if (aggregateStackWords > DORK_CHECKPOINT_MAX_TOTAL_STACK_WORDS) {
      fail(
        "limit-exceeded",
        "machine stacks exceed the aggregate stack-word limit",
      );
    }
    const local = materialize ? new Array<number>(localCount) : undefined;
    const ds = materialize ? new Array<number>(frameStackCount) : undefined;
    for (let index = 0; index < localCount; index += 1) {
      const word = reader.i16();
      if (local !== undefined) local[index] = word;
    }
    for (let index = 0; index < frameStackCount; index += 1) {
      const word = reader.i16();
      if (ds !== undefined) ds[index] = word;
    }
    if (callStack !== undefined && local !== undefined && ds !== undefined) {
      callStack[frameIndex] = { pc, local, ds, discardResult, argCount };
    }
  }

  const gameplayState = reader.u32();
  const reseedState = reader.u32();
  const savedFlags = reader.i16();
  const rngModeOffset = reader.offset;
  const rngMode = reader.u8();
  if (rngMode !== 0 && rngMode !== 1) {
    fail("invalid-value", "machine.rngMode is invalid", rngModeOffset);
  }
  readReservedU8(reader, "machine state reserved field");
  const checkpointMemoryView = new DataView(
    dynamicMemoryView.buffer,
    dynamicMemoryView.byteOffset,
    dynamicMemoryView.byteLength,
  );
  if (checkpointMemoryView.getInt16(16, byteSwapped) !== savedFlags) {
    fail(
      "invalid-value",
      "machine.savedFlags does not match machine.dynamicMemory",
    );
  }
  const streamCountOffset = reader.offset;
  const streamCount = reader.u32();
  if (streamCount > DORK_CHECKPOINT_MAX_STREAM_DEPTH) {
    fail(
      "limit-exceeded",
      "machine.stream3 exceeds the depth limit",
      streamCountOffset,
    );
  }
  const stream3 = materialize
    ? new Array<ZMachineCheckpoint["stream3"][number]>(streamCount)
    : undefined;
  for (let index = 0; index < streamCount; index += 1) {
    const base = reader.u32();
    const cursor = reader.u32();
    if (
      base + 2 > dynamicMemoryLength ||
      cursor < base + 2 ||
      cursor > dynamicMemoryLength
    ) {
      fail(
        "invalid-value",
        `machine.stream3[${index}] is outside dynamic memory`,
      );
    }
    if (stream3 !== undefined) stream3[index] = { base, cursor };
  }

  const instructionCount = reader.safeU64("machine.instructionCount");
  const turnInstructionCount = reader.safeU64("machine.turnInstructionCount");
  if (maxInstructions !== null && turnInstructionCount > instructionCount) {
    fail(
      "invalid-value",
      "machine.turnInstructionCount exceeds instructionCount",
    );
  }
  if (maxInstructions !== null && instructionCount > maxInstructions) {
    fail(
      "invalid-value",
      "machine.instructionCount exceeds its configured limit",
    );
  }
  if (turnInstructionCount > maxInstructionsPerTurn) {
    fail(
      "invalid-value",
      "machine.turnInstructionCount exceeds its configured limit",
    );
  }

  const pendingKindOffset = reader.offset;
  if (reader.u8() !== PENDING_READ_LINE) {
    fail(
      "invalid-value",
      "machine.pendingRead kind is invalid",
      pendingKindOffset,
    );
  }
  readReservedU8(reader, "pending-read reserved byte");
  readReservedU16(reader, "pending-read reserved word");
  const instructionPcOffset = reader.offset;
  const instructionPc = reader.u32();
  assertAddress(
    instructionPc,
    byteLength,
    "machine.pendingRead.instructionPc",
    instructionPcOffset,
  );
  const continuationPcOffset = reader.offset;
  const continuationPc = reader.u32();
  assertAddress(
    continuationPc,
    byteLength,
    "machine.pendingRead.continuationPc",
    continuationPcOffset,
  );
  if (continuationPc <= instructionPc) {
    fail(
      "invalid-value",
      "machine.pendingRead continuation must follow its instruction",
      continuationPcOffset,
    );
  }
  const textBufferOffset = reader.offset;
  const textBuffer = reader.u32();
  assertAddress(
    textBuffer,
    dynamicMemoryLength,
    "machine.pendingRead.textBuffer",
    textBufferOffset,
  );
  const parseBufferOffset = reader.offset;
  const parseBuffer = reader.u32();
  assertAddress(
    parseBuffer,
    dynamicMemoryLength,
    "machine.pendingRead.parseBuffer",
    parseBufferOffset,
  );
  if (parseBuffer === 0) {
    fail(
      "invalid-value",
      "machine.pendingRead.parseBuffer must not be zero",
      parseBufferOffset,
    );
  }
  const maxLengthOffset = reader.offset;
  const maxLength = reader.u32();
  if (maxLength < 1 || maxLength > 0xff) {
    fail(
      "invalid-value",
      "machine.pendingRead.maxLength is invalid",
      maxLengthOffset,
    );
  }
  if (
    instructionPc < dynamicMemoryLength &&
    dynamicMemoryView[instructionPc] !== 228
  ) {
    fail(
      "invalid-value",
      "machine.pendingRead instruction is not a V3 READ",
      instructionPcOffset,
    );
  }
  if (dynamicMemoryView[textBuffer] !== maxLength) {
    fail(
      "invalid-value",
      "machine.pendingRead.maxLength does not match machine.dynamicMemory",
      maxLengthOffset,
    );
  }
  if (textBuffer + maxLength + 1 > dynamicMemoryLength) {
    fail(
      "invalid-value",
      "machine.pendingRead text buffer exceeds dynamic memory",
    );
  }
  const maximumTokens = dynamicMemoryView[parseBuffer]!;
  if (parseBuffer + 2 + maximumTokens * 4 > dynamicMemoryLength) {
    fail(
      "invalid-value",
      "machine.pendingRead parse buffer exceeds dynamic memory",
      parseBufferOffset,
    );
  }

  if (reader.remaining !== 0) {
    fail("trailing-bytes", "checkpoint contains trailing bytes", reader.offset);
  }
  if (!materialize) return undefined;
  if (
    dataStack === undefined ||
    callStack === undefined ||
    stream3 === undefined
  ) {
    fail("invalid-input", "internal checkpoint materialization failed");
  }

  return {
    schemaVersion: DORK_CHECKPOINT_SCHEMA_VERSION,
    runtimeId: DORK_CHECKPOINT_RUNTIME_ID,
    adapterId: DORK_CHECKPOINT_ADAPTER_ID,
    storyId,
    artifactSha256,
    revision,
    lastOutput,
    machine: {
      schemaVersion: 2,
      story: {
        version: 3,
        byteSwapped,
        release,
        serial,
        checksum,
        byteLength,
        staticMemoryBase,
      },
      config: {
        isTandy,
        strict,
        maxInstructions,
        maxInstructionsPerTurn,
        ioCapabilities,
      },
      dynamicMemory: new Uint8Array(dynamicMemoryView),
      dataStack,
      callStack,
      rngMode,
      gameplayState,
      reseedState,
      savedFlags,
      stream3,
      instructionCount,
      turnInstructionCount,
      pendingRead: {
        kind: "line",
        instructionPc,
        continuationPc,
        textBuffer,
        parseBuffer,
        maxLength,
      },
    },
  };
}

export function decodeDorkCheckpointEnvelope(
  input: Uint8Array,
): DorkCheckpointEnvelope {
  if (!(input instanceof Uint8Array)) {
    fail("invalid-input", "checkpoint bytes must be a Uint8Array");
  }
  if (input.byteLength > DORK_CHECKPOINT_MAX_TOTAL_BYTES) {
    fail(
      "limit-exceeded",
      `checkpoint exceeds the ${DORK_CHECKPOINT_MAX_TOTAL_BYTES}-byte limit`,
    );
  }
  if (input.byteLength < DORK_CHECKPOINT_FIXED_HEADER_BYTES) {
    fail(
      "truncated",
      "checkpoint is shorter than its fixed header",
      input.byteLength,
    );
  }

  // Copy the caller's bytes once before inspecting them. This detaches the
  // validation pass from mutable/SharedArrayBuffer-backed input. The first pass
  // validates every length, count, value, reserved field, and trailing byte.
  // Only the second pass allocates stack arrays and copies dynamic memory.
  const bytes = new Uint8Array(input);
  parseEnvelope(bytes, false);
  const result = parseEnvelope(bytes, true);
  if (result === undefined) fail("invalid-input", "checkpoint decoding failed");
  return result;
}
