import {
  isCanonicalEventTimestamp,
  isEventEnvelopeV1,
} from "../../contracts/src/index.js";
import type {
  EventEnvelope,
  EventVisibility,
} from "../../contracts/src/index.js";

export interface EventSequenceOptions {
  readonly sessionId: string;
  readonly firstSequence?: number;
  readonly now: () => string;
  readonly nextId: () => string;
}

export interface EventDraft<TType extends string, TPayload> {
  readonly type: TType;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly visibility: EventVisibility;
  readonly payload: TPayload;
}

/** The coordinator-owned monotonic sequence allocator. */
export class EventSequence {
  readonly #sessionId: string;
  readonly #now: () => string;
  readonly #nextId: () => string;
  #nextSequence: number | undefined;

  public constructor(options: EventSequenceOptions) {
    const firstSequence = options.firstSequence ?? 1;
    if (
      typeof options.sessionId !== "string" ||
      options.sessionId.length === 0
    ) {
      throw new TypeError("sessionId must be a nonempty string");
    }
    if (!Number.isSafeInteger(firstSequence) || firstSequence < 1) {
      throw new RangeError("firstSequence must be a positive safe integer");
    }

    this.#sessionId = options.sessionId;
    this.#nextSequence = firstSequence;
    this.#now = options.now;
    this.#nextId = options.nextId;
  }

  public append<TType extends string, TPayload>(
    draft: EventDraft<TType, TPayload>,
  ): EventEnvelope<TType, TPayload> {
    const sequence = this.#nextSequence;
    if (sequence === undefined) {
      throw new RangeError("event sequence is exhausted");
    }
    if (typeof draft.type !== "string" || draft.type.length === 0) {
      throw new TypeError("event type must be a nonempty string");
    }
    if (
      typeof draft.correlationId !== "string" ||
      draft.correlationId.length === 0
    ) {
      throw new TypeError("correlationId must be a nonempty string");
    }
    if (
      draft.causationId !== undefined &&
      (typeof draft.causationId !== "string" || draft.causationId.length === 0)
    ) {
      throw new TypeError("causationId must be a nonempty string when present");
    }
    if (
      draft.visibility !== "internal" &&
      draft.visibility !== "debug" &&
      draft.visibility !== "accessible"
    ) {
      throw new TypeError("event visibility is invalid");
    }

    const id = this.#nextId();
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("event id must be a nonempty string");
    }
    const occurredAt = this.#now();
    if (!isCanonicalEventTimestamp(occurredAt)) {
      throw new RangeError(
        "occurredAt must be a canonical UTC ISO timestamp with millisecond precision",
      );
    }

    const common: EventEnvelope<TType, TPayload> = {
      schemaVersion: 1 as const,
      id,
      sessionId: this.#sessionId,
      sequence,
      occurredAt,
      type: draft.type,
      correlationId: draft.correlationId,
      visibility: draft.visibility,
      payload: draft.payload,
    };

    const event =
      draft.causationId === undefined
        ? common
        : { ...common, causationId: draft.causationId };
    if (!isEventEnvelopeV1(event)) {
      throw new TypeError(
        "constructed event failed EventEnvelope v1 validation",
      );
    }

    this.#nextSequence =
      sequence === Number.MAX_SAFE_INTEGER ? undefined : sequence + 1;
    return event;
  }
}
