import {
  ENGINE_WORKER_PROTOCOL_VERSION,
  type EngineWorkerInspectRequest,
  type EngineWorkerResponse,
} from "../packages/game-engine/src/worker-protocol.js";
import type {} from "../spikes/dork-worker/browser-worker-entry.js";
import {
  DORK_BROWSER_WORKER_PROTOCOL_VERSION,
  type DorkBrowserEngineRequest,
  type DorkBrowserInitializeRequest,
  type DorkBrowserWorkerMessage,
} from "../spikes/dork-worker/browser-worker-messages.js";
import {
  installDorkBrowserWorkerEndpoint,
  type DorkBrowserWorkerMessageEvent,
  type DorkBrowserWorkerScope,
  type DorkWorkerRuntimeFactory,
} from "../spikes/dork-worker/browser-worker-endpoint.js";
import { describe, expect, it, vi } from "vitest";

const STORY_ID = "minimal-zmachine-story";

function storyBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes[0] = 3;
  return bytes;
}

function initialize(
  messageId = "initialize-1",
  bytes = storyBytes(),
): DorkBrowserInitializeRequest {
  return {
    protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
    messageId,
    kind: "dork.initialize",
    storyId: STORY_ID,
    storyBytes: bytes,
  };
}

function inspectRequest(messageId = "engine-outer-1"): {
  readonly outer: DorkBrowserEngineRequest;
  readonly inner: EngineWorkerInspectRequest;
} {
  const inner = {
    protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
    messageId: "engine-inner-1",
    kind: "inspect-public-state",
  } as const satisfies EngineWorkerInspectRequest;
  return {
    inner,
    outer: {
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId,
      kind: "engine.request",
      request: inner,
    },
  };
}

function inspectResponse(messageId: string): EngineWorkerResponse {
  return {
    protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
    messageId,
    kind: "inspect-public-state.result",
    state: {
      revision: 2,
      lastOutput: "North Room\n\n> ",
      boundary: "input-requested",
    },
  };
}

class FakeWorkerScope implements DorkBrowserWorkerScope {
  public readonly responses: DorkBrowserWorkerMessage[] = [];
  public throwWhilePosting = false;
  #listener: ((event: DorkBrowserWorkerMessageEvent) => void) | undefined;

  public postMessage(message: DorkBrowserWorkerMessage): void {
    if (this.throwWhilePosting) throw new Error("fake port is closed");
    this.responses.push(message);
  }

  public addEventListener(
    type: "message",
    listener: (event: DorkBrowserWorkerMessageEvent) => void,
  ): void {
    if (type !== "message") throw new Error("unexpected event type");
    this.#listener = listener;
  }

