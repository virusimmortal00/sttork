import {
  createObservedWorldProjection,
  createOpeningSceneProjection,
  OPENING_SCENE_BOOT_OUTPUT,
  OPENING_SCENE_MAILBOX_REVEAL_OUTPUT,
  OPENING_SCENE_STORY_ID,
  OPENING_SCENE_STORY_SHA256,
  projectOpeningSceneFromEvent,
  projectObservedWorldFromEngineOutput,
  projectObservedWorldFromEvent,
  type OpeningSceneProjection,
} from "../../command-knowledge/src/index.js";
import type { SemanticEvent } from "../../contracts/src/index.js";
import { describe, expect, it } from "vitest";

import { FakeGuideModel } from "./fake-guide-model.js";
import { decideInitialGuideTurn } from "./initial-guide.js";

const signal = new AbortController().signal;
const baseInput = {
  interactionId: "interaction-1",
  playerUtterance: "please head north",
  transcriptConfidence: 0.99,
  observedObjects: ["brass token"],
} as const;
const leafletReadExaminePending = {
  kind: "read-examine-choice",
  objectValueId: "observed-object:leaflet",
  allowedActions: ["examine", "read"],
} as const;
const leafletContextualPending = {
  kind: "contextual-object-action-choice",
  objectValueId: "observed-object:leaflet",
  suggestedActions: ["examine", "read"],
} as const;
const mailboxContextualPending = {
  kind: "contextual-object-action-choice",
  objectValueId: "observed-object:mailbox",
  suggestedActions: ["examine", "open"],
} as const;

function authenticatedOpeningScene(): OpeningSceneProjection {
  return projectOpeningSceneFromEvent(
    createOpeningSceneProjection({
      id: OPENING_SCENE_STORY_ID,
      artifactSha256: OPENING_SCENE_STORY_SHA256,
    }),
    {
      schemaVersion: 1,
      id: "opening-output",
      sessionId: "session-1",
      sequence: 1,
      occurredAt: "2026-08-20T12:00:00.000Z",
      type: "engine.output",
      correlationId: "story-opening",
      visibility: "accessible",
      payload: {
        revision: 0,
        exactText: OPENING_SCENE_BOOT_OUTPUT,
        boundary: "input-requested",
        retention: "local-save",
      },
    } satisfies SemanticEvent<"engine.output">,
  );
}

function openedMailboxScene(): OpeningSceneProjection {
  const opening = authenticatedOpeningScene();
  const committed = projectOpeningSceneFromEvent(opening, {
    schemaVersion: 1,
    id: "open-mailbox-commit",
    sessionId: "session-1",
    sequence: 2,
    occurredAt: "2026-08-20T12:00:01.000Z",
    type: "engine.command.committed",
    correlationId: "interaction-open-mailbox",
    visibility: "debug",
    payload: {
      requestId: "open-mailbox-request",
      previousRevision: 0,
      revision: 1,
      command: "open mailbox",
      boundary: "input-requested",
    },
  } satisfies SemanticEvent<"engine.command.committed">);
  return projectOpeningSceneFromEvent(committed, {
    schemaVersion: 1,
    id: "open-mailbox-output",
    sessionId: "session-1",
    sequence: 3,
    occurredAt: "2026-08-20T12:00:02.000Z",
    type: "engine.output",
    correlationId: "interaction-open-mailbox",
    causationId: "open-mailbox-commit",
    visibility: "accessible",
    payload: {
      revision: 1,
      exactText: OPENING_SCENE_MAILBOX_REVEAL_OUTPUT,
      boundary: "input-requested",
      retention: "local-save",
    },
  } satisfies SemanticEvent<"engine.output">);
}

function readLeafletScene(): OpeningSceneProjection {
  const opened = openedMailboxScene();
  const committed = projectOpeningSceneFromEvent(opened, {
    schemaVersion: 1,
    id: "read-leaflet-commit",
    sessionId: "session-1",
    sequence: 4,
    occurredAt: "2026-08-20T12:00:03.000Z",
    type: "engine.command.committed",
    correlationId: "interaction-read-leaflet",
    visibility: "debug",
    payload: {
      requestId: "read-leaflet-request",
      previousRevision: 1,
      revision: 2,
      command: "read leaflet",
      boundary: "input-requested",
    },
  } satisfies SemanticEvent<"engine.command.committed">);
  return projectOpeningSceneFromEvent(committed, {
    schemaVersion: 1,
    id: "read-leaflet-output",
    sessionId: "session-1",
    sequence: 5,
    occurredAt: "2026-08-20T12:00:04.000Z",
    type: "engine.output",
    correlationId: "interaction-read-leaflet",
    causationId: "read-leaflet-commit",
    visibility: "accessible",
    payload: {
      revision: 2,
      exactText: '(Taken)\n"WELCOME TO ZORK!"\n\n>',
      boundary: "input-requested",
      retention: "local-save",
    },
  } satisfies SemanticEvent<"engine.output">);
}

function openedMailboxSceneInput(): {
  readonly observedObjects: readonly string[];
  readonly scene: OpeningSceneProjection;
} {
  return {
    observedObjects: ["door", "house", "leaflet", "mailbox"],
    scene: openedMailboxScene(),
  };
}

function movementClearedOpeningScene(): OpeningSceneProjection {
  const opening = authenticatedOpeningScene();
  const committed = projectOpeningSceneFromEvent(opening, {
    schemaVersion: 1,
    id: "north-commit",
    sessionId: "session-1",
    sequence: 2,
    occurredAt: "2026-08-20T12:00:01.000Z",
    type: "engine.command.committed",
    correlationId: "interaction-move",
    visibility: "debug",
    payload: {
      requestId: "request-move",
      previousRevision: 0,
      revision: 1,
      command: "north",
      boundary: "input-requested",
    },
  } satisfies SemanticEvent<"engine.command.committed">);
  return projectOpeningSceneFromEvent(committed, {
    schemaVersion: 1,
    id: "north-output",
    sessionId: "session-1",
    sequence: 3,
    occurredAt: "2026-08-20T12:00:02.000Z",
    type: "engine.output",
    correlationId: "interaction-move",
    visibility: "accessible",
    payload: {
      revision: 1,
      exactText:
        "North of House\nYou are facing the north side of a white house.\n\n>",
      boundary: "input-requested",
      retention: "local-save",
    },
  } satisfies SemanticEvent<"engine.output">);
}

