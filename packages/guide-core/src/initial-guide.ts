import {
  createOpeningCommandKnowledge,
  groundOpeningCommand,
  groundObservedObjectContentQuestion,
  groundPendingOpeningObjectReply,
  inferPendingOpeningObjectIntent,
  openingCommandHelp,
  openingObjectSelectionMentioned,
  resolveOpeningCommandIntent,
  type OpeningCommandKnowledge,
  type PendingOpeningObjectIntent,
} from "../../command-knowledge/src/index.js";
import type {
  CanonicalCommand,
  GuideDecision,
} from "../../contracts/src/index.js";

import {
  type InitialGuideModelDecision,
  validateInitialGuideModelDecision,
} from "./initial-model-decision-validator.js";

export const INITIAL_EXECUTE_CONFIDENCE = 0.8;
export const INITIAL_TRANSCRIPT_CONFIDENCE = 0.75;

export interface InitialGuideInput {
  readonly interactionId: string;
  readonly playerUtterance: string;
  readonly transcriptConfidence?: number;
  readonly observedObjects: readonly string[];
  readonly pendingIntent?: PendingOpeningObjectIntent;
}

export interface InitialGuideModelInput extends InitialGuideInput {
  readonly knowledge: OpeningCommandKnowledge;
}

export interface GuideModel {
  decide(input: InitialGuideModelInput, signal: AbortSignal): Promise<unknown>;
}

export type InitialGuideResult =
  | {
      readonly kind: "execute";
      readonly command: CanonicalCommand;
      readonly decision: Extract<GuideDecision, { readonly kind: "execute" }>;
      readonly groundingSourceId: string;
    }
  | {
      readonly kind: "clarify";
      readonly decision: Extract<GuideDecision, { readonly kind: "clarify" }>;
      readonly pendingIntent?: PendingOpeningObjectIntent;
    }
  | {
      readonly kind: "explain";
      readonly decision: Extract<GuideDecision, { readonly kind: "explain" }>;
    }
  | {
      readonly kind: "rejected";
      readonly decision: Extract<
        GuideDecision,
        { readonly kind: "cannot_comply" }
      >;
      readonly cause:
        | "malformed-provider-decision"
        | "unsupported-initial-decision"
        | "ungrounded-command"
        | "invalid-context";
    }
  | {
      readonly kind: "provider-failure";
      readonly decision: Extract<
        GuideDecision,
        { readonly kind: "cannot_comply" }
      >;
    };

function clarification(
  question: string,
  ambiguity: string,
  pendingIntent?: PendingOpeningObjectIntent,
): InitialGuideResult {
  return {
    kind: "clarify",
    decision: { kind: "clarify", question, ambiguity },
    ...(pendingIntent === undefined ? {} : { pendingIntent }),
  };
}

function appearsMultiStep(utterance: string): boolean {
  return /[;\n]|\b(?:and|then|after that|followed by)\b/iu.test(utterance);
}

