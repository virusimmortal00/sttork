export type EventVisibility = "internal" | "debug" | "accessible";

export interface EventEnvelope<TType extends string, TPayload> {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: TType;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly visibility: EventVisibility;
  readonly payload: TPayload;
}

const EVENT_KEYS = new Set([
  "schemaVersion",
  "id",
  "sessionId",
  "sequence",
  "occurredAt",
  "type",
  "correlationId",
  "causationId",
  "visibility",
  "payload",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Canonical UTC timestamp form emitted by Date.prototype.toISOString(). */
export function isCanonicalEventTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export function isEventEnvelopeV1(
  value: unknown,
): value is EventEnvelope<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  if (Object.keys(value).some((key) => !EVENT_KEYS.has(key))) {
    return false;
  }

  return (
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= 1 &&
    isCanonicalEventTimestamp(value.occurredAt) &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    typeof value.correlationId === "string" &&
    value.correlationId.length > 0 &&
    (value.causationId === undefined ||
      (typeof value.causationId === "string" &&
        value.causationId.length > 0)) &&
    (value.visibility === "internal" ||
      value.visibility === "debug" ||
      value.visibility === "accessible") &&
    Object.hasOwn(value, "payload")
  );
}