  public dispatch(data: unknown): void {
    const listener = this.#listener;
    if (listener === undefined) throw new Error("endpoint is not installed");
    listener({ data });
  }
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("Dork browser worker endpoint", () => {
  it("initializes exactly once from a synchronous detached story copy", () => {
    const scope = new FakeWorkerScope();
    let runtimeStory: Uint8Array | undefined;
    const createRuntime = vi.fn<DorkWorkerRuntimeFactory>((_, bytes) => {
      runtimeStory = bytes;
      return { exchange: vi.fn() };
    });
    installDorkBrowserWorkerEndpoint(scope, createRuntime);
    const callerStory = storyBytes();

    scope.dispatch(initialize("initialize-first", callerStory));
    callerStory.fill(0xff);

    expect(createRuntime).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledWith(
      STORY_ID,
      expect.any(Uint8Array),
    );
    expect(runtimeStory).toEqual(storyBytes());
    expect(runtimeStory).not.toBe(callerStory);
    expect(scope.responses).toEqual([
      {
        protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
        messageId: "initialize-first",
        kind: "dork.initialized",
        environment: {
          workerGlobalScope: false,
          documentAbsent: true,
          windowAbsent: true,
        },
      },
    ]);

    scope.dispatch(initialize("initialize-second"));
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(scope.responses.at(-1)).toMatchObject({
      messageId: "initialize-second",
      kind: "dork.error",
      error: { code: "already_initialized" },
    });
  });

  it("rejects engine requests before initialization", () => {
    const scope = new FakeWorkerScope();
    const createRuntime = vi.fn<DorkWorkerRuntimeFactory>();
    installDorkBrowserWorkerEndpoint(scope, createRuntime);

    scope.dispatch(inspectRequest("engine-before-init").outer);

    expect(createRuntime).not.toHaveBeenCalled();
    expect(scope.responses).toEqual([
      {
        protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
        messageId: "engine-before-init",
        kind: "dork.error",
        error: {
          code: "not_initialized",
          message: "Initialize the Dork worker before sending engine requests.",
        },
      },
    ]);
  });

  it("rejects malformed messages without throwing from the event callback", () => {
    const scope = new FakeWorkerScope();
    installDorkBrowserWorkerEndpoint(scope, vi.fn());

    expect(() => scope.dispatch({ kind: "unknown" })).not.toThrow();
    expect(scope.responses.at(-1)).toMatchObject({
      messageId: "invalid-message",
      kind: "dork.error",
      error: { code: "invalid_message" },
    });

    expect(() =>
      scope.dispatch({
        ...initialize("malformed-init"),
        storyBytes: new Uint8Array(2),
      }),
    ).not.toThrow();
    expect(scope.responses.at(-1)).toMatchObject({
      messageId: "malformed-init",
      kind: "dork.error",
      error: { code: "invalid_message" },
    });

    scope.throwWhilePosting = true;
    expect(() => scope.dispatch({ kind: "still-unknown" })).not.toThrow();
  });

  it("delegates engine requests and preserves outer and inner message IDs", async () => {
    const scope = new FakeWorkerScope();
    const exchange = vi.fn(
      async (
        request: EngineWorkerInspectRequest,
      ): Promise<EngineWorkerResponse> => inspectResponse(request.messageId),
    );
    installDorkBrowserWorkerEndpoint(scope, () => ({ exchange }));
    scope.dispatch(initialize());
    const { outer, inner } = inspectRequest();

    scope.dispatch(outer);
    await flushPromises();

    expect(exchange).toHaveBeenCalledOnce();
    expect(exchange).toHaveBeenCalledWith(inner);
    expect(scope.responses.at(-1)).toEqual({
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId: outer.messageId,
      kind: "engine.response",
      response: inspectResponse(inner.messageId),
    });
  });

  it("sanitizes synchronous construction and asynchronous runtime failures", async () => {
    const scope = new FakeWorkerScope();
    installDorkBrowserWorkerEndpoint(scope, () => {
      throw new Error("constructor secret", {
        cause: new Error("private stack material"),
      });
    });

    expect(() => scope.dispatch(initialize("failed-init"))).not.toThrow();
    expect(scope.responses.at(-1)).toEqual({
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId: "failed-init",
      kind: "dork.error",
      error: {
        code: "internal_error",
        message: "The Dork worker could not complete the request.",
      },
    });
    expect(JSON.stringify(scope.responses)).not.toMatch(/secret|stack/iu);

    scope.dispatch(initialize("retry-after-failure"));
    expect(scope.responses.at(-1)).toMatchObject({
      error: { code: "already_initialized" },
    });

    const runtimeScope = new FakeWorkerScope();
    installDorkBrowserWorkerEndpoint(runtimeScope, () => ({
      exchange: vi.fn().mockRejectedValue(
        new Error("runtime secret", {
          cause: new Error("private runtime stack"),
        }),
      ),
    }));
    runtimeScope.dispatch(initialize());
    runtimeScope.dispatch(inspectRequest("failed-engine").outer);
    await flushPromises();

    expect(runtimeScope.responses.at(-1)).toEqual({
      protocolVersion: DORK_BROWSER_WORKER_PROTOCOL_VERSION,
      messageId: "failed-engine",
      kind: "dork.error",
      error: {
        code: "internal_error",
        message: "The Dork worker could not complete the request.",
      },
    });
    expect(JSON.stringify(runtimeScope.responses)).not.toMatch(
      /secret|stack/iu,
    );
  });
});
