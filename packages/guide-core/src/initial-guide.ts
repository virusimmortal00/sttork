import {
  createPendingOpeningContextualObjectActionChoiceIntent,
  createPendingOpeningContentObjectIntent,
  createPendingOpeningReadExamineChoiceIntent,
  createOpeningCommandKnowledge,
  groundOpeningCommand,
  groundPendingOpeningContextualObjectActionChoiceReply,
  groundPendingOpeningObjectReply,
  groundPendingOpeningReadExamineChoiceReply,
  identifyNonlexicalOpeningContentRequest,
  identifyNonlexicalOpeningReadExamineAmbiguity,
  identifyOpeningReadExamineClarificationChoice,
  inferPendingOpeningObjectIntent,
  isOpeningSceneProjection,
  isObservedWorldProjection,
  isPendingOpeningObjectIntent,
  openingActionOptionsRequested,
  openingCommandHelp,
  openingGlobalActionHelpScopeRequested,
  openingObjectActionMentioned,
  openingObjectObservationDirectlyRequested,
  openingObjectSelectionUniquelyMentioned,
  observedWorldCurrentEntity,
  observedWorldRecentEntity,
  openingReadExamineActionMentioned,
  openingSceneCurrentObjectLabels,
  openingScopedActionOptionsRequested,
  openingUtteranceMatchesObjectFocus,
  resolveOpeningSceneGuidance,
  resolveOpeningSceneFocusedObservationRequest,
  resolveOpeningSceneObjectActionSuggestion,
  resolvePendingOpeningContentObjectReply,
  resolveOpeningCommandComparisonQuestion,
  resolveOpeningCommandIntent,
  resolvePendingOpeningReadExamineChoiceObject,
  resolvePendingOpeningContextualObjectActionChoiceForScene,
  type OpeningCommandKnowledge,
  type OpeningObservedObjectOption,
  type OpeningSceneObjectActionSuggestion,
  type OpeningSceneProjection,
  type ObservedWorldProjection,
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
  readonly observedWorld?: ObservedWorldProjection;
}

export interface InitialGuideModelInput extends Omit<
  InitialGuideInput,
  "scene" | "observedWorld"
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

function contextualActionChoiceClarification(
  suggestion: OpeningSceneObjectActionSuggestion,
  style: "initial" | "options" = "initial",
): InitialGuideResult {
  const objectLabel = suggestion.selectedObject.label;
  const isReadExamineChoice =
    suggestion.suggestedActions[0] === "examine" &&
    suggestion.suggestedActions[1] === "read";
  const actionDescription = (action: string): string => {
    switch (action) {
      case "examine":
        return isReadExamineChoice
          ? "EXAMINE inspects it without taking it"
          : "EXAMINE inspects it without changing it";
      case "open":
        return "OPEN tries to open it";
      case "read":
        return "READ asks the game to read it and may take it";
      case "take":
        return "TAKE tries to take it";
      default:
        throw new TypeError("Unsupported contextual object action.");
    }
  };
  const initialActionPhrase = (action: string): string => {
    switch (action) {
      case "examine":
        return isReadExamineChoice
          ? `examine the ${objectLabel} without taking it`
          : `examine the ${objectLabel} without changing it`;
      case "open":
        return "try to open it";
      case "read":
        return "use READ, which may take it";
      case "take":
        return "try to take it";
      default:
        throw new TypeError("Unsupported contextual object action.");
    }
  };
  const [first, second] = suggestion.suggestedActions;
  const question =
    style === "initial"
      ? `Would you like me to ${initialActionPhrase(first)}, or ${initialActionPhrase(second)}?`
      : `For the ${objectLabel}, ${actionDescription(first)}; ${actionDescription(second)}. Which should I try?`;
  return clarification(
    question,
    isReadExamineChoice
      ? "The request could mean a non-taking EXAMINE action or the parser's READ action, which may implicitly take the object."
      : "The current scene offers two useful attempts, but neither is the only parser command the player may explicitly request.",
    createPendingOpeningContextualObjectActionChoiceIntent(
      suggestion.selectedObject,
      suggestion.suggestedActions,
    ),
    [`${first} ${objectLabel}`, `${second} ${objectLabel}`] as readonly [
      string,
      string,
    ],
  );
}

