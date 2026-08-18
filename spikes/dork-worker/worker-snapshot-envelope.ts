import {
  MAX_CANONICAL_COMMAND_LENGTH,
  MAX_ENGINE_SNAPSHOT_BYTES,
  canonicalizeCommand,
  type CanonicalCommand,
  type EngineTurnBoundary,
  type ExecuteResult,
} from "../../packages/contracts/src/index.js";

import {
  DORK_CHECKPOINT_FIXED_HEADER_BYTES,
  DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES,
  DORK_CHECKPOINT_MAX_TOTAL_BYTES,
} from "./checkpoint-envelope.js";

export const WORKER_SNAPSHOT_MAGIC = "ZVDORKWS";
export const WORKER_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const WORKER_SNAPSHOT_MAX_TOTAL_BYTES = MAX_ENGINE_SNAPSHOT_BYTES;
export const WORKER_SNAPSHOT_MAX_INNER_CHECKPOINT_BYTES =
  DORK_CHECKPOINT_MAX_TOTAL_BYTES;
export const WORKER_SNAPSHOT_MAX_LAST_OUTPUT_BYTES =
  DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES;
export const WORKER_SNAPSHOT_MAX_RESULT_OUTPUT_BYTES =
  DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES;
export const WORKER_SNAPSHOT_MAX_REQUEST_ID_BYTES = 128;
export const WORKER_SNAPSHOT_MAX_COMMAND_LENGTH = MAX_CANONICAL_COMMAND_LENGTH;
export const WORKER_SNAPSHOT_MAX_COMMAND_BYTES =
  WORKER_SNAPSHOT_MAX_COMMAND_LENGTH * 4;
export const WORKER_SNAPSHOT_MAX_RECEIPTS = 32;
export const WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES = 1024 * 1024;

export const WORKER_SNAPSHOT_FIXED_HEADER_BYTES = 16;
export const WORKER_SNAPSHOT_FIXED_BODY_BYTES = 28;
export const WORKER_SNAPSHOT_RECEIPT_FIXED_BYTES = 40;
export const WORKER_SNAPSHOT_RECEIPT_LENGTH_PREFIX_BYTES = 4;

const UINT32_FACTOR = 0x1_0000_0000;
const MAX_SAFE_U64_HIGH_WORD = 0x001f_ffff;
const BOUNDARY_INPUT_REQUESTED = 1;
const BOUNDARY_TERMINATED = 2;
const STATUS_COMMITTED = 1;
const STATUS_REJECTED = 2;
const REJECTION_NONE = 0;
const REJECTION_STALE_REVISION = 1;
const REJECTION_DUPLICATE = 2;
const REJECTION_INVALID_COMMAND = 3;
const REJECTION_RECEIPT_CAPACITY = 4;

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const magicBytes = textEncoder.encode(WORKER_SNAPSHOT_MAGIC);

const ENVELOPE_KEYS = [
  "schemaVersion",
  "revision",
  "lastOutput",
  "boundary",
  "innerCheckpoint",
  "receipts",
] as const;
const RECEIPT_KEYS = [
  "requestId",
  "expectedRevision",
  "command",
  "result",
] as const;
const COMMITTED_RESULT_KEYS = [
  "requestId",
  "previousRevision",
  "revision",
  "command",
  "output",
  "turnComplete",
  "boundary",
  "status",
] as const;
const REJECTED_RESULT_KEYS = [...COMMITTED_RESULT_KEYS, "rejection"] as const;

export type WorkerSnapshotCodecErrorCode =
  | "invalid-input"
  | "limit-exceeded"
  | "truncated"
  | "trailing-bytes"
  | "invalid-magic"
  | "unsupported-version"
  | "nonzero-reserved"
  | "invalid-total-length"
  | "invalid-utf8"
  | "noncanonical"
  | "duplicate-request-id"
  | "invalid-value";

export class WorkerSnapshotCodecError extends Error {
  public readonly code: WorkerSnapshotCodecErrorCode;
  public readonly offset: number | undefined;

  public constructor(
    code: WorkerSnapshotCodecErrorCode,
    message: string,
    offset?: number,
  ) {
    super(message);
    this.name = "WorkerSnapshotCodecError";
    this.code = code;
    this.offset = offset;
  }
}

export interface WorkerSnapshotReceipt {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly command: CanonicalCommand;
  readonly result: ExecuteResult;
}

