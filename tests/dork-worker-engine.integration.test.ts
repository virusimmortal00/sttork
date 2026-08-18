import { readFile } from "node:fs/promises";

import {
  canonicalizeCommand,
  type EngineSnapshot,
} from "@zork-voice/contracts";
import { DORK_WORKER_BINDING } from "../spikes/dork-worker/dork-worker-binding.js";
import {
  DorkWorkerEngine,
  type DorkWorkerLease,
  type DorkWorkerLeaseFactory,
} from "../spikes/dork-worker/dork-worker-engine.js";
import { DorkWorkerRuntime } from "../spikes/dork-worker/dork-worker-runtime.js";
import {
  EngineAdapterStateError,
  EngineExecutionUncertainError,
} from "../packages/game-engine/src/worker-engine-adapter.js";
import { describe, expect, it } from "vitest";

const STORY_ID = "minimal-zmachine-story";
const STORY_SHA256 =
  "67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389";
const storyUrl = new URL(
  "../fixtures/stories/minimal/artifact/minimal.z3",
  import.meta.url,
);

async function storyBytes(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(storyUrl));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

class RuntimeLease implements DorkWorkerLease {
  public terminated = false;
  #lostResponse = false;

  public constructor(
    private readonly runtime: DorkWorkerRuntime,
    private readonly loseRequestId?: string,
  ) {}

  public exchange: DorkWorkerLease["exchange"] = async (request, signal) => {
    if (this.terminated) throw new Error("lease is terminated");
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const response = await this.runtime.exchange(request, signal);
    if (
      !this.#lostResponse &&
      request.kind === "execute" &&
      request.input.requestId === this.loseRequestId
    ) {
      this.#lostResponse = true;
      throw new Error("synthetic lost response after commit");
    }
    return response;
  };

  public terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.runtime.dispose();
  }
}

class RuntimeFactory implements DorkWorkerLeaseFactory {
  public readonly leases: RuntimeLease[] = [];

  public constructor(private readonly loseRequestId?: string) {}

  public async create(
    input: { readonly storyId: string; readonly storyBytes: Uint8Array },
    signal?: AbortSignal,
  ): Promise<DorkWorkerLease> {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const lease = new RuntimeLease(
      new DorkWorkerRuntime({
        storyId: input.storyId,
        storyBytes: input.storyBytes,
        seed: 29,
      }),
      this.leases.length === 0 ? this.loseRequestId : undefined,
    );
    this.leases.push(lease);
    return lease;
  }
}

async function engineFixture(loseRequestId?: string): Promise<{
  readonly engine: DorkWorkerEngine;
  readonly factory: RuntimeFactory;
}> {
  const factory = new RuntimeFactory(loseRequestId);
  let message = 0;
  const engine = new DorkWorkerEngine({
    factory,
    storyBytes: await storyBytes(),
    binding: DORK_WORKER_BINDING,
    nextMessageId: () => `engine-${++message}`,
  });
  await engine.boot({ storyId: STORY_ID, artifactSha256: STORY_SHA256 });
  return { engine, factory };
}

describe("Dork replacement-worker engine", () => {
  it("atomically swaps to a cold worker and restores branch receipts", async () => {
    const { engine, factory } = await engineFixture();
    const look = await engine.execute({
      requestId: "branch-look",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });
    const snapshot = await engine.snapshot();
    const uninterrupted = await engine.execute({
      requestId: "branch-north",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    });
    const oldLease = factory.leases[0]!;

    await expect(engine.restore(snapshot)).resolves.toEqual({
      status: "restored",
      revision: 1,
      output: "",
      turnComplete: true,
      boundary: "input-requested",
    });
    expect(oldLease.terminated).toBe(true);
    expect(factory.leases).toHaveLength(2);
    await expect(
      engine.execute({
        requestId: "branch-look",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
      }),
    ).resolves.toEqual(look);
    await expect(
      engine.execute({
        requestId: "branch-north",
        expectedRevision: 1,
        command: canonicalizeCommand("north"),
      }),
    ).resolves.toEqual(uninterrupted);
  });

  it("rejects outer and inner corruption without replacing the active worker", async () => {
    const { engine, factory } = await engineFixture();
    const snapshot = await engine.snapshot();
    const activeLease = factory.leases[0]!;

    const outerCorrupt: EngineSnapshot = {
      ...snapshot,
      bytes: new Uint8Array(snapshot.bytes).fill(0, 0, 1),
    };
    await expect(engine.restore(outerCorrupt)).resolves.toMatchObject({
      status: "rejected",
      rejection: "corrupt_snapshot",
      revision: 0,
    });
    expect(factory.leases).toHaveLength(1);
    expect(activeLease.terminated).toBe(false);

    const innerBytes = new Uint8Array(snapshot.bytes);
    innerBytes[0] = innerBytes[0]! ^ 0xff;
    const innerCorrupt: EngineSnapshot = {
      ...snapshot,
      bytes: innerBytes,
      sha256: await sha256(innerBytes),
    };
    await expect(engine.restore(innerCorrupt)).resolves.toMatchObject({
      status: "rejected",
      rejection: "corrupt_snapshot",
      revision: 0,
    });
    expect(factory.leases).toHaveLength(2);
    expect(factory.leases[1]?.terminated).toBe(true);
    expect(activeLease.terminated).toBe(false);
    await expect(
      engine.execute({
        requestId: "after-corruption",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
      }),
    ).resolves.toMatchObject({ status: "committed", revision: 1 });
  });

  it("rejects incompatible snapshots locally and preserves active state", async () => {
    const { engine, factory } = await engineFixture();
    const snapshot = await engine.snapshot();
    const incompatible: EngineSnapshot = {
      ...snapshot,
      compatibility: {
        ...snapshot.compatibility,
        runtime: { ...snapshot.compatibility.runtime, version: "other" },
      },
    };

    await expect(engine.restore(incompatible)).resolves.toEqual({
      status: "rejected",
      rejection: "incompatible_snapshot",
      revision: 0,
      output: "",
      turnComplete: true,
      boundary: "input-requested",
    });
    expect(factory.leases).toHaveLength(1);
    expect(factory.leases[0]?.terminated).toBe(false);
  });

  it("recovers a committed lost response only through the exact receipt retry", async () => {
    const { engine } = await engineFixture("uncertain-look");
    const request = {
      requestId: "uncertain-look",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    } as const;

    await expect(engine.execute(request)).rejects.toBeInstanceOf(
      EngineExecutionUncertainError,
    );
    await expect(engine.inspectPublicState()).resolves.toMatchObject({
      revision: 1,
      boundary: "input-requested",
    });
    await expect(engine.snapshot()).rejects.toBeInstanceOf(
      EngineAdapterStateError,
    );
    await expect(
      engine.execute({ ...request, command: canonicalizeCommand("north") }),
    ).rejects.toBeInstanceOf(EngineAdapterStateError);

    await expect(engine.execute(request)).resolves.toMatchObject({
      status: "committed",
      previousRevision: 0,
      revision: 1,
      command: "look",
    });
    await expect(engine.snapshot()).resolves.toMatchObject({ revision: 1 });
  });
});