function contextualContentClarification(
  selectedObject: OpeningObservedObjectOption,
  scene: OpeningSceneProjection | undefined,
): InitialGuideResult {
  const suggestion =
    scene === undefined
      ? undefined
      : resolveOpeningSceneObjectActionSuggestion(scene, selectedObject.id);
  return suggestion === undefined
    ? clarification(
        `What single action would you like me to try with the ${selectedObject.label}?`,
        "The current scene does not provide two source-backed contextual suggestions for that object.",
      )
    : contextualActionChoiceClarification(suggestion);
}

function exactlyContextualSuggestionSources(
  sourceIds: readonly string[],
  suggestion: OpeningSceneObjectActionSuggestion,
): boolean {
  return (
    sourceIds.length === suggestion.suggestedActions.length &&
    suggestion.suggestedActions.every((action) =>
      sourceIds.includes(`grammar.${action}`),
    )
  );
}

function readExamineOptionsClarification(
  selectedObject: OpeningObservedObjectOption,
): InitialGuideResult {
  const objectLabel = selectedObject.label;
  return clarification(
    `For the ${objectLabel}, EXAMINE inspects it without taking it; READ asks the game to read it and may take it. Which should I try?`,
    "The active object has two distinct parser actions with different effects.",
    createPendingOpeningReadExamineChoiceIntent(selectedObject),
    [`examine ${objectLabel}`, `read ${objectLabel}`],
  );
}

