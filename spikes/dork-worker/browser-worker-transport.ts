import type {
  EngineWorkerRequest,
  EngineWorkerResponse,
} from "../../packages/game-engine/src/worker-protocol.js";

import type {
  DorkWorkerLease,
  DorkWorkerLeaseFactory,
} from "./dork-worker-engine.js";
import {
  DORK_BROWSER_WORKER_PROTOCOL_VERSION,
  isDorkBrowserWorkerMessage,
  type DorkBrowserHostMessage,
  type DorkBrowserWorkerEnvironment,
  type DorkBrowserWorkerMessage,
} from "./browser-worker-messages.js";

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  readonly message?: string;
}

type WorkerMessageListener = (event: WorkerMessageEventLike) => void;
type WorkerErrorListener = (event: WorkerErrorEventLike) => void;

export interface DorkBrowserWorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(type: "message", listener: WorkerMessageListener): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: WorkerErrorListener,
  ): void;
  removeEventListener(type: "message", listener: WorkerMessageListener): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: WorkerErrorListener,
  ): void;
  terminate(): void;
}

export interface BrowserDorkWorkerFactoryOptions {
  readonly createWorker: () => DorkBrowserWorkerLike;
  readonly nextInitializationId?: () => string;
  readonly initializationTimeoutMs?: number;
}

interface PendingExchange {
  readonly expectedKind: DorkBrowserWorkerMessage["kind"];
  readonly resolve: (message: DorkBrowserWorkerMessage) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal | undefined;
  readonly abort: (() => void) | undefined;
  readonly timeout: ReturnType<typeof setTimeout> | undefined;
}

export class DorkBrowserWorkerTransportError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DorkBrowserWorkerTransportError";
  }
}

function abortError(): DOMException {
  return new DOMException("The Worker exchange was aborted.", "AbortError");
}

function requireMessageId(value: string): void {
  if (value.length === 0 || new TextEncoder().encode(value).byteLength > 128) {
    throw new TypeError(
      "Worker messageId must contain 1 through 128 UTF-8 bytes",
    );
  }
}

class BrowserDorkWorkerLease implements DorkWorkerLease {
  readonly #worker: DorkBrowserWorkerLike;
  readonly #pending = new Map<string, PendingExchange>();
  readonly #onMessage: WorkerMessageListener;
  readonly #onError: WorkerErrorListener;
  #terminated = false;

