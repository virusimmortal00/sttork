import type { EngineTurnBoundary } from "./engine.js";
import type { EventEnvelope } from "./event-envelope.js";
import type { GuideDecision } from "./guide-decision.js";

export type ProseRetention = "session-only" | "local-save";
export type NarrationRole = "guide" | "narrator";

export interface SemanticEventPayloads {
  readonly "session.paused": {
    readonly reason: "player-request";
  };
  readonly "session.resumed": Record<string, never>;
  readonly "audio.capture.started": {
    readonly captureId: string;
    readonly mode: "push-to-talk";
  };
  readonly "audio.capture.ended": {
    readonly captureId: string;
    readonly durationMs: number;
    readonly outcome: "submitted" | "cancelled" | "silence" | "failed";
  };
  readonly "audio.playback.started": {
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly sourceEventId: string;
  };
  readonly "audio.playback.ended": {
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly outcome: "complete" | "interrupted" | "failed";
  };
  readonly "transcript.final": {
    readonly text: string;
    readonly confidence?: number;
    readonly retention: ProseRetention;
  };
  readonly "experience.role-introduction": {
    readonly role: NarrationRole;
    readonly text: string;
    readonly position: number;
    readonly total: number;
    readonly retention: ProseRetention;
  };
  readonly "guide.decision.proposed": {
    readonly decision: GuideDecision;
    readonly retention: ProseRetention;
  };
  readonly "guide.decision.accepted": {
    readonly kind: "execute" | "clarify" | "explain";
  };
  readonly "guide.decision.rejected": {
    readonly cause: string;
    readonly decision?: Extract<
      GuideDecision,
      { readonly kind: "cannot_comply" }
    >;
    readonly retention: ProseRetention;
  };
  readonly "guide.clarification": {
    readonly question: string;
    readonly ambiguity: string;
    readonly choices?: readonly string[];
    readonly retention: ProseRetention;
  };
  readonly "guide.explanation": {
    readonly response: string;
    readonly sourceIds: readonly string[];
    readonly retention: ProseRetention;
  };
  readonly "guide.cannot_comply": {
    readonly response: string;
    readonly reason: string;
    readonly retention: ProseRetention;
  };
  readonly "engine.command.requested": {
    readonly requestId: string;
    readonly expectedRevision: number;
    readonly command: string;
  };
  readonly "engine.command.committed": {
    readonly requestId: string;
    readonly previousRevision: number;
    readonly revision: number;
    readonly command: string;
    readonly boundary: EngineTurnBoundary;
  };
  readonly "engine.command.rejected": {
    readonly requestId: string;
    readonly revision: number;
    readonly command: string;
    readonly reason: string;
  };
  readonly "engine.output": {
    readonly revision: number;
    readonly exactText: string;
    readonly boundary: EngineTurnBoundary;
    readonly retention: ProseRetention;
  };
  readonly "narration.requested": {
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly text: string;
    readonly sourceEventId: string;
    readonly retention: ProseRetention;
  };
  readonly "narration.ready": {
    readonly narrationId: string;
    readonly role: NarrationRole;
  };
  readonly "narration.cancelled": {
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly reason: "player-cancelled" | "stale-turn";
  };
  readonly "narration.failed": {
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly recoverable: true;
  };
  readonly "save.checkpointed": {
    readonly revision: number;
    readonly sha256: string;
    readonly byteLength: number;
  };
  readonly "save.failed": {
    readonly revision: number;
    readonly recoverable: true;
  };
  readonly "system.error": {
    readonly stage:
      | "audio"
      | "transcription"
      | "guide"
      | "engine"
      | "checkpoint"
      | "narration"
      | "coordinator";
    readonly code: string;
    readonly recoverable: boolean;
    readonly engineCommitState: "not-submitted" | "confirmed" | "unknown";
  };
  readonly "system.recovered": {
    readonly stage: "engine";
    readonly requestId: string;
    readonly revision: number;
  };
}

export type SemanticEventType = keyof SemanticEventPayloads;

export type SemanticEvent<TType extends SemanticEventType = SemanticEventType> =
  TType extends SemanticEventType
    ? EventEnvelope<TType, SemanticEventPayloads[TType]>
    : never;