export interface WorkerSnapshotEnvelope {
  readonly schemaVersion: typeof WORKER_SNAPSHOT_SCHEMA_VERSION;
  readonly revision: number;
  readonly lastOutput: string;
  readonly boundary: EngineTurnBoundary;
  readonly innerCheckpoint: Uint8Array;
  /** Oldest-to-newest receipt insertion order. */
  readonly receipts: readonly WorkerSnapshotReceipt[];
}

interface PreparedCommand {
  readonly value: CanonicalCommand;
  readonly bytes: Uint8Array;
}

interface PreparedExecuteResult {
  readonly value: ExecuteResult;
  readonly requestIdBytes: Uint8Array;
  readonly commandBytes: Uint8Array;
  readonly outputBytes: Uint8Array;
  readonly boundaryMarker: number;
  readonly statusMarker: number;
  readonly rejectionMarker: number;
}

interface PreparedReceipt {
  readonly value: WorkerSnapshotReceipt;
  readonly requestIdBytes: Uint8Array;
  readonly commandBytes: Uint8Array;
  readonly result: PreparedExecuteResult;
  readonly payloadBytes: number;
  readonly encodedBytes: number;
}

interface PreparedEnvelope {
  readonly value: WorkerSnapshotEnvelope;
  readonly lastOutputBytes: Uint8Array;
  readonly innerCheckpoint: Uint8Array;
  readonly receipts: readonly PreparedReceipt[];
  readonly journalBytes: number;
  readonly boundaryMarker: number;
  readonly totalBytes: number;
}

function fail(
  code: WorkerSnapshotCodecErrorCode,
  message: string,
  offset?: number,
): never {
  throw new WorkerSnapshotCodecError(code, message, offset);
}

function requireObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid-input", `${field} must be an object`);
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("invalid-input", `${field} contains unknown or missing fields`);
  }
}

function requireSafeUint(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("invalid-value", `${field} must be a non-negative safe integer`);
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
  // UTF-8 is never shorter than a JavaScript string's UTF-16 code-unit count.
  // Refuse obviously oversized hostile strings before TextEncoder allocates.
  if (value.length > maximumBytes) {
    fail("limit-exceeded", `${field} exceeds its ${maximumBytes}-byte limit`);
  }
  const bytes = textEncoder.encode(value);
  if (bytes.byteLength > maximumBytes) {
    fail("limit-exceeded", `${field} exceeds its ${maximumBytes}-byte limit`);
  }
  if (decodeFatalUtf8(bytes, field) !== value) {
    fail("invalid-value", `${field} contains an unpaired UTF-16 surrogate`);
  }
  return bytes;
}

function decodeFatalUtf8(bytes: Uint8Array, field: string): string {
  try {
    return fatalTextDecoder.decode(bytes);
  } catch {
    fail("invalid-utf8", `${field} is not valid UTF-8`);
  }
}

function prepareRequestId(value: unknown, field: string): Uint8Array {
  return encodeBoundedUtf8(
    value,
    WORKER_SNAPSHOT_MAX_REQUEST_ID_BYTES,
    field,
    false,
  );
}

function prepareCommand(value: unknown, field: string): PreparedCommand {
  if (typeof value !== "string") {
    fail("invalid-value", `${field} must be a string`);
  }
  if (value.length > WORKER_SNAPSHOT_MAX_COMMAND_LENGTH) {
    fail(
      "limit-exceeded",
      `${field} exceeds its ${WORKER_SNAPSHOT_MAX_COMMAND_LENGTH}-character limit`,
    );
  }

  let canonical: CanonicalCommand;
  try {
    canonical = canonicalizeCommand(value);
  } catch {
    fail("noncanonical", `${field} is not a valid canonical command`);
  }
  if (canonical !== value) {
    fail("noncanonical", `${field} is not in canonical form`);
  }

  return {
    value: canonical,
    bytes: encodeBoundedUtf8(
      canonical,
      WORKER_SNAPSHOT_MAX_COMMAND_BYTES,
      field,
      false,
    ),
  };
}

function boundaryMarker(boundary: unknown, field: string): number {
  switch (boundary) {
    case "input-requested":
      return BOUNDARY_INPUT_REQUESTED;
    case "terminated":
      return BOUNDARY_TERMINATED;
    default:
      fail("invalid-value", `${field} is invalid`);
  }
}

