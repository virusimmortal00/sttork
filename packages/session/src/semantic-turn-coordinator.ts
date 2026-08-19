import type {
  BootResult,
  EnginePort,
  EngineSnapshot,
  ExecuteRequest,
  ExecuteResult,
  NarrationRole,
  SemanticEvent,
  SemanticEventPayloads,
  SemanticEventType,
} from "../../contracts/src/index.js";
import type { PendingOpeningObjectIntent } from "../../command-knowledge/src/index.js";
import type { EventSequence } from "../../events/src/index.js";
import {
  decideInitialGuideTurn,
  type GuideModel,
  type InitialGuideResult,
} from "../../guide-core/src/index.js";

export const MAX_COORDINATED_TURNS = 128;
export const MAX_OPENING_OUTPUT_LENGTH = 32_768;
export const MAX_TURN_TRANSCRIPT_LENGTH = 2_000;
export const MAX_TURN_OBSERVED_OBJECTS = 32;

export interface NarrationRequest {
  readonly narrationId: string;
  readonly role: NarrationRole;
  readonly text: string;
  readonly sourceEventId: string;
  readonly correlationId: string;
}

export interface NarrationPort {
  prepare(input: NarrationRequest, signal: AbortSignal): Promise<void>;
}

export interface SemanticTurnInput {
  readonly interactionId: string;
  readonly transcript: string;
  readonly transcriptConfidence?: number;
  readonly observedObjects: readonly string[];
}

export interface OpeningNarrationInput {
  readonly interactionId: string;
  readonly boot: BootResult;
}

export interface OpeningNarrationResult {
  readonly interactionId: string;
  readonly outcome: "ready" | "cancelled" | "failed";
  readonly events: readonly SemanticEvent[];
}

type NarrationPreparationOutcome = OpeningNarrationResult["outcome"];

export type SemanticTurnOutcome =
  | "committed"
  | "clarified"
  | "explained"
  | "rejected"
  | "cancelled"
  | "failed"
  | "uncertain";

export interface SemanticTurnResult {
  readonly interactionId: string;
  readonly outcome: SemanticTurnOutcome;
  readonly events: readonly SemanticEvent[];
  readonly engineResult?: ExecuteResult;
  readonly checkpoint?: EngineSnapshot;
}

export interface SemanticTurnCoordinatorOptions {
  readonly engine: EnginePort;
  readonly guide: GuideModel;
  readonly narrator: NarrationPort;
  readonly events: EventSequence;
  readonly nextRequestId: () => string;
  readonly nextNarrationId: () => string;
  readonly publish?: (event: SemanticEvent) => void;
  readonly maxTurns?: number;
}

export class SemanticTurnConflictError extends Error {
  public constructor(interactionId: string) {
    super(`Interaction ${interactionId} was reused with different input.`);
    this.name = "SemanticTurnConflictError";
  }
}

export class SemanticTurnBusyError extends Error {
  public constructor() {
    super("Another semantic turn is already active.");
    this.name = "SemanticTurnBusyError";
  }
}

export class SemanticTurnCapacityError extends Error {
  public constructor(maximum: number) {
    super(`The semantic turn journal reached its limit of ${maximum}.`);
    this.name = "SemanticTurnCapacityError";
  }
}

interface RecoveryRecord {
  readonly request: ExecuteRequest;
  readonly requestedEventId: string;
}

interface StoredPendingOpeningObjectIntent extends PendingOpeningObjectIntent {
  readonly sourceInteractionId: string;
}

type StoredTurn =
  | {
      readonly kind: "pending";
      readonly fingerprint: string;
      readonly promise: Promise<RunResult>;
    }
  | {
      readonly kind: "complete";
      readonly fingerprint: string;
      readonly result: SemanticTurnResult;
    }
  | {
      readonly kind: "uncertain";
      readonly fingerprint: string;
      readonly result: SemanticTurnResult;
      readonly recovery: RecoveryRecord;
    };

interface RunResult {
  readonly result: SemanticTurnResult;
  readonly recovery?: RecoveryRecord;
}

interface OpeningRunResult {
  readonly result: OpeningNarrationResult;
  readonly sourceEventId: string;
}

interface OpeningRunProgress {
  sourceEventId?: string;
}