function containsNegation(utterance: string): boolean {
  return /\b(?:do not|don't|dont|never|not)\b/iu.test(utterance);
}

function transcriptConfidenceRequiresClarification(
  transcriptConfidence: number | undefined,
): boolean {
  return (
    transcriptConfidence !== undefined &&
    (!Number.isFinite(transcriptConfidence) ||
      transcriptConfidence < INITIAL_TRANSCRIPT_CONFIDENCE ||
      transcriptConfidence > 1)
  );
}

function validPendingIntent(
  value: PendingOpeningObjectIntent | undefined,
): boolean {
  return (
    value === undefined ||
    (typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 1 &&
      ["examine", "open", "read", "take"].includes(value.action))
  );
}

function materializeExecuteDecision(
  proposal: Extract<InitialGuideModelDecision, { readonly kind: "execute" }>,
  command: CanonicalCommand,
): Extract<GuideDecision, { readonly kind: "execute" }> {
  if ("affordanceId" in proposal) {
    const {
      affordanceId: _providerOnlyAffordanceId,
      slots: _providerOnlySlots,
      ...decision
    } = proposal;
    void _providerOnlyAffordanceId;
    void _providerOnlySlots;
    return { ...decision, command };
  }
  return { ...proposal, command };
}

export async function decideInitialGuideTurn(
  model: GuideModel,
  input: InitialGuideInput,
  signal: AbortSignal,
): Promise<InitialGuideResult> {
  let knowledge: OpeningCommandKnowledge;
  try {
    if (
      typeof input.interactionId !== "string" ||
      input.interactionId.length === 0 ||
      input.interactionId.length > 160 ||
      typeof input.playerUtterance !== "string" ||
      input.playerUtterance.trim().length === 0 ||
      input.playerUtterance.length > 2_000 ||
      /\p{Cc}/u.test(input.interactionId) ||
      /\p{Cc}/u.test(input.playerUtterance) ||
      !validPendingIntent(input.pendingIntent)
    ) {
      throw new TypeError("Initial guide context strings are invalid.");
    }
    knowledge = createOpeningCommandKnowledge({
      observedObjects: input.observedObjects,
    });
  } catch {
    return {
      kind: "rejected",
      cause: "invalid-context",
      decision: {
        kind: "cannot_comply",
        response:
          "The guide context could not be safely bounded. Your game has not changed.",
        reason: "unsafe",
      },
    };
  }

  signal.throwIfAborted();

  if (transcriptConfidenceRequiresClarification(input.transcriptConfidence)) {
    return clarification(
      "Could you say which single action you want me to try?",
      "The interpretation confidence is too low to safely execute.",
      input.pendingIntent,
    );
  }

  if (appearsMultiStep(input.playerUtterance)) {
    return clarification(
      "Which one action should I try first?",
      "The request contains more than one possible game turn.",
    );
  }

  if (containsNegation(input.playerUtterance)) {
    return clarification(
      "What single action would you like me to perform instead?",
      "The utterance contains a negation, so executing the proposed command would be unsafe.",
    );
  }

  if (input.pendingIntent !== undefined) {
    const pendingReply = groundPendingOpeningObjectReply(
      input.pendingIntent,
      input.playerUtterance,
      knowledge,
    );
    if (pendingReply.ok) {
      const decision = {
        kind: "execute" as const,
        command: pendingReply.command,
        intentSummary:
          "Apply the pending action to the selected observed object.",
        confidence: 1,
      };
      return {
        kind: "execute",
        command: pendingReply.command,
        decision,
        groundingSourceId: pendingReply.ruleId,
      };
    }
  }

  const directContentQuestion = groundObservedObjectContentQuestion(
    input.playerUtterance,
    knowledge,
  );
  if (directContentQuestion.ok) {
    const decision = {
      kind: "execute" as const,
      command: directContentQuestion.command,
      intentSummary: "Examine the observed object for visible content.",
      confidence: 1,
    };
    return {
      kind: "execute",
      command: directContentQuestion.command,
      decision,
      groundingSourceId: directContentQuestion.ruleId,
    };
  }

  let unknownDecision: unknown;
  try {
    unknownDecision = await model.decide({ ...input, knowledge }, signal);
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason ?? error;
    }
    return {
      kind: "provider-failure",
      decision: {
        kind: "cannot_comply",
        response: "The guide is unavailable. Your game has not changed.",
        reason: "provider-limitation",
      },
    };
  }
  signal.throwIfAborted();

  let decision: InitialGuideModelDecision;
  try {
    decision = validateInitialGuideModelDecision(unknownDecision);
  } catch {
    return {
      kind: "rejected",
      cause: "malformed-provider-decision",
      decision: {
        kind: "cannot_comply",
        response:
          "I could not safely interpret that response. Your game has not changed.",
        reason: "unsafe",
      },
    };
  }

  if (decision.kind === "clarify") {
    const pendingIntent = inferPendingOpeningObjectIntent(
      input.playerUtterance,
    );
    return {
      kind: "clarify",
      decision,
      ...(pendingIntent === undefined ? {} : { pendingIntent }),
    };
  }

  if (decision.kind === "explain") {
    if (
      decision.basis !== "command-help" ||
      decision.sourceIds.length === 0 ||
      decision.sourceIds.some(
        (sourceId) => !knowledge.sourceIds.includes(sourceId),
      )
    ) {
      return {
        kind: "rejected",
        cause: "unsupported-initial-decision",
        decision: {
          kind: "cannot_comply",
          response:
            "I can only explain parser help grounded in what is currently available.",
          reason: "not-observed",
        },
      };
    }
    return {
      kind: "explain",
      decision: {
        kind: "explain",
        response: openingCommandHelp(knowledge),
        basis: "command-help",
        sourceIds: decision.sourceIds,
      },
    };
  }

  if (decision.kind !== "execute") {
    return {
      kind: "rejected",
      cause: "unsupported-initial-decision",
      decision: {
        kind: "cannot_comply",
        response:
          "That guide action is not available in the initial bounded guide.",
        reason: "unsupported",
      },
    };
  }

  if (decision.confidence < INITIAL_EXECUTE_CONFIDENCE) {
    return clarification(
      "Could you say which single action you want me to try?",
      "The interpretation confidence is too low to safely execute.",
      input.pendingIntent,
    );
  }

  if ("remainingGoal" in decision && decision.remainingGoal !== undefined) {
    return clarification(
      "Which one action should I try first?",
      "The request contains more than one possible game turn.",
      inferPendingOpeningObjectIntent(input.playerUtterance),
    );
  }

  try {
    if (!("affordanceId" in decision)) {
      const lexicalGrounding = groundOpeningCommand(
        decision.command,
        input.playerUtterance,
        knowledge,
      );
      if (!lexicalGrounding.ok) {
        return {
          kind: "rejected",
          cause: "ungrounded-command",
          decision: {
            kind: "cannot_comply",
            response:
              "I could not ground that command in your words and the observed scene.",
            reason: "not-observed",
          },
        };
      }
      return {
        kind: "execute",
        command: lexicalGrounding.command,
        decision: materializeExecuteDecision(
          decision,
          lexicalGrounding.command,
        ),
        groundingSourceId: lexicalGrounding.ruleId,
      };
    }

    const semanticGrounding = resolveOpeningCommandIntent(
      {
        affordanceId: decision.affordanceId,
        slots: decision.slots,
      },
      knowledge,
    );
    if (!semanticGrounding.ok) {
      return {
        kind: "rejected",
        cause: "ungrounded-command",
        decision: {
          kind: "cannot_comply",
          response:
            "I could not ground that command in your words and the observed scene.",
          reason: "not-observed",
        },
      };
    }

    const lexicalGrounding = groundOpeningCommand(
      semanticGrounding.command,
      input.playerUtterance,
      knowledge,
    );
    const semanticFallbackAllowed =
      semanticGrounding.semanticFallbackAllowed &&
      (semanticGrounding.riskTier === 1 ||
        (semanticGrounding.riskTier === 2 &&
          semanticGrounding.ruleId === "grammar.examine" &&
          semanticGrounding.selectedObject !== undefined &&
          openingObjectSelectionMentioned(
            semanticGrounding.selectedObject,
            input.playerUtterance,
          )));
    if (!lexicalGrounding.ok && !semanticFallbackAllowed) {
      return {
        kind: "rejected",
        cause: "ungrounded-command",
        decision: {
          kind: "cannot_comply",
          response:
            "I could not ground that command in your words and the observed scene.",
          reason: "not-observed",
        },
      };
    }
    return {
      kind: "execute",
      command: semanticGrounding.command,
      decision: materializeExecuteDecision(decision, semanticGrounding.command),
      groundingSourceId: semanticGrounding.ruleId,
    };
  } catch {
    return {
      kind: "rejected",
      cause: "ungrounded-command",
      decision: {
        kind: "cannot_comply",
        response: "I could not safely form one parser command.",
        reason: "unsafe",
      },
    };
  }
}
