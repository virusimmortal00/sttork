import { isEventEnvelopeV1 } from "@sttork/contracts";
import { describe, expect, it } from "vitest";

import { EventSequence } from "./event-sequence.js";

const canonicalTime = "2026-08-17T12:00:00.000Z";

function createSequence(
  options: Partial<ConstructorParameters<typeof EventSequence>[0]> = {},
): EventSequence {
  return new EventSequence({
    sessionId: "session-1",
    now: () => canonicalTime,
    nextId: () => "event-1",
    ...options,
  });
}

describe("EventSequence", () => {
  it("allocates one ordered sequence for every semantic event", () => {
    let id = 0;
    const events = createSequence({
      nextId: () => `event-${(id += 1)}`,
    });

    const started = events.append({
      type: "session.started",
      correlationId: "turn-1",
      visibility: "accessible",
      payload: {},
    });
    const transcript = events.append({
      type: "transcript.final",
      correlationId: "turn-1",
      causationId: started.id,
      visibility: "accessible",
      payload: { text: "look" },
    });

    expect([started.sequence, transcript.sequence]).toEqual([1, 2]);
    expect(transcript.causationId).toBe(started.id);
    expect(isEventEnvelopeV1(started)).toBe(true);
    expect(isEventEnvelopeV1(transcript)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid initial sequence %s",
    (firstSequence) => {
      expect(() => createSequence({ firstSequence })).toThrow(RangeError);
    },
  );

  it("rejects an empty session id at construction", () => {
    expect(() => createSequence({ sessionId: "" })).toThrow(TypeError);
  });

  it.each([
    ["type", { type: "", correlationId: "turn-1" }],
    ["correlation", { type: "session.started", correlationId: "" }],
    [
      "causation",
      {
        type: "session.started",
        correlationId: "turn-1",
        causationId: "",
      },
    ],
  ] as const)("rejects an empty %s id without allocating", (_name, fields) => {
    let allocatedIds = 0;
    const events = createSequence({
      nextId: () => `event-${(allocatedIds += 1)}`,
    });

    expect(() =>
      events.append({
        ...fields,
        visibility: "accessible",
        payload: {},
      }),
    ).toThrow(TypeError);
    expect(allocatedIds).toBe(0);
  });

  it("rejects an empty generated event id without advancing", () => {
    let attempts = 0;
    const events = createSequence({
      nextId: () => (attempts++ === 0 ? "" : "event-2"),
    });
    const draft = {
      type: "session.started",
      correlationId: "turn-1",
      visibility: "accessible",
      payload: {},
    } as const;

    expect(() => events.append(draft)).toThrow(TypeError);
    expect(events.append(draft).sequence).toBe(1);
  });

  it("rejects a noncanonical timestamp without advancing", () => {
    let attempts = 0;
    const events = createSequence({
      now: () => (attempts++ === 0 ? "2026-08-17T12:00:00Z" : canonicalTime),
    });
    const draft = {
      type: "session.started",
      correlationId: "turn-1",
      visibility: "accessible",
      payload: {},
    } as const;

    expect(() => events.append(draft)).toThrow(RangeError);
    expect(events.append(draft).sequence).toBe(1);
  });

  it("rejects visibility outside the envelope contract", () => {
    const events = createSequence();

    expect(() =>
      events.append({
        type: "session.started",
        correlationId: "turn-1",
        visibility: "provider-only" as never,
        payload: {},
      }),
    ).toThrow(TypeError);
  });

  it("allocates MAX_SAFE_INTEGER once and then reports exhaustion", () => {
    let allocatedIds = 0;
    const events = createSequence({
      firstSequence: Number.MAX_SAFE_INTEGER,
      nextId: () => `event-${(allocatedIds += 1)}`,
    });
    const draft = {
      type: "session.ended",
      correlationId: "turn-final",
      visibility: "accessible",
      payload: {},
    } as const;

    const finalEvent = events.append(draft);
    expect(finalEvent.sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(isEventEnvelopeV1(finalEvent)).toBe(true);
    expect(() => events.append(draft)).toThrow("event sequence is exhausted");
    expect(allocatedIds).toBe(1);
  });
});