type StoredOpening =
  | {
      readonly kind: "pending";
      readonly fingerprint: string;
      readonly input: OpeningNarrationInput;
      readonly progress: OpeningRunProgress;
      readonly promise: Promise<OpeningRunResult>;
    }
  | {
      readonly kind: "retryable";
      readonly fingerprint: string;
      readonly input: OpeningNarrationInput;
      readonly sourceEventId: string;
    }
  | {
      readonly kind: "complete";
      readonly fingerprint: string;
      readonly result: OpeningNarrationResult;
    };

function fingerprint(input: SemanticTurnInput): string {
  return JSON.stringify({
    interactionId: input.interactionId,
    transcript: input.transcript,
    transcriptConfidence: input.transcriptConfidence ?? null,
    observedObjects: [...input.observedObjects].sort(),
  });
}

function validateTurnInput(input: SemanticTurnInput): void {
  if (
    typeof input.interactionId !== "string" ||
    input.interactionId.length === 0 ||
    input.interactionId.length > 160 ||
    /\p{Cc}/u.test(input.interactionId)
  ) {
    throw new TypeError("interactionId must be a bounded nonempty string");
  }
  if (
    typeof input.transcript !== "string" ||
    input.transcript.trim().length === 0 ||
    input.transcript.length > MAX_TURN_TRANSCRIPT_LENGTH ||
    /\p{Cc}/u.test(input.transcript)
  ) {
    throw new TypeError("transcript must be a bounded nonempty string");
  }
  if (
    input.transcriptConfidence !== undefined &&
    (typeof input.transcriptConfidence !== "number" ||
      !Number.isFinite(input.transcriptConfidence) ||
      input.transcriptConfidence < 0 ||
      input.transcriptConfidence > 1)
  ) {
    throw new RangeError("transcriptConfidence must be from zero through one");
  }
  if (
    !Array.isArray(input.observedObjects) ||
    input.observedObjects.length > MAX_TURN_OBSERVED_OBJECTS ||
    input.observedObjects.some(
      (object) =>
        typeof object !== "string" ||
        object.length === 0 ||
        object.length > 80 ||
        /\p{Cc}/u.test(object),
    )
  ) {
    throw new TypeError("observedObjects must contain bounded object names");
  }
}