function exactlyReadExamineSources(sourceIds: readonly string[]): boolean {
  return (
    sourceIds.length === 2 &&
    sourceIds.includes("grammar.examine") &&
    sourceIds.includes("grammar.read")
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

function objectScopedActionHelpTarget(
  utterance: string,
  knowledge: OpeningCommandKnowledge,
): OpeningObservedObjectOption | undefined {
  const normalized = utterance
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim();
  if (
    !/^(?:what can i (?:do|try)|what are my (?:options|choices)|what actions? (?:can i|could i) (?:do|try))(?: with| to| for| on| about) /u.test(
      normalized,
    )
  ) {
    return undefined;
  }
  const mentioned = knowledge.observedObjectOptions.filter((object) =>
    openingObjectSelectionUniquelyMentioned(object, utterance, knowledge),
  );
  return mentioned.length === 1 ? mentioned[0] : undefined;
}

function groundRecentObservedObjectReference(
  utterance: string,
  knowledge: OpeningCommandKnowledge,
  world: ObservedWorldProjection,
) {
  const recentEntity = observedWorldRecentEntity(world);
  if (
    recentEntity === undefined ||
    !world.currentObjects.includes(recentEntity.label) ||
    !/\bit\b/iu.test(utterance)
  ) {
    return undefined;
  }
  const resolvedUtterance = utterance.replace(
    /\bit\b/giu,
    `the ${recentEntity.label}`,
  );
  const grounding = groundOpeningCommand(
    resolvedUtterance.replace(/[.!?]+$/u, ""),
    resolvedUtterance,
    knowledge,
  );
  return grounding.ok ? { grounding, recentEntity } : undefined;
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
        openingSceneCurrentObjectLabels(input.scene).some(
          (object) => !knowledge.observedObjects.includes(object),
        ))
    ) {
      throw new TypeError(
        "Initial guide scene does not match current objects.",
      );
    }
    if (
      input.observedWorld !== undefined &&
      (!isObservedWorldProjection(input.observedWorld) ||
        JSON.stringify(input.observedWorld.currentObjects) !==
          JSON.stringify(input.observedObjects))
    ) {
      throw new TypeError(
        "Initial guide observed world does not match current objects.",
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

  const pendingReadExamineObject =
    input.pendingIntent !== undefined &&
    "kind" in input.pendingIntent &&
    input.pendingIntent.kind === "read-examine-choice"
      ? resolvePendingOpeningReadExamineChoiceObject(
          input.pendingIntent,
          knowledge,
        )
      : undefined;
  const pendingContextualSuggestion =
    input.pendingIntent !== undefined &&
    "kind" in input.pendingIntent &&
    input.pendingIntent.kind === "contextual-object-action-choice" &&
    input.scene !== undefined
      ? resolvePendingOpeningContextualObjectActionChoiceForScene(
          input.scene,
          input.pendingIntent,
        )
      : undefined;
  if (
    input.pendingIntent !== undefined &&
    "kind" in input.pendingIntent &&
    input.pendingIntent.kind === "read-examine-choice" &&
    pendingReadExamineObject === undefined
  ) {
    return clarification(
      "That object is no longer in the observed scene. What would you like to do instead?",
      "The pending READ-or-EXAMINE choice no longer has a currently observed object.",
    );
  }
  if (
    input.pendingIntent !== undefined &&
    "kind" in input.pendingIntent &&
    input.pendingIntent.kind === "contextual-object-action-choice" &&
    pendingContextualSuggestion === undefined
  ) {
    return clarification(
      "Those object suggestions are no longer current. What would you like to do instead?",
      "The pending object focus or its source-backed suggestion pair is no longer current.",
    );
  }

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
    if (
      pendingContextualSuggestion !== undefined &&
      exactlyContextualSuggestionSources(
        commandComparison.sourceIds,
        pendingContextualSuggestion,
      ) &&
      (!openingGlobalActionHelpScopeRequested(input.playerUtterance) ||
        openingObjectSelectionUniquelyMentioned(
          pendingContextualSuggestion.selectedObject,
          input.playerUtterance,
          knowledge,
        )) &&
      openingUtteranceMatchesObjectFocus(
        pendingContextualSuggestion.selectedObject,
        input.playerUtterance,
        knowledge,
      )
    ) {
      return contextualActionChoiceClarification(
        pendingContextualSuggestion,
        "options",
      );
    }
    if (
      input.pendingIntent !== undefined &&
      "kind" in input.pendingIntent &&
      input.pendingIntent.kind === "read-examine-choice" &&
      exactlyReadExamineSources(commandComparison.sourceIds) &&
      pendingReadExamineObject !== undefined &&
      (!openingGlobalActionHelpScopeRequested(input.playerUtterance) ||
        openingObjectSelectionUniquelyMentioned(
          pendingReadExamineObject,
          input.playerUtterance,
          knowledge,
        )) &&
      openingUtteranceMatchesObjectFocus(
        pendingReadExamineObject,
        input.playerUtterance,
        knowledge,
      )
    ) {
      return readExamineOptionsClarification(pendingReadExamineObject);
    }
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

  const localContentAmbiguity = identifyNonlexicalOpeningContentRequest(
    input.playerUtterance,
    knowledge,
  );

  if (
    appearsMultiStep(input.playerUtterance) &&
    localContentAmbiguity === undefined
  ) {
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

  if (input.observedWorld !== undefined && input.scene === undefined) {
    const directCommand = groundOpeningCommand(
      input.playerUtterance.replace(/[.!?]+$/u, ""),
      input.playerUtterance,
      knowledge,
    );
    if (directCommand.ok) {
      return {
        kind: "execute",
        command: directCommand.command,
        decision: {
          kind: "execute",
          command: directCommand.command,
          intentSummary:
            "Execute one explicit command against a source-backed current referent.",
          confidence: 1,
        },
        groundingSourceId: directCommand.ruleId,
      };
    }

    const recentReference = groundRecentObservedObjectReference(
      input.playerUtterance,
      knowledge,
      input.observedWorld,
    );
    if (recentReference !== undefined) {
      return {
        kind: "execute",
        command: recentReference.grounding.command,
        decision: {
          kind: "execute",
          command: recentReference.grounding.command,
          intentSummary: `Execute one explicit command against the recently focused ${recentReference.recentEntity.label}.`,
          confidence: 1,
        },
        groundingSourceId: recentReference.grounding.ruleId,
      };
    }

    const helpTarget = objectScopedActionHelpTarget(
      input.playerUtterance,
      knowledge,
    );
    const currentEntity =
      helpTarget === undefined
        ? undefined
        : observedWorldCurrentEntity(input.observedWorld, helpTarget.label);
    if (helpTarget !== undefined && currentEntity !== undefined) {
      return {
        kind: "explain",
        decision: {
          kind: "explain",
          response: `The game has shown the ${helpTarget.label} here. A safe first step is to EXAMINE it. If you have another action in mind, say it directly and the game will decide whether it works.`,
          basis: "command-help",
          sourceIds: ["grammar.examine", ...currentEntity.sourceEventIds],
        },
      };
    }
  }

  const focusedObservation =
    input.scene === undefined
      ? undefined
      : resolveOpeningSceneFocusedObservationRequest(
          input.playerUtterance,
          input.scene,
        );
  if (focusedObservation !== undefined) {
    return {
      kind: "execute",
      command: focusedObservation.command,
      decision: {
        kind: "execute",
        command: focusedObservation.command,
        intentSummary: `Inspect the recently focused ${focusedObservation.selectedObject.label} for the detail the player asked about.`,
        confidence: 1,
      },
      groundingSourceId: "grammar.examine",
    };
  }

  if (localContentAmbiguity !== undefined) {
    return contextualContentClarification(localContentAmbiguity, input.scene);
  }

  if (
    input.pendingIntent !== undefined &&
    "kind" in input.pendingIntent &&
    input.pendingIntent.kind === "read-examine-choice" &&
    openingScopedActionOptionsRequested(input.playerUtterance)
  ) {
    if (pendingReadExamineObject !== undefined) {
      return readExamineOptionsClarification(pendingReadExamineObject);
    }
  }
  if (
    pendingContextualSuggestion !== undefined &&
    openingScopedActionOptionsRequested(input.playerUtterance)
  ) {
    return contextualActionChoiceClarification(
      pendingContextualSuggestion,
      "options",
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
        return contextualContentClarification(
          contentObjectReply.selectedObject,
          input.scene,
        );
      }
    } else if (input.pendingIntent.kind === "contextual-object-action-choice") {
      const contextualReply =
        groundPendingOpeningContextualObjectActionChoiceReply(
          input.pendingIntent,
          input.playerUtterance,
          knowledge,
        );
      if (contextualReply.ok) {
        const decision = {
          kind: "execute" as const,
          command: contextualReply.command,
          intentSummary:
            "Apply the player's explicit action to the still-current focused object.",
          confidence: 1,
        };
        return {
          kind: "execute",
          command: contextualReply.command,
          decision,
          groundingSourceId: contextualReply.ruleId,
        };
      }
      if (contextualReply.code === "unobserved-object") {
        return clarification(
          "Those object suggestions are no longer current. What would you like to do instead?",
          "The pending object focus is no longer current.",
        );
      }
      if (
        contextualReply.code === "not-direct-action-request" &&
        openingObjectActionMentioned(input.playerUtterance)
      ) {
        return clarification(
          "Please state the single parser action you want me to try.",
          "A question, condition, or quoted command does not authorize the pending action.",
        );
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
        if (openingReadExamineActionMentioned(input.playerUtterance)) {
          return clarification(
            "Please choose READ or EXAMINE as a direct action.",
            "A question, condition, or quoted command does not authorize the pending action.",
          );
        }
      }
    }
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
    const {
      scene: _localScene,
      observedWorld: _localObservedWorld,
      ...modelInput
    } = input;
    void _localScene;
    void _localObservedWorld;
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
      return contextualContentClarification(
        deterministicAmbiguity,
        input.scene,
      );
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
    const contextualFocusMatches =
      pendingContextualSuggestion !== undefined &&
      (!openingGlobalActionHelpScopeRequested(input.playerUtterance) ||
        openingObjectSelectionUniquelyMentioned(
          pendingContextualSuggestion.selectedObject,
          input.playerUtterance,
          knowledge,
        )) &&
      openingUtteranceMatchesObjectFocus(
        pendingContextualSuggestion.selectedObject,
        input.playerUtterance,
        knowledge,
      );
    if (contextualFocusMatches) {
      return exactlyContextualSuggestionSources(
        decision.sourceIds,
        pendingContextualSuggestion,
      )
        ? contextualActionChoiceClarification(
            pendingContextualSuggestion,
            "options",
          )
        : genericProviderClarification();
    }
    if (
      input.pendingIntent !== undefined &&
      "kind" in input.pendingIntent &&
      input.pendingIntent.kind === "read-examine-choice" &&
      exactlyReadExamineSources(decision.sourceIds) &&
      pendingReadExamineObject !== undefined &&
      (!openingActionOptionsRequested(input.playerUtterance) ||
        openingScopedActionOptionsRequested(input.playerUtterance)) &&
      (!openingGlobalActionHelpScopeRequested(input.playerUtterance) ||
        openingObjectSelectionUniquelyMentioned(
          pendingReadExamineObject,
          input.playerUtterance,
          knowledge,
        )) &&
      openingUtteranceMatchesObjectFocus(
        pendingReadExamineObject,
        input.playerUtterance,
        knowledge,
      )
    ) {
      return readExamineOptionsClarification(pendingReadExamineObject);
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
          return contextualContentClarification(ambiguity, input.scene);
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
      return contextualContentClarification(readExamineAmbiguity, input.scene);
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
