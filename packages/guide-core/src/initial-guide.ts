import {
  createPendingOpeningContentObjectIntent,
  createPendingOpeningReadExamineChoiceIntent,
  createOpeningCommandKnowledge,
  groundOpeningCommand,
  groundPendingOpeningObjectReply,
  groundPendingOpeningReadExamineChoiceReply,
  identifyNonlexicalOpeningContentRequest,
  identifyNonlexicalOpeningReadExamineAmbiguity,
  identifyOpeningReadExamineClarificationChoice,
  inferPendingOpeningObjectIntent,
  isOpeningSceneProjection,
  isPendingOpeningObjectIntent,
  openingCommandHelp,
  openingObjectObservationDirectlyRequested,
  openingSceneCurrentObjectLabels,
  resolveOpeningSceneGuidance,
  resolvePendingOpeningContentObjectReply,
  resolveOpeningCommandComparisonQuestion,
  resolveOpeningCommandIntent,
  type OpeningCommandKnowledge,
  type OpeningObservedObjectOption,
  type OpeningSceneProjection,
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
  readonly scene?: OpeningSceneProjection;
}

export interface InitialGuideModelInput extends Omit<
  InitialGuideInput,
  "scene"
> {
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
  choices?: readonly [string, string],
): InitialGuideResult {
  return {
    kind: "clarify",
    decision: {
      kind: "clarify",
      question,
      ambiguity,
      ...(choices === undefined ? {} : { choices }),
    },
    ...(pendingIntent === undefined ? {} : { pendingIntent }),
  };
}

function readExamineClarification(
  selectedObject: OpeningObservedObjectOption,
): InitialGuideResult {
  const objectLabel = selectedObject.label;
  return clarification(
    `Would you like me to examine the ${objectLabel} without taking it, or use READ, which may take it?`,
    "The request could mean a non-taking EXAMINE action or the parser's READ action, which may implicitly take the object.",
    createPendingOpeningReadExamineChoiceIntent(selectedObject),
    [`examine ${objectLabel}`, `read ${objectLabel}`],
  );
}

function genericProviderClarification(
  pendingIntent?: PendingOpeningObjectIntent,
): InitialGuideResult {
  return clarification(
    "Could you say which single action you want me to try?",
    "The request has more than one safely grounded interpretation.",
    pendingIntent,
  );
}

