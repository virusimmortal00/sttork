import {
  MAX_ENGINE_SNAPSHOT_BYTES,
  canonicalizeCommand,
  type BootRequest,
  type BootResult,
  type EngineAdapterIdentity,
  type EngineCompatibility,
  type EnginePort,
  type EngineRuntimeIdentity,
  type EngineSnapshot,
  type EngineTurnBoundary,
  type ExecuteRequest,
  type ExecuteResult,
  type PublicEngineState,
  type RestoreResult,
} from "@zork-voice/contracts";

import {
  ENGINE_WORKER_PROTOCOL_VERSION,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
  type EngineWorkerTransport,
} from "./worker-protocol.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface EngineWorkerBinding {
  readonly runtime: EngineRuntimeIdentity;
  readonly adapter: EngineAdapterIdentity;
  readonly snapshotSchemaVersion: number;
}

export interface WorkerEngineAdapterOptions {
  readonly transport: EngineWorkerTransport;
  readonly binding: EngineWorkerBinding;
  readonly nextMessageId: () => string;
  readonly digestSha256?: (bytes: Uint8Array) => Promise<string>;
}

export class EngineAdapterStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EngineAdapterStateError";
  }
}

export class EngineWorkerProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EngineWorkerProtocolError";
  }
}

export class EngineExecutionCancelledError extends Error {
  public readonly requestId: string;
  public readonly commitState = "not-submitted" as const;

  public constructor(requestId: string) {
    super(`Engine request ${requestId} was cancelled before submission.`);
    this.name = "EngineExecutionCancelledError";
    this.requestId = requestId;
  }
}

export class EngineExecutionUncertainError extends Error {
  public readonly requestId: string;
  public readonly expectedRevision: number;
  public readonly commitState = "unknown" as const;

  public constructor(
    requestId: string,
    expectedRevision: number,
    cause: unknown,
  ) {
    super(
      `Engine request ${requestId} was submitted, but its commit state is unknown.`,
      { cause },
    );
    this.name = "EngineExecutionUncertainError";
    this.requestId = requestId;
    this.expectedRevision = expectedRevision;
  }
}

export class EngineRestoreUncertainError extends Error {
  public readonly snapshotRevision: number;
  public readonly commitState = "unknown" as const;

  public constructor(snapshotRevision: number, cause: unknown) {
    super(
      `Restore of engine snapshot revision ${snapshotRevision} was submitted, but its result is unknown.`,
      { cause },
    );
    this.name = "EngineRestoreUncertainError";
    this.snapshotRevision = snapshotRevision;
  }
}

export class EngineBootUncertainError extends Error {
  public readonly storyId: string;
  public readonly commitState = "unknown" as const;

  public constructor(storyId: string, cause: unknown) {
    super(
      `Engine boot for story ${storyId} was submitted, but its result is unknown.`,
      { cause },
    );
    this.name = "EngineBootUncertainError";
    this.storyId = storyId;
  }
}

type AdapterOperation =
  "boot" | "execute" | "snapshot" | "restore" | "inspect-public-state";

type AdapterRecoveryState =
  | { readonly kind: "ready" }
  | { readonly kind: "boot-quarantined"; readonly storyId: string }
  | {
      readonly kind: "execute-uncertain";
      readonly requestId: string;
      readonly expectedRevision: number;
      readonly command: string;
    }
  | {
      readonly kind: "restore-quarantined";
      readonly snapshotRevision: number;
    };

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
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}

function requireTurnBoundary(
  value: unknown,
  field: string,
): asserts value is EngineTurnBoundary {
  if (value !== "input-requested" && value !== "terminated") {
    throw new EngineWorkerProtocolError(`${field} is invalid`);
  }
}