function boundaryFromMarker(
  marker: number,
  offset: number,
): EngineTurnBoundary {
  switch (marker) {
    case BOUNDARY_INPUT_REQUESTED:
      return "input-requested";
    case BOUNDARY_TERMINATED:
      return "terminated";
    default:
      fail("invalid-value", "turn boundary marker is invalid", offset);
  }
}

function addSize(
  total: number,
  amount: number,
  maximum: number,
  field: string,
): number {
  const next = total + amount;
  if (!Number.isSafeInteger(next) || next > maximum) {
    fail("limit-exceeded", `${field} exceeds its ${maximum}-byte limit`);
  }
  return next;
}

function prepareExecuteResult(value: unknown): PreparedExecuteResult {
  requireObject(value, "receipt.result");
  const status = value.status;
  if (status === "committed") {
    requireExactKeys(value, COMMITTED_RESULT_KEYS, "receipt.result");
  } else if (status === "rejected") {
    requireExactKeys(value, REJECTED_RESULT_KEYS, "receipt.result");
  } else {
    fail("invalid-value", "receipt.result.status is invalid");
  }

  const requestIdBytes = prepareRequestId(
    value.requestId,
    "receipt.result.requestId",
  );
  const command = prepareCommand(value.command, "receipt.result.command");
  const outputBytes = encodeBoundedUtf8(
    value.output,
    WORKER_SNAPSHOT_MAX_RESULT_OUTPUT_BYTES,
    "receipt.result.output",
  );
  requireSafeUint(value.previousRevision, "receipt.result.previousRevision");
  requireSafeUint(value.revision, "receipt.result.revision");
  if (value.turnComplete !== true) {
    fail("invalid-value", "receipt.result.turnComplete must equal true");
  }
  const resultBoundaryMarker = boundaryMarker(
    value.boundary,
    "receipt.result.boundary",
  );

  let statusMarker: number;
  let rejectionMarker: number;
  let result: ExecuteResult;
  if (status === "committed") {
    statusMarker = STATUS_COMMITTED;
    rejectionMarker = REJECTION_NONE;
    if (
      value.revision !== value.previousRevision + 1 ||
      !Number.isSafeInteger(value.previousRevision + 1)
    ) {
      fail(
        "invalid-value",
        "a committed receipt must advance exactly one safe revision",
      );
    }
    result = {
      requestId: value.requestId as string,
      previousRevision: value.previousRevision,
      revision: value.revision,
      command: command.value,
      output: value.output as string,
      turnComplete: true,
      boundary: value.boundary as EngineTurnBoundary,
      status,
    };
  } else {
    statusMarker = STATUS_REJECTED;
    if (value.previousRevision !== value.revision) {
      fail("invalid-value", "a rejected receipt must preserve its revision");
    }
    switch (value.rejection) {
      case "stale_revision":
        rejectionMarker = REJECTION_STALE_REVISION;
        break;
      case "duplicate":
        rejectionMarker = REJECTION_DUPLICATE;
        break;
      case "invalid_command":
        rejectionMarker = REJECTION_INVALID_COMMAND;
        break;
      case "receipt_capacity":
        rejectionMarker = REJECTION_RECEIPT_CAPACITY;
        break;
      default:
        fail("invalid-value", "receipt.result.rejection is invalid");
    }
    result = {
      requestId: value.requestId as string,
      previousRevision: value.previousRevision,
      revision: value.revision,
      command: command.value,
      output: value.output as string,
      turnComplete: true,
      boundary: value.boundary as EngineTurnBoundary,
      status,
      rejection: value.rejection,
    };
  }

  return {
    value: result,
    requestIdBytes,
    commandBytes: command.bytes,
    outputBytes,
    boundaryMarker: resultBoundaryMarker,
    statusMarker,
    rejectionMarker,
  };
}

