import {
  MAX_ENGINE_SNAPSHOT_BYTES,
  canonicalizeCommand,
  type CanonicalCommand,
  type EngineCompatibility,
  type EngineSnapshot,
  type EngineTurnBoundary,
  type ExecuteResult,
} from "../../packages/contracts/src/index.js";
import {
  ENGINE_WORKER_PROTOCOL_VERSION,
  type EngineWorkerBootRequest,
  type EngineWorkerExecuteRequest,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
  type EngineWorkerRestoreRequest,
  type EngineWorkerTransport,
} from "../../packages/game-engine/src/worker-protocol.js";

import { DorkCandidateSession } from "./dork-candidate-session.js";
import { DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES } from "./checkpoint-envelope.js";
import { DORK_WORKER_BINDING } from "./dork-worker-binding.js";
import {
  WORKER_SNAPSHOT_MAX_RECEIPTS,
  WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
  WORKER_SNAPSHOT_MAX_TOTAL_BYTES,
  WORKER_SNAPSHOT_SCHEMA_VERSION,
  decodeWorkerSnapshotEnvelope,
  encodeWorkerSnapshotEnvelope,
  measureWorkerSnapshotReceiptBytes,
  type WorkerSnapshotEnvelope,
  type WorkerSnapshotReceipt,
} from "./worker-snapshot-envelope.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_RUNTIME_ID_BYTES = 128;
const UINT32_MAX = 0xffff_ffff;

export interface DorkWorkerRuntimeOptions {
  /** Product artifact ID, distinct from the Z-code header ID. */
  readonly storyId: string;
  /** Detached by the runtime before any asynchronous work begins. */
  readonly storyBytes: Uint8Array;
  /** Deterministic test seam. Production construction should omit it. */
  readonly seed?: number;
  /** May be lowered for a bounded test, but never raised above the wire cap. */
  readonly maxReceipts?: number;
  /** May be lowered for a bounded test, but never raised above the wire cap. */
  readonly maxReceiptJournalBytes?: number;
}

class DorkWorkerInvalidRequestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DorkWorkerInvalidRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function requireBoundedId(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8Length(value) > MAX_RUNTIME_ID_BYTES ||
    /\p{Cc}/u.test(value)
  ) {
    throw new DorkWorkerInvalidRequestError(
      `${field} must be a nonempty control-free string of at most ${MAX_RUNTIME_ID_BYTES} UTF-8 bytes`,
    );
  }
}

function requireRevision(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new DorkWorkerInvalidRequestError(
      `${field} must be a non-negative safe integer`,
    );
  }
}

function requireSha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new DorkWorkerInvalidRequestError(
      `${field} must be a lowercase SHA-256 digest`,
    );
  }
}

function requirePositiveLimit(
  value: number | undefined,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? maximum;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`${field} must be between 1 and ${maximum}`);
  }
  return resolved;
}

function cloneCompatibility(
  compatibility: EngineCompatibility,
): EngineCompatibility {
  return {
    story: { ...compatibility.story },
    runtime: { ...compatibility.runtime },
    adapter: { ...compatibility.adapter },
    snapshotSchemaVersion: compatibility.snapshotSchemaVersion,
  };
}

function sameCompatibility(
  left: EngineCompatibility,
  right: EngineCompatibility,
): boolean {
  return (
    left.story.id === right.story.id &&
    left.story.artifactSha256 === right.story.artifactSha256 &&
    left.runtime.id === right.runtime.id &&
    left.runtime.version === right.runtime.version &&
    left.runtime.artifactSha256 === right.runtime.artifactSha256 &&
    left.adapter.id === right.adapter.id &&
    left.adapter.version === right.adapter.version &&
    left.snapshotSchemaVersion === right.snapshotSchemaVersion
  );
}

