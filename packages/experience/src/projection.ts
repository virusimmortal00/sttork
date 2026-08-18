import type { SemanticEvent } from "../../contracts/src/index.js";

export type ExperienceDisplayState =
  | "booting"
  | "ready"
  | "listening"
  | "processing"
  | "guide-speaking"
  | "narrator-speaking"
  | "paused"
  | "reconnecting"
  | "blocked"
  | "ended";

export type TranscriptRole = "player" | "guide" | "game" | "system";
export type TranscriptDelivery =
  "pending" | "speaking" | "interrupted" | "complete" | "failed";

export interface TranscriptItemProjection {
  readonly id: string;
  readonly sourceEventIds: readonly string[];
  readonly throughSequence: number;
  readonly role: TranscriptRole;
  readonly text: string;
  readonly command?: string;
  readonly delivery: TranscriptDelivery;
}

export interface ExperienceProjectionState {
  readonly displayState: ExperienceDisplayState;
  readonly statusText: string;
  readonly throughSequence: number;
  readonly sourceEventIds: readonly string[];
  readonly transcript: readonly TranscriptItemProjection[];
  readonly debug: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly type: string;
    readonly correlationId: string;
  }[];
}

export function initialExperienceProjection(): ExperienceProjectionState {
  return {
    displayState: "booting",
    statusText: "Starting",
    throughSequence: 0,
    sourceEventIds: [],
    transcript: [],
    debug: [],
  };
}

function transcriptItem(
  event: SemanticEvent,
  role: TranscriptRole,
  text: string,
  command?: string,
): TranscriptItemProjection {
  return {
    id: event.id,
    sourceEventIds: [event.id],
    throughSequence: event.sequence,
    role,
    text,
    ...(command === undefined ? {} : { command }),
    delivery: "complete",
  };
}

function updateDelivery(
  items: readonly TranscriptItemProjection[],
  sourceEventId: string,
  delivery: TranscriptDelivery,
  event: SemanticEvent,
): readonly TranscriptItemProjection[] {
  return items.map((item) =>
    item.sourceEventIds.includes(sourceEventId)
      ? {
          ...item,
          sourceEventIds: [...item.sourceEventIds, event.id],
          throughSequence: event.sequence,
          delivery,
        }
      : item,
  );
}

export function reduceExperienceProjection(
  previous: ExperienceProjectionState,
  event: SemanticEvent,
): ExperienceProjectionState {
  if (event.sequence <= previous.throughSequence) {
    throw new RangeError(
      "Experience events must be reduced in sequence order.",
    );
  }
  let displayState = previous.displayState;
  let statusText = previous.statusText;
  let transcript = previous.transcript;

  switch (event.type) {
    case "audio.capture.started":
      displayState = "listening";
      statusText = "Listening";
      break;
    case "audio.capture.ended":
      displayState = "processing";
      statusText = "Processing";
      break;
    case "session.paused":
      displayState = "paused";
      statusText = "Paused";
      break;
    case "session.resumed":
      displayState = "ready";
      statusText = "Ready";
      break;
    case "transcript.final":
      transcript = [
        ...transcript,
        transcriptItem(event, "player", event.payload.text),
      ];
      break;
    case "guide.clarification":
      transcript = [
        ...transcript,
        transcriptItem(event, "guide", event.payload.question),
      ];
      break;
    case "guide.explanation":
      transcript = [
        ...transcript,
        transcriptItem(event, "guide", event.payload.response),
      ];
      break;
    case "guide.cannot_comply":
      transcript = [
        ...transcript,
        transcriptItem(event, "guide", event.payload.response),
      ];
      break;
    case "engine.command.requested":
      transcript = [
        ...transcript,
        transcriptItem(
          event,
          "system",
          event.payload.command,
          event.payload.command,
        ),
      ];
      break;
    case "engine.output":
      transcript = [
        ...transcript,
        transcriptItem(event, "game", event.payload.exactText),
      ];
      break;
    case "system.error":
      displayState = event.payload.recoverable ? "blocked" : "ended";
      statusText = event.payload.recoverable
        ? "Action needed"
        : "Session ended";
      transcript = [
        ...transcript,
        transcriptItem(event, "system", `Error: ${event.payload.code}`),
      ];
      break;
    case "narration.requested":
      transcript = updateDelivery(
        transcript,
        event.payload.sourceEventId,
        "pending",
        event,
      );
      break;
    case "audio.playback.started":
      displayState =
        event.payload.role === "guide" ? "guide-speaking" : "narrator-speaking";
      statusText =
        event.payload.role === "guide" ? "Guide speaking" : "Narrator speaking";
      transcript = updateDelivery(
        transcript,
        event.payload.sourceEventId,
        "speaking",
        event,
      );
      break;
    case "audio.playback.ended": {
      if (displayState !== "paused") {
        displayState = "ready";
        statusText = "Ready";
      }
      const narrationRequest = previous.debug.find(
        (entry) => entry.id === event.causationId,
      );
      const sourceEventId = narrationRequest?.id ?? event.causationId;
      if (sourceEventId !== undefined) {
        transcript = updateDelivery(
          transcript,
          sourceEventId,
          event.payload.outcome === "complete"
            ? "complete"
            : event.payload.outcome === "interrupted"
              ? "interrupted"
              : "failed",
          event,
        );
      }
      break;
    }
    default:
      break;
  }

  return {
    displayState,
    statusText,
    throughSequence: event.sequence,
    sourceEventIds: [...previous.sourceEventIds, event.id],
    transcript,
    debug: [
      ...previous.debug,
      {
        id: event.id,
        sequence: event.sequence,
        type: event.type,
        correlationId: event.correlationId,
      },
    ],
  };
}

export function projectExperience(
  events: readonly SemanticEvent[],
): ExperienceProjectionState {
  return events.reduce(
    reduceExperienceProjection,
    initialExperienceProjection(),
  );
}