function prepareReceipt(value: unknown): PreparedReceipt {
  requireObject(value, "receipt");
  requireExactKeys(value, RECEIPT_KEYS, "receipt");
  const requestIdBytes = prepareRequestId(value.requestId, "receipt.requestId");
  requireSafeUint(value.expectedRevision, "receipt.expectedRevision");
  const command = prepareCommand(value.command, "receipt.command");
  const result = prepareExecuteResult(value.result);

  if (value.requestId !== result.value.requestId) {
    fail(
      "invalid-value",
      "receipt requestId must equal receipt.result.requestId",
    );
  }
  if (command.value !== result.value.command) {
    fail("invalid-value", "receipt command must equal receipt.result.command");
  }
  if (
    result.value.status === "committed" &&
    value.expectedRevision !== result.value.previousRevision
  ) {
    fail(
      "invalid-value",
      "a committed receipt expectedRevision must equal previousRevision",
    );
  }
  if (
    result.value.status === "rejected" &&
    result.value.rejection === "stale_revision" &&
    value.expectedRevision === result.value.revision
  ) {
    fail(
      "invalid-value",
      "a stale-revision receipt must contain a stale expectedRevision",
    );
  }

  let payloadBytes = WORKER_SNAPSHOT_RECEIPT_FIXED_BYTES;
  payloadBytes = addSize(
    payloadBytes,
    requestIdBytes.byteLength,
    WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
    "receipt",
  );
  payloadBytes = addSize(
    payloadBytes,
    command.bytes.byteLength,
    WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
    "receipt",
  );
  payloadBytes = addSize(
    payloadBytes,
    result.requestIdBytes.byteLength,
    WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
    "receipt",
  );
  payloadBytes = addSize(
    payloadBytes,
    result.commandBytes.byteLength,
    WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
    "receipt",
  );
  payloadBytes = addSize(
    payloadBytes,
    result.outputBytes.byteLength,
    WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
    "receipt",
  );
  const encodedBytes = addSize(
    WORKER_SNAPSHOT_RECEIPT_LENGTH_PREFIX_BYTES,
    payloadBytes,
    WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
    "receipt",
  );

  const receipt: WorkerSnapshotReceipt = {
    requestId: value.requestId as string,
    expectedRevision: value.expectedRevision,
    command: command.value,
    result: result.value,
  };
  return {
    value: receipt,
    requestIdBytes,
    commandBytes: command.bytes,
    result,
    payloadBytes,
    encodedBytes,
  };
}

function validateReceiptsRelativeToEnvelope(
  receipts: readonly PreparedReceipt[],
  revision: number,
  lastOutput: string,
  boundary: EngineTurnBoundary,
): void {
  const requestIds = new Set<string>();
  const committedRevisions = new Set<number>();

  for (const receipt of receipts) {
    if (requestIds.has(receipt.value.requestId)) {
      fail(
        "duplicate-request-id",
        `duplicate receipt requestId ${JSON.stringify(receipt.value.requestId)}`,
      );
    }
    requestIds.add(receipt.value.requestId);

    const result = receipt.value.result;
    if (result.previousRevision > revision || result.revision > revision) {
      fail(
        "invalid-value",
        "receipt result revisions must not exceed the envelope revision",
      );
    }
    if (result.status === "committed") {
      if (committedRevisions.has(result.revision)) {
        fail(
          "invalid-value",
          "only one committed receipt may produce a revision",
        );
      }
      committedRevisions.add(result.revision);
      if (
        result.revision === revision &&
        (result.output !== lastOutput || result.boundary !== boundary)
      ) {
        fail(
          "invalid-value",
          "the current committed receipt must match public engine state",
        );
      }
    }
    if (result.revision === revision && result.boundary !== boundary) {
      fail(
        "invalid-value",
        "a current-revision receipt must match the envelope boundary",
      );
    }
  }

  for (
    let committedRevision = 1;
    committedRevision <= revision;
    committedRevision += 1
  ) {
    if (!committedRevisions.has(committedRevision)) {
      fail(
        "invalid-value",
        `receipt journal is missing committed revision ${committedRevision}`,
      );
    }
  }
}