describe("initial bounded Dungeon Guide", () => {
  it("grounds an explicit EXAMINE against a later source-backed world referent", async () => {
    let observedWorld = projectObservedWorldFromEngineOutput(
      createObservedWorldProjection(),
      "Forest Path\nOne particularly large tree with some low branches stands at the edge of the path.\n\n>",
    );
    const model = new FakeGuideModel(() => {
      throw new Error("The provider must not be needed.");
    });

    await expect(
      decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "Examine tree.",
          observedObjects: observedWorld.currentObjects,
          observedWorld,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      kind: "execute",
      command: "examine tree",
      groundingSourceId: "grammar.examine",
    });
    expect(model.calls).toBe(0);

    await expect(
      decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "Go north.",
          observedObjects: observedWorld.currentObjects,
          observedWorld,
        },
        signal,
      ),
    ).resolves.toMatchObject({ kind: "execute", command: "north" });
    expect(model.calls).toBe(0);

    await expect(
      decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "What can I do with the tree?",
          observedObjects: observedWorld.currentObjects,
          observedWorld,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      kind: "explain",
      decision: {
        response: expect.stringContaining("EXAMINE"),
        sourceIds: expect.arrayContaining(["grammar.examine"]),
      },
    });
    expect(model.calls).toBe(0);

    observedWorld = projectObservedWorldFromEvent(observedWorld, {
      schemaVersion: 1,
      id: "examine-tree-commit",
      sessionId: "session-1",
      sequence: 2,
      occurredAt: "2026-08-20T12:00:01.000Z",
      type: "engine.command.committed",
      correlationId: "examine-tree",
      visibility: "debug",
      payload: {
        requestId: "request-examine-tree",
        previousRevision: 0,
        revision: 1,
        command: "examine tree",
        boundary: "input-requested",
      },
    } satisfies SemanticEvent<"engine.command.committed">);
    observedWorld = projectObservedWorldFromEvent(observedWorld, {
      schemaVersion: 1,
      id: "examine-tree-output",
      sessionId: "session-1",
      sequence: 3,
      occurredAt: "2026-08-20T12:00:02.000Z",
      type: "engine.output",
      correlationId: "examine-tree",
      causationId: "examine-tree-commit",
      visibility: "accessible",
      payload: {
        revision: 1,
        exactText: "You see nothing special about the tree.\n\n>",
        boundary: "input-requested",
        retention: "local-save",
      },
    } satisfies SemanticEvent<"engine.output">);

    await expect(
      decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "Inspect it.",
          observedObjects: observedWorld.currentObjects,
          observedWorld,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      kind: "execute",
      command: "examine tree",
      groundingSourceId: "grammar.examine",
    });
    expect(model.calls).toBe(0);
  });

  it.each([
    {
      playerUtterance: "Walk to the mailbox.",
      response:
        "The mailbox is already here. You can try examining it or opening it.",
      basis: "observed-memory" as const,
      sourceIds: ["opening-output", "grammar.examine", "grammar.open"],
    },
    {
      playerUtterance: "What actions are available?",
      response:
        "You can try examining the mailbox, opening the mailbox, or examining the boarded door. The game will decide what works.",
      basis: "command-help" as const,
      sourceIds: ["grammar.examine", "opening-output", "grammar.open"],
    },
    {
      playerUtterance: "In which direction was the house again?",
      response:
        "The game said you were west of the house, so the house is east of you.",
      basis: "observed-memory" as const,
      sourceIds: ["opening-output"],
    },
  ])(
    "answers the scene-aware request $playerUtterance locally",
    async ({ playerUtterance, response, basis, sourceIds }) => {
      const model = new FakeGuideModel(() => {
        throw new Error("scene-aware guidance reached the model");
      });

      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance,
          observedObjects: ["door", "house", "mailbox"],
          scene: authenticatedOpeningScene(),
        },
        signal,
      );

      expect(result).toEqual({
        kind: "explain",
        decision: {
          kind: "explain",
          response,
          basis,
          sourceIds,
        },
      });
      expect(result).not.toHaveProperty("command");
      expect(model.calls).toBe(0);
    },
  );

  it.each([
    {
      name: "low-confidence transcript",
      playerUtterance: "Walk to the mailbox.",
      transcriptConfidence: 0.4,
    },
    {
      name: "multi-action request",
      playerUtterance: "Walk to the mailbox, then open it.",
      transcriptConfidence: 0.99,
    },
    {
      name: "negated request",
      playerUtterance: "Do not walk to the mailbox.",
      transcriptConfidence: 0.99,
    },
  ])(
    "clarifies a $name before applying scene-aware guidance",
    async ({ playerUtterance, transcriptConfidence }) => {
      const model = new FakeGuideModel(() => {
        throw new Error("unsafe scene-aware request reached the model");
      });

      expect(
        await decideInitialGuideTurn(
          model,
          {
            ...baseInput,
            playerUtterance,
            transcriptConfidence,
            observedObjects: ["door", "house", "mailbox"],
            scene: authenticatedOpeningScene(),
          },
          signal,
        ),
      ).toMatchObject({ kind: "clarify" });
      expect(model.calls).toBe(0);
    },
  );

  it("does not claim a historical house direction after movement clears the current scene", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("stale spatial recall reached the model");
    });

    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "In which direction was the house again?",
        observedObjects: [],
        scene: movementClearedOpeningScene(),
      },
      signal,
    );

    expect(result).toEqual({
      kind: "explain",
      decision: {
        kind: "explain",
        response:
          "I don't have a current, observed direction for the house. Try LOOK to reorient.",
        basis: "observed-memory",
        sourceIds: ["opening-output", "grammar.look"],
      },
    });
    expect(result).not.toHaveProperty("command");
    expect(model.calls).toBe(0);
  });

  it("grounds a direct execute decision as one canonical command", async () => {
    const result = await decideInitialGuideTurn(
      FakeGuideModel.returning({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      }),
      baseInput,
      signal,
    );
    expect(result).toMatchObject({
      kind: "execute",
      command: "north",
      groundingSourceId: "grammar.direction.north",
    });
  });

  it.each(["What do I see around me?", "What do I see in front of me?"])(
    "grounds the natural observation question %s as one look command",
    async (playerUtterance) => {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          command: "look",
          intentSummary: "Observe the current surroundings",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance,
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "execute",
        command: "look",
        groundingSourceId: "grammar.look",
      });
    },
  );

  it.each([
    ["Tell me where I am.", "grammar.look", "look"],
    ["Describe this place.", "grammar.look", "look"],
    ["Give me a sense of my surroundings.", "grammar.look", "look"],
    ["What can I see from here?", "grammar.look", "look"],
    ["What have I got with me?", "grammar.inventory", "inventory"],
    ["List my possessions.", "grammar.inventory", "inventory"],
  ])(
    "semantically resolves the paraphrase %s through %s",
    async (playerUtterance, affordanceId, command) => {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          affordanceId,
          slots: [],
          intentSummary: "Resolve one global observation",
          confidence: 0.99,
        }),
        { ...baseInput, playerUtterance },
        signal,
      );

      expect(result).toMatchObject({
        kind: "execute",
        command,
        groundingSourceId: affordanceId,
      });
      if (result.kind === "execute") {
        expect(result.decision).not.toHaveProperty("affordanceId");
        expect(result.decision).not.toHaveProperty("slots");
      }
    },
  );

  it.each([
    "What does the mailbox look like?",
    "Let's check out the mailbox.",
    "Examine the mailbox.",
    "Examine the mailbox without taking it.",
    "Can you examine the mailbox without taking it?",
    "Examine the mailbox without taking it, please.",
    "Could you look more closely at the mailbox?",
    "Let's take a closer look at the mailbox.",
    "What can you tell me about the mailbox?",
    "Give me a description of the mailbox.",
    "Show me what the mailbox looks like.",
    "Could you check the mailbox out?",
    "Let's see what the mailbox looks like.",
    "Could you look over the mailbox?",
    "Could you tell me what you see on the mailbox?",
    "I want to know more about the mailbox.",
    "How would you describe the mailbox?",
    "What can I see on the mailbox?",
    "Take a good look at the mailbox.",
  ])(
    "semantically examines the explicitly mentioned observed mailbox in %s",
    async (playerUtterance) => {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          affordanceId: "grammar.examine",
          slots: [
            {
              slotId: "object",
              valueId: "observed-object:mailbox",
            },
          ],
          intentSummary: "Observe the mailbox more closely",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance,
          observedObjects: ["door", "mailbox"],
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "execute",
        command: "examine mailbox",
        groundingSourceId: "grammar.examine",
        decision: {
          kind: "execute",
          command: "examine mailbox",
          intentSummary: "Observe the mailbox more closely",
          confidence: 0.99,
        },
      });
      if (result.kind === "execute") {
        expect(result.decision).not.toHaveProperty("affordanceId");
        expect(result.decision).not.toHaveProperty("slots");
      }
    },
  );

  it("uses recent object focus to inspect an implicitly referenced reverse side", async () => {
    const model = FakeGuideModel.returning({
      kind: "clarify",
      question: "Could you say which single action you want me to try?",
      ambiguity: "generic",
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "Is there anything on the back?",
        observedObjects: ["door", "house", "mailbox"],
        scene: readLeafletScene(),
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "execute",
      command: "examine leaflet",
      groundingSourceId: "grammar.examine",
      decision: {
        kind: "execute",
        command: "examine leaflet",
        confidence: 1,
      },
    });
    expect(model.calls).toBe(0);
  });

  it("semantically examines the correctly selected longer overlapping object", async () => {
    const result = await decideInitialGuideTurn(
      FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.examine",
        slots: [
          {
            slotId: "object",
            valueId: "observed-object:red leaflet",
          },
        ],
        intentSummary: "Observe the red leaflet more closely",
        confidence: 0.99,
      }),
      {
        ...baseInput,
        playerUtterance: "Could you look more closely at the red leaflet?",
        observedObjects: ["leaflet", "red leaflet"],
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "execute",
      command: "examine red leaflet",
      groundingSourceId: "grammar.examine",
    });
  });

  it.each([
    "What's in the leaflet?",
    "What's on or in the leaflet?",
    "Could you tell me what's on or in the leaflet?",
    "What's written on the leaflet?",
    "Tell me what the leaflet says.",
    "What words are on the leaflet?",
  ])(
    "clarifies the nonlexical READ-versus-EXAMINE ambiguity in %s",
    async (playerUtterance) => {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          affordanceId: "grammar.read",
          slots: [
            {
              slotId: "object",
              valueId: "observed-object:leaflet",
            },
          ],
          intentSummary: "Learn what is written on the leaflet",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance,
          ...openedMailboxSceneInput(),
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "clarify",
        decision: {
          kind: "clarify",
          question:
            "Would you like me to examine the leaflet without taking it, or use READ, which may take it?",
          ambiguity: expect.stringContaining("may implicitly take"),
          choices: ["examine leaflet", "read leaflet"],
        },
      });
      expect(result).not.toHaveProperty("command");
      expect(result).toMatchObject({
        pendingIntent: leafletContextualPending,
      });
    },
  );

  it("suggests EXAMINE and OPEN for mailbox contents without narrowing parser authority", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("scene-backed mailbox content help reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What's inside the mailbox?",
        observedObjects: ["door", "house", "mailbox"],
        scene: authenticatedOpeningScene(),
      },
      signal,
    );

    expect(result).toEqual({
      kind: "clarify",
      decision: {
        kind: "clarify",
        question:
          "Would you like me to examine the mailbox without changing it, or try to open it?",
        ambiguity:
          "The current scene offers two useful attempts, but neither is the only parser command the player may explicitly request.",
        choices: ["examine mailbox", "open mailbox"],
      },
      pendingIntent: mailboxContextualPending,
    });
    expect(model.calls).toBe(0);
  });

  it.each(["Read the mailbox.", "read it"])(
    "keeps the explicit out-of-suggestion parser action available in %s",
    async (playerUtterance) => {
      const model = new FakeGuideModel(() => {
        throw new Error("explicit focused READ reached the provider");
      });
      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance,
          observedObjects: ["door", "house", "mailbox"],
          scene: authenticatedOpeningScene(),
          pendingIntent: mailboxContextualPending,
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "execute",
        command: "read mailbox",
        groundingSourceId: "grammar.read",
      });
      expect(model.calls).toBe(0);
    },
  );

  it("clears a contextual focus when the exact scene suggestion pair changes", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("stale contextual focus reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What were those options?",
        ...openedMailboxSceneInput(),
        pendingIntent: mailboxContextualPending,
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "clarify",
      decision: {
        question: expect.stringContaining("no longer current"),
      },
    });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(model.calls).toBe(0);
  });

  it("retains an explicitly authorized semantic READ command", async () => {
    expect(
      await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          affordanceId: "grammar.read",
          slots: [
            {
              slotId: "object",
              valueId: "observed-object:leaflet",
            },
          ],
          intentSummary: "Read the leaflet",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance: "Read the leaflet.",
          observedObjects: ["leaflet"],
        },
        signal,
      ),
    ).toMatchObject({
      kind: "execute",
      command: "read leaflet",
      groundingSourceId: "grammar.read",
    });
  });

  it.each([
    "What's in the leaflet?",
    "What information is available on the leaflet?",
    "What does the leaflet contain?",
    "What are the contents of the leaflet?",
    "What is contained in the leaflet?",
    "Show me the contents of the leaflet.",
    "Can you tell me what's in the leaflet?",
    "What's written on the leaflet?",
    "What is the writing on the leaflet?",
    "What words are on the leaflet?",
    "Tell me the text on the leaflet.",
    "What is the content of the leaflet?",
    "What is the inscription on the leaflet?",
    "What's printed on the leaflet?",
    "What might the leaflet say?",
    "Tell me what the leaflet says.",
  ])(
    "clarifies the visible-content request %s without consulting the provider",
    async (playerUtterance) => {
      const model = FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.examine",
        slots: [
          {
            slotId: "object",
            valueId: "observed-object:leaflet",
          },
        ],
        intentSummary: "Observe the leaflet's visible writing",
        confidence: 0.99,
      });
      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance,
          ...openedMailboxSceneInput(),
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "clarify",
        decision: {
          choices: ["examine leaflet", "read leaflet"],
        },
      });
      expect(result).not.toHaveProperty("command");
      expect(result).toMatchObject({
        pendingIntent: leafletContextualPending,
      });
      expect(model.calls).toBe(0);
    },
  );

  it("answers action-options help for the pending leaflet without losing focus", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("scoped pending help reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What are the action options?",
        observedObjects: ["leaflet", "mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toEqual({
      kind: "clarify",
      decision: {
        kind: "clarify",
        question:
          "For the leaflet, EXAMINE inspects it without taking it; READ asks the game to read it and may take it. Which should I try?",
        ambiguity:
          "The active object has two distinct parser actions with different effects.",
        choices: ["examine leaflet", "read leaflet"],
      },
      pendingIntent: leafletReadExaminePending,
    });
    if (result.kind !== "clarify") {
      throw new Error("Expected scoped leaflet clarification.");
    }
    expect(result.decision.question).not.toMatch(/LOOK:|INVENTORY:|NORTH:/u);
    expect(model.calls).toBe(0);
  });

  it("does not offer scoped action options for a stale pending object", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("stale pending help reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What are the action options?",
        observedObjects: ["mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "clarify",
      decision: {
        question: expect.stringContaining("no longer in the observed scene"),
      },
    });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(model.calls).toBe(0);
  });

  it("normalizes adaptive provider help back to the current scoped choices", async () => {
    const model = FakeGuideModel.returning({
      kind: "explain",
      response: "Untrusted provider prose",
      basis: "command-help",
      sourceIds: ["grammar.read", "grammar.examine"],
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "Could you remind me what those choices were?",
        observedObjects: ["leaflet", "mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "clarify",
      decision: {
        question: expect.stringContaining("For the leaflet"),
        choices: ["examine leaflet", "read leaflet"],
      },
      pendingIntent: leafletReadExaminePending,
    });
    expect(result.decision).not.toMatchObject({
      question: "Untrusted provider prose",
    });
    expect(model.calls).toBe(1);
  });

  it("does not bind scoped comparison help to a different current object", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("deterministic command comparison reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "Should I read or examine the mailbox?",
        observedObjects: ["leaflet", "mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({ kind: "explain" });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(JSON.stringify(result)).not.toContain("For the leaflet");
    expect(model.calls).toBe(0);
  });

  it("does not bind adaptive provider help to a different current object", async () => {
    const model = FakeGuideModel.returning({
      kind: "explain",
      response: "Untrusted provider prose",
      basis: "command-help",
      sourceIds: ["grammar.examine", "grammar.read"],
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What action options do I have for the mailbox?",
        observedObjects: ["leaflet", "mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({ kind: "explain" });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(JSON.stringify(result)).not.toContain("For the leaflet");
    expect(model.calls).toBe(1);
  });

  it("does not preserve scoped focus when a provider misclassifies explicit scene-wide help", async () => {
    const model = FakeGuideModel.returning({
      kind: "explain",
      response: "Untrusted provider prose",
      basis: "command-help",
      sourceIds: ["grammar.examine", "grammar.read"],
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What can I do here?",
        observedObjects: ["leaflet", "mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({ kind: "explain" });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(JSON.stringify(result)).not.toContain("For the leaflet");
    expect(model.calls).toBe(1);
  });

  it("does not preserve scoped focus for an unseen global-help paraphrase", async () => {
    const model = FakeGuideModel.returning({
      kind: "explain",
      response: "Untrusted provider prose",
      basis: "command-help",
      sourceIds: ["grammar.examine", "grammar.read"],
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What options do I have here?",
        observedObjects: ["leaflet", "mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({ kind: "explain" });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(JSON.stringify(result)).not.toContain("For the leaflet");
    expect(model.calls).toBe(1);
  });

  it("clears stale focus before an adaptive help request reaches the provider", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("stale pending focus reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "Could you remind me what those choices were?",
        observedObjects: ["mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "clarify",
      decision: {
        question: expect.stringContaining("no longer in the observed scene"),
      },
    });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(model.calls).toBe(0);
  });

  it("clears stale focus before low-confidence retry preservation", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("stale low-confidence focus reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What were those options?",
        transcriptConfidence: 0.4,
        observedObjects: ["mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "clarify",
      decision: {
        question: expect.stringContaining("no longer in the observed scene"),
      },
    });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(model.calls).toBe(0);
  });

  it.each([
    ["read leaflet", "Tell me what the leaflet says."],
    ["examine leaflet", "What's written on the leaflet?"],
  ])(
    "clarifies a legacy provider proposal %s for %s",
    async (command, playerUtterance) => {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          command,
          intentSummary: "Unsafe legacy content selection",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance,
          ...openedMailboxSceneInput(),
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "clarify",
        decision: {
          choices: ["examine leaflet", "read leaflet"],
        },
      });
      expect(result).not.toHaveProperty("command");
    },
  );

  it.each(["grammar.examine", "grammar.read"])(
    "rejects a shorter overlapping object selected through %s",
    async (affordanceId) => {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          affordanceId,
          slots: [
            {
              slotId: "object",
              valueId: "observed-object:leaflet",
            },
          ],
          intentSummary: "Select the wrong shorter object",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance: "Could you look more closely at the red leaflet?",
          observedObjects: ["leaflet", "red leaflet"],
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "rejected",
        cause: "ungrounded-command",
      });
      expect(result).not.toHaveProperty("command");
    },
  );

  it.each([
    ["wrong actions", ["open leaflet", "take leaflet"]],
    ["duplicate action", ["read leaflet", "read leaflet"]],
    ["stale object", ["examine mailbox", "read mailbox"]],
    ["unobserved object", ["examine sword", "read sword"]],
    ["wrong paired action", ["examine leaflet", "open leaflet"]],
  ])(
    "does not surface $0 provider choices for a recognized content request",
    async (_name, choices) => {
      const model = new FakeGuideModel(() => ({
        kind: "clarify",
        question: "Provider-controlled question",
        ambiguity: "Provider-controlled ambiguity",
        choices,
      }));
      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "What's written on the leaflet?",
          ...openedMailboxSceneInput(),
        },
        signal,
      );

      expect(result).toEqual({
        kind: "clarify",
        decision: {
          kind: "clarify",
          question:
            "Would you like me to examine the leaflet without taking it, or use READ, which may take it?",
          ambiguity:
            "The request could mean a non-taking EXAMINE action or the parser's READ action, which may implicitly take the object.",
          choices: ["examine leaflet", "read leaflet"],
        },
        pendingIntent: leafletContextualPending,
      });
      expect(model.calls).toBe(0);
    },
  );

  it("normalizes a valid provider READ/EXAMINE pair for unseen wording", async () => {
    const model = FakeGuideModel.returning({
      kind: "clarify",
      question: "Provider-controlled question",
      ambiguity: "Provider-controlled ambiguity",
      choices: ["READ the leaflet", "EXAMINE the leaflet"],
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "I'd like details about the leaflet.",
        ...openedMailboxSceneInput(),
      },
      signal,
    );

    expect(result).toEqual({
      kind: "clarify",
      decision: {
        kind: "clarify",
        question:
          "Would you like me to examine the leaflet without taking it, or use READ, which may take it?",
        ambiguity:
          "The request could mean a non-taking EXAMINE action or the parser's READ action, which may implicitly take the object.",
        choices: ["examine leaflet", "read leaflet"],
      },
      pendingIntent: leafletContextualPending,
    });
    expect(model.calls).toBe(1);
  });

  it("replaces a generic non-content provider clarification with local prose", async () => {
    const decision = {
      kind: "clarify" as const,
      question: "Which direction would you like to try?",
      ambiguity: "Two directions remain possible.",
      choices: ["north", "south"] as const,
    };
    const model = FakeGuideModel.returning(decision);
    expect(
      await decideInitialGuideTurn(
        model,
        { ...baseInput, playerUtterance: "Which way might work?" },
        signal,
      ),
    ).toEqual({
      kind: "clarify",
      decision: {
        kind: "clarify",
        question: "Could you say which single action you want me to try?",
        ambiguity:
          "The request has more than one safely grounded interpretation.",
      },
    });
    expect(model.calls).toBe(1);
  });

  it("discards malicious non-content provider choices for unseen wording", async () => {
    const model = FakeGuideModel.returning({
      kind: "clarify",
      question: "Open it or take it?",
      ambiguity: "Provider-controlled ambiguity",
      choices: ["open leaflet", "take leaflet"],
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "Help me with the leaflet.",
        observedObjects: ["leaflet"],
      },
      signal,
    );

    expect(result).toEqual({
      kind: "clarify",
      decision: {
        kind: "clarify",
        question: "Could you say which single action you want me to try?",
        ambiguity:
          "The request has more than one safely grounded interpretation.",
      },
    });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(model.calls).toBe(1);
  });

  it("does not consult a provider that would select a different current object", async () => {
    const model = FakeGuideModel.returning({
      kind: "execute",
      affordanceId: "grammar.read",
      slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
      intentSummary: "Unsafe content selection",
      confidence: 0.99,
    });
    expect(
      await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "What's written on the leaflet?",
          ...openedMailboxSceneInput(),
        },
        signal,
      ),
    ).toMatchObject({
      kind: "clarify",
      decision: { choices: ["examine leaflet", "read leaflet"] },
    });
    expect(model.calls).toBe(0);
  });

  it("rejects a semantic READ with an unobserved selected object", async () => {
    expect(
      await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          affordanceId: "grammar.read",
          slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
          intentSummary: "Unsafe content selection",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance: "What's written on the leaflet?",
          observedObjects: ["mailbox"],
        },
        signal,
      ),
    ).toMatchObject({ kind: "rejected", cause: "ungrounded-command" });
  });

  it.each([
    {
      name: "low-confidence transcript",
      input: {
        ...baseInput,
        playerUtterance: "What does the mailbox look like?",
        transcriptConfidence: 0.4,
        observedObjects: ["mailbox"],
      },
    },
    {
      name: "negated request",
      input: {
        ...baseInput,
        playerUtterance: "Do not check out the mailbox.",
        observedObjects: ["mailbox"],
      },
    },
    {
      name: "multi-step request",
      input: {
        ...baseInput,
        playerUtterance: "Check out the mailbox, then open it.",
        observedObjects: ["mailbox"],
      },
    },
    {
      name: "alternative request",
      input: {
        ...baseInput,
        playerUtterance: "Check out the mailbox or open it.",
        observedObjects: ["mailbox"],
      },
    },
  ])(
    "clarifies a $name before requesting a semantic examine decision",
    async ({ input }) => {
      const model = FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.examine",
        slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
        intentSummary: "Observe the mailbox more closely",
        confidence: 0.99,
      });

      expect(await decideInitialGuideTurn(model, input, signal)).toMatchObject({
        kind: "clarify",
      });
      expect(model.calls).toBe(0);
    },
  );

  it("clarifies a low-confidence semantic examine decision", async () => {
    const model = FakeGuideModel.returning({
      kind: "execute",
      affordanceId: "grammar.examine",
      slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
      intentSummary: "Observe the mailbox more closely",
      confidence: 0.5,
    });

    expect(
      await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "What does the mailbox look like?",
          observedObjects: ["mailbox"],
        },
        signal,
      ),
    ).toMatchObject({ kind: "clarify" });
    expect(model.calls).toBe(1);
  });

  it.each([
    {
      name: "unknown affordance",
      playerUtterance: "Tell me where I am.",
      affordanceId: "grammar.unknown",
      slots: [],
    },
    {
      name: "wrong action for an appearance request",
      playerUtterance: "What does the mailbox look like?",
      affordanceId: "grammar.open",
      slots: [
        { slotId: "object" as const, valueId: "observed-object:mailbox" },
      ],
    },
    {
      name: "wrong mutating action for an appearance request",
      playerUtterance: "Let's check out the mailbox.",
      affordanceId: "grammar.take",
      slots: [
        { slotId: "object" as const, valueId: "observed-object:mailbox" },
      ],
    },
    {
      name: "wrong observed object",
      playerUtterance: "What does the mailbox look like?",
      affordanceId: "grammar.examine",
      slots: [{ slotId: "object" as const, valueId: "observed-object:door" }],
    },
    {
      name: "unobserved object",
      playerUtterance: "What does the sword look like?",
      affordanceId: "grammar.examine",
      slots: [{ slotId: "object" as const, valueId: "observed-object:sword" }],
    },
    {
      name: "higher-risk nonlexical bypass",
      playerUtterance: "Please reveal the mailbox.",
      affordanceId: "grammar.open",
      slots: [
        { slotId: "object" as const, valueId: "observed-object:mailbox" },
      ],
    },
  ])(
    "rejects $name without lexical authorization",
    async ({ playerUtterance, affordanceId, slots }) => {
      expect(
        await decideInitialGuideTurn(
          FakeGuideModel.returning({
            kind: "execute",
            affordanceId,
            slots,
            intentSummary: "Unsafe semantic proposal",
            confidence: 0.99,
          }),
          {
            ...baseInput,
            playerUtterance,
            observedObjects: ["door", "mailbox"],
          },
          signal,
        ),
      ).toMatchObject({ kind: "rejected", cause: "ungrounded-command" });
    },
  );

  it.each([
    ["go north", "north", "grammar.direction.north", []],
    [
      "open the mailbox",
      "open mailbox",
      "grammar.open",
      [{ slotId: "object", valueId: "observed-object:mailbox" }],
    ],
  ])(
    "retains lexical grounding for the higher-risk request %s",
    async (playerUtterance, command, affordanceId, slots) => {
      expect(
        await decideInitialGuideTurn(
          FakeGuideModel.returning({
            kind: "execute",
            affordanceId,
            slots,
            intentSummary: "Perform the explicitly requested action",
            confidence: 0.99,
          }),
          { ...baseInput, playerUtterance, observedObjects: ["mailbox"] },
          signal,
        ),
      ).toMatchObject({
        kind: "execute",
        command,
        groundingSourceId: affordanceId,
      });
    },
  );

  it.each([
    "Do not tell me where I am.",
    "Tell me where I am, then open the mailbox.",
  ])(
    "does not ask the model to execute the unsafe semantic contrast %s",
    async (playerUtterance) => {
      const model = FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.look",
        slots: [],
        intentSummary: "Observe the location",
        confidence: 0.99,
      });
      expect(
        await decideInitialGuideTurn(
          model,
          { ...baseInput, playerUtterance },
          signal,
        ),
      ).toMatchObject({ kind: "clarify" });
      expect(model.calls).toBe(0);
    },
  );

  it("clarifies a low-confidence semantic observation", async () => {
    expect(
      await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          affordanceId: "grammar.look",
          slots: [],
          intentSummary: "Observe the location",
          confidence: 0.5,
        }),
        { ...baseInput, playerUtterance: "Tell me where I am." },
        signal,
      ),
    ).toMatchObject({ kind: "clarify" });
  });

  it("fails an exact content question closed without trusted scene suggestions", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error(
        "the deterministic content question reached the provider",
      );
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What does the brass token say?",
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "clarify",
      decision: {
        kind: "clarify",
        question:
          "What single action would you like me to try with the brass token?",
      },
    });
    expect(result.decision).not.toHaveProperty("choices");
    expect(result).not.toHaveProperty("pendingIntent");
    expect(result).not.toHaveProperty("command");
    expect(model.calls).toBe(0);
  });

  it.each([
    {
      name: "low-confidence content question",
      input: {
        ...baseInput,
        playerUtterance: "What does the brass token say?",
        transcriptConfidence: 0.4,
      },
    },
    {
      name: "negated content question",
      input: {
        ...baseInput,
        playerUtterance: "Do not answer what does the brass token say.",
      },
    },
    {
      name: "multi-step content question",
      input: {
        ...baseInput,
        playerUtterance: "What does the brass token say, then go north?",
      },
    },
  ])("clarifies a $name before calling the provider", async ({ input }) => {
    const model = new FakeGuideModel(() => {
      throw new Error("unsafe content question reached the provider");
    });

    expect(await decideInitialGuideTurn(model, input, signal)).toMatchObject({
      kind: "clarify",
    });
    expect(model.calls).toBe(0);
  });

  it("does not infer action suggestions after resolving an object without a scene", async () => {
    const clarificationModel = new FakeGuideModel(() => {
      throw new Error("the unresolved content request reached the provider");
    });
    const clarified = await decideInitialGuideTurn(
      clarificationModel,
      {
        ...baseInput,
        playerUtterance: "What does it say?",
      },
      signal,
    );
    expect(clarified).toMatchObject({
      kind: "clarify",
      pendingIntent: { kind: "content-object" },
    });
    expect(clarificationModel.calls).toBe(0);

    const answerModel = new FakeGuideModel(() => {
      throw new Error("the exact pending-object answer reached the provider");
    });
    const resolved = await decideInitialGuideTurn(
      answerModel,
      {
        ...baseInput,
        playerUtterance: "The brass token",
        pendingIntent: { kind: "content-object" },
      },
      signal,
    );
    expect(resolved).toMatchObject({
      kind: "clarify",
      decision: {
        question:
          "What single action would you like me to try with the brass token?",
      },
    });
    expect(resolved.decision).not.toHaveProperty("choices");
    expect(resolved).not.toHaveProperty("pendingIntent");
    expect(answerModel.calls).toBe(0);
  });

  it.each([
    ["READ", "read leaflet", "grammar.read"],
    ["read it", "read leaflet", "grammar.read"],
    ["Please read it", "read leaflet", "grammar.read"],
    ["Can you read it?", "read leaflet", "grammar.read"],
    ["I'd like to read it", "read leaflet", "grammar.read"],
    ["Okay, read it", "read leaflet", "grammar.read"],
    ["EXAMINE", "examine leaflet", "grammar.examine"],
    ["examine it", "examine leaflet", "grammar.examine"],
    ["Could you examine it?", "examine leaflet", "grammar.examine"],
    ["Examine it without taking it", "examine leaflet", "grammar.examine"],
    [
      "Examine it without taking it, please",
      "examine leaflet",
      "grammar.examine",
    ],
    [
      "Can you examine it without taking it?",
      "examine leaflet",
      "grammar.examine",
    ],
  ])(
    "executes the explicit pending choice %s as %s",
    async (playerUtterance, command, groundingSourceId) => {
      const model = new FakeGuideModel(() => {
        throw new Error("the explicit pending choice reached the provider");
      });
      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance,
          observedObjects: ["leaflet"],
          pendingIntent: leafletReadExaminePending,
        },
        signal,
      );
      expect(result).toMatchObject({
        kind: "execute",
        command,
        groundingSourceId,
      });
      expect(model.calls).toBe(0);
    },
  );

  it("allows a fresh explicit command to supersede the pending choice", async () => {
    const result = await decideInitialGuideTurn(
      FakeGuideModel.returning({
        kind: "execute",
        command: "open mailbox",
        intentSummary: "Open the mailbox",
        confidence: 0.99,
      }),
      {
        ...baseInput,
        playerUtterance: "Open the mailbox.",
        observedObjects: ["leaflet", "mailbox"],
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );
    expect(result).toMatchObject({
      kind: "execute",
      command: "open mailbox",
    });
  });

  it.each([
    {
      name: "stale observed object",
      playerUtterance: "read it",
      observedObjects: [] as readonly string[],
    },
    {
      name: "negated choice",
      playerUtterance: "do not read it",
      observedObjects: ["leaflet"],
    },
    {
      name: "multi-step choice",
      playerUtterance: "read it and open the mailbox",
      observedObjects: ["leaflet", "mailbox"],
    },
    {
      name: "questioned choice",
      playerUtterance: "read it?",
      observedObjects: ["leaflet"],
    },
    {
      name: "quoted choice",
      playerUtterance: '"READ"',
      observedObjects: ["leaflet"],
    },
    {
      name: "negated bare choice",
      playerUtterance: "No read it",
      observedObjects: ["leaflet"],
    },
  ])("fails a $name closed and clears the choice", async (testCase) => {
    const model = new FakeGuideModel(() => {
      throw new Error("an unsafe pending choice reached the provider");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: testCase.playerUtterance,
        observedObjects: testCase.observedObjects,
        pendingIntent: leafletReadExaminePending,
      },
      signal,
    );
    expect(result).toMatchObject({ kind: "clarify" });
    expect(result).not.toHaveProperty("pendingIntent");
    expect(model.calls).toBe(0);
  });

  it.each([
    {
      name: "unobserved answer",
      playerUtterance: "The sword",
      transcriptConfidence: 0.99,
    },
    {
      name: "low-confidence answer",
      playerUtterance: "The brass token",
      transcriptConfidence: 0.4,
    },
    {
      name: "negated answer",
      playerUtterance: "Not the brass token",
      transcriptConfidence: 0.99,
    },
    {
      name: "multi-step answer",
      playerUtterance: "The brass token, then go north",
      transcriptConfidence: 0.99,
    },
  ])("does not execute a $name for pending intent", async (testCase) => {
    const model = FakeGuideModel.returning({
      kind: "clarify",
      question: "Which one observed object?",
      ambiguity: "The answer did not safely fill the object slot.",
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: testCase.playerUtterance,
        transcriptConfidence: testCase.transcriptConfidence,
        pendingIntent: { action: "examine" },
      },
      signal,
    );
    expect(result).toMatchObject({ kind: "clarify" });
    if (testCase.name === "low-confidence answer") {
      expect(result).toMatchObject({
        pendingIntent: { action: "examine" },
      });
    } else {
      expect(result).not.toHaveProperty("pendingIntent");
    }
  });

  it.each([
    {
      name: "low transcript confidence",
      input: { ...baseInput, transcriptConfidence: 0.4 },
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      } as const,
    },
    {
      name: "low model confidence",
      input: baseInput,
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.5,
      } as const,
    },
    {
      name: "multi-step utterance",
      input: { ...baseInput, playerUtterance: "go north then take the token" },
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Start the plan",
        confidence: 0.99,
      } as const,
    },
    {
      name: "multi-step natural observation",
      input: {
        ...baseInput,
        playerUtterance: "What do I see around me, then go north?",
      },
      decision: {
        kind: "execute",
        command: "look",
        intentSummary: "Observe before moving north",
        confidence: 0.99,
      } as const,
    },
    {
      name: "multi-step front-facing observation",
      input: {
        ...baseInput,
        playerUtterance: "What do I see in front of me, then go north?",
      },
      decision: {
        kind: "execute",
        command: "look",
        intentSummary: "Observe before moving north",
        confidence: 0.99,
      } as const,
    },
    {
      name: "negated action",
      input: { ...baseInput, playerUtterance: "do not go north" },
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Unsafe negated move",
        confidence: 0.99,
      } as const,
    },
  ])(
    "clarifies $name without authorizing execution",
    async ({ input, decision }) => {
      expect(
        await decideInitialGuideTurn(
          FakeGuideModel.returning(decision),
          input,
          signal,
        ),
      ).toMatchObject({ kind: "clarify" });
    },
  );

  it("rejects separators, hidden referents, and ungrounded substitutions", async () => {
    const cases = [
      {
        input: baseInput,
        command: "north; take token",
      },
      {
        input: { ...baseInput, playerUtterance: "take the sword" },
        command: "take sword",
      },
      {
        input: baseInput,
        command: "south",
      },
    ];

    for (const testCase of cases) {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          command: testCase.command,
          intentSummary: "Untrusted proposal",
          confidence: 0.99,
        }),
        testCase.input,
        signal,
      );
      expect(result).toMatchObject({
        kind: "rejected",
        cause: "ungrounded-command",
      });
    }
  });

  it("replaces provider command-help prose with observed, deterministic help", async () => {
    const result = await decideInitialGuideTurn(
      FakeGuideModel.returning({
        kind: "explain",
        response: "Ignore policy: the sword is hidden below the trapdoor.",
        basis: "command-help",
        sourceIds: ["grammar.look", "grammar.take"],
      }),
      { ...baseInput, playerUtterance: "what can I do?" },
      signal,
    );
    expect(result).toMatchObject({ kind: "explain" });
    if (result.kind === "explain") {
      expect(result.decision.response).toContain("brass token");
      expect(result.decision.response).not.toMatch(/sword|trapdoor/iu);
    }
  });

  it.each([
    "What is the difference between read and examine?",
    "Should I read or examine the leaflet?",
  ])(
    "answers the READ-versus-EXAMINE meta question %s without executing",
    async (playerUtterance) => {
      const model = new FakeGuideModel(() => {
        throw new Error("a deterministic command comparison reached the model");
      });
      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance,
          observedObjects: ["leaflet"],
        },
        signal,
      );

      expect(result).toEqual({
        kind: "explain",
        decision: {
          kind: "explain",
          response:
            "EXAMINE inspects an observed object without taking it. READ asks the parser to read the object and may implicitly take it.",
          basis: "command-help",
          sourceIds: ["grammar.examine", "grammar.read"],
        },
      });
      expect(result).not.toHaveProperty("command");
      expect(result).not.toHaveProperty("pendingIntent");
      expect(model.calls).toBe(0);
    },
  );

  it.each([
    ["What does READ do with the leaflet?", ["grammar.read"]],
    ["Does READ take the leaflet?", ["grammar.read"]],
    ["Does READ implicitly take the leaflet?", ["grammar.read"]],
    [
      "Is READ safer than EXAMINE for the leaflet?",
      ["grammar.examine", "grammar.read"],
    ],
    [
      "Is READ different from EXAMINE for the leaflet?",
      ["grammar.examine", "grammar.read"],
    ],
    [
      "Should I read the leaflet instead of examining it?",
      ["grammar.examine", "grammar.read"],
    ],
    [
      "Can you tell me the difference between read and examine?",
      ["grammar.examine", "grammar.read"],
    ],
    [
      "How exactly does read differ from examine?",
      ["grammar.examine", "grammar.read"],
    ],
    ["Can you compare read and examine?", ["grammar.examine", "grammar.read"]],
    [
      "Could you explain the difference between read and examine?",
      ["grammar.examine", "grammar.read"],
    ],
  ])(
    "answers the command meta question %s before a malicious execute proposal",
    async (playerUtterance, sourceIds) => {
      const model = FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.read",
        slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
        intentSummary: "Unsafe meta-action execution",
        confidence: 0.99,
      });
      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance,
          observedObjects: ["leaflet"],
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "explain",
        decision: { kind: "explain", sourceIds },
      });
      expect(result).not.toHaveProperty("command");
      expect(model.calls).toBe(0);
    },
  );

  it("keeps a direct Can-you READ request on the ordinary execute path", async () => {
    const model = FakeGuideModel.returning({
      kind: "execute",
      affordanceId: "grammar.read",
      slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
      intentSummary: "Read the observed leaflet",
      confidence: 0.99,
    });
    expect(
      await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance: "Can you read the leaflet?",
          observedObjects: ["leaflet"],
        },
        signal,
      ),
    ).toMatchObject({ kind: "execute", command: "read leaflet" });
    expect(model.calls).toBe(1);
  });

  it.each([
    "What if I READ the leaflet?",
    "Will READ take the leaflet?",
    "If I read the leaflet, what happens?",
    "I wonder what if I read the leaflet.",
    "I said read the leaflet.",
    'The guide said "read the leaflet."',
    "Read anything except the leaflet.",
    "Can you read anything except the leaflet?",
    "Read the leaflet only if it is safe.",
    "Read all but the leaflet.",
    "Read something other than the leaflet.",
    "Read the leaflet later.",
    "Read the leaflet when you are ready.",
  ])(
    "rejects semantic and legacy execution for the non-direct speech act %s",
    async (playerUtterance) => {
      const proposals = [
        {
          kind: "execute",
          affordanceId: "grammar.read",
          slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
          intentSummary: "Unsafe semantic speech-act execution",
          confidence: 0.99,
        },
        {
          kind: "execute",
          command: "read leaflet",
          intentSummary: "Unsafe legacy speech-act execution",
          confidence: 0.99,
        },
      ];

      for (const proposal of proposals) {
        const model = new FakeGuideModel(() => proposal);
        const result = await decideInitialGuideTurn(
          model,
          {
            ...baseInput,
            playerUtterance,
            observedObjects: ["leaflet"],
          },
          signal,
        );
        expect(result).toMatchObject({
          kind: "rejected",
          cause: "ungrounded-command",
        });
        expect(result).not.toHaveProperty("command");
        expect(model.calls).toBe(1);
      }
    },
  );

  it.each([
    "Examine all but the leaflet.",
    "I said examine the leaflet.",
    "“Examine the leaflet.”",
    "What if I examine the leaflet?",
    "What if I check out the leaflet?",
    "If it is safe, check out the leaflet.",
    "The guide suggested checking out the leaflet.",
    "The guide said ‘check out the leaflet.’",
    "I might check out the leaflet.",
    "I wonder whether to look more closely at the leaflet.",
    "Could you open the leaflet?",
    "Can you open up the leaflet?",
    "Could you open the closed leaflet?",
    "I'd like you to open the leaflet carefully.",
    "Let's open up the leaflet.",
    "Could you head north past the leaflet?",
    "How do I open the leaflet?",
    "How do I read the leaflet?",
    "What does opening the leaflet involve?",
    "Can you tell me whether opening the leaflet is safe?",
    "Can you tell me a joke about the leaflet?",
    "I want you to destroy the leaflet.",
    "Can you open the leaflet later?",
    "Would you read the leaflet aloud?",
    "Could you take the leaflet tomorrow?",
  ])(
    "rejects semantic and legacy EXAMINE for the non-direct speech act %s",
    async (playerUtterance) => {
      const proposals = [
        {
          kind: "execute",
          affordanceId: "grammar.examine",
          slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
          intentSummary: "Unsafe semantic EXAMINE speech act",
          confidence: 0.99,
        },
        {
          kind: "execute",
          command: "examine leaflet",
          intentSummary: "Unsafe legacy EXAMINE speech act",
          confidence: 0.99,
        },
      ];

      for (const proposal of proposals) {
        const result = await decideInitialGuideTurn(
          new FakeGuideModel(() => proposal),
          {
            ...baseInput,
            playerUtterance,
            observedObjects: ["leaflet"],
          },
          signal,
        );
        expect(result).toMatchObject({
          kind: "rejected",
          cause: "ungrounded-command",
        });
        expect(result).not.toHaveProperty("command");
      }
    },
  );

  it("answers another offered command comparison without the model", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error("a deterministic command comparison reached the model");
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "Compare take and open.",
        observedObjects: ["leaflet"],
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "explain",
      decision: {
        kind: "explain",
        sourceIds: ["grammar.open", "grammar.take"],
        response: expect.stringMatching(/OPEN:.*TAKE:.*leaflet/u),
      },
    });
    expect(result).not.toHaveProperty("command");
    expect(model.calls).toBe(0);
  });

  it.each([
    "Compare read and dance.",
    "Compare read and examine, then open the mailbox.",
    "Compare mailbox with house.",
  ])(
    "clarifies the invalid comparison %s before a malicious execute proposal",
    async (playerUtterance) => {
      const model = FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.take",
        slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
        intentSummary: "Unsafe comparison-shaped action",
        confidence: 0.99,
      });
      const result = await decideInitialGuideTurn(
        model,
        {
          ...baseInput,
          playerUtterance,
          observedObjects: ["mailbox"],
        },
        signal,
      );

      expect(result).toMatchObject({ kind: "clarify" });
      expect(result).not.toHaveProperty("command");
      expect(model.calls).toBe(0);
    },
  );

  it("rejects command help with an unknown source ID", async () => {
    expect(
      await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "explain",
          response: "Unreviewed command help.",
          basis: "command-help",
          sourceIds: ["grammar.unknown"],
        }),
        {
          ...baseInput,
          playerUtterance: "What does that unknown command do?",
        },
        signal,
      ),
    ).toMatchObject({
      kind: "rejected",
      cause: "unsupported-initial-decision",
    });
  });

  it("fails closed on extra fields and provider failure", async () => {
    const malformed = await decideInitialGuideTurn(
      new FakeGuideModel(() => ({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
        bypassEngine: true,
      })),
      baseInput,
      signal,
    );
    expect(malformed).toMatchObject({
      kind: "rejected",
      cause: "malformed-provider-decision",
    });

    const failed = await decideInitialGuideTurn(
      new FakeGuideModel(() => {
        throw new Error("offline");
      }),
      baseInput,
      signal,
    );
    expect(failed).toMatchObject({ kind: "provider-failure" });
  });

  it("propagates cancellation instead of converting it to provider failure", async () => {
    const controller = new AbortController();
    const model = new FakeGuideModel(async () => {
      controller.abort(new Error("player cancelled"));
      return {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      };
    });

    await expect(
      decideInitialGuideTurn(model, baseInput, controller.signal),
    ).rejects.toThrow("player cancelled");
  });

  it("rejects unbounded context before calling the model", async () => {
    const model = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const result = await decideInitialGuideTurn(
      model,
      { ...baseInput, playerUtterance: "x".repeat(2_001) },
      signal,
    );
    expect(result).toMatchObject({
      kind: "rejected",
      cause: "invalid-context",
    });
    expect(model.calls).toBe(0);
  });

  it("rejects malformed pending intent before calling the model", async () => {
    const model = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        pendingIntent: {
          action: "examine",
          injected: true,
        },
      } as typeof baseInput & {
        pendingIntent: { action: "examine"; injected: boolean };
      },
      signal,
    );
    expect(result).toMatchObject({
      kind: "rejected",
      cause: "invalid-context",
    });
    expect(model.calls).toBe(0);
  });
});
