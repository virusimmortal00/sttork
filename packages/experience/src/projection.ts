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

export type StoryStartPhase = "ready" | "starting" | "started";

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

export interface CommandCueProjection {
  readonly requestId: string;
  readonly correlationId: string;
  readonly command: string;
  readonly phase: "requested" | "committed";
  readonly outputEventId?: string;
  readonly narrationId?: string;
  readonly sourceEventIds: readonly string[];
  readonly throughSequence: number;
}

export const EXPERIENCE_ACTION_LOG_LIMIT = 8;

export interface ActionLogItemProjection {
  readonly requestId: string;
  readonly correlationId: string;
  readonly command: string;
  readonly phase: "committed";
  readonly sourceEventIds: readonly string[];
  readonly throughSequence: number;
}

export interface StoryStartSourceProjection {
  readonly outputEventId: string;
  readonly correlationId: string;
  readonly narration?: {
    readonly id: string;
    readonly requestEventId: string;
  };
}

export interface ExperienceProjectionState {
  readonly displayState: ExperienceDisplayState;
  readonly statusText: string;
  readonly storyStartPhase: StoryStartPhase;
  readonly storyStartSource?: StoryStartSourceProjection;
  readonly activeCommand?: CommandCueProjection;
  readonly actionLog: readonly ActionLogItemProjection[];
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
    storyStartPhase: "ready",
    actionLog: [],
    throughSequence: 0,
    sourceEventIds: [],
    transcript: [],
    debug: [],
  };
}

function matchesActiveStoryStartNarration(
  state: ExperienceProjectionState,
  event: SemanticEvent<"narration.cancelled" | "narration.failed">,
): boolean {
  const source = state.storyStartSource;
  return (
    state.storyStartPhase === "starting" &&
    source !== undefined &&
    event.payload.role === "narrator" &&
    event.correlationId === source.correlationId &&
    event.payload.narrationId === source.narration?.id &&
    event.causationId === source.narration?.requestEventId
  );
}

function matchesActiveStoryStartPlayback(
  state: ExperienceProjectionState,
  event: SemanticEvent<"audio.playback.ended">,
): boolean {
  const source = state.storyStartSource;
  return (
    state.storyStartPhase === "starting" &&
    source !== undefined &&
    event.payload.role === "narrator" &&
    event.correlationId === source.correlationId &&
    event.payload.narrationId === source.narration?.id &&
    event.causationId === source.outputEventId
  );
}

function matchesAction(
  item: ActionLogItemProjection,
  command: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly command: string;
  },
): boolean {
  return (
    item.requestId === command.requestId &&
    item.correlationId === command.correlationId &&
    item.command === command.command
  );
}

function addCommittedAction(
  actionLog: readonly ActionLogItemProjection[],
  action: ActionLogItemProjection,
): readonly ActionLogItemProjection[] {
  return [action, ...actionLog].slice(0, EXPERIENCE_ACTION_LOG_LIMIT);
}

function recoverableErrorStatus(code: string): string {
  switch (code) {
    case "playback-authorization-required":
      return "Tap Repeat to enable audio";
    case "budget-exhausted":
      return "Request limit reached";
    default:
      return "Action needed";
  }
}

