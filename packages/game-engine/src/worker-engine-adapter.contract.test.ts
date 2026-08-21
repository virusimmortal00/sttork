import {
  MAX_ENGINE_SNAPSHOT_BYTES,
  canonicalizeCommand,
  type CanonicalCommand,
  type EngineCompatibility,
  type EngineSnapshot,
  type EngineTurnBoundary,
  type ExecuteResult,
} from "@sttork/contracts";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  EngineAdapterStateError,
  EngineBootUncertainError,
  EngineExecutionCancelledError,
  EngineExecutionUncertainError,
  EngineRestoreUncertainError,
  EngineWorkerProtocolError,
  WorkerEngineAdapter,
  type EngineWorkerBinding,
} from "./worker-engine-adapter.js";
import {
  ENGINE_WORKER_PROTOCOL_VERSION,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
  type EngineWorkerTransport,
} from "./worker-protocol.js";

const STORY_SHA = "1".repeat(64);
const RUNTIME_SHA = "2".repeat(64);
const BOOT_OUTPUT =
  "Minimal Harness\n\nSouth Room\nA  double-spaced detail.\n\n> ";
const LOOK_OUTPUT = "\nSouth Room\nA plain room.\n\n> ";
const NORTH_OUTPUT = "\nNorth Room\nA quiet room.\n\n> ";

const binding = {
  runtime: {
    id: "deterministic-test-runtime",
    version: "0.0.0-test",
    artifactSha256: RUNTIME_SHA,
  },
  adapter: {
    id: "typed-worker-spike",
    version: "1",
  },
  snapshotSchemaVersion: 1,
} as const satisfies EngineWorkerBinding;

interface Receipt {
  readonly expectedRevision: number;
  readonly command: string;
  readonly result: ExecuteResult;
}

interface StoredSnapshot {
  readonly bytes: Uint8Array;
  readonly revision: number;
  readonly lastOutput: string;
  readonly boundary: EngineTurnBoundary;
  readonly receipts: ReadonlyArray<readonly [string, Receipt]>;
  readonly compatibility: EngineCompatibility;
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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
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

function cloneReceipt(receipt: Receipt): Receipt {
  return {
    expectedRevision: receipt.expectedRevision,
    command: receipt.command,
    result: { ...receipt.result },
  };
}

function cloneReceiptJournal(
  receipts: ReadonlyMap<string, Receipt>,
): Array<readonly [string, Receipt]> {
  return Array.from(
    receipts,
    ([requestId, receipt]) => [requestId, cloneReceipt(receipt)] as const,
  ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

function encodeSnapshotBytes(input: {
  readonly revision: number;
  readonly lastOutput: string;
  readonly boundary: EngineTurnBoundary;
  readonly receipts: ReadonlyMap<string, Receipt>;
}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      revision: input.revision,
      lastOutput: input.lastOutput,
      boundary: input.boundary,
      receipts: cloneReceiptJournal(input.receipts).map(
        ([requestId, receipt]) => ({ requestId, ...receipt }),
      ),
    }),
  );
}

class DeterministicFakeWorkerTransport implements EngineWorkerTransport {
  public readonly requests: EngineWorkerRequest[] = [];
  public readonly committedCommands: string[] = [];
  public restoreRequests = 0;
  public interruptAfterCommit = new Set<string>();
  public onAfterCommit: (() => void) | undefined;
  public executeResponseGate: Promise<void> | undefined;
  public tamperNextSnapshotHash = false;
  public oversizeNextSnapshot = false;
  public interruptAfterRestore = false;
  public interruptAfterBoot = false;
  public bootResponseGate: Promise<void> | undefined;

  readonly #receipts = new Map<string, Receipt>();
  readonly #snapshots = new Map<string, StoredSnapshot>();
  #compatibility: EngineCompatibility | undefined;
  #revision = 0;
  #lastOutput = "";
  #boundary: EngineTurnBoundary = "input-requested";

