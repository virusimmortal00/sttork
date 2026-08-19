import type { SemanticEvent } from "../../contracts/src/index.js";
import { describe, expect, it } from "vitest";

import {
  createOpeningObjectProjection,
  MAX_OPENING_ENGINE_OUTPUT_LENGTH,
  projectOpeningObjectsFromEngineOutput,
  projectOpeningObjectsFromEvent,
} from "./opening-observed-objects.js";

const bootOutput =
  "ZORK I: The Great Underground Empire\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.\n\n>";

function engineOutput(exactText: string): SemanticEvent<"engine.output"> {
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
      revision: 1,
      exactText,
      boundary: "input-requested",
      retention: "local-save",
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
      version: 1,
      observedObjects: ["house", "door", "mailbox"],
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.observedObjects)).toBe(true);
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
    expect(
      projectOpeningObjectsFromEvent(
        opened,
        engineOutput("Opening the small mailbox reveals a leaflet.\n\n>"),
      ),
    ).toBe(opened);
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
