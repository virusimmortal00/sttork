import type {
  EngineWorkerRequest,
  EngineWorkerResponse,
} from "../../packages/game-engine/src/worker-protocol.js";

export const DORK_BROWSER_WORKER_PROTOCOL_VERSION = 1 as const;
export const DORK_BROWSER_WORKER_MAX_STORY_BYTES = 0x1_fffe;
export const DORK_BROWSER_WORKER_MAX_ID_BYTES = 128;

interface DorkBrowserMessageBase {
  readonly protocolVersion: typeof DORK_BROWSER_WORKER_PROTOCOL_VERSION;
  readonly messageId: string;
}

export interface DorkBrowserInitializeRequest extends DorkBrowserMessageBase {
  readonly kind: "dork.initialize";
  readonly storyId: string;
  readonly storyBytes: Uint8Array;
}

export interface DorkBrowserEngineRequest extends DorkBrowserMessageBase {
  readonly kind: "engine.request";
  readonly request: EngineWorkerRequest;
}

export type DorkBrowserHostMessage =
  DorkBrowserInitializeRequest | DorkBrowserEngineRequest;

export interface DorkBrowserInitializeResponse extends DorkBrowserMessageBase {
  readonly kind: "dork.initialized";
  readonly environment: DorkBrowserWorkerEnvironment;
}

export interface DorkBrowserWorkerEnvironment {
  readonly workerGlobalScope: boolean;
  readonly documentAbsent: boolean;
  readonly windowAbsent: boolean;
}

export interface DorkBrowserEngineResponse extends DorkBrowserMessageBase {
  readonly kind: "engine.response";
  readonly response: EngineWorkerResponse;
}

export interface DorkBrowserErrorResponse extends DorkBrowserMessageBase {
  readonly kind: "dork.error";
  readonly error: {
    readonly code:
      | "invalid_message"
      | "not_initialized"
      | "already_initialized"
      | "internal_error";
    readonly message: string;
  };
}

export type DorkBrowserWorkerMessage =
  | DorkBrowserInitializeResponse
  | DorkBrowserEngineResponse
  | DorkBrowserErrorResponse;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(
  value: unknown,
  maximumBytes: number,
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > maximumBytes) return false;
  return new TextEncoder().encode(value).byteLength <= maximumBytes;
}

export function isDorkBrowserInitializeRequest(
  value: unknown,
): value is DorkBrowserInitializeRequest {
  return (
    isObject(value) &&
    value.protocolVersion === DORK_BROWSER_WORKER_PROTOCOL_VERSION &&
    value.kind === "dork.initialize" &&
    isBoundedString(value.messageId, DORK_BROWSER_WORKER_MAX_ID_BYTES) &&
    isBoundedString(value.storyId, DORK_BROWSER_WORKER_MAX_ID_BYTES) &&
    value.storyBytes instanceof Uint8Array &&
    value.storyBytes.byteLength >= 64 &&
    value.storyBytes.byteLength <= DORK_BROWSER_WORKER_MAX_STORY_BYTES
  );
}

export function isDorkBrowserEngineRequest(
  value: unknown,
): value is DorkBrowserEngineRequest {
  return (
    isObject(value) &&
    value.protocolVersion === DORK_BROWSER_WORKER_PROTOCOL_VERSION &&
    value.kind === "engine.request" &&
    isBoundedString(value.messageId, DORK_BROWSER_WORKER_MAX_ID_BYTES) &&
    isObject(value.request)
  );
}

export function isDorkBrowserWorkerMessage(
  value: unknown,
): value is DorkBrowserWorkerMessage {
  if (
    !isObject(value) ||
    value.protocolVersion !== DORK_BROWSER_WORKER_PROTOCOL_VERSION ||
    !isBoundedString(value.messageId, DORK_BROWSER_WORKER_MAX_ID_BYTES)
  ) {
    return false;
  }
  if (value.kind === "dork.initialized") {
    return (
      isObject(value.environment) &&
      typeof value.environment.workerGlobalScope === "boolean" &&
      typeof value.environment.documentAbsent === "boolean" &&
      typeof value.environment.windowAbsent === "boolean"
    );
  }
  if (value.kind === "engine.response") return isObject(value.response);
  return (
    value.kind === "dork.error" &&
    isObject(value.error) &&
    (value.error.code === "invalid_message" ||
      value.error.code === "not_initialized" ||
      value.error.code === "already_initialized" ||
      value.error.code === "internal_error") &&
    typeof value.error.message === "string"
  );
}
