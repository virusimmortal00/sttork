import {
  ENGINE_WORKER_PROTOCOL_VERSION,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
} from "../packages/game-engine/src/worker-protocol.js";
import {
  DORK_BROWSER_WORKER_PROTOCOL_VERSION,
  type DorkBrowserWorkerMessage,
} from "../spikes/dork-worker/browser-worker-messages.js";
import {
  BrowserDorkWorkerFactory,
  DorkBrowserWorkerTransportError,
  type DorkBrowserWorkerLike,
} from "../spikes/dork-worker/browser-worker-transport.js";
import { describe, expect, it } from "vitest";

type MessageListener = (event: { readonly data: unknown }) => void;
type ErrorListener = (event: { readonly message?: string }) => void;

class FakeBrowserWorker implements DorkBrowserWorkerLike {
  public readonly posted: unknown[] = [];
  public readonly transfers: Array<readonly Transferable[]> = [];
  public terminated = false;
  readonly #messages = new Set<MessageListener>();
  readonly #errors = new Set<ErrorListener>();
  readonly #messageErrors = new Set<ErrorListener>();

  public postMessage(
    message: unknown,
    transfer: readonly Transferable[] = [],
  ): void {
    if (this.terminated) throw new Error("fake worker is terminated");
    this.posted.push(message);
    this.transfers.push(transfer);
  }

  public addEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | ErrorListener,
  ): void {
    if (type === "message") this.#messages.add(listener as MessageListener);
    else if (type === "error") this.#errors.add(listener as ErrorListener);
    else this.#messageErrors.add(listener as ErrorListener);
  }

  public removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | ErrorListener,
  ): void {
    if (type === "message") this.#messages.delete(listener as MessageListener);
    else if (type === "error") this.#errors.delete(listener as ErrorListener);
    else this.#messageErrors.delete(listener as ErrorListener);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public respond(message: DorkBrowserWorkerMessage): void {
    for (const listener of this.#messages) listener({ data: message });
  }

  public fail(message = "worker crash"): void {
    for (const listener of this.#errors) listener({ message });
  }
}

function storyBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes[0] = 3;
  return bytes;
}

function initialized(messageId: string): DorkBrowserWorkerMessage {
  return {
    protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
    messageId,
    kind: "dork.initialized",
    environment: {
      workerGlobalScope: true,
      documentAbsent: true,
      windowAbsent: true,
    },
  };
}

function inspectRequest(messageId: string): EngineWorkerRequest {
  return {
    protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
    messageId,
    kind: "inspect-public-state",
  };
}

function inspectResponse(messageId: string): EngineWorkerResponse {
  return {
    protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
    messageId,
    kind: "inspect-public-state.result",
    state: {
      revision: 0,
      lastOutput: "Opening\n\n> ",
      boundary: "input-requested",
    },
  };
}

async function initializedLease(): Promise<{
  readonly worker: FakeBrowserWorker;
  readonly factory: BrowserDorkWorkerFactory;
  readonly lease: Awaited<ReturnType<BrowserDorkWorkerFactory["create"]>>;
}> {
  const worker = new FakeBrowserWorker();
  const factory = new BrowserDorkWorkerFactory({
    createWorker: () => worker,
    nextInitializationId: () => "initialize-1",
  });
  const creation = factory.create({
    storyId: "minimal-story",
    storyBytes: storyBytes(),
  });
  await Promise.resolve();
  worker.respond(initialized("initialize-1"));
  return { worker, factory, lease: await creation };
}

describe("Dork browser Worker transport", () => {
  it("initializes with a transferred copy and records Worker isolation evidence", async () => {
    const source = storyBytes();
    const worker = new FakeBrowserWorker();
    const factory = new BrowserDorkWorkerFactory({
      createWorker: () => worker,
      nextInitializationId: () => "initialize-copy",
    });
    const creation = factory.create({
      storyId: "minimal-story",
      storyBytes: source,
    });
    await Promise.resolve();

    const posted = worker.posted[0] as {
      readonly kind: string;
      readonly storyBytes: Uint8Array;
    };
    expect(posted.kind).toBe("dork.initialize");
    expect(posted.storyBytes).toEqual(source);
    expect(posted.storyBytes).not.toBe(source);
    expect(worker.transfers[0]).toEqual([posted.storyBytes.buffer]);
    worker.respond(initialized("initialize-copy"));

    await expect(creation).resolves.toBeDefined();
    expect(factory.lastEnvironment).toEqual({
      workerGlobalScope: true,
      documentAbsent: true,
      windowAbsent: true,
    });
  });

  it("correlates engine responses and ignores a late response after local abort", async () => {
    const { worker, lease } = await initializedLease();
    const first = lease.exchange(inspectRequest("inspect-1"));
    worker.respond({
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId: "inspect-1",
      kind: "engine.response",
      response: inspectResponse("inspect-1"),
    });
    await expect(first).resolves.toEqual(inspectResponse("inspect-1"));

    const abort = new AbortController();
    const submitted = lease.exchange(
      inspectRequest("inspect-aborted"),
      abort.signal,
    );
    abort.abort();
    await expect(submitted).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(false);
    worker.respond({
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId: "inspect-aborted",
      kind: "engine.response",
      response: inspectResponse("inspect-aborted"),
    });

    const next = lease.exchange(inspectRequest("inspect-next"));
    worker.respond({
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId: "inspect-next",
      kind: "engine.response",
      response: inspectResponse("inspect-next"),
    });
    await expect(next).resolves.toEqual(inspectResponse("inspect-next"));
  });

  it("does not post a pre-aborted request", async () => {
    const { worker, lease } = await initializedLease();
    const postedBefore = worker.posted.length;
    const abort = new AbortController();
    abort.abort();

    await expect(
      lease.exchange(inspectRequest("inspect-never-posted"), abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.posted).toHaveLength(postedBefore);
  });

  it("fails closed and rejects every pending exchange after a Worker error", async () => {
    const { worker, lease } = await initializedLease();
    const first = lease.exchange(inspectRequest("inspect-fail-1"));
    const second = lease.exchange(inspectRequest("inspect-fail-2"));

    worker.fail("synthetic crash");

    await expect(first).rejects.toBeInstanceOf(DorkBrowserWorkerTransportError);
    await expect(second).rejects.toBeInstanceOf(
      DorkBrowserWorkerTransportError,
    );
    expect(worker.terminated).toBe(true);
    await expect(
      lease.exchange(inspectRequest("inspect-after-failure")),
    ).rejects.toBeInstanceOf(DorkBrowserWorkerTransportError);
  });

  it("rejects a malformed initialization response and terminates the lease", async () => {
    const worker = new FakeBrowserWorker();
    const factory = new BrowserDorkWorkerFactory({
      createWorker: () => worker,
      nextInitializationId: () => "initialize-malformed",
    });
    const creation = factory.create({
      storyId: "minimal-story",
      storyBytes: storyBytes(),
    });
    await Promise.resolve();
    worker.respond({
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId: "initialize-malformed",
      kind: "dork.initialized",
    } as unknown as DorkBrowserWorkerMessage);

    await expect(creation).rejects.toBeInstanceOf(
      DorkBrowserWorkerTransportError,
    );
    expect(worker.terminated).toBe(true);
  });
});