function cloneIncomingCompatibility(value: unknown): EngineCompatibility {
  if (!isRecord(value)) {
    throw new DorkWorkerInvalidRequestError(
      "snapshot compatibility must be an object",
    );
  }
  const story = value.story;
  const runtime = value.runtime;
  const adapter = value.adapter;
  if (!isRecord(story) || !isRecord(runtime) || !isRecord(adapter)) {
    throw new DorkWorkerInvalidRequestError(
      "snapshot compatibility identities must be objects",
    );
  }
  requireBoundedId(story.id, "snapshot story id");
  requireSha256(story.artifactSha256, "snapshot story artifact SHA-256");
  requireBoundedId(runtime.id, "snapshot runtime id");
  requireBoundedId(runtime.version, "snapshot runtime version");
  requireSha256(runtime.artifactSha256, "snapshot runtime artifact SHA-256");
  requireBoundedId(adapter.id, "snapshot adapter id");
  requireBoundedId(adapter.version, "snapshot adapter version");
  requireRevision(value.snapshotSchemaVersion, "snapshot schema version");
  if (value.snapshotSchemaVersion < 1) {
    throw new DorkWorkerInvalidRequestError(
      "snapshot schema version must be positive",
    );
  }
  return {
    story: { id: story.id, artifactSha256: story.artifactSha256 },
    runtime: {
      id: runtime.id,
      version: runtime.version,
      artifactSha256: runtime.artifactSha256,
    },
    adapter: { id: adapter.id, version: adapter.version },
    snapshotSchemaVersion: value.snapshotSchemaVersion,
  };
}

function cloneExecuteResult(result: ExecuteResult): ExecuteResult {
  return { ...result };
}

function cloneReceipt(receipt: WorkerSnapshotReceipt): WorkerSnapshotReceipt {
  return {
    requestId: receipt.requestId,
    expectedRevision: receipt.expectedRevision,
    command: receipt.command,
    result: cloneExecuteResult(receipt.result),
  };
}

