import { readFile } from "node:fs/promises";

import {
  createOpeningObjectProjection,
  projectOpeningObjectsFromEngineOutput,
  projectOpeningObjectsFromEvent,
} from "../packages/command-knowledge/src/index.js";
import { canonicalizeCommand, type SemanticEvent } from "@zork-voice/contracts";
import { EventSequence } from "@zork-voice/events";
import { selectOpeningNarrationText } from "../packages/experience/src/index.js";
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
const ZORK_STORY_ID = "zork1-release-119";
const ZORK_STORY_SHA256 =
  "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79";
const ZORK_RELEASE_119_OPENING =
  "ZORK I: The Great Underground Empire\nInfocom interactive fiction - a fantasy story\nCopyright (c) 1981, 1982, 1983, 1984, 1985, 1986 Infocom, Inc. All rights reserved.\nZORK is a registered trademark of Infocom, Inc.\nRelease 119 / Serial number 880429\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.\n\n>";
const ZORK_RELEASE_119_SPOKEN_OPENING =
  "ZORK I: The Great Underground Empire\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.";
const storyUrl = new URL(
  "../fixtures/stories/minimal/artifact/minimal.z3",
  import.meta.url,
);
const zorkStoryUrl = new URL("../vendor/zork1/zork1.z3", import.meta.url);

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
  it("preserves the exact Zork I opening while narrating its reviewed excerpt", async () => {
    let messageId = 0;
    const engine = new DorkWorkerEngine({
      factory: new RuntimeFactory(),
      storyBytes: new Uint8Array(await readFile(zorkStoryUrl)),
      binding: DORK_WORKER_BINDING,
      nextMessageId: () => `opening-message-${++messageId}`,
    });
    const boot = await engine.boot({
      storyId: ZORK_STORY_ID,
      artifactSha256: ZORK_STORY_SHA256,
    });
    expect(boot).toMatchObject({
      revision: 0,
      output: ZORK_RELEASE_119_OPENING,
      turnComplete: true,
      boundary: "input-requested",
    });

    const published: SemanticEvent[] = [];
    const narration: NarrationRequest[] = [];
    let eventId = 0;
    let narrationId = 0;
    const subject = new SemanticTurnCoordinator({
      engine,
      guide: FakeGuideModel.returning({
        kind: "execute",
        command: "look",
        intentSummary: "Observe the current surroundings",
        confidence: 0.99,
      }),
      narrator: {
        prepare: (request) => {
          narration.push(request);
          return Promise.resolve();
        },
      },
      events: new EventSequence({
        sessionId: "zork-opening-session",
        now: () => "2026-08-19T20:00:00.000Z",
        nextId: () => `opening-event-${++eventId}`,
      }),
      nextRequestId: () => "opening-look-request",
      nextNarrationId: () => `opening-narration-${++narrationId}`,
      publish: (event) => published.push(event),
    });
    const openingInput = {
      interactionId: "story-opening",
      boot,
      narrationText: selectOpeningNarrationText(boot),
    } as const;

    const [opening, duplicate] = await Promise.all([
      subject.prepareOpening(openingInput, new AbortController().signal),
      subject.prepareOpening(openingInput, new AbortController().signal),
    ]);
    expect(duplicate).toEqual(opening);
    expect(opening.events.map((event) => event.type)).toEqual([
      "engine.output",
      "narration.requested",
      "narration.ready",
    ]);
    const openingOutput = opening.events[0];
    expect(openingOutput).toMatchObject({
      type: "engine.output",
      correlationId: "story-opening",
      payload: {
        revision: 0,
        exactText: ZORK_RELEASE_119_OPENING,
        boundary: "input-requested",
        retention: "local-save",
      },
    });
    expect(
      published.filter((event) => event.type === "engine.output"),
    ).toHaveLength(1);
    expect(
      published.filter((event) => event.type.startsWith("engine.command.")),
    ).toHaveLength(0);
    expect(
      published.filter((event) => event.type === "save.checkpointed"),
    ).toHaveLength(0);
    expect(narration).toEqual([
      {
        narrationId: "opening-narration-1",
        role: "narrator",
        text: ZORK_RELEASE_119_SPOKEN_OPENING,
        sourceEventId: openingOutput?.id,
        correlationId: "story-opening",
      },
    ]);
    expect(await engine.inspectPublicState()).toMatchObject({
      revision: 0,
      lastOutput: ZORK_RELEASE_119_OPENING,
      boundary: "input-requested",
    });

    const look = await subject.submitTurn(
      {
        interactionId: "first-look",
        transcript: "What do I see around me?",
        transcriptConfidence: 0.99,
        observedObjects: ["house", "door", "mailbox"],
      },
      new AbortController().signal,
    );
    expect(look).toMatchObject({
      outcome: "committed",
      engineResult: {
        status: "committed",
        previousRevision: 0,
        revision: 1,
        command: "look",
        output: expect.stringContaining("West of House"),
      },
    });
    expect(await engine.inspectPublicState()).toMatchObject({ revision: 1 });
  });

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

  it("commits a semantic location request as one Zork I look turn", async () => {
    let messageId = 0;
    const engine = new DorkWorkerEngine({
      factory: new RuntimeFactory(),
      storyBytes: new Uint8Array(await readFile(zorkStoryUrl)),
      binding: DORK_WORKER_BINDING,
      nextMessageId: () => `front-look-message-${++messageId}`,
    });
    await engine.boot({
      storyId: ZORK_STORY_ID,
      artifactSha256: ZORK_STORY_SHA256,
    });

    const published: SemanticEvent[] = [];
    const narration: NarrationRequest[] = [];
    let eventId = 0;
    const subject = new SemanticTurnCoordinator({
      engine,
      guide: FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.look",
        slots: [],
        intentSummary: "Observe the current surroundings",
        confidence: 0.99,
      }),
      narrator: {
        prepare: (request) => {
          narration.push(request);
          return Promise.resolve();
        },
      },
      events: new EventSequence({
        sessionId: "zork-front-look-session",
        now: () => "2026-08-19T18:45:00.000Z",
        nextId: () => `front-look-event-${++eventId}`,
      }),
      nextRequestId: () => "front-look-engine-request-1",
      nextNarrationId: () => "front-look-narration-1",
      publish: (event) => published.push(event),
    });

    const result = await subject.submitTurn(
      {
        interactionId: "front-look-interaction",
        transcript: "Tell me where I am.",
        transcriptConfidence: 0.99,
        observedObjects: ["house", "door", "mailbox"],
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      outcome: "committed",
      engineResult: {
        status: "committed",
        revision: 1,
        command: "look",
        output: expect.stringContaining("West of House"),
      },
    });
    expect(
      published
        .filter((event) => event.type === "engine.command.requested")
        .map((event) => event.payload.command),
    ).toEqual(["look"]);
    const proposed = published.find(
      (event) => event.type === "guide.decision.proposed",
    );
    expect(proposed?.payload.decision).not.toHaveProperty("affordanceId");
    expect(narration).toEqual([
      expect.objectContaining({
        role: "narrator",
        text: result.engineResult?.output,
      }),
    ]);
  });

  it.each(["What does the mailbox look like?", "Let's check out the mailbox."])(
    "compiles the observed-object paraphrase %s as one Zork I examine turn",
    async (transcript) => {
      let messageId = 0;
      const engine = new DorkWorkerEngine({
        factory: new RuntimeFactory(),
        storyBytes: new Uint8Array(await readFile(zorkStoryUrl)),
        binding: DORK_WORKER_BINDING,
        nextMessageId: () => `mailbox-message-${++messageId}`,
      });
      await engine.boot({
        storyId: ZORK_STORY_ID,
        artifactSha256: ZORK_STORY_SHA256,
      });

      const published: SemanticEvent[] = [];
      const narration: NarrationRequest[] = [];
      let eventId = 0;
      const subject = new SemanticTurnCoordinator({
        engine,
        guide: FakeGuideModel.returning({
          kind: "execute",
          affordanceId: "grammar.examine",
          slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
          intentSummary: "Observe the mailbox more closely",
          confidence: 0.99,
        }),
        narrator: {
          prepare: (request) => {
            narration.push(request);
            return Promise.resolve();
          },
        },
        events: new EventSequence({
          sessionId: "zork-mailbox-session",
          now: () => "2026-08-19T19:00:00.000Z",
          nextId: () => `mailbox-event-${++eventId}`,
        }),
        nextRequestId: () => "mailbox-engine-request-1",
        nextNarrationId: () => "mailbox-narration-1",
        publish: (event) => published.push(event),
      });

      const result = await subject.submitTurn(
        {
          interactionId: "mailbox-interaction",
          transcript,
          transcriptConfidence: 0.99,
          observedObjects: ["house", "door", "mailbox"],
        },
        new AbortController().signal,
      );

      expect(result).toMatchObject({
        outcome: "committed",
        engineResult: {
          status: "committed",
          revision: 1,
          command: "examine mailbox",
          output: "The small mailbox is closed.\n\n>",
        },
      });
      expect(
        published
          .filter((event) => event.type === "engine.command.requested")
          .map((event) => event.payload.command),
      ).toEqual(["examine mailbox"]);
      const proposed = published.find(
        (event) => event.type === "guide.decision.proposed",
      );
      expect(proposed?.payload.decision).toMatchObject({
        kind: "execute",
        command: "examine mailbox",
      });
      expect(proposed?.payload.decision).not.toHaveProperty("affordanceId");
      expect(proposed?.payload.decision).not.toHaveProperty("slots");
      expect(narration).toEqual([
        expect.objectContaining({
          role: "narrator",
          text: "The small mailbox is closed.\n\n>",
        }),
      ]);
    },
  );

  it("reads the observed Zork I leaflet without implicitly taking it", async () => {
    let messageId = 0;
    const engine = new DorkWorkerEngine({
      factory: new RuntimeFactory(),
      storyBytes: new Uint8Array(await readFile(zorkStoryUrl)),
      binding: DORK_WORKER_BINDING,
      nextMessageId: () => `zork-message-${++messageId}`,
    });
    const boot = await engine.boot({
      storyId: ZORK_STORY_ID,
      artifactSha256: ZORK_STORY_SHA256,
    });
    let observedObjectProjection = projectOpeningObjectsFromEngineOutput(
      createOpeningObjectProjection(),
      boot.output,
    );
    expect(observedObjectProjection.observedObjects).toEqual([
      "house",
      "door",
      "mailbox",
    ]);

    const published: SemanticEvent[] = [];
    const narration: NarrationRequest[] = [];
    let eventId = 0;
    let requestId = 0;
    let narrationId = 0;
    const guide = FakeGuideModel.returning({
      kind: "execute",
      command: "open mailbox",
      intentSummary: "Open the observed mailbox",
      confidence: 0.99,
    });
    const subject = new SemanticTurnCoordinator({
      engine,
      guide,
      narrator: {
        prepare: (request) => {
          narration.push(request);
          return Promise.resolve();
        },
      },
      events: new EventSequence({
        sessionId: "zork-leaflet-session",
        now: () => "2026-08-19T18:30:00.000Z",
        nextId: () => `zork-event-${++eventId}`,
      }),
      nextRequestId: () => `zork-engine-request-${++requestId}`,
      nextNarrationId: () => `zork-narration-${++narrationId}`,
      publish: (event) => {
        published.push(event);
        observedObjectProjection = projectOpeningObjectsFromEvent(
          observedObjectProjection,
          event,
        );
      },
    });

    const opened = await subject.submitTurn(
      {
        interactionId: "open-mailbox",
        transcript: "Open the mailbox.",
        transcriptConfidence: 0.99,
        observedObjects: observedObjectProjection.observedObjects,
      },
      new AbortController().signal,
    );
    expect(opened.engineResult).toMatchObject({
      status: "committed",
      revision: 1,
      command: "open mailbox",
      output: "Opening the small mailbox reveals a leaflet.\n\n>",
    });
    expect(observedObjectProjection.observedObjects).toEqual([
      "house",
      "door",
      "mailbox",
      "leaflet",
    ]);

    const leafletText =
      '"WELCOME TO ZORK!\n\nZORK is a game of adventure, danger, and low cunning. In it you will explore some of the most amazing territory ever seen by mortals. No computer should be without one!"\n\n>';
    const read = await subject.submitTurn(
      {
        interactionId: "read-leaflet",
        transcript: "What does the leaflet say?",
        transcriptConfidence: 0.99,
        observedObjects: observedObjectProjection.observedObjects,
      },
      new AbortController().signal,
    );
    expect(read).toMatchObject({
      outcome: "committed",
      engineResult: {
        status: "committed",
        revision: 2,
        command: "examine leaflet",
        output: leafletText,
      },
    });
    expect(guide.calls).toBe(1);

    const requestedCommands = published
      .filter((event) => event.type === "engine.command.requested")
      .map((event) => event.payload.command);
    expect(requestedCommands).toEqual(["open mailbox", "examine leaflet"]);
    expect(
      requestedCommands.filter((command) => command === "examine leaflet"),
    ).toHaveLength(1);
    expect(requestedCommands).not.toContain("take leaflet");
    expect(narration).toEqual([
      expect.objectContaining({
        role: "narrator",
        text: "Opening the small mailbox reveals a leaflet.\n\n>",
      }),
      expect.objectContaining({ role: "narrator", text: leafletText }),
    ]);

    const inventory = await engine.execute({
      requestId: "inventory-verification",
      expectedRevision: 2,
      command: canonicalizeCommand("inventory"),
    });
    expect(inventory).toMatchObject({
      status: "committed",
      revision: 3,
      command: "inventory",
      output: "You are empty-handed.\n\n>",
    });
  });
});
