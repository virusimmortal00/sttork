import type { SemanticEvent } from "@zork-voice/contracts";
import { EventSequence } from "@zork-voice/events";
import { describe, expect, it } from "vitest";

import {
  initialExperienceProjection,
  projectExperience,
  reduceExperienceProjection,
} from "./projection.js";

function fixtureEvents(): readonly SemanticEvent[] {
  let id = 0;
  const sequence = new EventSequence({
    sessionId: "session",
    now: () => "2026-08-18T20:00:00.000Z",
    nextId: () => `event-${++id}`,
  });
  return [
    sequence.append({
      type: "audio.capture.started",
      correlationId: "turn",
      visibility: "accessible",
      payload: { captureId: "capture", mode: "push-to-talk" },
    }),
    sequence.append({
      type: "audio.capture.ended",
      correlationId: "turn",
      visibility: "accessible",
      payload: { captureId: "capture", durationMs: 500, outcome: "submitted" },
    }),
    sequence.append({
      type: "transcript.final",
      correlationId: "turn",
      visibility: "accessible",
      payload: { text: "go north", confidence: 0.99, retention: "local-save" },
    }),
    sequence.append({
      type: "engine.command.requested",
      correlationId: "turn",
      visibility: "debug",
      payload: { requestId: "request", expectedRevision: 0, command: "north" },
    }),
    sequence.append({
      type: "engine.output",
      correlationId: "turn",
      visibility: "accessible",
      payload: {
        revision: 1,
        exactText: "North Room\n\n> ",
        boundary: "input-requested",
        retention: "local-save",
      },
    }),
    sequence.append({
      type: "narration.requested",
      correlationId: "turn",
      causationId: "event-5",
      visibility: "debug",
      payload: {
        narrationId: "narration",
        role: "narrator",
        text: "North Room\n\n> ",
        sourceEventId: "event-5",
        retention: "session-only",
      },
    }),
    sequence.append({
      type: "audio.playback.started",
      correlationId: "turn",
      causationId: "event-5",
      visibility: "accessible",
      payload: {
        narrationId: "narration",
        role: "narrator",
        sourceEventId: "event-5",
      },
    }),
    sequence.append({
      type: "audio.playback.ended",
      correlationId: "turn",
      causationId: "event-5",
      visibility: "accessible",
      payload: {
        narrationId: "narration",
        role: "narrator",
        outcome: "complete",
      },
    }),
  ] as readonly SemanticEvent[];
}

describe("experience projection", () => {
  it("replays exact attributed transcript and audio delivery state", () => {
    const events = fixtureEvents();
    const projection = projectExperience(events);
    expect(projection.displayState).toBe("ready");
    expect(projection.statusText).toBe("Ready");
    expect(projection.throughSequence).toBe(8);
    expect(
      projection.transcript.map(({ role, text, command, delivery }) => ({
        role,
        text,
        command,
        delivery,
      })),
    ).toEqual([
      {
        role: "player",
        text: "go north",
        command: undefined,
        delivery: "complete",
      },
      { role: "system", text: "north", command: "north", delivery: "complete" },
      {
        role: "game",
        text: "North Room\n\n> ",
        command: undefined,
        delivery: "complete",
      },
    ]);
    expect(projectExperience(events)).toEqual(projection);
    expect(projection.debug).toHaveLength(events.length);
  });

  it("rejects replay out of sequence", () => {
    const [first] = fixtureEvents();
    if (first === undefined) throw new Error("missing fixture event");
    const once = reduceExperienceProjection(
      initialExperienceProjection(),
      first,
    );
    expect(() => reduceExperienceProjection(once, first)).toThrow(
      "must be reduced in sequence order",
    );
  });

  it("returns to ready when an active capture is cancelled", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "cancelled-capture",
      now: () => "2026-08-19T06:42:00.000Z",
      nextId: () => `cancelled-event-${++id}`,
    });
    const projection = projectExperience([
      sequence.append({
        type: "audio.capture.started",
        correlationId: "cancelled-turn",
        visibility: "accessible",
        payload: { captureId: "capture", mode: "push-to-talk" as const },
      }),
      sequence.append({
        type: "audio.capture.ended",
        correlationId: "cancelled-turn",
        visibility: "accessible",
        payload: {
          captureId: "capture",
          durationMs: 0,
          outcome: "cancelled" as const,
        },
      }),
    ]);

    expect(projection.displayState).toBe("ready");
    expect(projection.statusText).toBe("Ready");
  });
});