async function digestSha256(bytes: Uint8Array): Promise<string> {
  const crypto = globalThis.crypto;
  if (crypto === undefined) {
    throw new Error("Web Crypto is unavailable");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isStoryLimitError(error: unknown): boolean {
  return (
    error instanceof RangeError &&
    /exceeds the story input limit/u.test(error.message)
  );
}

/**
 * Isolated ADR-0009 worker-side protocol runtime. It deliberately remains
 * outside the production package exports until the Dork evidence gates pass.
 */
export class DorkWorkerRuntime implements EngineWorkerTransport {
  readonly #storyId: string;
  readonly #storyBytes: Uint8Array;
  readonly #artifactSha256: Promise<string>;
  readonly #seed: number | undefined;
  readonly #maxReceipts: number;
  readonly #maxReceiptJournalBytes: number;
  #session: DorkCandidateSession | undefined;
  #compatibility: EngineCompatibility | undefined;
  #receipts = new Map<string, WorkerSnapshotReceipt>();
  #receiptJournalBytes = 0;
  #operationInFlight = false;
  #disposed = false;
  #lifecycleEpoch = 0;

  public constructor(options: DorkWorkerRuntimeOptions) {
    requireBoundedId(options.storyId, "storyId");
    if (!(options.storyBytes instanceof Uint8Array)) {
      throw new TypeError("storyBytes must be a Uint8Array");
    }
    if (options.storyBytes.byteLength < 64) {
      throw new RangeError("storyBytes must contain a complete story header");
    }
    if (
      options.seed !== undefined &&
      (!Number.isSafeInteger(options.seed) ||
        options.seed < 0 ||
        options.seed > UINT32_MAX)
    ) {
      throw new RangeError(`seed must be between 0 and ${UINT32_MAX}`);
    }
    this.#storyId = options.storyId;
    this.#storyBytes = new Uint8Array(options.storyBytes);
    this.#artifactSha256 = digestSha256(this.#storyBytes);
    this.#seed = options.seed;
    this.#maxReceipts = requirePositiveLimit(
      options.maxReceipts,
      WORKER_SNAPSHOT_MAX_RECEIPTS,
      "maxReceipts",
    );
    this.#maxReceiptJournalBytes = requirePositiveLimit(
      options.maxReceiptJournalBytes,
      WORKER_SNAPSHOT_MAX_RECEIPT_JOURNAL_BYTES,
      "maxReceiptJournalBytes",
    );
  }

  public async exchange(
    request: EngineWorkerRequest,
    signal?: AbortSignal,
  ): Promise<EngineWorkerResponse> {
    // Browser transport cancellation is local after submission. The runtime
    // must finish and journal the submitted command so an exact retry can
    // recover its result.
    void signal;
    const untrusted = request as unknown;
    const messageId =
      isRecord(untrusted) && typeof untrusted.messageId === "string"
        ? untrusted.messageId
        : "";

    if (this.#operationInFlight) {
      return this.#error(
        messageId,
        "invalid_request",
        "Another engine operation is already in flight.",
      );
    }
    this.#operationInFlight = true;
    try {
      if (this.#disposed) {
        return this.#error(
          messageId,
          "internal_error",
          "The engine worker runtime is unavailable.",
        );
      }
      if (!isRecord(untrusted)) {
        return this.#error(
          messageId,
          "invalid_request",
          "The worker request must be an object.",
        );
      }
      requireBoundedId(untrusted.messageId, "messageId");
      if (untrusted.protocolVersion !== ENGINE_WORKER_PROTOCOL_VERSION) {
        throw new DorkWorkerInvalidRequestError(
          "The worker protocol version is unsupported",
        );
      }

      const typedRequest = untrusted as unknown as EngineWorkerRequest;
      switch (untrusted.kind) {
        case "boot":
          return await this.#boot(typedRequest as EngineWorkerBootRequest);
        case "execute":
          return await this.#execute(
            typedRequest as EngineWorkerExecuteRequest,
          );
        case "snapshot":
          return await this.#snapshot(typedRequest);
        case "restore":
          return await this.#restore(
            typedRequest as EngineWorkerRestoreRequest,
          );
        case "inspect-public-state":
          return this.#inspect(typedRequest);
        default:
          throw new DorkWorkerInvalidRequestError(
            "The worker request kind is unsupported",
          );
      }
    } catch (error) {
      if (error instanceof DorkWorkerInvalidRequestError) {
        return this.#error(
          messageId,
          "invalid_request",
          "The engine worker request is invalid.",
        );
      }
      return this.#error(
        messageId,
        "internal_error",
        "The engine worker request could not be completed.",
      );
    } finally {
      this.#operationInFlight = false;
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lifecycleEpoch += 1;
    this.#session?.dispose();
    this.#session = undefined;
    this.#compatibility = undefined;
    this.#receipts.clear();
    this.#receiptJournalBytes = 0;
  }

  async #boot(request: EngineWorkerBootRequest): Promise<EngineWorkerResponse> {
    if (this.#session !== undefined) {
      return this.#error(
        request.messageId,
        "already_booted",
        "The engine worker is already booted.",
      );
    }
    if (!isRecord(request.input)) {
      throw new DorkWorkerInvalidRequestError("boot input must be an object");
    }
    requireBoundedId(request.input.storyId, "boot storyId");
    requireSha256(request.input.artifactSha256, "boot story artifact SHA-256");
    const artifactSha256 = await this.#artifactSha256;
    if (
      request.input.storyId !== this.#storyId ||
      request.input.artifactSha256 !== artifactSha256
    ) {
      throw new DorkWorkerInvalidRequestError(
        "boot does not match the configured story artifact",
      );
    }

    const lifecycleEpoch = this.#lifecycleEpoch;
    const candidate = new DorkCandidateSession(this.#storyBytes, {
      ...(this.#seed === undefined ? {} : { seed: this.#seed }),
    });
    try {
      const turn = await candidate.boot();
      if (this.#disposed || this.#lifecycleEpoch !== lifecycleEpoch) {
        throw new Error("worker lifecycle changed during boot");
      }
      const compatibility = this.#createCompatibility(artifactSha256);
      this.#session = candidate;
      this.#compatibility = compatibility;
      return {
        protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
        messageId: request.messageId,
        kind: "boot.result",
        result: {
          revision: 0,
          output: turn.output,
          turnComplete: true,
          boundary: turn.boundary,
          compatibility: cloneCompatibility(compatibility),
        },
      };
    } catch (error) {
      candidate.dispose();
      throw error;
    }
  }

  async #execute(
    request: EngineWorkerExecuteRequest,
  ): Promise<EngineWorkerResponse> {
    const session = this.#session;
    if (session === undefined) {
      return this.#error(
        request.messageId,
        "not_booted",
        "The engine worker must be booted first.",
      );
    }
    if (!isRecord(request.input)) {
      throw new DorkWorkerInvalidRequestError(
        "execute input must be an object",
      );
    }
    requireBoundedId(request.input.requestId, "execute requestId");
    requireRevision(request.input.expectedRevision, "execute expectedRevision");
    if (typeof request.input.command !== "string") {
      throw new DorkWorkerInvalidRequestError(
        "execute command must be a string",
      );
    }

    const requestId = request.input.requestId;
    const expectedRevision = request.input.expectedRevision;
    const command = request.input.command;
    const existing = this.#receipts.get(requestId);
    if (existing !== undefined) {
      if (
        existing.expectedRevision === expectedRevision &&
        existing.command === command
      ) {
        return this.#executeResponse(
          request.messageId,
          cloneExecuteResult(existing.result),
        );
      }
      const state = session.inspectPublicState();
      return this.#executeResponse(
        request.messageId,
        this.#rejectedExecute(
          requestId,
          command,
          state.revision,
          state.boundary,
          "duplicate",
        ),
      );
    }

    let canonicalCommand: CanonicalCommand | undefined;
    try {
      const candidate = canonicalizeCommand(command);
      if (candidate === command) canonicalCommand = candidate;
    } catch {
      // The raw string has not crossed the canonical command boundary.
    }

    const state = session.inspectPublicState();
    if (canonicalCommand === undefined) {
      return this.#error(
        request.messageId,
        "invalid_request",
        "The engine command is not in canonical form.",
      );
    }
    if (state.boundary === "terminated") {
      const result = this.#rejectedExecute(
        requestId,
        canonicalCommand,
        state.revision,
        state.boundary,
        "invalid_command",
      );
      const receipt = {
        requestId,
        expectedRevision,
        command: canonicalCommand,
        result,
      } as const satisfies WorkerSnapshotReceipt;
      if (!this.#canRecordReceipt(receipt)) {
        return this.#receiptCapacityResponse(
          request.messageId,
          requestId,
          canonicalCommand,
          state.revision,
          state.boundary,
        );
      }
      this.#recordReceipt(receipt);
      return this.#executeResponse(request.messageId, result);
    }
    if (expectedRevision !== state.revision) {
      const result = this.#rejectedExecute(
        requestId,
        canonicalCommand,
        state.revision,
        state.boundary,
        "stale_revision",
      );
      const receipt = {
        requestId,
        expectedRevision,
        command: canonicalCommand,
        result,
      } as const satisfies WorkerSnapshotReceipt;
      if (!this.#canRecordReceipt(receipt)) {
        return this.#receiptCapacityResponse(
          request.messageId,
          requestId,
          canonicalCommand,
          state.revision,
          state.boundary,
        );
      }
      this.#recordReceipt(receipt);
      return this.#executeResponse(request.messageId, result);
    }
    if (state.revision === Number.MAX_SAFE_INTEGER) {
      throw new Error("engine revision cannot advance safely");
    }
    if (
      !this.#canRecordWorstCaseCommittedReceipt(
        requestId,
        expectedRevision,
        canonicalCommand,
        state.revision,
      )
    ) {
      return this.#receiptCapacityResponse(
        request.messageId,
        requestId,
        canonicalCommand,
        state.revision,
        state.boundary,
      );
    }

    let turn;
    try {
      turn = await session.execute(canonicalCommand);
    } catch (error) {
      if (!isStoryLimitError(error)) throw error;
      const current = session.inspectPublicState();
      const result = this.#rejectedExecute(
        requestId,
        canonicalCommand,
        current.revision,
        current.boundary,
        "invalid_command",
      );
      const receipt = {
        requestId,
        expectedRevision,
        command: canonicalCommand,
        result,
      } as const satisfies WorkerSnapshotReceipt;
      if (!this.#canRecordReceipt(receipt)) {
        throw new Error("preflighted receipt exceeded the journal capacity", {
          cause: error,
        });
      }
      this.#recordReceipt(receipt);
      return this.#executeResponse(request.messageId, result);
    }
    const committedState = session.inspectPublicState();
    if (
      committedState.revision !== state.revision + 1 ||
      committedState.lastOutput !== turn.output ||
      committedState.boundary !== turn.boundary
    ) {
      throw new Error("Dork committed an inconsistent public turn");
    }
    const result = {
      requestId,
      previousRevision: state.revision,
      revision: committedState.revision,
      command: canonicalCommand,
      output: turn.output,
      turnComplete: true,
      boundary: turn.boundary,
      status: "committed",
    } as const satisfies ExecuteResult;
    this.#recordReceipt({
      requestId,
      expectedRevision,
      command: canonicalCommand,
      result,
    });
    return this.#executeResponse(request.messageId, result);
  }

  async #snapshot(request: EngineWorkerRequest): Promise<EngineWorkerResponse> {
    const session = this.#session;
    const compatibility = this.#compatibility;
    if (session === undefined || compatibility === undefined) {
      return this.#error(
        request.messageId,
        "not_booted",
        "The engine worker must be booted first.",
      );
    }
    const innerCheckpoint = await session.snapshot();
    const state = session.inspectPublicState();
    const envelope: WorkerSnapshotEnvelope = {
      schemaVersion: WORKER_SNAPSHOT_SCHEMA_VERSION,
      revision: state.revision,
      lastOutput: state.lastOutput,
      boundary: state.boundary,
      innerCheckpoint,
      receipts: Array.from(this.#receipts.values(), cloneReceipt),
    };
    const encoded = encodeWorkerSnapshotEnvelope(envelope);
    if (
      encoded.byteLength > WORKER_SNAPSHOT_MAX_TOTAL_BYTES ||
      encoded.byteLength > MAX_ENGINE_SNAPSHOT_BYTES
    ) {
      throw new Error("Dork worker snapshot exceeded its encoded size limit");
    }
    const bytes = new Uint8Array(encoded);
    const snapshot: EngineSnapshot = {
      bytes,
      sha256: await digestSha256(bytes),
      revision: state.revision,
      compatibility: cloneCompatibility(compatibility),
    };
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "snapshot.result",
      snapshot,
    };
  }

  async #restore(
    request: EngineWorkerRestoreRequest,
  ): Promise<EngineWorkerResponse> {
    const active = this.#session;
    const compatibility = this.#compatibility;
    if (active === undefined || compatibility === undefined) {
      return this.#error(
        request.messageId,
        "not_booted",
        "The engine worker must be booted first.",
      );
    }
    const activeState = active.inspectPublicState();
    const reject = (
      rejection: "incompatible_snapshot" | "corrupt_snapshot",
    ): EngineWorkerResponse => ({
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "restore.result",
      result: {
        status: "rejected",
        rejection,
        revision: activeState.revision,
        output: "",
        turnComplete: true,
        boundary: activeState.boundary,
      },
    });

    let candidateSnapshot: EngineSnapshot;
    try {
      const untrusted = request.snapshot as unknown;
      if (!isRecord(untrusted) || !(untrusted.bytes instanceof Uint8Array)) {
        return reject("corrupt_snapshot");
      }
      if (
        untrusted.bytes.byteLength === 0 ||
        untrusted.bytes.byteLength > WORKER_SNAPSHOT_MAX_TOTAL_BYTES ||
        untrusted.bytes.byteLength > MAX_ENGINE_SNAPSHOT_BYTES
      ) {
        return reject("corrupt_snapshot");
      }
      requireSha256(untrusted.sha256, "snapshot SHA-256");
      requireRevision(untrusted.revision, "snapshot revision");
      const incomingCompatibility = cloneIncomingCompatibility(
        untrusted.compatibility,
      );
      candidateSnapshot = {
        bytes: new Uint8Array(untrusted.bytes),
        sha256: untrusted.sha256,
        revision: untrusted.revision,
        compatibility: incomingCompatibility,
      };
    } catch {
      return reject("corrupt_snapshot");
    }

    if (!sameCompatibility(candidateSnapshot.compatibility, compatibility)) {
      return reject("incompatible_snapshot");
    }
    try {
      if (
        (await digestSha256(candidateSnapshot.bytes)) !==
        candidateSnapshot.sha256
      ) {
        return reject("corrupt_snapshot");
      }
      const envelope = decodeWorkerSnapshotEnvelope(candidateSnapshot.bytes);
      if (envelope.revision !== candidateSnapshot.revision) {
        return reject("corrupt_snapshot");
      }
      const receiptState = this.#validateRestoredReceipts(envelope);
      const lifecycleEpoch = this.#lifecycleEpoch;
      const candidate = await DorkCandidateSession.restoreFromSnapshot(
        this.#storyBytes,
        envelope.innerCheckpoint,
      );
      try {
        const candidateState = candidate.inspectPublicState();
        if (
          candidateState.revision !== envelope.revision ||
          candidateState.lastOutput !== envelope.lastOutput ||
          candidateState.boundary !== envelope.boundary
        ) {
          throw new Error("restored public state does not match the snapshot");
        }
        if (this.#disposed || this.#lifecycleEpoch !== lifecycleEpoch) {
          throw new Error("worker lifecycle changed while restore was staged");
        }

        this.#session = candidate;
        this.#receipts = receiptState.receipts;
        this.#receiptJournalBytes = receiptState.bytes;
        active.dispose();
        return {
          protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
          messageId: request.messageId,
          kind: "restore.result",
          result: {
            status: "restored",
            revision: candidateState.revision,
            output: "",
            turnComplete: true,
            boundary: candidateState.boundary,
          },
        };
      } catch (error) {
        candidate.dispose();
        throw error;
      }
    } catch {
      return reject("corrupt_snapshot");
    }
  }

  #inspect(request: EngineWorkerRequest): EngineWorkerResponse {
    const session = this.#session;
    if (session === undefined) {
      return this.#error(
        request.messageId,
        "not_booted",
        "The engine worker must be booted first.",
      );
    }
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "inspect-public-state.result",
      state: session.inspectPublicState(),
    };
  }

  #createCompatibility(artifactSha256: string): EngineCompatibility {
    return {
      story: { id: this.#storyId, artifactSha256 },
      runtime: { ...DORK_WORKER_BINDING.runtime },
      adapter: { ...DORK_WORKER_BINDING.adapter },
      snapshotSchemaVersion: DORK_WORKER_BINDING.snapshotSchemaVersion,
    };
  }

  #recordReceipt(receipt: WorkerSnapshotReceipt): void {
    const stored = cloneReceipt(receipt);
    if (!this.#canRecordReceipt(stored)) {
      throw new Error("receipt journal capacity was not reserved");
    }
    this.#receipts.set(stored.requestId, stored);
    this.#receiptJournalBytes += measureWorkerSnapshotReceiptBytes(stored);
  }

  #canRecordReceipt(receipt: WorkerSnapshotReceipt): boolean {
    return (
      this.#receipts.size < this.#maxReceipts &&
      this.#receiptJournalBytes + measureWorkerSnapshotReceiptBytes(receipt) <=
        this.#maxReceiptJournalBytes
    );
  }

  #canRecordWorstCaseCommittedReceipt(
    requestId: string,
    expectedRevision: number,
    command: CanonicalCommand,
    previousRevision: number,
  ): boolean {
    const maximumOutput = "x".repeat(DORK_CHECKPOINT_MAX_LAST_OUTPUT_BYTES);
    const receipt = {
      requestId,
      expectedRevision,
      command,
      result: {
        requestId,
        previousRevision,
        revision: previousRevision + 1,
        command,
        output: maximumOutput,
        turnComplete: true,
        boundary: "input-requested",
        status: "committed",
      },
    } as const satisfies WorkerSnapshotReceipt;
    return this.#canRecordReceipt(receipt);
  }

  #validateRestoredReceipts(envelope: WorkerSnapshotEnvelope): {
    readonly receipts: Map<string, WorkerSnapshotReceipt>;
    readonly bytes: number;
  } {
    if (envelope.receipts.length > this.#maxReceipts) {
      throw new Error("snapshot receipt journal exceeds the runtime cap");
    }
    const receipts = new Map<string, WorkerSnapshotReceipt>();
    let bytes = 0;
    for (const receipt of envelope.receipts) {
      const stored = cloneReceipt(receipt);
      if (receipts.has(stored.requestId)) {
        throw new Error("snapshot receipt IDs must be unique");
      }
      bytes += measureWorkerSnapshotReceiptBytes(stored);
      if (bytes > this.#maxReceiptJournalBytes) {
        throw new Error("snapshot receipt journal exceeds the byte cap");
      }
      receipts.set(stored.requestId, stored);
    }
    return { receipts, bytes };
  }

  #rejectedExecute(
    requestId: string,
    command: string,
    revision: number,
    boundary: EngineTurnBoundary,
    rejection:
      "stale_revision" | "duplicate" | "invalid_command" | "receipt_capacity",
  ): ExecuteResult {
    return {
      requestId,
      previousRevision: revision,
      revision,
      command,
      output: "",
      turnComplete: true,
      boundary,
      status: "rejected",
      rejection,
    };
  }

  #executeResponse(
    messageId: string,
    result: ExecuteResult,
  ): EngineWorkerResponse {
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId,
      kind: "execute.result",
      result,
    };
  }

  #receiptCapacityResponse(
    messageId: string,
    requestId: string,
    command: CanonicalCommand,
    revision: number,
    boundary: EngineTurnBoundary,
  ): EngineWorkerResponse {
    return this.#executeResponse(
      messageId,
      this.#rejectedExecute(
        requestId,
        command,
        revision,
        boundary,
        "receipt_capacity",
      ),
    );
  }

  #error(
    messageId: string,
    code:
      "invalid_request" | "not_booted" | "already_booted" | "internal_error",
    message: string,
  ): EngineWorkerResponse {
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId,
      kind: "error",
      error: { code, message },
    };
  }
}
