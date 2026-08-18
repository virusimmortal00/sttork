import { canonicalizeCommand, isEventEnvelopeV1 } from "@zork-voice/contracts";
import { EventSequence } from "@zork-voice/events";
import { FakeClock } from "@zork-voice/test-support";
import { describe, expect, it } from "vitest";

describe("foundation contract integration", () => {
  it("records a validated single command as a canonical attributed event", () => {
    const clock = new FakeClock("2026-08-17T12:00:00.000Z");
    const sequence = new EventSequence({
      sessionId: "session-1",
      now: clock.now,
      nextId: () => "event-1",
    });
    const command = canonicalizeCommand("  open   mailbox ");

    const event = sequence.append({
      type: "engine.command.requested",
      correlationId: "turn-1",
      visibility: "debug",
      payload: { requestId: "request-1", expectedRevision: 0, command },
    });

    expect(isEventEnvelopeV1(event)).toBe(true);
    expect(event.payload.command).toBe("open mailbox");
  });
});
