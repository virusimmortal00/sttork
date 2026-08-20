import type { SemanticEvent } from "../../contracts/src/index.js";
import { describe, expect, it } from "vitest";

import { createPendingOpeningContextualObjectActionChoiceIntent } from "./opening-area.js";
import {
  createOpeningSceneProjection,
  OPENING_SCENE_BOOT_OUTPUT,
  OPENING_SCENE_PROFILE_ID,
  OPENING_SCENE_READ_MAILBOX_REFUSAL_OUTPUT,
  OPENING_SCENE_ROOM_OUTPUT,
  OPENING_SCENE_STORY_ID,
  OPENING_SCENE_STORY_SHA256,
  openingSceneCurrentObjectLabels,
  projectOpeningSceneFromEvent,
  resolveOpeningSceneObjectActionSuggestion,
  resolvePendingOpeningContextualObjectActionChoiceForScene,
  resolveOpeningSceneGuidance,
} from "./opening-scene.js";

function initial() {
  return createOpeningSceneProjection({
    id: OPENING_SCENE_STORY_ID,
    artifactSha256: OPENING_SCENE_STORY_SHA256,
  });
}

function output(
  id: string,
  sequence: number,
  revision: number,
  exactText: string,
  causationId?: string,
  correlationId = `interaction-${revision}`,
): SemanticEvent<"engine.output"> {
  return {
    schemaVersion: 1,
    id,
    sessionId: "session-1",
    sequence,
    occurredAt: "2026-08-20T12:00:00.000Z",
    type: "engine.output",
    correlationId,
    ...(causationId === undefined ? {} : { causationId }),
    visibility: "accessible",
    payload: {
      revision,
      exactText,
      boundary: "input-requested",
      retention: "local-save",
    },
  };
}

function committed(
  id: string,
  sequence: number,
  revision: number,
  command: string,
): SemanticEvent<"engine.command.committed"> {
  return {
    schemaVersion: 1,
    id,
    sessionId: "session-1",
    sequence,
    occurredAt: "2026-08-20T12:00:00.000Z",
    type: "engine.command.committed",
    correlationId: `interaction-${revision}`,
    visibility: "debug",
    payload: {
      requestId: `request-${revision}`,
      previousRevision: revision - 1,
      revision,
      command,
      boundary: "input-requested",
    },
  };
}