function appearsMultiStep(utterance: string): boolean {
  return /[;\n]|\b(?:and|or|then|after that|followed by)\b/iu.test(utterance);
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
  return value === undefined || isPendingOpeningObjectIntent(value);
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
    if (
      input.scene !== undefined &&
      (!isOpeningSceneProjection(input.scene) ||
        JSON.stringify(openingSceneCurrentObjectLabels(input.scene)) !==
          JSON.stringify(knowledge.observedObjects))
    ) {
      throw new TypeError(
        "Initial guide scene does not match current objects.",
      );
    }
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

  const commandComparison = resolveOpeningCommandComparisonQuestion(
    input.playerUtterance,
    knowledge,
  );
  if (commandComparison.kind === "resolved") {
    return {
      kind: "explain",
      decision: {
        kind: "explain",
        response: openingCommandHelp(knowledge, commandComparison.sourceIds),
        basis: "command-help",
        sourceIds: commandComparison.sourceIds,
      },
    };
  }
  if (commandComparison.kind === "invalid") {
    return clarification(
      "Which two available commands would you like me to compare?",
      "A command comparison must name exactly two currently available commands and no additional action.",
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

  if (input.scene !== undefined) {
    const sceneGuidance = resolveOpeningSceneGuidance(
      input.playerUtterance,
      input.scene,
    );
    if (sceneGuidance !== undefined) {
      return {
        kind: "explain",
        decision: {
          kind: "explain",
          response: sceneGuidance.response,
          basis: sceneGuidance.basis,
          sourceIds: sceneGuidance.sourceIds,
        },
      };
    }
  }

  if (input.pendingIntent !== undefined) {
    if ("action" in input.pendingIntent) {
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
    } else if (input.pendingIntent.kind === "content-object") {
      const contentObjectReply = resolvePendingOpeningContentObjectReply(
        input.pendingIntent,
        input.playerUtterance,
        knowledge,
      );
      if (contentObjectReply.ok) {
        return readExamineClarification(contentObjectReply.selectedObject);
      }
    } else {
      const choiceReply = groundPendingOpeningReadExamineChoiceReply(
        input.pendingIntent,
        input.playerUtterance,
        knowledge,
      );
      if (choiceReply.ok) {
        const decision = {
          kind: "execute" as const,
          command: choiceReply.command,
          intentSummary:
            "Apply the player's explicit action choice to the still-observed object.",
          confidence: 1,
        };
        return {
          kind: "execute",
          command: choiceReply.command,
          decision,
          groundingSourceId: choiceReply.ruleId,
        };
      }
      if (choiceReply.code === "unobserved-object") {
        return clarification(
          "That object is no longer in the observed scene. What would you like to do instead?",
          "The pending READ-or-EXAMINE choice no longer has a currently observed object.",
        );
      }
      if (choiceReply.code === "not-direct-action-request") {
        return clarification(
          "Please choose READ or EXAMINE as a direct action.",
          "A question, condition, or quoted command does not authorize the pending action.",
        );
      }
    }
  }

  const localContentAmbiguity = identifyNonlexicalOpeningContentRequest(
    input.playerUtterance,
    knowledge,
  );
  if (localContentAmbiguity !== undefined) {
    return readExamineClarification(localContentAmbiguity);
  }

  const missingContentObject = inferPendingOpeningObjectIntent(
    input.playerUtterance,
  );
  if (
    missingContentObject !== undefined &&
    "kind" in missingContentObject &&
    missingContentObject.kind === "content-object"
  ) {
    return clarification(
      "Which observed object would you like to inspect or read?",
      "The content request does not identify one currently observed object.",
      createPendingOpeningContentObjectIntent(),
    );
  }

  let unknownDecision: unknown;
  try {
    const { scene: _localScene, ...modelInput } = input;
    void _localScene;
    unknownDecision = await model.decide({ ...modelInput, knowledge }, signal);
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
    const deterministicAmbiguity =
      identifyNonlexicalOpeningContentRequest(
        input.playerUtterance,
        knowledge,
      ) ??
      identifyOpeningReadExamineClarificationChoice(
        decision.choices,
        input.playerUtterance,
        knowledge,
      );
    if (deterministicAmbiguity !== undefined) {
      return readExamineClarification(deterministicAmbiguity);
    }
    const pendingIntent = inferPendingOpeningObjectIntent(
      input.playerUtterance,
    );
    return genericProviderClarification(pendingIntent);
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
        response: openingCommandHelp(knowledge, decision.sourceIds),
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
        const ambiguity = identifyNonlexicalOpeningReadExamineAmbiguity(
          decision.command,
          input.playerUtterance,
          knowledge,
        );
        if (ambiguity !== undefined) {
          return readExamineClarification(ambiguity);
        }
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
    const readExamineAmbiguity = lexicalGrounding.ok
      ? undefined
      : identifyNonlexicalOpeningReadExamineAmbiguity(
          {
            affordanceId: decision.affordanceId,
            slots: decision.slots,
          },
          input.playerUtterance,
          knowledge,
        );
    if (readExamineAmbiguity !== undefined) {
      return readExamineClarification(readExamineAmbiguity);
    }
    const semanticFallbackAllowed =
      !lexicalGrounding.ok &&
      semanticGrounding.semanticFallbackAllowed &&
      ((lexicalGrounding.code === "not-grounded-in-utterance" &&
        semanticGrounding.riskTier === 1) ||
        ((lexicalGrounding.code === "not-grounded-in-utterance" ||
          lexicalGrounding.code === "not-direct-action-request") &&
          semanticGrounding.riskTier === 2 &&
          semanticGrounding.ruleId === "grammar.examine" &&
          semanticGrounding.selectedObject !== undefined &&
          openingObjectObservationDirectlyRequested(
            semanticGrounding.selectedObject,
            input.playerUtterance,
            knowledge,
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
