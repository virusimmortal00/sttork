import type { CanonicalCommand } from "./canonical-command.js";

/** Maximum opaque engine snapshot payload accepted at any adapter boundary. */
export const MAX_ENGINE_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export interface BootRequest {
  readonly storyId: string;
  readonly artifactSha256: string;
}

export type EngineTurnBoundary = "input-requested" | "terminated";

export interface EngineRuntimeIdentity {
  readonly id: string;
  readonly version: string;
  readonly artifactSha256: string;
}

export interface EngineAdapterIdentity {
  readonly id: string;
  readonly version: string;
}

export interface EngineCompatibility {
  readonly story: {
    readonly id: string;
    readonly artifactSha256: string;
  };
  readonly runtime: EngineRuntimeIdentity;
  readonly adapter: EngineAdapterIdentity;
  readonly snapshotSchemaVersion: number;
}

export interface BootResult {
  readonly revision: 0;
  readonly output: string;
  readonly turnComplete: true;
  readonly boundary: EngineTurnBoundary;
  readonly compatibility: EngineCompatibility;
}

export interface ExecuteRequest {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly command: CanonicalCommand;
}

interface ExecuteResultBase {
  readonly requestId: string;
  readonly previousRevision: number;
  readonly revision: number;
  readonly command: string;
  readonly output: string;
  readonly turnComplete: true;
  readonly boundary: EngineTurnBoundary;
}

export interface CommittedExecuteResult extends ExecuteResultBase {
  readonly status: "committed";
  readonly rejection?: never;
}

export interface RejectedExecuteResult extends ExecuteResultBase {
  readonly status: "rejected";
  readonly rejection: "stale_revision" | "duplicate" | "invalid_command";
}

export type ExecuteResult = CommittedExecuteResult | RejectedExecuteResult;

export interface EngineSnapshot {
  /**
   * Opaque, versioned worker state including the authoritative engine save and
   * the request-receipt journal needed to preserve branch-local idempotency.
   */
  readonly bytes: Uint8Array;
  /** Lowercase SHA-256 of `bytes`. */
  readonly sha256: string;
  readonly revision: number;
  readonly compatibility: EngineCompatibility;
}

export interface RestoredResult {
  readonly status: "restored";
  readonly revision: number;
  readonly output: string;
  readonly turnComplete: true;
  readonly boundary: EngineTurnBoundary;
}

export interface RejectedRestoreResult {
  readonly status: "rejected";
  readonly revision: number;
  readonly output: "";
  readonly turnComplete: true;
  readonly boundary: EngineTurnBoundary;
  readonly rejection: "incompatible_snapshot" | "corrupt_snapshot";
}

export type RestoreResult = RestoredResult | RejectedRestoreResult;

export interface PublicEngineState {
  readonly revision: number;
  readonly lastOutput: string;
  readonly boundary: EngineTurnBoundary;
}

export interface EnginePort {
  boot(input: BootRequest): Promise<BootResult>;
  execute(input: ExecuteRequest, signal?: AbortSignal): Promise<ExecuteResult>;
  snapshot(): Promise<EngineSnapshot>;
  restore(snapshot: EngineSnapshot): Promise<RestoreResult>;
  inspectPublicState(): Promise<PublicEngineState>;
}