function prepareEnvelope(value: unknown): PreparedEnvelope {
  requireObject(value, "worker snapshot envelope");
  requireExactKeys(value, ENVELOPE_KEYS, "worker snapshot envelope");
  if (value.schemaVersion !== WORKER_SNAPSHOT_SCHEMA_VERSION) {
    fail("unsupported-version", "unsupported worker snapshot schema");
  }
  requireSafeUint(value.revision, "revision");
  const envelopeBoundaryMarker = boundaryMarker(value.boundary, "boundary");
  const lastOutputBytes = encodeBoundedUtf8(
    value.lastOutput,
    WORKER_SNAPSHOT_MAX_LAST_OUTPUT_BYTES,
    "lastOutput",
  );
  if (!(value.innerCheckpoint instanceof Uint8Array)) {
    fail("invalid-value", "innerCheckpoint must be a Uint8Array");
  }
  if (value.innerCheckpoint.byteLength < DORK_CHECKPOINT_FIXED_HEADER_BYTES) {
    fail(
      "invalid-value",
      "innerCheckpoint is shorter than a Dork checkpoint header",
    );
  }
  if (
    value.innerCheckpoint.byteLength >
    WORKER_SNAPSHOT_MAX_INNER_CHECKPOINT_BYTES
  ) {
    fail(
      "limit-exceeded",
      `innerCheckpoint exceeds its ${WORKER_SNAPSHOT_MAX_INNER_CHECKPOINT_BYTES}-byte limit`,
    );
  }
  if (!Array.isArray(value.receipts)) {
    fail("invalid-value", "receipts must be an array");
  }
  if (value.receipts.length > WORKER_SNAPSHOT_MAX_RECEIPTS) {
    fail(
      "limit-exceeded",
      `receipts exceeds its ${WORKER_SNAPSHOT_MAX_RECEIPTS}-entry limit`,
    );
  }

  const receipts = value.receipts.map((receipt) => prepareReceipt(receipt));
  let journalBytes = 0;
  for (const receipt of receipts) {
    journalBytes = addSize(
      journalBytes,
      receipt.encodedBytes,
      WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
      "receipt journal",
    );
  }
  validateReceiptsRelativeToEnvelope(
    receipts,
    value.revision,
    value.lastOutput as string,
    value.boundary as EngineTurnBoundary,
  );

  let totalBytes =
    WORKER_SNAPSHOT_FIXED_HEADER_BYTES + WORKER_SNAPSHOT_FIXED_BODY_BYTES;
  totalBytes = addSize(
    totalBytes,
    lastOutputBytes.byteLength,
    WORKER_SNAPSHOT_MAX_TOTAL_BYTES,
    "worker snapshot",
  );
  totalBytes = addSize(
    totalBytes,
    value.innerCheckpoint.byteLength,
    WORKER_SNAPSHOT_MAX_TOTAL_BYTES,
    "worker snapshot",
  );
  totalBytes = addSize(
    totalBytes,
    journalBytes,
    WORKER_SNAPSHOT_MAX_TOTAL_BYTES,
    "worker snapshot",
  );

  const envelope: WorkerSnapshotEnvelope = {
    schemaVersion: WORKER_SNAPSHOT_SCHEMA_VERSION,
    revision: value.revision,
    lastOutput: value.lastOutput as string,
    boundary: value.boundary as EngineTurnBoundary,
    innerCheckpoint: value.innerCheckpoint,
    receipts: receipts.map((receipt) => receipt.value),
  };
  return {
    value: envelope,
    lastOutputBytes,
    innerCheckpoint: value.innerCheckpoint,
    receipts,
    journalBytes,
    boundaryMarker: envelopeBoundaryMarker,
    totalBytes,
  };
}

export function measureWorkerSnapshotReceiptBytes(
  receipt: WorkerSnapshotReceipt,
): number {
  return prepareReceipt(receipt).encodedBytes;
}

export function measureWorkerSnapshotReceiptJournalBytes(
  receipts: readonly WorkerSnapshotReceipt[],
): number {
  if (!Array.isArray(receipts)) {
    fail("invalid-input", "receipts must be an array");
  }
  if (receipts.length > WORKER_SNAPSHOT_MAX_RECEIPTS) {
    fail(
      "limit-exceeded",
      `receipts exceeds its ${WORKER_SNAPSHOT_MAX_RECEIPTS}-entry limit`,
    );
  }
  let total = 0;
  for (const receipt of receipts) {
    total = addSize(
      total,
      measureWorkerSnapshotReceiptBytes(receipt),
      WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
      "receipt journal",
    );
  }
  return total;
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

  public bytes(value: Uint8Array): void {
    this.#bytes.set(value, this.#offset);
    this.#offset += value.byteLength;
  }

  public u8(value: number): void {
    this.#view.setUint8(this.#offset, value);
    this.#offset += 1;
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
    const high = Math.floor(value / UINT32_FACTOR);
    const low = value - high * UINT32_FACTOR;
    this.u32(high);
    this.u32(low);
  }

  public finish(): Uint8Array {
    if (this.#offset !== this.#bytes.byteLength) {
      fail("invalid-input", "internal worker snapshot size mismatch");
    }
    return this.#bytes;
  }
}