  public async exchange(
    request: EngineWorkerRequest,
    signal?: AbortSignal,
  ): Promise<EngineWorkerResponse> {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    this.requests.push(request);

    switch (request.kind) {
      case "boot": {
        const response = this.#boot(request);
        await this.bootResponseGate;
        if (this.interruptAfterBoot) {
          this.interruptAfterBoot = false;
          throw new DOMException(
            "The boot response was interrupted.",
            "AbortError",
          );
        }
        return response;
      }
      case "execute": {
        const response = this.#execute(request);
        await this.executeResponseGate;
        return response;
      }
      case "snapshot":
        return this.#snapshot(request);
      case "restore": {
        const response = this.#restore(request);
        if (this.interruptAfterRestore) {
          this.interruptAfterRestore = false;
          throw new DOMException(
            "The restore response was interrupted.",
            "AbortError",
          );
        }
        return response;
      }
      case "inspect-public-state":
        return this.#inspect(request);
    }
  }

  #boot(
    request: Extract<EngineWorkerRequest, { readonly kind: "boot" }>,
  ): EngineWorkerResponse {
    if (this.#compatibility !== undefined) {
      return this.#error(request, "already_booted", "Already booted.");
    }
    this.#compatibility = {
      story: {
        id: request.input.storyId,
        artifactSha256: request.input.artifactSha256,
      },
      runtime: { ...binding.runtime },
      adapter: { ...binding.adapter },
      snapshotSchemaVersion: binding.snapshotSchemaVersion,
    };
    this.#lastOutput = BOOT_OUTPUT;
    this.#boundary = "input-requested";
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "boot.result",
      result: {
        revision: 0,
        output: BOOT_OUTPUT,
        turnComplete: true,
        boundary: this.#boundary,
        compatibility: cloneCompatibility(this.#compatibility),
      },
    };
  }

  #execute(
    request: Extract<EngineWorkerRequest, { readonly kind: "execute" }>,
  ): EngineWorkerResponse {
    if (this.#compatibility === undefined) {
      return this.#error(request, "not_booted", "Boot first.");
    }

    const receipt = this.#receipts.get(request.input.requestId);
    if (receipt) {
      if (
        receipt.expectedRevision === request.input.expectedRevision &&
        receipt.command === request.input.command
      ) {
        return this.#executeResult(request, receipt.result);
      }
      return this.#executeResult(request, {
        requestId: request.input.requestId,
        previousRevision: this.#revision,
        revision: this.#revision,
        command: request.input.command,
        output: "",
        turnComplete: true,
        boundary: this.#boundary,
        status: "rejected",
        rejection: "duplicate",
      });
    }

    if (this.#boundary === "terminated") {
      const result = {
        requestId: request.input.requestId,
        previousRevision: this.#revision,
        revision: this.#revision,
        command: request.input.command,
        output: "",
        turnComplete: true,
        boundary: this.#boundary,
        status: "rejected",
        rejection: "invalid_command",
      } as const satisfies ExecuteResult;
      this.#receipts.set(request.input.requestId, {
        expectedRevision: request.input.expectedRevision,
        command: request.input.command,
        result,
      });
      return this.#executeResult(request, result);
    }

    if (request.input.expectedRevision !== this.#revision) {
      const result = {
        requestId: request.input.requestId,
        previousRevision: this.#revision,
        revision: this.#revision,
        command: request.input.command,
        output: "",
        turnComplete: true,
        boundary: this.#boundary,
        status: "rejected",
        rejection: "stale_revision",
      } as const satisfies ExecuteResult;
      this.#receipts.set(request.input.requestId, {
        expectedRevision: request.input.expectedRevision,
        command: request.input.command,
        result,
      });
      return this.#executeResult(request, result);
    }

    const terminated = request.input.command === "quit";
    const output = terminated
      ? "\nGoodbye.\n"
      : request.input.command === "look"
        ? LOOK_OUTPUT
        : request.input.command === "north"
          ? NORTH_OUTPUT
          : `Executed ${request.input.command}.\n\n> `;
    const previousRevision = this.#revision;
    this.#revision += 1;
    this.#lastOutput = output;
    this.#boundary = terminated ? "terminated" : "input-requested";
    this.committedCommands.push(request.input.command);
    const result = {
      requestId: request.input.requestId,
      previousRevision,
      revision: this.#revision,
      command: request.input.command,
      output,
      turnComplete: true,
      boundary: this.#boundary,
      status: "committed",
    } as const satisfies ExecuteResult;
    this.#receipts.set(request.input.requestId, {
      expectedRevision: request.input.expectedRevision,
      command: request.input.command,
      result,
    });

    if (this.interruptAfterCommit.delete(request.input.requestId)) {
      this.onAfterCommit?.();
      throw new DOMException("The response was interrupted.", "AbortError");
    }
    return this.#executeResult(request, result);
  }

  #snapshot(
    request: Extract<EngineWorkerRequest, { readonly kind: "snapshot" }>,
  ): EngineWorkerResponse {
    const compatibility = this.#requireCompatibility();
    if (this.oversizeNextSnapshot) {
      this.oversizeNextSnapshot = false;
      return {
        protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
        messageId: request.messageId,
        kind: "snapshot.result",
        snapshot: {
          bytes: new Uint8Array(MAX_ENGINE_SNAPSHOT_BYTES + 1),
          sha256: "0".repeat(64),
          revision: this.#revision,
          compatibility: cloneCompatibility(compatibility),
        },
      };
    }
    const bytes = encodeSnapshotBytes({
      revision: this.#revision,
      lastOutput: this.#lastOutput,
      boundary: this.#boundary,
      receipts: this.#receipts,
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const snapshot: EngineSnapshot = {
      bytes,
      sha256: this.tamperNextSnapshotHash ? "f".repeat(64) : sha256,
      revision: this.#revision,
      compatibility: cloneCompatibility(compatibility),
    };
    this.tamperNextSnapshotHash = false;
    this.#snapshots.set(sha256, {
      bytes: new Uint8Array(snapshot.bytes),
      revision: snapshot.revision,
      lastOutput: this.#lastOutput,
      boundary: this.#boundary,
      receipts: cloneReceiptJournal(this.#receipts),
      compatibility: cloneCompatibility(snapshot.compatibility),
    });
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "snapshot.result",
      snapshot,
    };
  }

  #restore(
    request: Extract<EngineWorkerRequest, { readonly kind: "restore" }>,
  ): EngineWorkerResponse {
    this.restoreRequests += 1;
    const stored = this.#snapshots.get(request.snapshot.sha256);
    if (
      !stored ||
      !sameBytes(stored.bytes, request.snapshot.bytes) ||
      request.snapshot.revision !== stored.revision ||
      !sameCompatibility(
        request.snapshot.compatibility,
        stored.compatibility,
      ) ||
      !sameCompatibility(
        request.snapshot.compatibility,
        this.#requireCompatibility(),
      )
    ) {
      return {
        protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
        messageId: request.messageId,
        kind: "restore.result",
        result: {
          status: "rejected",
          rejection: "corrupt_snapshot",
          revision: this.#revision,
          output: "",
          turnComplete: true,
          boundary: this.#boundary,
        },
      };
    }

    this.#revision = stored.revision;
    this.#lastOutput = stored.lastOutput;
    this.#boundary = stored.boundary;
    this.#receipts.clear();
    for (const [requestId, receipt] of stored.receipts) {
      this.#receipts.set(requestId, cloneReceipt(receipt));
    }
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "restore.result",
      result: {
        status: "restored",
        revision: stored.revision,
        output: "",
        turnComplete: true,
        boundary: stored.boundary,
      },
    };
  }

  #inspect(
    request: Extract<
      EngineWorkerRequest,
      { readonly kind: "inspect-public-state" }
    >,
  ): EngineWorkerResponse {
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "inspect-public-state.result",
      state: {
        revision: this.#revision,
        lastOutput: this.#lastOutput,
        boundary: this.#boundary,
      },
    };
  }

  #executeResult(
    request: Extract<EngineWorkerRequest, { readonly kind: "execute" }>,
    result: ExecuteResult,
  ): EngineWorkerResponse {
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "execute.result",
      result,
    };
  }

  #error(
    request: EngineWorkerRequest,
    code: "not_booted" | "already_booted",
    message: string,
  ): EngineWorkerResponse {
    return {
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: request.messageId,
      kind: "error",
      error: { code, message },
    };
  }

  #requireCompatibility(): EngineCompatibility {
    if (!this.#compatibility) throw new Error("fake worker is not booted");
    return this.#compatibility;
  }
}

