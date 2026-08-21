import { readFile } from "node:fs/promises";

import { canonicalizeCommand } from "@sttork/contracts";
import {
  ENGINE_WORKER_PROTOCOL_VERSION,
  type EngineWorkerResponse,
} from "../packages/game-engine/src/worker-protocol.js";
import { WorkerEngineAdapter } from "../packages/game-engine/src/worker-engine-adapter.js";
import { DORK_WORKER_BINDING } from "../spikes/dork-worker/dork-worker-binding.js";
import { DorkWorkerRuntime } from "../spikes/dork-worker/dork-worker-runtime.js";
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

function requireKind<TKind extends EngineWorkerResponse["kind"]>(
  response: EngineWorkerResponse,
  kind: TKind,
): Extract<EngineWorkerResponse, { readonly kind: TKind }> {
  expect(response.kind).toBe(kind);
  if (response.kind !== kind) throw new Error(`expected ${kind}`);
  return response as Extract<EngineWorkerResponse, { readonly kind: TKind }>;
}

async function boot(
  runtime: DorkWorkerRuntime,
  messageId = "boot-1",
): Promise<void> {
  const response = requireKind(
    await runtime.exchange({
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId,
      kind: "boot",
      input: { storyId: STORY_ID, artifactSha256: STORY_SHA256 },
    }),
    "boot.result",
  );
  expect(response.result).toMatchObject({
    revision: 0,
    boundary: "input-requested",
  });
}

async function execute(
  runtime: DorkWorkerRuntime,
  messageId: string,
  requestId: string,
  expectedRevision: number,
  command: string,
) {
  return requireKind(
    await runtime.exchange({
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId,
      kind: "execute",
      input: { requestId, expectedRevision, command },
    }),
    "execute.result",
  ).result;
}

describe("Dork worker runtime", () => {
  it("replays exact receipts and restores branch-local receipts cold", async () => {
    const bytes = await storyBytes();
    const first = new DorkWorkerRuntime({
      storyId: STORY_ID,
      storyBytes: bytes,
      seed: 17,
    });
    await boot(first);

    const look = await execute(
      first,
      "execute-look",
      "request-look",
      0,
      "LOOK",
    );
    expect(look).toMatchObject({ status: "committed", revision: 1 });
    await expect(
      execute(first, "retry-look", "request-look", 0, "LOOK"),
    ).resolves.toEqual(look);

    const conflict = await execute(
      first,
      "conflict-look",
      "request-look",
      0,
      "NORTH",
    );
    expect(conflict).toMatchObject({
      status: "rejected",
      rejection: "duplicate",
      revision: 1,
    });

    const snapshot = requireKind(
      await first.exchange({
        protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
        messageId: "snapshot-1",
        kind: "snapshot",
      }),
      "snapshot.result",
    ).snapshot;
    const uninterruptedNorth = await execute(
      first,
      "north-first",
      "request-north",
      1,
      "NORTH",
    );

    const restored = new DorkWorkerRuntime({
      storyId: STORY_ID,
      storyBytes: bytes,
      seed: 999,
    });
    await boot(restored, "boot-restored");
    const restore = requireKind(
      await restored.exchange({
        protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
        messageId: "restore-1",
        kind: "restore",
        snapshot,
      }),
      "restore.result",
    );
    expect(restore.result).toEqual({
      status: "restored",
      revision: 1,
      output: "",
      turnComplete: true,
      boundary: "input-requested",
    });
    await expect(
      execute(restored, "restored-retry", "request-look", 0, "LOOK"),
    ).resolves.toEqual(look);
    await expect(
      execute(restored, "restored-north", "request-north", 1, "NORTH"),
    ).resolves.toEqual(uninterruptedNorth);
  });

  it("rejects receipt capacity before mutation without creating uncertainty", async () => {
    const runtime = new DorkWorkerRuntime({
      storyId: STORY_ID,
      storyBytes: await storyBytes(),
      seed: 19,
      maxReceipts: 1,
    });
    let message = 0;
    const adapter = new WorkerEngineAdapter({
      transport: runtime,
      binding: DORK_WORKER_BINDING,
      nextMessageId: () => `adapter-${++message}`,
    });
    await adapter.boot({ storyId: STORY_ID, artifactSha256: STORY_SHA256 });
    const first = await adapter.execute({
      requestId: "capacity-first",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });
    expect(first).toMatchObject({ status: "committed", revision: 1 });

    const rejected = await adapter.execute({
      requestId: "capacity-second",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    });
    expect(rejected).toEqual({
      requestId: "capacity-second",
      previousRevision: 1,
      revision: 1,
      command: "north",
      output: "",
      turnComplete: true,
      boundary: "input-requested",
      status: "rejected",
      rejection: "receipt_capacity",
    });
    await expect(
      adapter.execute({
        requestId: "capacity-second",
        expectedRevision: 1,
        command: canonicalizeCommand("north"),
      }),
    ).resolves.toEqual(rejected);
    await expect(adapter.inspectPublicState()).resolves.toMatchObject({
      revision: 1,
      boundary: "input-requested",
    });
  });

  it("allows only one operation to cross the runtime at a time", async () => {
    const runtime = new DorkWorkerRuntime({
      storyId: STORY_ID,
      storyBytes: await storyBytes(),
      seed: 23,
    });
    await boot(runtime);

    const first = execute(
      runtime,
      "overlap-first",
      "overlap-command",
      0,
      "LOOK",
    );
    const second = await runtime.exchange({
      protocolVersion: ENGINE_WORKER_PROTOCOL_VERSION,
      messageId: "overlap-inspect",
      kind: "inspect-public-state",
    });

    expect(second).toMatchObject({
      kind: "error",
      error: { code: "invalid_request" },
    });
    await expect(first).resolves.toMatchObject({
      status: "committed",
      revision: 1,
    });
  });
});
