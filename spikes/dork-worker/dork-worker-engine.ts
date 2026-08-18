import {
  MAX_ENGINE_SNAPSHOT_BYTES,
  type BootRequest,
  type BootResult,
  type EngineCompatibility,
  type EnginePort,
  type EngineSnapshot,
  type ExecuteRequest,
  type ExecuteResult,
  type PublicEngineState,
  type RestoreResult,
} from "../../packages/contracts/src/index.js";
import {
  EngineAdapterStateError,
  EngineExecutionUncertainError,
  WorkerEngineAdapter,
  type EngineWorkerBinding,
} from "../../packages/game-engine/src/worker-engine-adapter.js";
import type { EngineWorkerTransport } from "../../packages/game-engine/src/worker-protocol.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface DorkWorkerLease extends EngineWorkerTransport {
  terminate(): void;
}

export interface DorkWorkerLeaseFactory {
  create(
    input: {
      readonly storyId: string;
      readonly storyBytes: Uint8Array;
    },
    signal?: AbortSignal,
  ): Promise<DorkWorkerLease>;
}

export interface DorkWorkerEngineOptions {
  readonly factory: DorkWorkerLeaseFactory;
  readonly storyBytes: Uint8Array;
  readonly binding: EngineWorkerBinding;
  readonly nextMessageId: () => string;
  readonly digestSha256?: (bytes: Uint8Array) => Promise<string>;
}

interface ActiveWorker {
  readonly lease: DorkWorkerLease;
  readonly adapter: WorkerEngineAdapter;
  readonly bootRequest: BootRequest;
  readonly compatibility: EngineCompatibility;
  state: PublicEngineState;
}

interface UncertainExecute {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly command: string;
}

export class DorkWorkerRestoreCancelledError extends Error {
  public readonly activeState = "preserved" as const;

  public constructor() {
    super(
      "Replacement-worker restore was cancelled; the active game was preserved.",
    );
    this.name = "DorkWorkerRestoreCancelledError";
  }
}

export class DorkWorkerRestoreError extends Error {
  public readonly activeState = "preserved" as const;

  public constructor(cause: unknown) {
    super("Replacement-worker restore failed; the active game was preserved.", {
      cause,
    });
    this.name = "DorkWorkerRestoreError";
  }
}

type Operation =
  "boot" | "execute" | "snapshot" | "restore" | "inspect-public-state";

function requireNonemptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a nonempty string`);
  }
}

function requireSha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

function requireRevision(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
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

function validateCompatibility(compatibility: EngineCompatibility): void {
  requireNonemptyString(compatibility.story.id, "story id");
  requireSha256(compatibility.story.artifactSha256, "story artifact SHA-256");
  requireNonemptyString(compatibility.runtime.id, "runtime id");
  requireNonemptyString(compatibility.runtime.version, "runtime version");
  requireSha256(
    compatibility.runtime.artifactSha256,
    "runtime artifact SHA-256",
  );
  requireNonemptyString(compatibility.adapter.id, "adapter id");
  requireNonemptyString(compatibility.adapter.version, "adapter version");
  if (
    !Number.isSafeInteger(compatibility.snapshotSchemaVersion) ||
    compatibility.snapshotSchemaVersion < 1
  ) {
    throw new RangeError(
      "snapshot schema version must be a positive safe integer",
    );
  }
}

function cloneSnapshot(snapshot: EngineSnapshot): EngineSnapshot {
  if (
    !(snapshot.bytes instanceof Uint8Array) ||
    snapshot.bytes.byteLength === 0
  ) {
    throw new TypeError("snapshot bytes must be a nonempty Uint8Array");
  }
  if (snapshot.bytes.byteLength > MAX_ENGINE_SNAPSHOT_BYTES) {
    throw new RangeError(
      `snapshot bytes must not exceed ${MAX_ENGINE_SNAPSHOT_BYTES} bytes`,
    );
  }
  requireSha256(snapshot.sha256, "snapshot SHA-256");
  requireRevision(snapshot.revision, "snapshot revision");
  validateCompatibility(snapshot.compatibility);
  return {
    bytes: new Uint8Array(snapshot.bytes),
    sha256: snapshot.sha256,
    revision: snapshot.revision,
    compatibility: cloneCompatibility(snapshot.compatibility),
  };
}

async function digestSha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function cancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DorkWorkerRestoreCancelledError();
}

function terminateQuietly(lease: DorkWorkerLease | undefined): void {
  try {
    lease?.terminate();
  } catch {
    // Termination is cleanup after the active-state decision. A broken Worker
    // host must not turn a confirmed swap or rejection into an ambiguous one.
  }
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  cancelled(signal);
  if (signal === undefined) return promise;

  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new DorkWorkerRestoreCancelledError());
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Isolated ADR-0009 facade that adds replacement-worker restore semantics to
 * the generic single-transport adapter. It is intentionally not exported by
 * the production game-engine package while Dork remains a candidate.
 */
export class DorkWorkerEngine implements EnginePort {
  readonly #factory: DorkWorkerLeaseFactory;
  readonly #storyBytes: Uint8Array;
  readonly #binding: EngineWorkerBinding;
  readonly #nextMessageId: () => string;
  readonly #digestSha256: (bytes: Uint8Array) => Promise<string>;
  #active: ActiveWorker | undefined;
  #operation: Operation | undefined;
  #uncertainExecute: UncertainExecute | undefined;
  #disposed = false;
  #lifecycleEpoch = 0;

  public constructor(options: DorkWorkerEngineOptions) {
    if (!(options.storyBytes instanceof Uint8Array)) {
      throw new TypeError("storyBytes must be a Uint8Array");
    }
    if (options.storyBytes.byteLength < 64) {
      throw new RangeError("storyBytes must contain a complete story header");
    }
    const compatibilityProbe: EngineCompatibility = {
      story: { id: "binding-probe", artifactSha256: "0".repeat(64) },
      runtime: { ...options.binding.runtime },
      adapter: { ...options.binding.adapter },
      snapshotSchemaVersion: options.binding.snapshotSchemaVersion,
    };
    validateCompatibility(compatibilityProbe);

    this.#factory = options.factory;
    this.#storyBytes = new Uint8Array(options.storyBytes);
    this.#binding = {
      runtime: { ...options.binding.runtime },
      adapter: { ...options.binding.adapter },
      snapshotSchemaVersion: options.binding.snapshotSchemaVersion,
    };
    this.#nextMessageId = options.nextMessageId;
    this.#digestSha256 = options.digestSha256 ?? digestSha256;
  }

  public async boot(input: BootRequest): Promise<BootResult> {
    this.#assertUsable();
    if (this.#active !== undefined) {
      throw new EngineAdapterStateError("engine is already booted");
    }
    requireNonemptyString(input.storyId, "storyId");
    requireSha256(input.artifactSha256, "artifactSha256");
    const lifecycleEpoch = this.#lifecycleEpoch;
    this.#begin("boot");
    let lease: DorkWorkerLease | undefined;
    try {
      lease = await this.#factory.create({
        storyId: input.storyId,
        storyBytes: new Uint8Array(this.#storyBytes),
      });
      const adapter = this.#createAdapter(lease);
      const result = await adapter.boot(input);
      if (this.#disposed || this.#lifecycleEpoch !== lifecycleEpoch) {
        throw new EngineAdapterStateError(
          "Dork worker engine lifecycle changed while boot was staged",
        );
      }
      this.#active = {
        lease,
        adapter,
        bootRequest: { ...input },
        compatibility: cloneCompatibility(result.compatibility),
        state: {
          revision: result.revision,
          lastOutput: result.output,
          boundary: result.boundary,
        },
      };
      lease = undefined;
      return result;
    } finally {
      terminateQuietly(lease);
      this.#end("boot");
    }
  }

  public async execute(
    input: ExecuteRequest,
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const active = this.#requireActive();
    this.#begin("execute");
    try {
      const result = await active.adapter.execute(input, signal);
      if (
        result.status === "committed" &&
        result.revision >= active.state.revision
      ) {
        active.state = {
          revision: result.revision,
          lastOutput: result.output,
          boundary: result.boundary,
        };
      }
      this.#uncertainExecute = undefined;
      return result;
    } catch (error) {
      if (error instanceof EngineExecutionUncertainError) {
        this.#uncertainExecute = {
          requestId: input.requestId,
          expectedRevision: input.expectedRevision,
          command: input.command,
        };
      }
      throw error;
    } finally {
      this.#end("execute");
    }
  }

  public async snapshot(): Promise<EngineSnapshot> {
    const active = this.#requireActive();
    this.#begin("snapshot");
    try {
      return await active.adapter.snapshot();
    } finally {
      this.#end("snapshot");
    }
  }

  public async restore(
    snapshot: EngineSnapshot,
    signal?: AbortSignal,
  ): Promise<RestoreResult> {
    const active = this.#requireActive();
    if (this.#uncertainExecute !== undefined) {
      throw new EngineAdapterStateError(
        "cannot restore until the exact uncertain execute is retried and its receipt is recovered",
      );
    }
    const lifecycleEpoch = this.#lifecycleEpoch;
    this.#begin("restore");
    let candidateLease: DorkWorkerLease | undefined;
    try {
      // Copy and cap synchronously before any asynchronous digest or factory
      // work. The caller cannot alter the bytes that are later authenticated.
      const candidateSnapshot = cloneSnapshot(snapshot);
      if (
        !sameCompatibility(
          candidateSnapshot.compatibility,
          active.compatibility,
        )
      ) {
        return this.#rejectedRestore(active, "incompatible_snapshot");
      }
      if (
        (await this.#digestSha256(candidateSnapshot.bytes)) !==
        candidateSnapshot.sha256
      ) {
        return this.#rejectedRestore(active, "corrupt_snapshot");
      }
      cancelled(signal);

      candidateLease = await this.#factory.create(
        {
          storyId: active.bootRequest.storyId,
          storyBytes: new Uint8Array(this.#storyBytes),
        },
        signal,
      );
      cancelled(signal);
      const candidateAdapter = this.#createAdapter(candidateLease);
      // Boot output is intentionally private staging data and never becomes an
      // engine.output event or RestoreResult output.
      await withAbort(candidateAdapter.boot(active.bootRequest), signal);
      const result = await withAbort(
        candidateAdapter.restore(candidateSnapshot),
        signal,
      );
      if (result.status === "rejected") {
        return this.#rejectedRestore(active, result.rejection);
      }
      if (result.output !== "") {
        throw new Error("replacement restore emitted engine prose");
      }
      const candidateState = await withAbort(
        candidateAdapter.inspectPublicState(),
        signal,
      );
      if (
        candidateState.revision !== result.revision ||
        candidateState.boundary !== result.boundary
      ) {
        throw new Error(
          "replacement worker public state does not match restore",
        );
      }
      cancelled(signal);
      if (this.#disposed || this.#lifecycleEpoch !== lifecycleEpoch) {
        throw new EngineAdapterStateError(
          "Dork worker engine lifecycle changed while restore was staged",
        );
      }

      const oldLease = active.lease;
      this.#active = {
        lease: candidateLease,
        adapter: candidateAdapter,
        bootRequest: { ...active.bootRequest },
        compatibility: cloneCompatibility(active.compatibility),
        state: { ...candidateState },
      };
      candidateLease = undefined;
      this.#uncertainExecute = undefined;
      terminateQuietly(oldLease);
      return {
        status: "restored",
        revision: result.revision,
        output: "",
        turnComplete: true,
        boundary: result.boundary,
      };
    } catch (error) {
      if (error instanceof DorkWorkerRestoreCancelledError) throw error;
      throw new DorkWorkerRestoreError(error);
    } finally {
      terminateQuietly(candidateLease);
      this.#end("restore");
    }
  }

  public async inspectPublicState(): Promise<PublicEngineState> {
    const active = this.#requireActive();
    this.#begin("inspect-public-state");
    try {
      const state = await active.adapter.inspectPublicState();
      active.state = { ...state };
      return state;
    } finally {
      this.#end("inspect-public-state");
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lifecycleEpoch += 1;
    terminateQuietly(this.#active?.lease);
    this.#active = undefined;
  }

  #createAdapter(lease: DorkWorkerLease): WorkerEngineAdapter {
    return new WorkerEngineAdapter({
      transport: lease,
      binding: this.#binding,
      nextMessageId: this.#nextMessageId,
      digestSha256: this.#digestSha256,
    });
  }

  #rejectedRestore(
    active: ActiveWorker,
    rejection: "incompatible_snapshot" | "corrupt_snapshot",
  ): RestoreResult {
    return {
      status: "rejected",
      rejection,
      revision: active.state.revision,
      output: "",
      turnComplete: true,
      boundary: active.state.boundary,
    };
  }

  #requireActive(): ActiveWorker {
    this.#assertUsable();
    const active = this.#active;
    if (active === undefined) {
      throw new EngineAdapterStateError("engine must be booted first");
    }
    return active;
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new EngineAdapterStateError("Dork worker engine is disposed");
    }
  }

  #begin(operation: Operation): void {
    if (this.#operation !== undefined) {
      throw new EngineAdapterStateError(
        `${this.#operation} is already in flight`,
      );
    }
    this.#operation = operation;
  }

  #end(operation: Operation): void {
    if (this.#operation !== operation) {
      throw new EngineAdapterStateError(
        `cannot finish ${operation}; ${this.#operation ?? "no operation"} is in flight`,
      );
    }
    this.#operation = undefined;
  }
}