  public constructor(worker: DorkBrowserWorkerLike) {
    this.#worker = worker;
    this.#onMessage = (event) => this.#receive(event.data);
    this.#onError = (event) => {
      this.#fail(
        new DorkBrowserWorkerTransportError(
          event.message === undefined
            ? "The Dork Worker failed."
            : `The Dork Worker failed: ${event.message}`,
        ),
      );
    };
    worker.addEventListener("message", this.#onMessage);
    worker.addEventListener("error", this.#onError);
    worker.addEventListener("messageerror", this.#onError);
  }

  public async initialize(
    messageId: string,
    storyId: string,
    storyBytes: Uint8Array,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<DorkBrowserWorkerEnvironment> {
    const bytes = new Uint8Array(storyBytes);
    const message = {
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId,
      kind: "dork.initialize",
      storyId,
      storyBytes: bytes,
    } as const;
    const response = await this.#send(
      message,
      "dork.initialized",
      signal,
      timeoutMs,
      [bytes.buffer],
    );
    if (response.kind !== "dork.initialized") {
      throw new DorkBrowserWorkerTransportError(
        `Expected dork.initialized, received ${response.kind}`,
      );
    }
    return { ...response.environment };
  }

  public async exchange(
    request: EngineWorkerRequest,
    signal?: AbortSignal,
  ): Promise<EngineWorkerResponse> {
    const response = await this.#send(
      {
        protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
        messageId: request.messageId,
        kind: "engine.request",
        request,
      },
      "engine.response",
      signal,
    );
    if (response.kind !== "engine.response") {
      throw new DorkBrowserWorkerTransportError(
        `Expected engine.response, received ${response.kind}`,
      );
    }
    return response.response;
  }

  public terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#detachAndTerminate();
    this.#rejectPending(
      new DorkBrowserWorkerTransportError("The Dork Worker was terminated."),
    );
  }

  async #send(
    message: DorkBrowserHostMessage,
    expectedKind: DorkBrowserWorkerMessage["kind"],
    signal?: AbortSignal,
    timeoutMs?: number,
    transfer?: readonly Transferable[],
  ): Promise<DorkBrowserWorkerMessage> {
    if (this.#terminated) {
      throw new DorkBrowserWorkerTransportError(
        "Cannot use a terminated Dork Worker.",
      );
    }
    requireMessageId(message.messageId);
    if (signal?.aborted) throw abortError();
    if (this.#pending.has(message.messageId)) {
      throw new DorkBrowserWorkerTransportError(
        `Worker messageId ${message.messageId} is already in flight.`,
      );
    }

    return await new Promise<DorkBrowserWorkerMessage>((resolve, reject) => {
      const abort =
        signal === undefined
          ? undefined
          : (): void => {
              const pending = this.#take(message.messageId);
              pending?.reject(abortError());
            };
      const timeout =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              const pending = this.#take(message.messageId);
              pending?.reject(
                new DorkBrowserWorkerTransportError(
                  "Dork Worker initialization timed out.",
                ),
              );
            }, timeoutMs);
      this.#pending.set(message.messageId, {
        expectedKind,
        resolve,
        reject,
        signal,
        abort,
        timeout,
      });
      signal?.addEventListener("abort", abort!, { once: true });
      try {
        this.#worker.postMessage(message, transfer);
      } catch (error) {
        this.#take(message.messageId)?.reject(error);
      }
    });
  }

  #receive(value: unknown): void {
    if (!isDorkBrowserWorkerMessage(value)) {
      this.#fail(
        new DorkBrowserWorkerTransportError(
          "The Dork Worker returned a malformed message.",
        ),
      );
      return;
    }
    const pending = this.#take(value.messageId);
    if (pending === undefined) return;
    if (value.kind === "dork.error") {
      pending.reject(
        new DorkBrowserWorkerTransportError(
          `${value.error.code}: ${value.error.message}`,
        ),
      );
      return;
    }
    if (value.kind !== pending.expectedKind) {
      pending.reject(
        new DorkBrowserWorkerTransportError(
          `Expected ${pending.expectedKind}, received ${value.kind}.`,
        ),
      );
      return;
    }
    pending.resolve(value);
  }

  #take(messageId: string): PendingExchange | undefined {
    const pending = this.#pending.get(messageId);
    if (pending === undefined) return undefined;
    this.#pending.delete(messageId);
    if (pending.abort !== undefined) {
      pending.signal?.removeEventListener("abort", pending.abort);
    }
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    return pending;
  }

  #fail(error: Error): void {
    if (!this.#terminated) {
      this.#terminated = true;
      this.#detachAndTerminate();
    }
    this.#rejectPending(error);
  }

  #detachAndTerminate(): void {
    try {
      this.#worker.removeEventListener("message", this.#onMessage);
    } catch {
      // Continue best-effort cleanup.
    }
    try {
      this.#worker.removeEventListener("error", this.#onError);
    } catch {
      // Continue best-effort cleanup.
    }
    try {
      this.#worker.removeEventListener("messageerror", this.#onError);
    } catch {
      // Continue best-effort cleanup.
    }
    try {
      this.#worker.terminate();
    } catch {
      // The lease remains terminal even if the host cleanup primitive fails.
    }
  }

  #rejectPending(error: Error): void {
    for (const messageId of this.#pending.keys()) {
      this.#take(messageId)?.reject(error);
    }
  }
}

export class BrowserDorkWorkerFactory implements DorkWorkerLeaseFactory {
  readonly #createWorker: () => DorkBrowserWorkerLike;
  readonly #nextInitializationId: () => string;
  readonly #initializationTimeoutMs: number;
  #lastEnvironment: DorkBrowserWorkerEnvironment | undefined;

  public constructor(options: BrowserDorkWorkerFactoryOptions) {
    if (
      options.initializationTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.initializationTimeoutMs) ||
        options.initializationTimeoutMs < 1 ||
        options.initializationTimeoutMs > 60_000)
    ) {
      throw new RangeError(
        "initializationTimeoutMs must be an integer from 1 through 60000",
      );
    }
    this.#createWorker = options.createWorker;
    this.#nextInitializationId =
      options.nextInitializationId ?? (() => globalThis.crypto.randomUUID());
    this.#initializationTimeoutMs = options.initializationTimeoutMs ?? 10_000;
  }

  public async create(
    input: { readonly storyId: string; readonly storyBytes: Uint8Array },
    signal?: AbortSignal,
  ): Promise<DorkWorkerLease> {
    this.#lastEnvironment = undefined;
    const worker = this.#createWorker();
    const lease = new BrowserDorkWorkerLease(worker);
    try {
      this.#lastEnvironment = await lease.initialize(
        this.#nextInitializationId(),
        input.storyId,
        input.storyBytes,
        this.#initializationTimeoutMs,
        signal,
      );
      return lease;
    } catch (error) {
      lease.terminate();
      throw error;
    }
  }

  public get lastEnvironment(): DorkBrowserWorkerEnvironment | undefined {
    return this.#lastEnvironment === undefined
      ? undefined
      : { ...this.#lastEnvironment };
  }
}