export function encodeWorkerSnapshotEnvelope(
  envelope: WorkerSnapshotEnvelope,
): Uint8Array {
  const prepared = prepareEnvelope(envelope);
  const writer = new BinaryWriter(prepared.totalBytes);

  writer.bytes(magicBytes);
  writer.u16(WORKER_SNAPSHOT_SCHEMA_VERSION);
  writer.u16(0);
  writer.u32(prepared.totalBytes);

  writer.u64(prepared.value.revision);
  writer.u8(prepared.boundaryMarker);
  writer.u8(0);
  writer.u16(0);
  writer.u32(prepared.lastOutputBytes.byteLength);
  writer.u32(prepared.innerCheckpoint.byteLength);
  writer.u16(prepared.receipts.length);
  writer.u16(0);
  writer.u32(prepared.journalBytes);

  writer.bytes(prepared.lastOutputBytes);
  writer.bytes(prepared.innerCheckpoint);
  for (const receipt of prepared.receipts) {
    writer.u32(receipt.payloadBytes);
    writer.u16(receipt.requestIdBytes.byteLength);
    writer.u16(receipt.commandBytes.byteLength);
    writer.u16(receipt.result.requestIdBytes.byteLength);
    writer.u16(receipt.result.commandBytes.byteLength);
    writer.u32(receipt.result.outputBytes.byteLength);
    writer.u64(receipt.value.expectedRevision);
    writer.u64(receipt.value.result.previousRevision);
    writer.u64(receipt.value.result.revision);
    writer.u8(1);
    writer.u8(receipt.result.boundaryMarker);
    writer.u8(receipt.result.statusMarker);
    writer.u8(receipt.result.rejectionMarker);
    writer.bytes(receipt.requestIdBytes);
    writer.bytes(receipt.commandBytes);
    writer.bytes(receipt.result.requestIdBytes);
    writer.bytes(receipt.result.commandBytes);
    writer.bytes(receipt.result.outputBytes);
  }

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
        "worker snapshot ends before a declared field is complete",
        this.#offset,
      );
    }
  }

  public bytes(byteLength: number): Uint8Array {
    this.#require(byteLength);
    const bytes = this.#bytes.subarray(this.#offset, this.#offset + byteLength);
    this.#offset += byteLength;
    return bytes;
  }

  public u8(): number {
    this.#require(1);
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  public u16(): number {
    this.#require(2);
    const value = this.#view.getUint16(this.#offset, false);
    this.#offset += 2;
    return value;
  }

  public u32(): number {
    this.#require(4);
    const value = this.#view.getUint32(this.#offset, false);
    this.#offset += 4;
    return value;
  }

  public safeU64(field: string): number {
    const offset = this.#offset;
    const high = this.u32();
    const low = this.u32();
    if (high > MAX_SAFE_U64_HIGH_WORD) {
      fail("invalid-value", `${field} exceeds Number.MAX_SAFE_INTEGER`, offset);
    }
    return high * UINT32_FACTOR + low;
  }
}

function readReservedU8(reader: BinaryReader, field: string): void {
  const offset = reader.offset;
  if (reader.u8() !== 0) {
    fail("nonzero-reserved", `${field} must be zero`, offset);
  }
}

