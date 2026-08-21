import type {
  BootRequest,
  BootResult,
  EngineSnapshot,
  ExecuteResult,
  PublicEngineState,
  RestoreResult,
} from "@sttork/contracts";

export const ENGINE_WORKER_PROTOCOL_VERSION = 1 as const;

interface EngineWorkerRequestBase {
  readonly protocolVersion: typeof ENGINE_WORKER_PROTOCOL_VERSION;
  readonly messageId: string;
}

export interface EngineWorkerBootRequest extends EngineWorkerRequestBase {
  readonly kind: "boot";
  readonly input: BootRequest;
}

export interface EngineWorkerExecuteRequest extends EngineWorkerRequestBase {
  readonly kind: "execute";
  readonly input: {
    readonly requestId: string;
    readonly expectedRevision: number;
    readonly command: string;
  };
}

export interface EngineWorkerSnapshotRequest extends EngineWorkerRequestBase {
  readonly kind: "snapshot";
}

export interface EngineWorkerRestoreRequest extends EngineWorkerRequestBase {
  readonly kind: "restore";
  readonly snapshot: EngineSnapshot;
}

export interface EngineWorkerInspectRequest extends EngineWorkerRequestBase {
  readonly kind: "inspect-public-state";
}

export type EngineWorkerRequest =
  | EngineWorkerBootRequest
  | EngineWorkerExecuteRequest
  | EngineWorkerSnapshotRequest
  | EngineWorkerRestoreRequest
  | EngineWorkerInspectRequest;

interface EngineWorkerResponseBase {
  readonly protocolVersion: typeof ENGINE_WORKER_PROTOCOL_VERSION;
  readonly messageId: string;
}

export interface EngineWorkerBootResponse extends EngineWorkerResponseBase {
  readonly kind: "boot.result";
  readonly result: BootResult;
}

export interface EngineWorkerExecuteResponse extends EngineWorkerResponseBase {
  readonly kind: "execute.result";
  readonly result: ExecuteResult;
}

export interface EngineWorkerSnapshotResponse extends EngineWorkerResponseBase {
  readonly kind: "snapshot.result";
  readonly snapshot: EngineSnapshot;
}

export interface EngineWorkerRestoreResponse extends EngineWorkerResponseBase {
  readonly kind: "restore.result";
  readonly result: RestoreResult;
}

export interface EngineWorkerInspectResponse extends EngineWorkerResponseBase {
  readonly kind: "inspect-public-state.result";
  readonly state: PublicEngineState;
}

export interface EngineWorkerErrorResponse extends EngineWorkerResponseBase {
  readonly kind: "error";
  readonly error: {
    readonly code:
      "invalid_request" | "not_booted" | "already_booted" | "internal_error";
    readonly message: string;
  };
}

export type EngineWorkerResponse =
  | EngineWorkerBootResponse
  | EngineWorkerExecuteResponse
  | EngineWorkerSnapshotResponse
  | EngineWorkerRestoreResponse
  | EngineWorkerInspectResponse
  | EngineWorkerErrorResponse;

/**
 * Typed request/reply seam implemented by a future raw Web Worker codec.
 * No browser-worker or interpreter binding is present in this spike.
 */
export interface EngineWorkerTransport {
  exchange(
    request: EngineWorkerRequest,
    signal?: AbortSignal,
  ): Promise<EngineWorkerResponse>;
}