function requireTurnComplete(result: {
  readonly turnComplete: true;
  readonly boundary: string;
  readonly output: string;
}): void {
  if (result.turnComplete !== true) {
    throw new EngineWorkerProtocolError(
      "worker returned a partial engine turn",
    );
  }
  requireTurnBoundary(result.boundary, "worker turn boundary");
  if (typeof result.output !== "string") {
    throw new EngineWorkerProtocolError("worker output must be a string");
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
  requireSha256(compatibility.story.artifactSha256, "story artifactSha256");
  requireNonemptyString(compatibility.runtime.id, "runtime id");
  requireNonemptyString(compatibility.runtime.version, "runtime version");
  requireSha256(compatibility.runtime.artifactSha256, "runtime artifactSha256");
  requireNonemptyString(compatibility.adapter.id, "adapter id");
  requireNonemptyString(compatibility.adapter.version, "adapter version");
  if (
    !Number.isSafeInteger(compatibility.snapshotSchemaVersion) ||
    compatibility.snapshotSchemaVersion < 1
  ) {
    throw new RangeError(
      "snapshotSchemaVersion must be a positive safe integer",
    );
  }
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

export class WorkerEngineAdapter implements EnginePort {
  readonly #transport: EngineWorkerTransport;
  readonly #binding: EngineWorkerBinding;
  readonly #nextMessageId: () => string;
  readonly #digestSha256: (bytes: Uint8Array) => Promise<string>;
  #compatibility: EngineCompatibility | undefined;
  #revision: number | undefined;
  #boundary: EngineTurnBoundary | undefined;
  #operationInFlight: AdapterOperation | undefined;
  #recoveryState: AdapterRecoveryState = { kind: "ready" };

  public constructor(options: WorkerEngineAdapterOptions) {
    const bindingCompatibility: EngineCompatibility = {
      story: {
        id: "binding-validation-placeholder",
        artifactSha256: "0".repeat(64),
      },
      runtime: options.binding.runtime,
      adapter: options.binding.adapter,
      snapshotSchemaVersion: options.binding.snapshotSchemaVersion,
    };
    validateCompatibility(bindingCompatibility);

    this.#transport = options.transport;
    this.#binding = {
      runtime: { ...options.binding.runtime },
      adapter: { ...options.binding.adapter },
      snapshotSchemaVersion: options.binding.snapshotSchemaVersion,
    };
    this.#nextMessageId = options.nextMessageId;
    this.#digestSha256 = options.digestSha256 ?? digestSha256;
  }

  public async boot(input: BootRequest): Promise<BootResult> {
    if (this.#recoveryState.kind === "boot-quarantined") {
      throw new EngineAdapterStateError(
        "cannot retry an uncertain boot; create a fresh adapter and worker",
      );
    }
    if (this.#compatibility !== undefined) {
      throw new EngineAdapterStateError("engine is already booted");
    }
    requireNonemptyString(input.storyId, "storyId");
    requireSha256(input.artifactSha256, "artifactSha256");

    const message = {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: this.#allocateMessageId(),
      kind: "boot",
      input,
    } as const;
    this.#beginOperation("boot");
    let submitted = false;
    try {
      submitted = true;
      const response = await this.#exchange(message, "boot.result");
      const result = response.result;
      requireTurnComplete(result);
      if (result.revision !== 0) {
        throw new EngineWorkerProtocolError("boot revision must be zero");
      }
      validateCompatibility(result.compatibility);

      const expectedCompatibility: EngineCompatibility = {
        story: { id: input.storyId, artifactSha256: input.artifactSha256 },
        runtime: this.#binding.runtime,
        adapter: this.#binding.adapter,
        snapshotSchemaVersion: this.#binding.snapshotSchemaVersion,
      };
      if (!sameCompatibility(result.compatibility, expectedCompatibility)) {
        throw new EngineWorkerProtocolError(
          "worker boot compatibility does not match the configured binding",
        );
      }

      this.#compatibility = cloneCompatibility(result.compatibility);
      this.#revision = 0;
      this.#boundary = result.boundary;
      this.#recoveryState = { kind: "ready" };
      return {
        revision: 0,
        output: result.output,
        turnComplete: true,
        boundary: result.boundary,
        compatibility: cloneCompatibility(result.compatibility),
      };
    } catch (error) {
      if (!submitted) throw error;
      this.#recoveryState = {
        kind: "boot-quarantined",
        storyId: input.storyId,
      };
      throw new EngineBootUncertainError(input.storyId, error);
    } finally {
      this.#endOperation("boot");
    }
  }

  public async execute(
    input: ExecuteRequest,
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const revision = this.#requireRevision();
    const boundary = this.#requireBoundary();
    requireNonemptyString(input.requestId, "requestId");
    requireRevision(input.expectedRevision, "expectedRevision");
    const canonicalCommand = canonicalizeCommand(input.command);
    if (canonicalCommand !== input.command) {
      throw new TypeError("command must already be in canonical form");
    }
    if (signal?.aborted) {
      throw new EngineExecutionCancelledError(input.requestId);
    }
    const resolvesUncertainExecute = this.#assertExecuteAllowed(
      input.requestId,
      input.expectedRevision,
      input.command,
    );
    if (boundary === "terminated" && !resolvesUncertainExecute) {
      throw new EngineAdapterStateError(
        "the engine has terminated; restore or reboot before executing another command",
      );
    }

    const message = {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: this.#allocateMessageId(),
      kind: "execute",
      input: {
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        command: canonicalCommand,
      },
    } as const;

    this.#beginOperation("execute");
    try {
      const response = await this.#exchange(message, "execute.result", signal);
      const result = response.result;
      this.#validateExecuteResult(input, result, revision, boundary);
      if (result.status === "committed" && result.revision >= revision) {
        this.#revision = result.revision;
        this.#boundary = result.boundary;
      } else {
        this.#revision = revision;
      }
      this.#recoveryState = { kind: "ready" };
      return { ...result };
    } catch (error) {
      this.#recoveryState = {
        kind: "execute-uncertain",
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        command: input.command,
      };
      throw new EngineExecutionUncertainError(
        input.requestId,
        input.expectedRevision,
        error,
      );
    } finally {
      this.#endOperation("execute");
    }
  }

  public async snapshot(): Promise<EngineSnapshot> {
    const revision = this.#requireRevision();
    const compatibility = this.#requireCompatibility();
    this.#assertReadyOperation("snapshot");
    const message = {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: this.#allocateMessageId(),
      kind: "snapshot",
    } as const;
    this.#beginOperation("snapshot");
    try {
      const response = await this.#exchange(message, "snapshot.result");
      this.#validateSnapshot(response.snapshot);
      const snapshot = {
        ...response.snapshot,
        bytes: new Uint8Array(response.snapshot.bytes),
        compatibility: cloneCompatibility(response.snapshot.compatibility),
      };
      if (!(await this.#snapshotDigestMatches(snapshot))) {
        throw new EngineWorkerProtocolError(
          "snapshot SHA-256 does not match its bytes",
        );
      }
      if (snapshot.revision !== revision) {
        throw new EngineWorkerProtocolError(
          "snapshot revision does not match the adapter revision",
        );
      }
      if (!sameCompatibility(snapshot.compatibility, compatibility)) {
        throw new EngineWorkerProtocolError(
          "snapshot compatibility does not match the active engine",
        );
      }
      return {
        ...snapshot,
        bytes: snapshot.bytes,
        compatibility: snapshot.compatibility,
      };
    } finally {
      this.#endOperation("snapshot");
    }
  }

  public async restore(snapshot: EngineSnapshot): Promise<RestoreResult> {
    const revision = this.#requireRevision();
    const boundary = this.#requireBoundary();
    const compatibility = this.#requireCompatibility();
    this.#assertReadyOperation("restore");
    this.#beginOperation("restore");
    let submitted = false;
    let candidate: EngineSnapshot | undefined;
    try {
      this.#validateSnapshot(snapshot);
      candidate = {
        ...snapshot,
        bytes: new Uint8Array(snapshot.bytes),
        compatibility: cloneCompatibility(snapshot.compatibility),
      };
      if (!sameCompatibility(candidate.compatibility, compatibility)) {
        return {
          status: "rejected",
          rejection: "incompatible_snapshot",
          revision,
          output: "",
          turnComplete: true,
          boundary,
        };
      }
      if (!(await this.#snapshotDigestMatches(candidate))) {
        return {
          status: "rejected",
          rejection: "corrupt_snapshot",
          revision,
          output: "",
          turnComplete: true,
          boundary,
        };
      }

      const message = {
        protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
        messageId: this.#allocateMessageId(),
        kind: "restore",
        snapshot: candidate,
      } as const;
      submitted = true;
      const response = await this.#exchange(message, "restore.result");
      const result = response.result;
      requireTurnComplete(result);
      requireRevision(result.revision, "restore revision");
      if (result.status === "restored") {
        if (result.revision !== candidate.revision) {
          throw new EngineWorkerProtocolError(
            "restored revision does not match the snapshot revision",
          );
        }
        this.#revision = result.revision;
        this.#boundary = result.boundary;
        this.#recoveryState = { kind: "ready" };
        return { ...result };
      }
      if (
        result.rejection !== "incompatible_snapshot" &&
        result.rejection !== "corrupt_snapshot"
      ) {
        throw new EngineWorkerProtocolError(
          "worker returned an invalid rejection",
        );
      }
      if (
        result.revision !== revision ||
        result.output !== "" ||
        result.boundary !== boundary
      ) {
        throw new EngineWorkerProtocolError(
          "rejected restore must preserve the active engine state",
        );
      }
      return { ...result };
    } catch (error) {
      if (!submitted) throw error;
      const submittedSnapshot = candidate;
      if (submittedSnapshot === undefined) {
        throw new EngineAdapterStateError(
          "restore was submitted without a validated snapshot",
        );
      }
      this.#recoveryState = {
        kind: "restore-quarantined",
        snapshotRevision: submittedSnapshot.revision,
      };
      throw new EngineRestoreUncertainError(submittedSnapshot.revision, error);
    } finally {
      this.#endOperation("restore");
    }
  }

  public async inspectPublicState(): Promise<PublicEngineState> {
    const revision = this.#requireRevision();
    const boundary = this.#requireBoundary();
    const recoveryState = this.#recoveryState;
    const message = {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: this.#allocateMessageId(),
      kind: "inspect-public-state",
    } as const;
    this.#beginOperation("inspect-public-state");
    try {
      const response = await this.#exchange(
        message,
        "inspect-public-state.result",
      );
      requireRevision(response.state.revision, "public state revision");
      if (typeof response.state.lastOutput !== "string") {
        throw new EngineWorkerProtocolError("lastOutput must be a string");
      }
      requireTurnBoundary(response.state.boundary, "public state boundary");
      if (recoveryState.kind === "ready") {
        if (
          response.state.revision !== revision ||
          response.state.boundary !== boundary
        ) {
          throw new EngineWorkerProtocolError(
            "public state does not match the confirmed adapter state",
          );
        }
      } else if (recoveryState.kind === "execute-uncertain") {
        const maximumRevision =
          revision === Number.MAX_SAFE_INTEGER ? revision : revision + 1;
        if (
          response.state.revision < revision ||
          response.state.revision > maximumRevision ||
          (response.state.revision === revision &&
            response.state.boundary !== boundary)
        ) {
          throw new EngineWorkerProtocolError(
            "public state cannot reconcile the uncertain execute",
          );
        }
        this.#revision = response.state.revision;
        this.#boundary = response.state.boundary;
      }
      return { ...response.state };
    } finally {
      this.#endOperation("inspect-public-state");
    }
  }

  #beginOperation(operation: AdapterOperation): void {
    if (this.#operationInFlight !== undefined) {
      throw new EngineAdapterStateError(
        `${this.#operationInFlight} is already in flight`,
      );
    }
    this.#operationInFlight = operation;
  }

  #endOperation(operation: AdapterOperation): void {
    if (this.#operationInFlight !== operation) {
      throw new EngineAdapterStateError(
        `cannot finish ${operation}; ${this.#operationInFlight ?? "no operation"} is in flight`,
      );
    }
    this.#operationInFlight = undefined;
  }

  #allocateMessageId(): string {
    const messageId = this.#nextMessageId();
    requireNonemptyString(messageId, "messageId");
    return messageId;
  }

  async #exchange<TKind extends Exclude<EngineWorkerResponse["kind"], "error">>(
    request: EngineWorkerRequest,
    expectedKind: TKind,
    signal?: AbortSignal,
  ): Promise<Extract<EngineWorkerResponse, { readonly kind: TKind }>> {
    const response = await this.#transport.exchange(request, signal);
    if (response.protocolVersion !== ENGINE_WORKER_PROTOCOL_VERSION) {
      throw new EngineWorkerProtocolError("worker protocol version mismatch");
    }
    if (response.messageId !== request.messageId) {
      throw new EngineWorkerProtocolError("worker response messageId mismatch");
    }
    if (response.kind === "error") {
      throw new EngineWorkerProtocolError(
        `${response.error.code}: ${response.error.message}`,
      );
    }
    if (response.kind !== expectedKind) {
      throw new EngineWorkerProtocolError(
        `expected ${expectedKind}, received ${response.kind}`,
      );
    }
    return response as Extract<EngineWorkerResponse, { readonly kind: TKind }>;
  }

  #requireRevision(): number {
    if (this.#revision === undefined) {
      throw new EngineAdapterStateError("engine must be booted first");
    }
    return this.#revision;
  }

  #requireBoundary(): EngineTurnBoundary {
    if (this.#boundary === undefined) {
      throw new EngineAdapterStateError("engine must be booted first");
    }
    return this.#boundary;
  }

  #requireCompatibility(): EngineCompatibility {
    if (this.#compatibility === undefined) {
      throw new EngineAdapterStateError("engine must be booted first");
    }
    return this.#compatibility;
  }

  #assertReadyOperation(operation: "snapshot" | "restore"): void {
    if (this.#recoveryState.kind === "execute-uncertain") {
      throw new EngineAdapterStateError(
        `cannot ${operation} until the exact uncertain execute is retried and its receipt is recovered`,
      );
    }
    if (this.#recoveryState.kind === "restore-quarantined") {
      throw new EngineAdapterStateError(
        `cannot ${operation} after an uncertain restore; create a fresh adapter and reboot the worker`,
      );
    }
  }

  #assertExecuteAllowed(
    requestId: string,
    expectedRevision: number,
    command: string,
  ): boolean {
    if (this.#recoveryState.kind === "restore-quarantined") {
      throw new EngineAdapterStateError(
        "cannot execute after an uncertain restore; create a fresh adapter and reboot the worker",
      );
    }
    if (this.#recoveryState.kind === "execute-uncertain") {
      if (
        this.#recoveryState.requestId !== requestId ||
        this.#recoveryState.expectedRevision !== expectedRevision ||
        this.#recoveryState.command !== command
      ) {
        throw new EngineAdapterStateError(
          "only the exact uncertain engine request may be retried; inspection alone cannot recover its receipt",
        );
      }
      return true;
    }
    return false;
  }

  #validateExecuteResult(
    input: ExecuteRequest,
    result: ExecuteResult,
    currentRevision: number,
    currentBoundary: EngineTurnBoundary,
  ): void {
    requireNonemptyString(result.requestId, "result requestId");
    requireRevision(result.previousRevision, "previousRevision");
    requireRevision(result.revision, "revision");
    requireTurnComplete(result);
    if (
      result.requestId !== input.requestId ||
      result.command !== input.command
    ) {
      throw new EngineWorkerProtocolError(
        "execute result does not match the submitted request",
      );
    }

    if (result.status === "committed") {
      if (
        result.previousRevision !== input.expectedRevision ||
        result.revision !== result.previousRevision + 1 ||
        (currentRevision !== result.previousRevision &&
          currentRevision < result.revision) ||
        (result.revision === currentRevision &&
          result.boundary !== currentBoundary)
      ) {
        throw new EngineWorkerProtocolError(
          "committed result has an invalid revision transition",
        );
      }
      return;
    }

    if (
      (result.rejection !== "stale_revision" &&
        result.rejection !== "duplicate" &&
        result.rejection !== "invalid_command") ||
      result.previousRevision !== result.revision ||
      result.revision > currentRevision ||
      (result.revision === currentRevision &&
        result.boundary !== currentBoundary)
    ) {
      throw new EngineWorkerProtocolError(
        "rejected result must preserve the current revision",
      );
    }
  }

  #validateSnapshot(snapshot: EngineSnapshot): void {
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
    requireSha256(snapshot.sha256, "snapshot sha256");
    requireRevision(snapshot.revision, "snapshot revision");
    validateCompatibility(snapshot.compatibility);
  }

  async #snapshotDigestMatches(snapshot: EngineSnapshot): Promise<boolean> {
    const actual = await this.#digestSha256(new Uint8Array(snapshot.bytes));
    requireSha256(actual, "computed snapshot sha256");
    return actual === snapshot.sha256;
  }
}