function readReservedU16(reader: BinaryReader, field: string): void {
  const offset = reader.offset;
  if (reader.u16() !== 0) {
    fail("nonzero-reserved", `${field} must be zero`, offset);
  }
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

function assertMagic(actual: Uint8Array): void {
  if (
    actual.byteLength !== magicBytes.byteLength ||
    !actual.every((byte, index) => byte === magicBytes[index])
  ) {
    fail("invalid-magic", "worker snapshot magic does not match", 0);
  }
}

function decodeStatus(
  statusMarker: number,
  rejectionMarker: number,
  offset: number,
):
  | { readonly status: "committed" }
  | {
      readonly status: "rejected";
      readonly rejection:
        "stale_revision" | "duplicate" | "invalid_command" | "receipt_capacity";
    } {
  if (statusMarker === STATUS_COMMITTED) {
    if (rejectionMarker !== REJECTION_NONE) {
      fail(
        "noncanonical",
        "a committed result must use the no-rejection marker",
        offset,
      );
    }
    return { status: "committed" };
  }
  if (statusMarker !== STATUS_REJECTED) {
    fail("invalid-value", "receipt status marker is invalid", offset);
  }
  switch (rejectionMarker) {
    case REJECTION_STALE_REVISION:
      return { status: "rejected", rejection: "stale_revision" };
    case REJECTION_DUPLICATE:
      return { status: "rejected", rejection: "duplicate" };
    case REJECTION_INVALID_COMMAND:
      return { status: "rejected", rejection: "invalid_command" };
    case REJECTION_RECEIPT_CAPACITY:
      return { status: "rejected", rejection: "receipt_capacity" };
    default:
      fail("invalid-value", "receipt rejection marker is invalid", offset + 1);
  }
}

function decodeReceipt(reader: BinaryReader): PreparedReceipt {
  const requestIdLength = reader.u16();
  const commandLength = reader.u16();
  const resultRequestIdLength = reader.u16();
  const resultCommandLength = reader.u16();
  const resultOutputLength = reader.u32();
  const expectedRevision = reader.safeU64("receipt.expectedRevision");
  const previousRevision = reader.safeU64("receipt.result.previousRevision");
  const revision = reader.safeU64("receipt.result.revision");
  const turnCompleteOffset = reader.offset;
  if (reader.u8() !== 1) {
    fail(
      "invalid-value",
      "receipt.result.turnComplete marker must equal true",
      turnCompleteOffset,
    );
  }
  const boundaryOffset = reader.offset;
  const resultBoundary = boundaryFromMarker(reader.u8(), boundaryOffset);
  const statusOffset = reader.offset;
  const statusMarker = reader.u8();
  const rejectionMarker = reader.u8();
  const status = decodeStatus(statusMarker, rejectionMarker, statusOffset);

  const requestId = readBoundedUtf8(
    reader,
    requestIdLength,
    WORKER_SNAPSHOT_MAX_REQUEST_ID_BYTES,
    "receipt.requestId",
    false,
  );
  const command = readBoundedUtf8(
    reader,
    commandLength,
    WORKER_SNAPSHOT_MAX_COMMAND_BYTES,
    "receipt.command",
    false,
  );
  const resultRequestId = readBoundedUtf8(
    reader,
    resultRequestIdLength,
    WORKER_SNAPSHOT_MAX_REQUEST_ID_BYTES,
    "receipt.result.requestId",
    false,
  );
  const resultCommand = readBoundedUtf8(
    reader,
    resultCommandLength,
    WORKER_SNAPSHOT_MAX_COMMAND_BYTES,
    "receipt.result.command",
    false,
  );
  const resultOutput = readBoundedUtf8(
    reader,
    resultOutputLength,
    WORKER_SNAPSHOT_MAX_RESULT_OUTPUT_BYTES,
    "receipt.result.output",
  );

  const result: ExecuteResult =
    status.status === "committed"
      ? {
          requestId: resultRequestId,
          previousRevision,
          revision,
          command: resultCommand,
          output: resultOutput,
          turnComplete: true,
          boundary: resultBoundary,
          status: "committed",
        }
      : {
          requestId: resultRequestId,
          previousRevision,
          revision,
          command: resultCommand,
          output: resultOutput,
          turnComplete: true,
          boundary: resultBoundary,
          status: "rejected",
          rejection: status.rejection,
        };

  return prepareReceipt({
    requestId,
    expectedRevision,
    command,
    result,
  });
}

export function decodeWorkerSnapshotEnvelope(
  input: Uint8Array,
): WorkerSnapshotEnvelope {
  if (!(input instanceof Uint8Array)) {
    fail("invalid-input", "worker snapshot bytes must be a Uint8Array");
  }
  if (input.byteLength > WORKER_SNAPSHOT_MAX_TOTAL_BYTES) {
    fail(
      "limit-exceeded",
      `worker snapshot exceeds the ${WORKER_SNAPSHOT_MAX_TOTAL_BYTES}-byte limit`,
    );
  }
  if (input.byteLength < WORKER_SNAPSHOT_FIXED_HEADER_BYTES) {
    fail(
      "truncated",
      "worker snapshot is shorter than its fixed header",
      input.byteLength,
    );
  }

  // Bound before copying, then detach validation from caller mutation.
  const bytes = new Uint8Array(input);
  const reader = new BinaryReader(bytes);
  assertMagic(reader.bytes(magicBytes.byteLength));
  const schemaOffset = reader.offset;
  if (reader.u16() !== WORKER_SNAPSHOT_SCHEMA_VERSION) {
    fail(
      "unsupported-version",
      "unsupported worker snapshot schema",
      schemaOffset,
    );
  }
  readReservedU16(reader, "worker snapshot header reserved field");
  const totalLengthOffset = reader.offset;
  const declaredTotal = reader.u32();
  if (declaredTotal !== bytes.byteLength) {
    fail(
      "invalid-total-length",
      `declared worker snapshot length ${declaredTotal} does not match ${bytes.byteLength}`,
      totalLengthOffset,
    );
  }

  const revision = reader.safeU64("revision");
  const boundaryOffset = reader.offset;
  const boundary = boundaryFromMarker(reader.u8(), boundaryOffset);
  readReservedU8(reader, "worker snapshot boundary reserved field");
  readReservedU16(reader, "worker snapshot public-state reserved field");
  const lastOutputLength = reader.u32();
  const innerCheckpointLength = reader.u32();
  const receiptCountOffset = reader.offset;
  const receiptCount = reader.u16();
  readReservedU16(reader, "worker snapshot journal reserved field");
  const journalLength = reader.u32();

  if (lastOutputLength > WORKER_SNAPSHOT_MAX_LAST_OUTPUT_BYTES) {
    fail(
      "limit-exceeded",
      `lastOutput exceeds its ${WORKER_SNAPSHOT_MAX_LAST_OUTPUT_BYTES}-byte limit`,
      reader.offset,
    );
  }
  if (
    innerCheckpointLength < DORK_CHECKPOINT_FIXED_HEADER_BYTES ||
    innerCheckpointLength > WORKER_SNAPSHOT_MAX_INNER_CHECKPOINT_BYTES
  ) {
    fail(
      innerCheckpointLength > WORKER_SNAPSHOT_MAX_INNER_CHECKPOINT_BYTES
        ? "limit-exceeded"
        : "invalid-value",
      "innerCheckpoint has an invalid declared length",
      reader.offset,
    );
  }
  if (receiptCount > WORKER_SNAPSHOT_MAX_RECEIPTS) {
    fail(
      "limit-exceeded",
      `receipt count exceeds ${WORKER_SNAPSHOT_MAX_RECEIPTS}`,
      receiptCountOffset,
    );
  }
  if (journalLength > WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES) {
    fail(
      "limit-exceeded",
      `receipt journal exceeds ${WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES} bytes`,
      reader.offset - 4,
    );
  }

  const lastOutput = readBoundedUtf8(
    reader,
    lastOutputLength,
    WORKER_SNAPSHOT_MAX_LAST_OUTPUT_BYTES,
    "lastOutput",
  );
  const innerCheckpoint = reader.bytes(innerCheckpointLength);
  const journal = new BinaryReader(reader.bytes(journalLength));
  const receipts: PreparedReceipt[] = [];
  for (let index = 0; index < receiptCount; index += 1) {
    const recordLengthOffset = journal.offset;
    const recordLength = journal.u32();
    if (recordLength < WORKER_SNAPSHOT_RECEIPT_FIXED_BYTES) {
      fail(
        "truncated",
        `receipt ${index} is shorter than its fixed fields`,
        recordLengthOffset,
      );
    }
    const record = new BinaryReader(journal.bytes(recordLength));
    const receipt = decodeReceipt(record);
    if (record.remaining !== 0) {
      fail(
        "trailing-bytes",
        `receipt ${index} has trailing bytes`,
        record.offset,
      );
    }
    if (
      receipt.encodedBytes !==
      WORKER_SNAPSHOT_RECEIPT_LENGTH_PREFIX_BYTES + recordLength
    ) {
      fail(
        "noncanonical",
        `receipt ${index} declared a noncanonical record length`,
        recordLengthOffset,
      );
    }
    receipts.push(receipt);
  }
  if (journal.remaining !== 0) {
    fail(
      "trailing-bytes",
      "receipt journal has trailing bytes",
      journal.offset,
    );
  }
  if (reader.remaining !== 0) {
    fail("trailing-bytes", "worker snapshot has trailing bytes", reader.offset);
  }

  validateReceiptsRelativeToEnvelope(receipts, revision, lastOutput, boundary);

  return {
    schemaVersion: WORKER_SNAPSHOT_SCHEMA_VERSION,
    revision,
    lastOutput,
    boundary,
    innerCheckpoint: new Uint8Array(innerCheckpoint),
    receipts: receipts.map((receipt) => receipt.value),
  };
}
