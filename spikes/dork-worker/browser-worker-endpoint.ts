import type {
  EngineWorkerRequest,
  EngineWorkerResponse,
} from "../../packages/game-engine/src/worker-protocol.js";

import {
  DORK_BROWSER_WORKER_MAX_ID_BYTES,
  DORK_BROWSER_WORKER_PROTOCOL_VERSION,
  isDorkBrowserEngineRequest,
  isDorkBrowserInitializeRequest,
  type DorkBrowserErrorResponse,
  type DorkBrowserWorkerMessage,
} from "./browser-worker-messages.js";
import { DorkWorkerRuntime } from "./dork-worker-runtime.js";

export interface DorkBrowserWorkerMessageEvent {
  readonly data: unknown;
}

/** The small structural surface used from a browser Dedicated Worker. */
export interface DorkBrowserWorkerScope {
  readonly importScripts?: unknown;
  postMessage(message: DorkBrowserWorkerMessage): void;
  addEventListener(
    type: "message",
    listener: (event: DorkBrowserWorkerMessageEvent) => void,
  ): void;
}

interface DorkWorkerRuntimePort {
  exchange(request: EngineWorkerRequest): Promise<EngineWorkerResponse>;
}

export type DorkWorkerRuntimeFactory = (
  storyId: string,
  storyBytes: Uint8Array,
) => DorkWorkerRuntimePort;

type InitializationState =
  | { readonly kind: "uninitialized" }
  | { readonly kind: "initialized"; readonly runtime: DorkWorkerRuntimePort }
  | { readonly kind: "failed" };

const INVALID_MESSAGE_ID = "invalid-message";
const INTERNAL_ERROR_MESSAGE =
  "The Dork worker could not complete the request.";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseMessageId(value: unknown): string {
  if (!isObject(value) || typeof value.messageId !== "string") {
    return INVALID_MESSAGE_ID;
  }
  const { messageId } = value;
  if (
    messageId.length === 0 ||
    messageId.length > DORK_BROWSER_WORKER_MAX_ID_BYTES ||
    new TextEncoder().encode(messageId).byteLength >
      DORK_BROWSER_WORKER_MAX_ID_BYTES
  ) {
    return INVALID_MESSAGE_ID;
  }
  return messageId;
}

function errorResponse(
  messageId: string,
  code: DorkBrowserErrorResponse["error"]["code"],
  message: string,
): DorkBrowserErrorResponse {
  return {
    protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
    messageId,
    kind: "dork.error",
    error: { code, message },
  };
}

function defaultRuntimeFactory(
  storyId: string,
  storyBytes: Uint8Array,
): DorkWorkerRuntimePort {
  return new DorkWorkerRuntime({ storyId, storyBytes });
}

export function installDorkBrowserWorkerEndpoint(
  scope: DorkBrowserWorkerScope,
  createRuntime: DorkWorkerRuntimeFactory = defaultRuntimeFactory,
): void {
  let initialization: InitializationState = { kind: "uninitialized" };

  const safePost = (message: DorkBrowserWorkerMessage): void => {
    try {
      scope.postMessage(message);
    } catch {
      // A failed worker reply cannot be reported through the same broken port.
      // Swallow it so an event callback never throws into the worker runtime.
    }
  };

  const postInternalError = (messageId: string): void => {
    safePost(
      errorResponse(messageId, "internal_error", INTERNAL_ERROR_MESSAGE),
    );
  };

  const onMessage = (event: DorkBrowserWorkerMessageEvent): void => {
    let messageId = INVALID_MESSAGE_ID;

    try {
      const message = event.data;
      messageId = responseMessageId(message);
      if (isDorkBrowserInitializeRequest(message)) {
        if (initialization.kind !== "uninitialized") {
          safePost(
            errorResponse(
              message.messageId,
              "already_initialized",
              "Dork worker initialization was already attempted.",
            ),
          );
          return;
        }

        // Consume the one initialization attempt before invoking user-controlled
        // construction and detach the runtime from the caller's mutable view.
        initialization = { kind: "failed" };
        const storyBytes = new Uint8Array(message.storyBytes);
        const runtime = createRuntime(message.storyId, storyBytes);
        initialization = { kind: "initialized", runtime };
        safePost({
          protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
          messageId: message.messageId,
          kind: "dork.initialized",
          environment: {
            workerGlobalScope: typeof scope.importScripts === "function",
            documentAbsent: !("document" in scope),
            windowAbsent: !("window" in scope),
          },
        });
        return;
      }

      if (isDorkBrowserEngineRequest(message)) {
        if (initialization.kind !== "initialized") {
          safePost(
            errorResponse(
              message.messageId,
              "not_initialized",
              "Initialize the Dork worker before sending engine requests.",
            ),
          );
          return;
        }

        const runtime = initialization.runtime;
        void runtime.exchange(message.request).then(
          (response) => {
            safePost({
              protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
              messageId: message.messageId,
              kind: "engine.response",
              response,
            });
          },
          () => postInternalError(message.messageId),
        );
        return;
      }

      safePost(
        errorResponse(
          messageId,
          "invalid_message",
          "The worker message is invalid.",
        ),
      );
    } catch {
      postInternalError(messageId);
    }
  };

  scope.addEventListener("message", onMessage);
}
