import { describe, expect, it } from "vitest";

import {
  isCanonicalEventTimestamp,
  isEventEnvelopeV1,
} from "./event-envelope.js";

const validEnvelope = {
  schemaVersion: 1,
  id: "event-1",
  sessionId: "session-1",
  sequence: 1,
  occurredAt: "2026-08-17T12:00:00.000Z",
  type: "session.started",
  correlationId: "turn-1",
  visibility: "accessible",
  payload: {},
} as const;

describe("EventEnvelope v1 contract", () => {
  it("accepts the architecture-owned envelope and final safe sequence", () => {
    expect(isEventEnvelopeV1(validEnvelope)).toBe(true);
    expect(
      isEventEnvelopeV1({
        ...validEnvelope,
        sequence: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
  });

  it.each([
    ["id", { id: "" }],
    ["sessionId", { sessionId: "" }],
    ["type", { type: "" }],
    ["correlationId", { correlationId: "" }],
    ["causationId", { causationId: "" }],
  ])("rejects an empty %s", (_field, change) => {
    expect(isEventEnvelopeV1({ ...validEnvelope, ...change })).toBe(false);
  });

  it.each([
    -1,
    0,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid sequence %s", (sequence) => {
    expect(isEventEnvelopeV1({ ...validEnvelope, sequence })).toBe(false);
  });

  it.each([
    "",
    "not-a-date",
    "2026-02-30T12:00:00.000Z",
    "2026-08-17T12:00:00Z",
    "2026-08-17T08:00:00.000-04:00",
  ])("rejects noncanonical timestamp %s", (occurredAt) => {
    expect(isCanonicalEventTimestamp(occurredAt)).toBe(false);
    expect(isEventEnvelopeV1({ ...validEnvelope, occurredAt })).toBe(false);
  });

  it("rejects vendor fields and invalid visibility", () => {
    expect(isEventEnvelopeV1({ ...validEnvelope, vendorRequest: {} })).toBe(
      false,
    );
    expect(
      isEventEnvelopeV1({ ...validEnvelope, visibility: "provider-only" }),
    ).toBe(false);
  });
});