describe("opening scene projection", () => {
  it("projects the authenticated opening into frozen source-backed scene facts", () => {
    const scene = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );

    expect(scene.profileId).toBe(OPENING_SCENE_PROFILE_ID);
    expect(scene.sessionId).toBe("session-1");
    expect(scene.engineRevision).toBe(0);
    expect(scene.currentLocationId).toBe("opening.location.west-of-house");
    expect(openingSceneCurrentObjectLabels(scene)).toEqual([
      "door",
      "house",
      "mailbox",
    ]);
    expect(scene.currentRelationIds).toEqual([
      "opening.relation.door-boarded",
      "opening.relation.house-east-of-player",
      "opening.relation.mailbox-here",
      "opening.relation.player-west-of-house",
    ]);
    expect(
      scene.relations.find(
        (relation) => relation.id === "opening.relation.house-east-of-player",
      ),
    ).toMatchObject({
      confidence: "inferred",
      sourceEventIds: ["opening-output"],
    });
    expect(
      scene.contextualAffordances.slice(0, 3).map((item) => item.spokenExample),
    ).toEqual([
      "examining the mailbox",
      "opening the mailbox",
      "examining the boarded door",
    ]);
    expect(Object.isFrozen(scene)).toBe(true);
    expect(Object.isFrozen(scene.entities)).toBe(true);
    expect(scene.entities.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(scene.contextualAffordances)).toBe(true);
  });

  it("suggests EXAMINE and OPEN for the current closed mailbox with exact provenance", () => {
    const scene = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const suggestion = resolveOpeningSceneObjectActionSuggestion(
      scene,
      "observed-object:mailbox",
    );

    expect(suggestion).toEqual({
      selectedObject: {
        id: "observed-object:mailbox",
        label: "mailbox",
      },
      suggestedActions: ["examine", "open"],
      sourceIds: ["grammar.examine", "opening-output", "grammar.open"],
    });
    expect(suggestion?.suggestedActions).not.toContain("read");
    expect(Object.isFrozen(suggestion)).toBe(true);
    expect(Object.isFrozen(suggestion?.selectedObject)).toBe(true);
    expect(Object.isFrozen(suggestion?.suggestedActions)).toBe(true);
    expect(Object.isFrozen(suggestion?.sourceIds)).toBe(true);
    if (suggestion === undefined) throw new Error("Expected mailbox options.");

    const matchingFocus =
      createPendingOpeningContextualObjectActionChoiceIntent(
        suggestion.selectedObject,
        suggestion.suggestedActions,
      );
    expect(
      resolvePendingOpeningContextualObjectActionChoiceForScene(
        scene,
        matchingFocus,
      ),
    ).toEqual(suggestion);
    expect(
      resolvePendingOpeningContextualObjectActionChoiceForScene(
        scene,
        createPendingOpeningContextualObjectActionChoiceIntent(
          suggestion.selectedObject,
          ["examine", "read"],
        ),
      ),
    ).toBeUndefined();

    const moving = projectOpeningSceneFromEvent(
      scene,
      committed("north-commit", 2, 1, "north"),
    );
    const moved = projectOpeningSceneFromEvent(
      moving,
      output(
        "north-output",
        3,
        1,
        "North of House\nUnknown scene.\n\n>",
        "north-commit",
      ),
    );
    expect(
      resolvePendingOpeningContextualObjectActionChoiceForScene(
        moved,
        matchingFocus,
      ),
    ).toBeUndefined();
  });

  it("fails closed for another story and for inexact or quoted opening prose", () => {
    const otherStory = createOpeningSceneProjection({
      id: "another-story",
      artifactSha256: OPENING_SCENE_STORY_SHA256,
    });
    expect(
      projectOpeningSceneFromEvent(
        otherStory,
        output("other-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
      ).entities,
    ).toEqual([]);
    expect(otherStory.contextualAffordances).toEqual([]);

    for (const exactText of [
      OPENING_SCENE_BOOT_OUTPUT.toLocaleLowerCase("en-US"),
      `${OPENING_SCENE_BOOT_OUTPUT}\nA quoted recollection follows.`,
      `A voice says:\n${OPENING_SCENE_BOOT_OUTPUT}`,
      "West of House\nThere is a small mailbox here.\n\n>",
    ]) {
      const scene = projectOpeningSceneFromEvent(
        initial(),
        output("inexact-output", 1, 0, exactText),
      );
      expect(scene.currentEntityIds).toEqual([]);
      expect(scene.currentLocationId).toBeNull();
    }
  });

  it("ignores non-engine prose even when it contains the exact opening", () => {
    const transcript: SemanticEvent<"transcript.final"> = {
      schemaVersion: 1,
      id: "quoted-transcript",
      sessionId: "session-1",
      sequence: 1,
      occurredAt: "2026-08-20T12:00:00.000Z",
      type: "transcript.final",
      correlationId: "interaction-1",
      visibility: "accessible",
      payload: {
        text: OPENING_SCENE_BOOT_OUTPUT,
        retention: "local-save",
      },
    };

    const scene = projectOpeningSceneFromEvent(initial(), transcript);
    expect(scene.currentEntityIds).toEqual([]);
    expect(scene.currentLocationId).toBeNull();
    expect(scene.throughEventId).toBe("quoted-transcript");
  });

  it("does not merge events from another session into the projection", () => {
    const opening = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const otherSessionEvent = {
      ...committed("other-session-commit", 2, 1, "north"),
      sessionId: "another-session",
    } satisfies SemanticEvent<"engine.command.committed">;

    expect(projectOpeningSceneFromEvent(opening, otherSessionEvent)).toBe(
      opening,
    );
  });

  it("treats a command commit as pending evidence and clears current facts only on movement output", () => {
    const opening = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const committedNorth = projectOpeningSceneFromEvent(
      opening,
      committed("north-commit", 2, 1, "north"),
    );

    expect(committedNorth.currentLocationId).toBe(
      "opening.location.west-of-house",
    );
    expect(committedNorth.pendingCommand).toEqual({
      command: "north",
      revision: 1,
      sourceEventId: "north-commit",
      correlationId: "interaction-1",
    });

    const moved = projectOpeningSceneFromEvent(
      committedNorth,
      output(
        "north-output",
        3,
        1,
        "North of House\nYou are facing the north side of a white house.\n\n>",
        "north-commit",
      ),
    );
    expect(moved.currentEntityIds).toEqual([]);
    expect(moved.currentRelationIds).toEqual([]);
    expect(moved.currentLocationId).toBeNull();
    expect(moved.entities.map((entity) => entity.label)).toEqual([
      "door",
      "house",
      "mailbox",
    ]);
    expect(moved.pendingCommand).toBeNull();

    const staleOpening = projectOpeningSceneFromEvent(
      moved,
      output("stale-opening", 4, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    expect(staleOpening.currentEntityIds).toEqual([]);
    expect(staleOpening.currentLocationId).toBeNull();
  });

  it("does not record a pending command across an engine revision gap", () => {
    const opening = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const gap = {
      ...committed("gap-commit", 2, 2, "north"),
      payload: {
        ...committed("gap-commit", 2, 2, "north").payload,
        previousRevision: 0,
      },
    } satisfies SemanticEvent<"engine.command.committed">;

    const projected = projectOpeningSceneFromEvent(opening, gap);
    expect(projected.pendingCommand).toBeNull();
    expect(projected.currentLocationId).toBe("opening.location.west-of-house");
  });

  it("clears current facts for a newer output whose committed command is missing", () => {
    const opening = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const missingCommit = projectOpeningSceneFromEvent(
      opening,
      output("unpaired-output", 2, 1, "An unknown result.\n\n>"),
    );

    expect(missingCommit.currentEntityIds).toEqual([]);
    expect(missingCommit.currentRelationIds).toEqual([]);
    expect(missingCommit.currentLocationId).toBeNull();
    expect(missingCommit.entities.map((entity) => entity.label)).toEqual([
      "door",
      "house",
      "mailbox",
    ]);
  });

  it("reconfirms a reviewed scene after movement without duplicating history", () => {
    const events = [
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
      committed("north-commit", 2, 1, "north"),
      output(
        "north-output",
        3,
        1,
        "North of House\nUnknown scene.\n\n>",
        "north-commit",
      ),
      committed("south-commit", 4, 2, "south"),
      output("return-output", 5, 2, OPENING_SCENE_ROOM_OUTPUT, "south-commit"),
    ] as const;
    const scene = events.reduce(projectOpeningSceneFromEvent, initial());

    expect(scene.currentLocationId).toBe("opening.location.west-of-house");
    expect(openingSceneCurrentObjectLabels(scene)).toEqual([
      "door",
      "house",
      "mailbox",
    ]);
    expect(scene.locations).toHaveLength(1);
    expect(scene.locations[0]?.sourceEventIds).toEqual([
      "opening-output",
      "return-output",
    ]);
    expect(events.reduce(projectOpeningSceneFromEvent, initial())).toEqual(
      scene,
    );
    expect(projectOpeningSceneFromEvent(scene, events[4])).toBe(scene);
  });

  it("learns the leaflet and open state only from the matching exact engine result", () => {
    const opening = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const pending = projectOpeningSceneFromEvent(
      opening,
      committed("open-commit", 2, 1, "open mailbox"),
    );
    expect(pending.entities.some((entity) => entity.label === "leaflet")).toBe(
      false,
    );

    const opened = projectOpeningSceneFromEvent(
      pending,
      output(
        "open-output",
        3,
        1,
        "Opening the small mailbox reveals a leaflet.\n\n>",
        "open-commit",
      ),
    );
    expect(openingSceneCurrentObjectLabels(opened)).toEqual([
      "door",
      "house",
      "leaflet",
      "mailbox",
    ]);
    expect(opened.currentRelationIds).toContain(
      "opening.relation.mailbox-open",
    );
    expect(
      opened.contextualAffordances.some(
        (affordance) => affordance.ruleId === "grammar.open",
      ),
    ).toBe(false);
    expect(
      resolveOpeningSceneObjectActionSuggestion(
        opened,
        "observed-object:leaflet",
      ),
    ).toEqual({
      selectedObject: {
        id: "observed-object:leaflet",
        label: "leaflet",
      },
      suggestedActions: ["examine", "read"],
      sourceIds: ["grammar.examine", "open-output", "grammar.read"],
    });
    expect(
      resolveOpeningSceneObjectActionSuggestion(
        opened,
        "observed-object:mailbox",
      ),
    ).toBeUndefined();
    expect(opened.locations[0]?.sourceEventIds).toEqual(["opening-output"]);
  });

  it("reprojects the mailbox from its exact correlated READ refusal", () => {
    const opening = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const pending = projectOpeningSceneFromEvent(
      opening,
      committed("read-commit", 2, 1, "read mailbox"),
    );
    const refused = projectOpeningSceneFromEvent(
      pending,
      output(
        "read-output",
        3,
        1,
        OPENING_SCENE_READ_MAILBOX_REFUSAL_OUTPUT,
        "read-commit",
      ),
    );

    expect(openingSceneCurrentObjectLabels(refused)).toEqual([
      "door",
      "house",
      "mailbox",
    ]);
    expect(
      refused.entities.find((entity) => entity.label === "mailbox"),
    ).toMatchObject({
      sourceEventIds: ["opening-output", "read-output"],
      lastSeenRevision: 1,
    });
    expect(
      refused.relations.find(
        (relation) => relation.id === "opening.relation.mailbox-here",
      ),
    ).toMatchObject({
      sourceEventIds: ["opening-output", "read-output"],
      lastSeenRevision: 1,
    });
    expect(
      resolveOpeningSceneObjectActionSuggestion(
        refused,
        "observed-object:mailbox",
      ),
    ).toEqual({
      selectedObject: {
        id: "observed-object:mailbox",
        label: "mailbox",
      },
      suggestedActions: ["examine", "open"],
      sourceIds: [
        "grammar.examine",
        "opening-output",
        "read-output",
        "grammar.open",
      ],
    });

    const inexactPending = projectOpeningSceneFromEvent(
      opening,
      committed("inexact-read-commit", 2, 1, "read mailbox"),
    );
    const inexact = projectOpeningSceneFromEvent(
      inexactPending,
      output(
        "inexact-read-output",
        3,
        1,
        "How does one read the small mailbox?\n\n>",
        "inexact-read-commit",
      ),
    );
    expect(openingSceneCurrentObjectLabels(inexact)).toEqual(["door", "house"]);
    expect(
      resolveOpeningSceneObjectActionSuggestion(
        inexact,
        "observed-object:mailbox",
      ),
    ).toBeUndefined();
  });

  it("does not attribute an exact result from another correlation to a pending command", () => {
    const opening = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const pending = projectOpeningSceneFromEvent(
      opening,
      committed("open-commit", 2, 1, "open mailbox"),
    );
    const crossed = projectOpeningSceneFromEvent(
      pending,
      output(
        "crossed-output",
        3,
        1,
        "Opening the small mailbox reveals a leaflet.\n\n>",
        "open-commit",
        "another-interaction",
      ),
    );

    expect(crossed.entities.some((entity) => entity.label === "leaflet")).toBe(
      false,
    );
    expect(crossed.currentEntityIds).toEqual([]);
    expect(crossed.currentRelationIds).toEqual([]);
  });

  it("renders bounded contextual help and source-backed spatial recall without commands", () => {
    const scene = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );

    expect(resolveOpeningSceneGuidance("Walk to the mailbox.", scene)).toEqual({
      response:
        "The mailbox is already here. You can try examining it or opening it.",
      basis: "observed-memory",
      sourceIds: ["opening-output", "grammar.examine", "grammar.open"],
    });
    expect(
      resolveOpeningSceneGuidance("What actions are available?", scene),
    ).toEqual({
      response:
        "You can try examining the mailbox, opening the mailbox, or examining the boarded door. The game will decide what works.",
      basis: "command-help",
      sourceIds: ["grammar.examine", "opening-output", "grammar.open"],
    });
    expect(
      resolveOpeningSceneGuidance("What are the action options?", scene),
    ).toEqual({
      response:
        "You can try examining the mailbox, opening the mailbox, or examining the boarded door. The game will decide what works.",
      basis: "command-help",
      sourceIds: ["grammar.examine", "opening-output", "grammar.open"],
    });
    expect(
      resolveOpeningSceneGuidance(
        "In which direction was the house again?",
        scene,
      ),
    ).toEqual({
      response:
        "The game said you were west of the house, so the house is east of you.",
      basis: "observed-memory",
      sourceIds: ["opening-output"],
    });
  });

  it("rejects a structurally forged contextual suggestion", () => {
    const scene = projectOpeningSceneFromEvent(
      initial(),
      output("opening-output", 1, 0, OPENING_SCENE_BOOT_OUTPUT),
    );
    const forged = {
      ...scene,
      contextualAffordances: scene.contextualAffordances.map(
        (affordance, index) =>
          index === 0
            ? { ...affordance, spokenExample: "opening a hidden trapdoor" }
            : affordance,
      ),
    };

    expect(
      resolveOpeningSceneGuidance(
        "What actions are available?",
        forged as typeof scene,
      ),
    ).toBeUndefined();
    expect(
      resolveOpeningSceneObjectActionSuggestion(
        forged as typeof scene,
        "observed-object:mailbox",
      ),
    ).toBeUndefined();

    const missingPremise = {
      ...scene,
      relations: scene.relations.filter(
        (relation) => relation.id !== "opening.relation.player-west-of-house",
      ),
      currentRelationIds: scene.currentRelationIds.filter(
        (id) => id !== "opening.relation.player-west-of-house",
      ),
    };
    expect(
      resolveOpeningSceneGuidance(
        "In which direction was the house again?",
        missingPremise as typeof scene,
      ),
    ).toBeUndefined();
  });
});
