import { readFile } from "node:fs/promises";

import { EventSequence } from "@zork-voice/events";
import { FakeGuideModel } from "../packages/guide-core/src/index.js";
import {
  SemanticTurnCoordinator,
  type NarrationRequest,
} from "../packages/session/src/index.js";
import { DORK_WORKER_BINDING } from "../spikes/dork-worker/dork-worker-binding.js";
import {
  DorkWorkerEngine,
  type DorkWorkerLease,
  type DorkWorkerLeaseFactory,
} from "../spikes/dork-worker/dork-worker-engine.js";
import { DorkWorkerRuntime } from "../spikes/dork-worker/dork-worker-runtime.js";
import { describe, expect, it } from "vitest";

const STORY_ID = "minimal-zmachine-story";
const STORY_SHA256 =
  "67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389";
const storyUrl = new URL(
  "../fixtures/stories/minimal/artifact/minimal.z3",
  import.meta.url,
);

class RuntimeLease implements DorkWorkerLease {
  public constructor(private readonly runtime: DorkWorkerRuntime) {}
  public exchange: DorkWorkerLease["exchange"] = async (request, signal) =>
    await this.runtime.exchange(request, signal);
  public terminate(): void {
    this.runtime.dispose();
  }
}

class RuntimeFactory implements DorkWorkerLeaseFactory {
  public async create(input: {
    readonly storyId: string;
    readonly storyBytes: Uint8Array;
  }): Promise<DorkWorkerLease> {
    return new RuntimeLease(
      new DorkWorkerRuntime({
        storyId: input.storyId,
        storyBytes: input.storyBytes,
        seed: 83,
      }),
    );
  }
}

describe("semantic turn through the isolated Dork engine", () => {
  it("commits, checkpoints, and requests exact narration once", async () => {
    let messageId = 0;
    const engine = new DorkWorkerEngine({
      factory: new RuntimeFactory(),
      storyBytes: new Uint8Array(await readFile(storyUrl)),
      binding: DORK_WORKER_BINDING,
      nextMessageId: () => `message-${++messageId}`,
    });
    await engine.boot({ storyId: STORY_ID, artifactSha256: STORY_SHA256 });

    const narration: NarrationRequest[] = [];
    let eventId = 0;
    const subject = new SemanticTurnCoordinator({
      engine,
      guide: FakeGuideModel.returning({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      }),
      narrator: {
        prepare: (request) => {
          narration.push(request);
          return Promise.resolve();
        },
      },
      events: new EventSequence({
        sessionId: "dork-session",
        now: () => "2026-08-18T18:30:00.000Z",
        nextId: () => `event-${++eventId}`,
      }),
      nextRequestId: () => "engine-request-1",
      nextNarrationId: () => "narration-1",
    });

    const input = {
      interactionId: "spoken-turn-1",
      transcript: "please head north",
      transcriptConfidence: 0.99,
      observedObjects: ["token"],
    } as const;
    const result = await subject.submitTurn(
      input,
      new AbortController().signal,
    );
    expect(result.outcome).toBe("committed");
    expect(result.engineResult).toMatchObject({
      status: "committed",
      revision: 1,
      command: "north",
      output: "North Room\nA quiet room with an exit south.\n\n> ",
    });
    expect(result.checkpoint?.revision).toBe(1);
    expect(narration).toEqual([
      expect.objectContaining({
        role: "narrator",
        text: "North Room\nA quiet room with an exit south.\n\n> ",
      }),
    ]);

    const duplicate = await subject.submitTurn(
      input,
      new AbortController().signal,
    );
    expect(duplicate).toEqual(result);
    expect((await engine.inspectPublicState()).revision).toBe(1);
    expect(narration).toHaveLength(1);
  });
});