function createHarness(digestSha256?: (bytes: Uint8Array) => Promise<string>): {
  readonly adapter: WorkerEngineAdapter;
  readonly transport: DeterministicFakeWorkerTransport;
} {
  const transport = new DeterministicFakeWorkerTransport();
  let messageNumber = 0;
  const adapter = new WorkerEngineAdapter({
    transport,
    binding,
    nextMessageId: () => `message-${(messageNumber += 1)}`,
    ...(digestSha256 === undefined ? {} : { digestSha256 }),
  });
  return { adapter, transport };
}

async function boot(adapter: WorkerEngineAdapter) {
  return adapter.boot({
    storyId: "minimal-test-story",
    artifactSha256: STORY_SHA,
  });
}

describe("generic worker engine adapter contract", () => {
  it("boots into one exact complete input boundary", async () => {
    const { adapter, transport } = createHarness();

    const result = await boot(adapter);

    expect(result).toStrictEqual({
      revision: 0,
      output: BOOT_OUTPUT,
      turnComplete: true,
      boundary: "input-requested",
      compatibility: {
        story: {
          id: "minimal-test-story",
          artifactSha256: STORY_SHA,
        },
        runtime: binding.runtime,
        adapter: binding.adapter,
        snapshotSchemaVersion: 1,
      },
    });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({ kind: "boot" });
  });

  it("quarantines an adapter whose submitted boot result is unknown", async () => {
    const { adapter, transport } = createHarness();
    transport.interruptAfterBoot = true;

    const uncertainBoot = boot(adapter);
    await expect(uncertainBoot).rejects.toBeInstanceOf(
      EngineBootUncertainError,
    );
    await expect(uncertainBoot).rejects.toMatchObject({
      commitState: "unknown",
      storyId: "minimal-test-story",
    });
    await expect(boot(adapter)).rejects.toBeInstanceOf(EngineAdapterStateError);
    expect(
      transport.requests.filter((request) => request.kind === "boot"),
    ).toHaveLength(1);

    const fresh = createHarness();
    await expect(boot(fresh.adapter)).resolves.toMatchObject({ revision: 0 });
  });

  it("includes boot in the shared operation guard", async () => {
    const { adapter, transport } = createHarness();
    let releaseResponse = () => {};
    transport.bootResponseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    const firstBoot = boot(adapter);
    await expect(boot(adapter)).rejects.toBeInstanceOf(EngineAdapterStateError);
    expect(
      transport.requests.filter((request) => request.kind === "boot"),
    ).toHaveLength(1);
    releaseResponse();
    await expect(firstBoot).resolves.toMatchObject({ revision: 0 });
  });

  it("submits exactly one canonical command and preserves exact output", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);

    const result = await adapter.execute({
      requestId: "request-look",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });

    expect(result).toMatchObject({
      status: "committed",
      previousRevision: 0,
      revision: 1,
      command: "look",
      output: LOOK_OUTPUT,
      turnComplete: true,
      boundary: "input-requested",
    });
    expect(transport.committedCommands).toStrictEqual(["look"]);
    const executeRequest = transport.requests.find(
      (request) => request.kind === "execute",
    );
    expect(executeRequest).toMatchObject({
      input: {
        requestId: "request-look",
        expectedRevision: 0,
        command: "look",
      },
    });

    await expect(
      adapter.execute({
        requestId: "request-batch",
        expectedRevision: 1,
        command: "look\nnorth" as CanonicalCommand,
      }),
    ).rejects.toThrow();
    expect(
      transport.requests.filter((request) => request.kind === "execute"),
    ).toHaveLength(1);
  });

  it("replays matching request receipts and rejects revision conflicts", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    const request = {
      requestId: "request-1",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    } as const;

    const committed = await adapter.execute(request);
    const replayed = await adapter.execute(request);
    const duplicate = await adapter.execute({
      requestId: "request-1",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    });
    const stale = await adapter.execute({
      requestId: "request-stale",
      expectedRevision: 0,
      command: canonicalizeCommand("north"),
    });
    await adapter.execute({
      requestId: "request-2",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    });
    const lateReplay = await adapter.execute(request);
    const lateStaleReplay = await adapter.execute({
      requestId: "request-stale",
      expectedRevision: 0,
      command: canonicalizeCommand("north"),
    });

    expect(replayed).toStrictEqual(committed);
    expect(duplicate).toMatchObject({
      status: "rejected",
      rejection: "duplicate",
      revision: 1,
    });
    expect(stale).toMatchObject({
      status: "rejected",
      rejection: "stale_revision",
      revision: 1,
    });
    expect(lateReplay).toStrictEqual(committed);
    expect(lateStaleReplay).toStrictEqual(stale);
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 2,
    });
    expect(transport.committedCommands).toStrictEqual(["look", "north"]);
  });

  it("returns opaque snapshot bytes and rejects incompatible restore locally", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    await adapter.execute({
      requestId: "request-look",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });
    const snapshot = await adapter.snapshot();
    await adapter.execute({
      requestId: "request-north",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    });

    expect(snapshot.bytes.byteLength).toBeGreaterThan(4);
    expect(createHash("sha256").update(snapshot.bytes).digest("hex")).toBe(
      snapshot.sha256,
    );
    const incompatible: EngineSnapshot = {
      ...snapshot,
      compatibility: {
        ...snapshot.compatibility,
        story: {
          ...snapshot.compatibility.story,
          artifactSha256: "f".repeat(64),
        },
      },
    };
    await expect(adapter.restore(incompatible)).resolves.toMatchObject({
      status: "rejected",
      rejection: "incompatible_snapshot",
      revision: 2,
    });
    expect(transport.restoreRequests).toBe(0);
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 2,
      lastOutput: NORTH_OUTPUT,
      boundary: "input-requested",
    });

    const corruptBytes = new Uint8Array(snapshot.bytes);
    corruptBytes[0] = corruptBytes[0]! ^ 0xff;
    await expect(
      adapter.restore({ ...snapshot, bytes: corruptBytes }),
    ).resolves.toMatchObject({
      status: "rejected",
      rejection: "corrupt_snapshot",
      revision: 2,
    });
    expect(transport.restoreRequests).toBe(0);
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 2,
      lastOutput: NORTH_OUTPUT,
      boundary: "input-requested",
    });

    await expect(adapter.restore(snapshot)).resolves.toMatchObject({
      status: "restored",
      revision: 1,
      output: "",
      turnComplete: true,
    });
    expect(transport.restoreRequests).toBe(1);
  });

  it("restores the snapshot-scoped receipt journal before replaying a branch", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    const beforeSnapshot = {
      requestId: "request-before-snapshot",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    } as const;
    const afterSnapshot = {
      requestId: "request-after-snapshot",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    } as const;

    const firstResult = await adapter.execute(beforeSnapshot);
    const snapshot = await adapter.snapshot();
    const branchResult = await adapter.execute(afterSnapshot);
    await expect(adapter.restore(snapshot)).resolves.toMatchObject({
      status: "restored",
      revision: 1,
    });

    await expect(adapter.execute(beforeSnapshot)).resolves.toStrictEqual(
      firstResult,
    );
    expect(transport.committedCommands).toStrictEqual(["look", "north"]);

    await expect(adapter.execute(afterSnapshot)).resolves.toStrictEqual(
      branchResult,
    );
    expect(transport.committedCommands).toStrictEqual([
      "look",
      "north",
      "north",
    ]);
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 2,
      lastOutput: NORTH_OUTPUT,
      boundary: "input-requested",
    });
  });

  it("includes receipt-only changes and full-width revisions in snapshot identity", async () => {
    const { adapter } = createHarness();
    await boot(adapter);
    const initial = await adapter.snapshot();

    for (let revision = 0; revision < 256; revision += 1) {
      await adapter.execute({
        requestId: `request-${revision}`,
        expectedRevision: revision,
        command: canonicalizeCommand("look"),
      });
    }
    const highRevision = await adapter.snapshot();
    expect(highRevision.revision).toBe(256);
    expect(highRevision.sha256).not.toBe(initial.sha256);
    expect(new TextDecoder().decode(highRevision.bytes)).toContain(
      '"revision":256',
    );

    const beforeReceipt = await adapter.snapshot();
    await adapter.execute({
      requestId: "request-stale-receipt",
      expectedRevision: 0,
      command: canonicalizeCommand("north"),
    });
    const afterReceipt = await adapter.snapshot();
    expect(afterReceipt.revision).toBe(beforeReceipt.revision);
    expect(afterReceipt.sha256).not.toBe(beforeReceipt.sha256);

    await expect(adapter.restore(initial)).resolves.toMatchObject({
      status: "restored",
      revision: 0,
    });
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 0,
      boundary: "input-requested",
    });
  });

  it("rejects a worker snapshot whose digest does not match its bytes", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    transport.tamperNextSnapshotHash = true;

    await expect(adapter.snapshot()).rejects.toBeInstanceOf(
      EngineWorkerProtocolError,
    );
    await expect(adapter.snapshot()).resolves.toMatchObject({ revision: 0 });
  });

  it("rejects an oversized worker snapshot before copying or hashing it", async () => {
    let digestCalls = 0;
    const { adapter, transport } = createHarness(async (bytes) => {
      digestCalls += 1;
      return createHash("sha256").update(bytes).digest("hex");
    });
    await boot(adapter);
    transport.oversizeNextSnapshot = true;

    await expect(adapter.snapshot()).rejects.toThrow(
      `snapshot bytes must not exceed ${MAX_ENGINE_SNAPSHOT_BYTES} bytes`,
    );
    expect(digestCalls).toBe(0);
  });

  it("rejects an oversized restore locally before copying, hashing, or submission", async () => {
    let digestCalls = 0;
    const { adapter, transport } = createHarness(async (bytes) => {
      digestCalls += 1;
      return createHash("sha256").update(bytes).digest("hex");
    });
    await boot(adapter);
    const snapshot = await adapter.snapshot();
    digestCalls = 0;

    await expect(
      adapter.restore({
        ...snapshot,
        bytes: new Uint8Array(MAX_ENGINE_SNAPSHOT_BYTES + 1),
      }),
    ).rejects.toThrow(
      `snapshot bytes must not exceed ${MAX_ENGINE_SNAPSHOT_BYTES} bytes`,
    );
    expect(digestCalls).toBe(0);
    expect(transport.restoreRequests).toBe(0);
    expect(
      transport.requests.filter((request) => request.kind === "restore"),
    ).toHaveLength(0);
  });

  it("hashes and submits the same copied restore bytes", async () => {
    let pauseDigest = false;
    let signalDigestStarted = () => {};
    let releaseDigest = () => {};
    const digestStarted = new Promise<void>((resolve) => {
      signalDigestStarted = resolve;
    });
    const digestGate = new Promise<void>((resolve) => {
      releaseDigest = resolve;
    });
    const { adapter, transport } = createHarness(async (bytes) => {
      if (pauseDigest) {
        signalDigestStarted();
        await digestGate;
      }
      return createHash("sha256").update(bytes).digest("hex");
    });
    await boot(adapter);
    const snapshot = await adapter.snapshot();
    await adapter.execute({
      requestId: "request-before-byte-copy-restore",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });

    pauseDigest = true;
    const restoration = adapter.restore(snapshot);
    await digestStarted;
    snapshot.bytes.fill(0);
    releaseDigest();

    await expect(restoration).resolves.toMatchObject({
      status: "restored",
      revision: 0,
    });
    expect(transport.restoreRequests).toBe(1);
  });

  it("permits only one worker operation in flight", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    const snapshot = await adapter.snapshot();
    let releaseResponse = () => {};
    transport.executeResponseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    const execution = adapter.execute({
      requestId: "request-held",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });

    await expect(adapter.snapshot()).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(adapter.restore(snapshot)).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(adapter.inspectPublicState()).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(
      adapter.execute({
        requestId: "request-overlap",
        expectedRevision: 0,
        command: canonicalizeCommand("north"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);

    releaseResponse();
    await expect(execution).resolves.toMatchObject({
      status: "committed",
      revision: 1,
    });
  });

  it("preserves termination across rejection and requires restore before execute", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    const inputSnapshot = await adapter.snapshot();
    await expect(
      adapter.execute({
        requestId: "request-quit",
        expectedRevision: 0,
        command: canonicalizeCommand("quit"),
      }),
    ).resolves.toMatchObject({
      status: "committed",
      revision: 1,
      boundary: "terminated",
    });
    const terminatedSnapshot = await adapter.snapshot();

    const executeRequests = transport.requests.filter(
      (request) => request.kind === "execute",
    ).length;
    await expect(
      adapter.execute({
        requestId: "request-after-quit",
        expectedRevision: 1,
        command: canonicalizeCommand("look"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);
    expect(
      transport.requests.filter((request) => request.kind === "execute"),
    ).toHaveLength(executeRequests);

    const incompatible: EngineSnapshot = {
      ...inputSnapshot,
      compatibility: {
        ...inputSnapshot.compatibility,
        adapter: { ...inputSnapshot.compatibility.adapter, version: "other" },
      },
    };
    await expect(adapter.restore(incompatible)).resolves.toMatchObject({
      status: "rejected",
      rejection: "incompatible_snapshot",
      revision: 1,
      boundary: "terminated",
    });

    const changedBytes = new Uint8Array(inputSnapshot.bytes);
    changedBytes[0] = changedBytes[0]! ^ 0xff;
    await expect(
      adapter.restore({ ...inputSnapshot, bytes: changedBytes }),
    ).resolves.toMatchObject({
      status: "rejected",
      rejection: "corrupt_snapshot",
      revision: 1,
      boundary: "terminated",
    });

    const unknownBytes = Uint8Array.from([1, 2, 3, 4]);
    await expect(
      adapter.restore({
        ...inputSnapshot,
        bytes: unknownBytes,
        sha256: createHash("sha256").update(unknownBytes).digest("hex"),
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      rejection: "corrupt_snapshot",
      revision: 1,
      boundary: "terminated",
    });
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 1,
      boundary: "terminated",
    });

    await expect(adapter.restore(inputSnapshot)).resolves.toMatchObject({
      status: "restored",
      revision: 0,
      boundary: "input-requested",
    });
    await expect(
      adapter.execute({
        requestId: "request-after-restore",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
      }),
    ).resolves.toMatchObject({ status: "committed", revision: 1 });

    await expect(adapter.restore(terminatedSnapshot)).resolves.toMatchObject({
      status: "restored",
      revision: 1,
      boundary: "terminated",
    });
    await expect(
      adapter.execute({
        requestId: "request-after-terminated-restore",
        expectedRevision: 1,
        command: canonicalizeCommand("look"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);
  });

  it("distinguishes pre-submit cancellation from an uncertain submitted command", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    const safeSnapshot = await adapter.snapshot();
    const cancelled = new AbortController();
    cancelled.abort();

    const cancelledExecution = adapter.execute(
      {
        requestId: "request-cancelled",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
      },
      cancelled.signal,
    );
    await expect(cancelledExecution).rejects.toBeInstanceOf(
      EngineExecutionCancelledError,
    );
    await expect(cancelledExecution).rejects.toMatchObject({
      commitState: "not-submitted",
      requestId: "request-cancelled",
    });
    expect(
      transport.requests.filter((request) => request.kind === "execute"),
    ).toHaveLength(0);

    const interrupted = new AbortController();
    transport.interruptAfterCommit.add("request-uncertain");
    transport.onAfterCommit = () => interrupted.abort();
    const uncertainRequest = {
      requestId: "request-uncertain",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    } as const;

    const uncertainExecution = adapter.execute(
      uncertainRequest,
      interrupted.signal,
    );
    await expect(uncertainExecution).rejects.toBeInstanceOf(
      EngineExecutionUncertainError,
    );
    await expect(uncertainExecution).rejects.toMatchObject({
      commitState: "unknown",
      requestId: "request-uncertain",
      expectedRevision: 0,
    });
    expect(interrupted.signal.aborted).toBe(true);
    expect(transport.committedCommands).toStrictEqual(["look"]);

    await expect(
      adapter.execute({
        requestId: "request-other",
        expectedRevision: 1,
        command: canonicalizeCommand("north"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);
    await expect(
      adapter.execute({
        ...uncertainRequest,
        command: canonicalizeCommand("north"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);
    await expect(adapter.snapshot()).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(adapter.restore(safeSnapshot)).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );

    await expect(adapter.execute(uncertainRequest)).resolves.toMatchObject({
      status: "committed",
      requestId: "request-uncertain",
      revision: 1,
    });
    expect(transport.committedCommands).toStrictEqual(["look"]);
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 1,
      lastOutput: LOOK_OUTPUT,
      boundary: "input-requested",
    });
  });

  it("uses inspection diagnostically until the uncertain receipt is recovered", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    transport.interruptAfterCommit.add("request-inspected");

    await expect(
      adapter.execute({
        requestId: "request-inspected",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
      }),
    ).rejects.toBeInstanceOf(EngineExecutionUncertainError);

    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 1,
      lastOutput: LOOK_OUTPUT,
      boundary: "input-requested",
    });
    await expect(
      adapter.execute({
        requestId: "request-after-inspection",
        expectedRevision: 1,
        command: canonicalizeCommand("north"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);
    await expect(adapter.snapshot()).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(
      adapter.execute({
        requestId: "request-inspected",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
      }),
    ).resolves.toMatchObject({
      status: "committed",
      revision: 1,
      output: LOOK_OUTPUT,
    });
    await expect(
      adapter.execute({
        requestId: "request-after-inspection",
        expectedRevision: 1,
        command: canonicalizeCommand("north"),
      }),
    ).resolves.toMatchObject({
      status: "committed",
      revision: 2,
      output: NORTH_OUTPUT,
    });
    expect(transport.committedCommands).toStrictEqual(["look", "north"]);
  });

  it("resolves an uncertain terminating command through its exact receipt", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    const request = {
      requestId: "request-uncertain-quit",
      expectedRevision: 0,
      command: canonicalizeCommand("quit"),
    } as const;
    transport.interruptAfterCommit.add(request.requestId);

    await expect(adapter.execute(request)).rejects.toBeInstanceOf(
      EngineExecutionUncertainError,
    );
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 1,
      boundary: "terminated",
    });
    await expect(adapter.execute(request)).resolves.toMatchObject({
      status: "committed",
      revision: 1,
      boundary: "terminated",
    });
    expect(transport.committedCommands).toStrictEqual(["quit"]);
    await expect(
      adapter.execute({
        requestId: "request-after-uncertain-quit",
        expectedRevision: 1,
        command: canonicalizeCommand("look"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);
  });

  it("quarantines the adapter when a submitted restore result is unknown", async () => {
    const { adapter, transport } = createHarness();
    await boot(adapter);
    const snapshot = await adapter.snapshot();
    await adapter.execute({
      requestId: "request-before-uncertain-restore",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });
    transport.interruptAfterRestore = true;

    const uncertainRestore = adapter.restore(snapshot);
    await expect(uncertainRestore).rejects.toBeInstanceOf(
      EngineRestoreUncertainError,
    );
    await expect(uncertainRestore).rejects.toMatchObject({
      commitState: "unknown",
      snapshotRevision: 0,
    });

    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 0,
      lastOutput: BOOT_OUTPUT,
      boundary: "input-requested",
    });
    await expect(adapter.snapshot()).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(adapter.restore(snapshot)).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(
      adapter.execute({
        requestId: "request-after-uncertain-restore",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
      }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);

    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 0,
      boundary: "input-requested",
    });
  });
});
