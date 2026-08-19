import type { SemanticEvent } from "../../contracts/src/index.js";
import { describe, expect, it } from "vitest";

import { createOpeningCommandKnowledge } from "./opening-area.js";
import {
  createOpeningObjectProjection,
  MAX_OPENING_ENGINE_OUTPUT_LENGTH,
  projectOpeningObjectsFromEngineOutput,
  projectOpeningObjectsFromEvent,
} from "./opening-observed-objects.js";

const bootOutput =
  "ZORK I: The Great Underground Empire\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.\n\n>";

function engineOutput(
  exactText: string,
  revision = 1,
): SemanticEvent<"engine.output"> {
  return {
    schemaVersion: 1,
    id: "event-1",
    sessionId: "session-1",
    sequence: 1,
    occurredAt: "2026-08-19T12:00:00.000Z",
    type: "engine.output",
    correlationId: "interaction-1",
    visibility: "accessible",
    payload: {
      revision,
      exactText,
      boundary: "input-requested",
      retention: "local-save",
    },
  };
}

function committedCommand(
  command: string,
  revision: number,
): SemanticEvent<"engine.command.committed"> {
  return {
    schemaVersion: 1,
    id: `committed-${revision}`,
    sessionId: "session-1",
    sequence: revision * 2,
    occurredAt: "2026-08-19T12:00:00.000Z",
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

describe("opening observed-object projection", () => {
  it("seeds only reviewed nouns disclosed by exact boot-output lines", () => {
    const projected = projectOpeningObjectsFromEngineOutput(
      createOpeningObjectProjection(),
      bootOutput,
    );

    expect(projected).toEqual({
      version: 2,
      observedObjects: ["house", "door", "mailbox"],
      currentObjects: ["house", "door", "mailbox"],
      pendingMovementRevision: null,
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.observedObjects)).toBe(true);
    expect(Object.isFrozen(projected.currentObjects)).toBe(true);
  });

  it("adds the leaflet from its reviewed engine-output disclosure", () => {
    const boot = projectOpeningObjectsFromEngineOutput(
      createOpeningObjectProjection(),
      bootOutput,
    );
    const opened = projectOpeningObjectsFromEvent(
      boot,
      engineOutput("Opening the small mailbox reveals a leaflet.\n\n>"),
    );

    expect(opened.observedObjects).toEqual([
      "house",
      "door",
      "mailbox",
      "leaflet",
    ]);
    expect(opened.currentObjects).toEqual([
      "house",
      "door",
      "mailbox",
      "leaflet",
    ]);
    expect(
      projectOpeningObjectsFromEvent(
        opened,
        engineOutput("Opening the small mailbox reveals a leaflet.\n\n>"),
      ),
    ).toBe(opened);
  });

  it("separates historical observations from current objects across movement and replay", () => {
    const boot = projectOpeningObjectsFromEngineOutput(
      createOpeningObjectProjection(),
      bootOutput,
    );
    const movingAway = projectOpeningObjectsFromEvent(
      boot,
      committedCommand("north", 1),
    );

    expect(movingAway.currentObjects).toEqual(["house", "door", "mailbox"]);
    expect(movingAway.pendingMovementRevision).toBe(1);

    const away = projectOpeningObjectsFromEvent(
      movingAway,
      engineOutput(
        "North of House\nYou are facing the north side of a white house.\n\n>",
        1,
      ),
    );
    expect(away).toEqual({
      version: 2,
      observedObjects: ["house", "door", "mailbox"],
      currentObjects: [],
      pendingMovementRevision: null,
    });

    const currentKnowledge = createOpeningCommandKnowledge({
      observedObjects: away.currentObjects,
    });
    expect(currentKnowledge.observedObjectOptions).toEqual([]);
    expect(
      currentKnowledge.rules.find((rule) => rule.id === "grammar.examine")
        ?.slots[0]?.allowedValueIds,
    ).toEqual([]);

    const looked = projectOpeningObjectsFromEvent(
      projectOpeningObjectsFromEvent(away, committedCommand("look", 2)),
      engineOutput(bootOutput, 2),
    );
    expect(looked.observedObjects).toEqual(["house", "door", "mailbox"]);
    expect(looked.currentObjects).toEqual(["house", "door", "mailbox"]);

    const returned = projectOpeningObjectsFromEvent(
      projectOpeningObjectsFromEvent(away, committedCommand("south", 2)),
      engineOutput(bootOutput, 2),
    );
    expect(returned).toEqual(looked);
    expect(Object.isFrozen(returned)).toBe(true);
    expect(Object.isFrozen(returned.observedObjects)).toBe(true);
    expect(Object.isFrozen(returned.currentObjects)).toBe(true);

    const replay = [
      committedCommand("north", 1),
      engineOutput(
        "North of House\nYou are facing the north side of a white house.\n\n>",
        1,
      ),
      committedCommand("south", 2),
      engineOutput(bootOutput, 2),
    ].reduce(projectOpeningObjectsFromEvent, boot);
    expect(replay).toEqual(returned);
  });

  it("clears current objects on movement output even when the output is too large to scan", () => {
    const boot = projectOpeningObjectsFromEngineOutput(
      createOpeningObjectProjection(),
      bootOutput,
    );
    const moving = projectOpeningObjectsFromEvent(
      boot,
      committedCommand("east", 1),
    );
    const moved = projectOpeningObjectsFromEvent(
      moving,
      engineOutput("x".repeat(MAX_OPENING_ENGINE_OUTPUT_LENGTH + 1), 1),
    );

    expect(moved.observedObjects).toEqual(["house", "door", "mailbox"]);
    expect(moved.currentObjects).toEqual([]);
    expect(moved.pendingMovementRevision).toBeNull();
  });

  it("does not infer objects from unreviewed or inexact prose", () => {
    const initial = createOpeningObjectProjection();

    for (const output of [
      "You imagine a house, door, mailbox, and leaflet.\n\n>",
      "A voice says: Opening the small mailbox reveals a leaflet.\n\n>",
      "opening the small mailbox reveals a leaflet.\n\n>",
    ]) {
      expect(projectOpeningObjectsFromEngineOutput(initial, output)).toBe(
        initial,
      );
    }
  });

  it("ignores non-engine events and oversized output without scanning it", () => {
    const initial = createOpeningObjectProjection();
    const transcript: SemanticEvent<"transcript.final"> = {
      schemaVersion: 1,
      id: "event-2",
      sessionId: "session-1",
      sequence: 2,
      occurredAt: "2026-08-19T12:00:01.000Z",
      type: "transcript.final",
      correlationId: "interaction-1",
      visibility: "accessible",
      payload: {
        text: "Opening the small mailbox reveals a leaflet.",
        confidence: 1,
        retention: "local-save",
      },
    };

    expect(projectOpeningObjectsFromEvent(initial, transcript)).toBe(initial);
    expect(
      projectOpeningObjectsFromEngineOutput(
        initial,
        `${"x".repeat(MAX_OPENING_ENGINE_OUTPUT_LENGTH)}\nOpening the small mailbox reveals a leaflet.`,
      ),
    ).toBe(initial);
  });
});