function projectCommittedAction(
  actionLog: readonly ActionLogItemProjection[],
  command: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly command: string;
  },
  event: SemanticEvent,
): readonly ActionLogItemProjection[] {
  const index = actionLog.findIndex((item) => matchesAction(item, command));
  if (index === -1) {
    return addCommittedAction(actionLog, {
      ...command,
      phase: "committed",
      sourceEventIds: [event.id],
      throughSequence: event.sequence,
    });
  }
  return actionLog.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          sourceEventIds: [...item.sourceEventIds, event.id],
          throughSequence: event.sequence,
        }
      : item,
  );
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
  let storyStartPhase = previous.storyStartPhase;
  let storyStartSource = previous.storyStartSource;
  let activeCommand = previous.activeCommand;
  let actionLog = previous.actionLog;
  let transcript = previous.transcript;

  switch (event.type) {
    case "audio.capture.started":
      displayState = "listening";
      statusText = "Listening";
      activeCommand = undefined;
      break;
    case "audio.capture.ended":
      if (event.payload.outcome === "submitted") {
        displayState = "processing";
        statusText = "Processing";
      } else if (event.payload.outcome === "failed") {
        displayState = "blocked";
        statusText = "Action needed";
      } else {
        displayState = "ready";
        statusText =
          event.payload.outcome === "silence" ? "No speech detected" : "Ready";
      }
      break;
    case "session.paused":
      displayState = "paused";
      statusText = "Paused";
      activeCommand = undefined;
      break;
    case "session.resumed":
      displayState = "ready";
      statusText = "Ready";
      break;
    case "transcript.final":
      if (
        activeCommand !== undefined &&
        activeCommand.correlationId !== event.correlationId
      ) {
        activeCommand = undefined;
      }
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
      activeCommand = {
        requestId: event.payload.requestId,
        correlationId: event.correlationId,
        command: event.payload.command,
        phase: "requested",
        sourceEventIds: [event.id],
        throughSequence: event.sequence,
      };
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
    case "engine.command.committed":
      actionLog = projectCommittedAction(
        actionLog,
        {
          requestId: event.payload.requestId,
          correlationId: event.correlationId,
          command: event.payload.command,
        },
        event,
      );
      if (activeCommand === undefined) {
        activeCommand = {
          requestId: event.payload.requestId,
          correlationId: event.correlationId,
          command: event.payload.command,
          phase: "committed",
          sourceEventIds: [event.id],
          throughSequence: event.sequence,
        };
      } else if (
        activeCommand.requestId === event.payload.requestId &&
        activeCommand.correlationId === event.correlationId &&
        activeCommand.command === event.payload.command
      ) {
        activeCommand = {
          ...activeCommand,
          phase: "committed",
          sourceEventIds: [...activeCommand.sourceEventIds, event.id],
          throughSequence: event.sequence,
        };
      }
      break;
    case "engine.command.rejected":
      if (
        activeCommand?.requestId === event.payload.requestId &&
        activeCommand.correlationId === event.correlationId &&
        activeCommand.command === event.payload.command
      ) {
        activeCommand = undefined;
      }
      break;
    case "engine.output":
      if (event.payload.revision === 0 && storyStartPhase === "ready") {
        storyStartPhase = "starting";
        storyStartSource = {
          outputEventId: event.id,
          correlationId: event.correlationId,
        };
        displayState = "processing";
        statusText = "Preparing story";
      }
      if (
        activeCommand?.phase === "committed" &&
        activeCommand.correlationId === event.correlationId
      ) {
        activeCommand = { ...activeCommand, outputEventId: event.id };
      }
      transcript = [
        ...transcript,
        transcriptItem(event, "game", event.payload.exactText),
      ];
      break;
    case "system.error":
      if (
        activeCommand !== undefined &&
        (!event.payload.recoverable ||
          (activeCommand.correlationId === event.correlationId &&
            event.payload.engineCommitState !== "confirmed"))
      ) {
        activeCommand = undefined;
      }
      displayState = event.payload.recoverable ? "blocked" : "ended";
      statusText = event.payload.recoverable
        ? recoverableErrorStatus(event.payload.code)
        : "Session ended";
      transcript = [
        ...transcript,
        transcriptItem(event, "system", `Error: ${event.payload.code}`),
      ];
      break;
    case "narration.cancelled": {
      if (matchesActiveStoryStartNarration(previous, event)) {
        storyStartPhase = "started";
        displayState = "ready";
        statusText = "Ready";
        if (event.causationId !== undefined) {
          transcript = updateDelivery(
            transcript,
            event.causationId,
            "interrupted",
            event,
          );
        }
      }
      if (
        activeCommand?.correlationId === event.correlationId &&
        event.payload.role === "narrator" &&
        activeCommand.narrationId === event.payload.narrationId
      ) {
        activeCommand = undefined;
      }
      break;
    }
    case "narration.failed": {
      if (matchesActiveStoryStartNarration(previous, event)) {
        storyStartPhase = "started";
        displayState = "blocked";
        statusText = "Action needed";
        if (event.causationId !== undefined) {
          transcript = updateDelivery(
            transcript,
            event.causationId,
            "failed",
            event,
          );
        }
      }
      if (
        activeCommand?.correlationId === event.correlationId &&
        event.payload.role === "narrator" &&
        activeCommand.narrationId === event.payload.narrationId
      ) {
        activeCommand = undefined;
      }
      break;
    }
    case "narration.requested":
      if (
        storyStartPhase === "starting" &&
        storyStartSource !== undefined &&
        event.payload.role === "narrator" &&
        event.correlationId === storyStartSource.correlationId &&
        event.payload.sourceEventId === storyStartSource.outputEventId
      ) {
        storyStartSource = {
          ...storyStartSource,
          narration: {
            id: event.payload.narrationId,
            requestEventId: event.id,
          },
        };
      }
      if (
        activeCommand?.correlationId === event.correlationId &&
        event.payload.role === "narrator" &&
        activeCommand.outputEventId === event.payload.sourceEventId
      ) {
        activeCommand = {
          ...activeCommand,
          narrationId: event.payload.narrationId,
        };
      }
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
      const endsStoryStart = matchesActiveStoryStartPlayback(previous, event);
      if (endsStoryStart) storyStartPhase = "started";
      if (event.payload.outcome === "failed") {
        displayState = "blocked";
        statusText = "Action needed";
      } else if (endsStoryStart || displayState !== "paused") {
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
      if (
        activeCommand?.correlationId === event.correlationId &&
        event.payload.role === "narrator" &&
        activeCommand.outputEventId === event.causationId &&
        activeCommand.narrationId === event.payload.narrationId
      ) {
        activeCommand = undefined;
      }
      break;
    }
    default:
      break;
  }

  return {
    displayState,
    statusText,
    storyStartPhase,
    ...(storyStartSource === undefined ? {} : { storyStartSource }),
    ...(activeCommand === undefined ? {} : { activeCommand }),
    actionLog,
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