function boundedOpeningIdentity(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 160 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${field} must be a bounded nonempty string`);
  }
  return value;
}

function validatedOpeningBoot(input: unknown): BootResult {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("opening boot result is not narratable");
  }
  const candidate = input as Partial<BootResult>;
  if (
    candidate.revision !== 0 ||
    candidate.turnComplete !== true ||
    candidate.boundary !== "input-requested" ||
    typeof candidate.output !== "string" ||
    candidate.output.length === 0 ||
    candidate.output.length > MAX_OPENING_OUTPUT_LENGTH
  ) {
    throw new TypeError("opening boot result is not narratable");
  }
  const compatibility = candidate.compatibility;
  if (typeof compatibility !== "object" || compatibility === null) {
    throw new TypeError("opening compatibility is required");
  }
  if (
    !Number.isSafeInteger(compatibility.snapshotSchemaVersion) ||
    compatibility.snapshotSchemaVersion < 1
  ) {
    throw new TypeError("opening snapshot schema version is invalid");
  }

  return {
    revision: 0,
    output: candidate.output,
    turnComplete: true,
    boundary: "input-requested",
    compatibility: {
      story: {
        id: boundedOpeningIdentity(compatibility.story?.id, "opening story id"),
        artifactSha256: boundedOpeningIdentity(
          compatibility.story?.artifactSha256,
          "opening story hash",
        ),
      },
      runtime: {
        id: boundedOpeningIdentity(
          compatibility.runtime?.id,
          "opening runtime id",
        ),
        version: boundedOpeningIdentity(
          compatibility.runtime?.version,
          "opening runtime version",
        ),
        artifactSha256: boundedOpeningIdentity(
          compatibility.runtime?.artifactSha256,
          "opening runtime hash",
        ),
      },
      adapter: {
        id: boundedOpeningIdentity(
          compatibility.adapter?.id,
          "opening adapter id",
        ),
        version: boundedOpeningIdentity(
          compatibility.adapter?.version,
          "opening adapter version",
        ),
      },
      snapshotSchemaVersion: compatibility.snapshotSchemaVersion,
    },
  };
}

function openingFingerprint(interactionId: string, boot: BootResult): string {
  return JSON.stringify({
    interactionId,
    revision: boot.revision,
    output: boot.output,
    boundary: boot.boundary,
    compatibility: boot.compatibility,
  });
}

function engineCommitState(error: unknown): "not-submitted" | "unknown" {
  return typeof error === "object" &&
    error !== null &&
    "commitState" in error &&
    error.commitState === "not-submitted"
    ? "not-submitted"
    : "unknown";
}

function abortError(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}

async function awaitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  let removeListener = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    removeListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    removeListener();
  }
}

export class SemanticTurnCoordinator {
  readonly #engine: EnginePort;
  readonly #guide: GuideModel;
  readonly #narrator: NarrationPort;
  readonly #events: EventSequence;
  readonly #nextRequestId: () => string;
  readonly #nextNarrationId: () => string;
  readonly #publish: ((event: SemanticEvent) => void) | undefined;
  readonly #maxTurns: number;
  readonly #turns = new Map<string, StoredTurn>();
  #opening: StoredOpening | undefined;
  #activeInteractionId: string | undefined;
  #pendingOpeningObjectIntent: StoredPendingOpeningObjectIntent | undefined;

  public constructor(options: SemanticTurnCoordinatorOptions) {
    if (
      !Number.isSafeInteger(options.maxTurns ?? MAX_COORDINATED_TURNS) ||
      (options.maxTurns ?? MAX_COORDINATED_TURNS) < 1
    ) {
      throw new RangeError("maxTurns must be a positive safe integer");
    }
    this.#engine = options.engine;
    this.#guide = options.guide;
    this.#narrator = options.narrator;
    this.#events = options.events;
    this.#nextRequestId = options.nextRequestId;
    this.#nextNarrationId = options.nextNarrationId;
    this.#publish = options.publish;
    this.#maxTurns = options.maxTurns ?? MAX_COORDINATED_TURNS;
  }

  public async submitTurn(
    input: SemanticTurnInput,
    signal: AbortSignal,
  ): Promise<SemanticTurnResult> {
    validateTurnInput(input);
    const inputFingerprint = fingerprint(input);
    const existing = this.#turns.get(input.interactionId);
    if (existing !== undefined) {
      if (existing.fingerprint !== inputFingerprint) {
        throw new SemanticTurnConflictError(input.interactionId);
      }
      if (existing.kind === "complete") return existing.result;
      if (existing.kind === "pending") return (await existing.promise).result;
      return await this.#recover(input.interactionId, existing, signal);
    }
    if (this.#turns.size >= this.#maxTurns) {
      throw new SemanticTurnCapacityError(this.#maxTurns);
    }
    if (this.#activeInteractionId !== undefined) {
      throw new SemanticTurnBusyError();
    }
    if (this.#opening?.kind === "pending") {
      throw new SemanticTurnBusyError();
    }

    const operation = this.#runNew(input, signal);
    this.#turns.set(input.interactionId, {
      kind: "pending",
      fingerprint: inputFingerprint,
      promise: operation,
    });
    try {
      const completed = await operation;
      this.#turns.set(
        input.interactionId,
        completed.recovery === undefined
          ? {
              kind: "complete",
              fingerprint: inputFingerprint,
              result: completed.result,
            }
          : {
              kind: "uncertain",
              fingerprint: inputFingerprint,
              result: completed.result,
              recovery: completed.recovery,
            },
      );
      return completed.result;
    } catch (error) {
      this.#turns.delete(input.interactionId);
      throw error;
    }
  }

  public async prepareOpening(
    input: OpeningNarrationInput,
    signal: AbortSignal,
  ): Promise<OpeningNarrationResult> {
    const interactionId = this.#requireId(input.interactionId, "interaction");
    const boot = validatedOpeningBoot(input.boot);
    const inputFingerprint = openingFingerprint(interactionId, boot);
    const existing = this.#opening;
    if (existing !== undefined) {
      if (existing.fingerprint !== inputFingerprint) {
        throw new SemanticTurnConflictError(interactionId);
      }
      if (existing.kind === "complete") return existing.result;
      if (existing.kind === "pending") return (await existing.promise).result;
    }
    if (this.#activeInteractionId !== undefined) {
      throw new SemanticTurnBusyError();
    }

    const normalizedInput = { interactionId, boot };
    const sourceEventId =
      existing?.kind === "retryable" ? existing.sourceEventId : undefined;
    const progress: OpeningRunProgress = {
      ...(sourceEventId === undefined ? {} : { sourceEventId }),
    };
    const operation = this.#runOpening(normalizedInput, signal, progress);
    this.#opening = {
      kind: "pending",
      fingerprint: inputFingerprint,
      input: normalizedInput,
      progress,
      promise: operation,
    };
    try {
      const completed = await operation;
      this.#opening =
        completed.result.outcome !== "ready"
          ? {
              kind: "retryable",
              fingerprint: inputFingerprint,
              input: normalizedInput,
              sourceEventId: completed.sourceEventId,
            }
          : {
              kind: "complete",
              fingerprint: inputFingerprint,
              result: completed.result,
            };
      return completed.result;
    } catch (error) {
      if (this.#opening?.kind === "pending") {
        const retainedSourceEventId = progress.sourceEventId;
        this.#opening =
          retainedSourceEventId === undefined
            ? undefined
            : {
                kind: "retryable",
                fingerprint: inputFingerprint,
                input: normalizedInput,
                sourceEventId: retainedSourceEventId,
              };
      }
      throw error;
    }
  }

  public recordTranscriptionFailure(input: {
    readonly interactionId: string;
    readonly code: string;
  }): SemanticTurnResult {
    if (
      typeof input.interactionId !== "string" ||
      input.interactionId.length === 0 ||
      input.interactionId.length > 160 ||
      /\p{Cc}/u.test(input.interactionId) ||
      typeof input.code !== "string" ||
      input.code.length === 0 ||
      input.code.length > 160 ||
      /\p{Cc}/u.test(input.code)
    ) {
      throw new TypeError(
        "transcription failure fields must be bounded strings",
      );
    }
    if (this.#turns.has(input.interactionId)) {
      throw new SemanticTurnConflictError(input.interactionId);
    }
    if (this.#turns.size >= this.#maxTurns) {
      throw new SemanticTurnCapacityError(this.#maxTurns);
    }
    const local: SemanticEvent[] = [];
    this.#emit(
      local,
      "system.error",
      input.interactionId,
      undefined,
      "accessible",
      {
        stage: "transcription",
        code: input.code,
        recoverable: true,
        engineCommitState: "not-submitted",
      },
    );
    const result: SemanticTurnResult = {
      interactionId: input.interactionId,
      outcome: "failed",
      events: local,
    };
    this.#turns.set(input.interactionId, {
      kind: "complete",
      fingerprint: `transcription-failure:${input.code}`,
      result,
    });
    return result;
  }

  async #runOpening(
    input: OpeningNarrationInput,
    signal: AbortSignal,
    progress: OpeningRunProgress,
  ): Promise<OpeningRunResult> {
    if (this.#activeInteractionId !== undefined) {
      throw new SemanticTurnBusyError();
    }
    this.#activeInteractionId = input.interactionId;
    try {
      if (progress.sourceEventId === undefined) {
        const publicState = await awaitWithAbort(
          this.#engine.inspectPublicState(),
          signal,
        );
        if (
          publicState.revision !== input.boot.revision ||
          publicState.lastOutput !== input.boot.output ||
          publicState.boundary !== input.boot.boundary
        ) {
          throw new SemanticTurnConflictError(input.interactionId);
        }
        signal.throwIfAborted();
      }

      const local: SemanticEvent[] = [];
      let sourceEventId = progress.sourceEventId;
      if (sourceEventId === undefined) {
        sourceEventId = this.#emit(
          local,
          "engine.output",
          input.interactionId,
          undefined,
          "accessible",
          {
            revision: input.boot.revision,
            exactText: input.boot.output,
            boundary: input.boot.boundary,
            retention: "local-save",
          },
        ).id;
        progress.sourceEventId = sourceEventId;
      }
      const outcome = await this.#narrate(
        local,
        input.interactionId,
        "narrator",
        input.boot.output,
        sourceEventId,
        signal,
      );
      return {
        result: {
          interactionId: input.interactionId,
          outcome,
          events: local,
        },
        sourceEventId,
      };
    } finally {
      this.#activeInteractionId = undefined;
    }
  }

  public recordAudioFailure(input: {
    readonly interactionId: string;
    readonly code: string;
  }): SemanticTurnResult {
    if (
      typeof input.interactionId !== "string" ||
      input.interactionId.length === 0 ||
      input.interactionId.length > 160 ||
      /\p{Cc}/u.test(input.interactionId) ||
      typeof input.code !== "string" ||
      input.code.length === 0 ||
      input.code.length > 160 ||
      /\p{Cc}/u.test(input.code)
    ) {
      throw new TypeError("audio failure fields must be bounded strings");
    }
    if (this.#turns.has(input.interactionId)) {
      throw new SemanticTurnConflictError(input.interactionId);
    }
    if (this.#turns.size >= this.#maxTurns) {
      throw new SemanticTurnCapacityError(this.#maxTurns);
    }
    const local: SemanticEvent[] = [];
    this.#emit(
      local,
      "system.error",
      input.interactionId,
      undefined,
      "accessible",
      {
        stage: "audio",
        code: input.code,
        recoverable: true,
        engineCommitState: "not-submitted",
      },
    );
    const result: SemanticTurnResult = {
      interactionId: input.interactionId,
      outcome: "failed",
      events: local,
    };
    this.#turns.set(input.interactionId, {
      kind: "complete",
      fingerprint: `audio-failure:${input.code}`,
      result,
    });
    return result;
  }

  public recordCaptureStarted(input: {
    readonly interactionId: string;
    readonly captureId: string;
  }): SemanticEvent<"audio.capture.started"> {
    return this.#emit(
      [],
      "audio.capture.started",
      input.interactionId,
      undefined,
      "accessible",
      {
        captureId: this.#requireId(input.captureId, "capture"),
        mode: "push-to-talk",
      },
    );
  }

  public recordCaptureEnded(input: {
    readonly interactionId: string;
    readonly captureId: string;
    readonly durationMs: number;
    readonly outcome: SemanticEventPayloads["audio.capture.ended"]["outcome"];
  }): SemanticEvent<"audio.capture.ended"> {
    if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
      throw new RangeError(
        "capture durationMs must be a non-negative safe integer",
      );
    }
    return this.#emit(
      [],
      "audio.capture.ended",
      input.interactionId,
      undefined,
      "accessible",
      {
        captureId: this.#requireId(input.captureId, "capture"),
        durationMs: input.durationMs,
        outcome: input.outcome,
      },
    );
  }

  public recordPlaybackStarted(input: {
    readonly interactionId: string;
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly sourceEventId: string;
  }): SemanticEvent<"audio.playback.started"> {
    return this.#emit(
      [],
      "audio.playback.started",
      input.interactionId,
      input.sourceEventId,
      "accessible",
      {
        narrationId: this.#requireId(input.narrationId, "narration"),
        role: input.role,
        sourceEventId: this.#requireId(input.sourceEventId, "source event"),
      },
    );
  }

  public recordPlaybackEnded(input: {
    readonly interactionId: string;
    readonly narrationId: string;
    readonly role: NarrationRole;
    readonly sourceEventId: string;
    readonly outcome: SemanticEventPayloads["audio.playback.ended"]["outcome"];
    readonly failureCode?: string;
  }): SemanticEvent<"audio.playback.ended"> {
    const failureCode =
      input.failureCode === undefined
        ? undefined
        : this.#requireId(input.failureCode, "playback failure code");
    const ended = this.#emit(
      [],
      "audio.playback.ended",
      input.interactionId,
      input.sourceEventId,
      "accessible",
      {
        narrationId: this.#requireId(input.narrationId, "narration"),
        role: input.role,
        outcome: input.outcome,
      },
    );
    if (input.outcome === "failed" && failureCode !== undefined) {
      this.#emit(
        [],
        "system.error",
        input.interactionId,
        ended.id,
        "accessible",
        {
          stage: "narration",
          code: failureCode,
          recoverable: true,
          engineCommitState:
            input.role === "narrator" ? "confirmed" : "not-submitted",
        },
      );
    }
    return ended;
  }

  public recordPaused(interactionId: string): SemanticEvent<"session.paused"> {
    return this.#emit(
      [],
      "session.paused",
      interactionId,
      undefined,
      "accessible",
      {
        reason: "player-request",
      },
    );
  }

  public recordResumed(
    interactionId: string,
  ): SemanticEvent<"session.resumed"> {
    return this.#emit(
      [],
      "session.resumed",
      interactionId,
      undefined,
      "accessible",
      {},
    );
  }

  async #runNew(
    input: SemanticTurnInput,
    signal: AbortSignal,
  ): Promise<RunResult> {
    this.#activeInteractionId = input.interactionId;
    const pendingOpeningObjectIntent = this.#pendingOpeningObjectIntent;
    const local: SemanticEvent[] = [];
    try {
      const transcriptEvent = this.#emit(
        local,
        "transcript.final",
        input.interactionId,
        undefined,
        "accessible",
        {
          text: input.transcript,
          ...(input.transcriptConfidence === undefined
            ? {}
            : { confidence: input.transcriptConfidence }),
          retention: "local-save",
        },
      );

      let guideResult: InitialGuideResult;
      try {
        guideResult = await awaitWithAbort(
          decideInitialGuideTurn(
            this.#guide,
            {
              interactionId: input.interactionId,
              playerUtterance: input.transcript,
              ...(input.transcriptConfidence === undefined
                ? {}
                : { transcriptConfidence: input.transcriptConfidence }),
              observedObjects: input.observedObjects,
              ...(pendingOpeningObjectIntent === undefined
                ? {}
                : {
                    pendingIntent: {
                      action: pendingOpeningObjectIntent.action,
                    },
                  }),
            },
            signal,
          ),
          signal,
        );
      } catch {
        this.#emit(
          local,
          "system.error",
          input.interactionId,
          transcriptEvent.id,
          "accessible",
          {
            stage: "guide",
            code: signal.aborted ? "cancelled" : "guide-failed",
            recoverable: true,
            engineCommitState: "not-submitted",
          },
        );
        return {
          result: this.#result(
            input.interactionId,
            signal.aborted ? "cancelled" : "failed",
            local,
          ),
        };
      }

      const proposed = this.#emit(
        local,
        "guide.decision.proposed",
        input.interactionId,
        transcriptEvent.id,
        "debug",
        { decision: guideResult.decision, retention: "local-save" },
      );

      if (
        guideResult.kind === "rejected" ||
        guideResult.kind === "provider-failure"
      ) {
        const rejected = this.#emit(
          local,
          "guide.decision.rejected",
          input.interactionId,
          proposed.id,
          "debug",
          {
            cause:
              guideResult.kind === "rejected"
                ? guideResult.cause
                : "provider-failure",
            decision: guideResult.decision,
            retention: "local-save",
          },
        );
        const cannot = this.#emit(
          local,
          "guide.cannot_comply",
          input.interactionId,
          rejected.id,
          "accessible",
          {
            response: guideResult.decision.response,
            reason: guideResult.decision.reason,
            retention: "local-save",
          },
        );
        await this.#narrate(
          local,
          input.interactionId,
          "guide",
          guideResult.decision.response,
          cannot.id,
          signal,
        );
        return {
          result: this.#result(
            input.interactionId,
            guideResult.kind === "provider-failure" ? "failed" : "rejected",
            local,
          ),
        };
      }

      const accepted = this.#emit(
        local,
        "guide.decision.accepted",
        input.interactionId,
        proposed.id,
        "debug",
        { kind: guideResult.kind },
      );

      if (guideResult.kind === "clarify") {
        const nextPendingOpeningObjectIntent =
          guideResult.pendingIntent === undefined
            ? undefined
            : {
                action: guideResult.pendingIntent.action,
                sourceInteractionId:
                  pendingOpeningObjectIntent?.action ===
                  guideResult.pendingIntent.action
                    ? pendingOpeningObjectIntent.sourceInteractionId
                    : input.interactionId,
              };
        const clarification = this.#emit(
          local,
          "guide.clarification",
          input.interactionId,
          accepted.id,
          "accessible",
          {
            question: guideResult.decision.question,
            ambiguity: guideResult.decision.ambiguity,
            ...(guideResult.decision.choices === undefined
              ? {}
              : { choices: guideResult.decision.choices }),
            retention: "local-save",
          },
        );
        await this.#narrate(
          local,
          input.interactionId,
          "guide",
          guideResult.decision.question,
          clarification.id,
          signal,
        );
        this.#pendingOpeningObjectIntent = nextPendingOpeningObjectIntent;
        return {
          result: this.#result(input.interactionId, "clarified", local),
        };
      }

      if (guideResult.kind === "explain") {
        const explanation = this.#emit(
          local,
          "guide.explanation",
          input.interactionId,
          accepted.id,
          "accessible",
          {
            response: guideResult.decision.response,
            sourceIds: guideResult.decision.sourceIds,
            retention: "local-save",
          },
        );
        await this.#narrate(
          local,
          input.interactionId,
          "guide",
          guideResult.decision.response,
          explanation.id,
          signal,
        );
        return {
          result: this.#result(input.interactionId, "explained", local),
        };
      }

      if (signal.aborted) {
        this.#emit(
          local,
          "system.error",
          input.interactionId,
          accepted.id,
          "accessible",
          {
            stage: "coordinator",
            code: "cancelled-before-engine-submit",
            recoverable: true,
            engineCommitState: "not-submitted",
          },
        );
        return {
          result: this.#result(input.interactionId, "cancelled", local),
        };
      }

      let state;
      try {
        state = await this.#engine.inspectPublicState();
      } catch {
        this.#emit(
          local,
          "system.error",
          input.interactionId,
          accepted.id,
          "accessible",
          {
            stage: "engine",
            code: "engine-inspection-failed",
            recoverable: true,
            engineCommitState: "not-submitted",
          },
        );
        return { result: this.#result(input.interactionId, "failed", local) };
      }
      if (signal.aborted) {
        this.#emit(
          local,
          "system.error",
          input.interactionId,
          accepted.id,
          "accessible",
          {
            stage: "coordinator",
            code: "cancelled-before-engine-submit",
            recoverable: true,
            engineCommitState: "not-submitted",
          },
        );
        return {
          result: this.#result(input.interactionId, "cancelled", local),
        };
      }
      const request: ExecuteRequest = {
        requestId: this.#requireId(this.#nextRequestId(), "engine request"),
        expectedRevision: state.revision,
        command: guideResult.command,
      };
      const requested = this.#emit(
        local,
        "engine.command.requested",
        input.interactionId,
        accepted.id,
        "debug",
        request,
      );
      try {
        const engineResult = await this.#engine.execute(request, signal);
        return await this.#finishEngineResult(
          input.interactionId,
          local,
          requested.id,
          request,
          engineResult,
          signal,
        );
      } catch (error) {
        const commitState = engineCommitState(error);
        this.#emit(
          local,
          "system.error",
          input.interactionId,
          requested.id,
          "accessible",
          {
            stage: "engine",
            code:
              commitState === "not-submitted"
                ? "cancelled-before-engine-submit"
                : "engine-outcome-uncertain",
            recoverable: true,
            engineCommitState: commitState,
          },
        );
        if (commitState === "not-submitted") {
          return {
            result: this.#result(input.interactionId, "cancelled", local),
          };
        }
        return {
          result: this.#result(input.interactionId, "uncertain", local),
          recovery: { request, requestedEventId: requested.id },
        };
      }
    } finally {
      this.#activeInteractionId = undefined;
    }
  }

  async #recover(
    interactionId: string,
    stored: Extract<StoredTurn, { readonly kind: "uncertain" }>,
    signal: AbortSignal,
  ): Promise<SemanticTurnResult> {
    if (this.#activeInteractionId !== undefined)
      throw new SemanticTurnBusyError();
    if (this.#opening?.kind === "pending") {
      throw new SemanticTurnBusyError();
    }
    if (signal.aborted) return stored.result;
    this.#activeInteractionId = interactionId;
    const local = [...stored.result.events];
    try {
      let engineResult: ExecuteResult;
      try {
        engineResult = await this.#engine.execute(
          stored.recovery.request,
          signal,
        );
      } catch {
        return stored.result;
      }
      const recovered = this.#emit(
        local,
        "system.recovered",
        interactionId,
        stored.recovery.requestedEventId,
        "debug",
        {
          stage: "engine",
          requestId: stored.recovery.request.requestId,
          revision: engineResult.revision,
        },
      );
      const completed = await this.#finishEngineResult(
        interactionId,
        local,
        recovered.id,
        stored.recovery.request,
        engineResult,
        signal,
      );
      this.#turns.set(interactionId, {
        kind: "complete",
        fingerprint: stored.fingerprint,
        result: completed.result,
      });
      return completed.result;
    } finally {
      this.#activeInteractionId = undefined;
    }
  }

  async #finishEngineResult(
    interactionId: string,
    local: SemanticEvent[],
    causationId: string,
    request: ExecuteRequest,
    engineResult: ExecuteResult,
    signal: AbortSignal,
  ): Promise<RunResult> {
    this.#pendingOpeningObjectIntent = undefined;
    if (engineResult.status === "rejected") {
      this.#emit(
        local,
        "engine.command.rejected",
        interactionId,
        causationId,
        "accessible",
        {
          requestId: request.requestId,
          revision: engineResult.revision,
          command: request.command,
          reason: engineResult.rejection,
        },
      );
      return {
        result: this.#result(interactionId, "failed", local, engineResult),
      };
    }

    const committed = this.#emit(
      local,
      "engine.command.committed",
      interactionId,
      causationId,
      "debug",
      {
        requestId: engineResult.requestId,
        previousRevision: engineResult.previousRevision,
        revision: engineResult.revision,
        command: engineResult.command,
        boundary: engineResult.boundary,
      },
    );
    const output = this.#emit(
      local,
      "engine.output",
      interactionId,
      committed.id,
      "accessible",
      {
        revision: engineResult.revision,
        exactText: engineResult.output,
        boundary: engineResult.boundary,
        retention: "local-save",
      },
    );

    let checkpoint: EngineSnapshot | undefined;
    try {
      checkpoint = await this.#engine.snapshot();
      this.#emit(
        local,
        "save.checkpointed",
        interactionId,
        output.id,
        "internal",
        {
          revision: checkpoint.revision,
          sha256: checkpoint.sha256,
          byteLength: checkpoint.bytes.byteLength,
        },
      );
    } catch {
      const failed = this.#emit(
        local,
        "save.failed",
        interactionId,
        output.id,
        "accessible",
        {
          revision: engineResult.revision,
          recoverable: true,
        },
      );
      this.#emit(
        local,
        "system.error",
        interactionId,
        failed.id,
        "accessible",
        {
          stage: "checkpoint",
          code: "checkpoint-failed",
          recoverable: true,
          engineCommitState: "confirmed",
        },
      );
    }

    if (signal.aborted) {
      const narrationId = this.#requireId(this.#nextNarrationId(), "narration");
      this.#emit(
        local,
        "narration.cancelled",
        interactionId,
        output.id,
        "accessible",
        {
          narrationId,
          role: "narrator",
          reason: "player-cancelled",
        },
      );
    } else {
      await this.#narrate(
        local,
        interactionId,
        "narrator",
        engineResult.output,
        output.id,
        signal,
      );
    }

    return {
      result: this.#result(
        interactionId,
        "committed",
        local,
        engineResult,
        checkpoint,
      ),
    };
  }

  async #narrate(
    local: SemanticEvent[],
    interactionId: string,
    role: NarrationRole,
    text: string,
    sourceEventId: string,
    signal: AbortSignal,
  ): Promise<NarrationPreparationOutcome> {
    const narrationId = this.#requireId(this.#nextNarrationId(), "narration");
    const requested = this.#emit(
      local,
      "narration.requested",
      interactionId,
      sourceEventId,
      "debug",
      { narrationId, role, text, sourceEventId, retention: "session-only" },
    );
    try {
      await awaitWithAbort(
        this.#narrator.prepare(
          {
            narrationId,
            role,
            text,
            sourceEventId,
            correlationId: interactionId,
          },
          signal,
        ),
        signal,
      );
      this.#emit(
        local,
        "narration.ready",
        interactionId,
        requested.id,
        "debug",
        {
          narrationId,
          role,
        },
      );
      return "ready";
    } catch {
      if (signal.aborted) {
        this.#emit(
          local,
          "narration.cancelled",
          interactionId,
          requested.id,
          "accessible",
          {
            narrationId,
            role,
            reason: "player-cancelled",
          },
        );
        return "cancelled";
      } else {
        const failed = this.#emit(
          local,
          "narration.failed",
          interactionId,
          requested.id,
          "accessible",
          {
            narrationId,
            role,
            recoverable: true,
          },
        );
        this.#emit(
          local,
          "system.error",
          interactionId,
          failed.id,
          "accessible",
          {
            stage: "narration",
            code: "narration-failed",
            recoverable: true,
            engineCommitState:
              role === "narrator" ? "confirmed" : "not-submitted",
          },
        );
        return "failed";
      }
    }
  }

  #emit<TType extends SemanticEventType>(
    local: SemanticEvent[],
    type: TType,
    correlationId: string,
    causationId: string | undefined,
    visibility: "internal" | "debug" | "accessible",
    payload: SemanticEventPayloads[TType],
  ): SemanticEvent<TType> {
    const event = this.#events.append({
      type,
      correlationId,
      ...(causationId === undefined ? {} : { causationId }),
      visibility,
      payload,
    }) as SemanticEvent<TType>;
    local.push(event);
    try {
      this.#publish?.(event);
    } catch {
      // The canonical in-memory append has already succeeded. A projection or
      // debug subscriber cannot change commit-boundary control flow.
    }
    return event;
  }

  #result(
    interactionId: string,
    outcome: SemanticTurnOutcome,
    events: readonly SemanticEvent[],
    engineResult?: ExecuteResult,
    checkpoint?: EngineSnapshot,
  ): SemanticTurnResult {
    return {
      interactionId,
      outcome,
      events: [...events],
      ...(engineResult === undefined ? {} : { engineResult }),
      ...(checkpoint === undefined ? {} : { checkpoint }),
    };
  }

  #requireId(value: string, kind: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 160) {
      throw new TypeError(`${kind} id must be a bounded nonempty string`);
    }
    return value;
  }
}
