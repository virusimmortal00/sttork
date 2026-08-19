import type {
  OpeningCommandIntent,
  OpeningCommandIntentSlot,
} from "../../command-knowledge/src/index.js";
import type { GuideDecision } from "../../contracts/src/index.js";

import {
  GuideDecisionValidationError,
  validateGuideDecision,
} from "./decision-validator.js";

type ExecuteDecision = Extract<GuideDecision, { readonly kind: "execute" }>;

export interface InitialGuideSemanticExecuteDecision extends OpeningCommandIntent {
  readonly kind: "execute";
  readonly intentSummary: string;
  readonly confidence: number;
}

export type InitialGuideModelDecision =
  | ExecuteDecision
  | InitialGuideSemanticExecuteDecision
  | Exclude<GuideDecision, ExecuteDecision>;

const semanticExecuteKeys = [
  "kind",
  "affordanceId",
  "slots",
  "intentSummary",
  "confidence",
] as const;

function boundedIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 160 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new GuideDecisionValidationError(
      "invalid-field",
      `${field} must be a bounded command-knowledge identifier.`,
    );
  }
  return value;
}

function validateIntentSlots(
  value: unknown,
): readonly OpeningCommandIntentSlot[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new GuideDecisionValidationError(
      "invalid-field",
      "slots must be a bounded command-intent slot array.",
    );
  }

  const seenSlotIds = new Set<string>();
  return value.map((slot) => {
    if (
      typeof slot !== "object" ||
      slot === null ||
      Array.isArray(slot) ||
      Object.keys(slot).length !== 2 ||
      !Object.hasOwn(slot, "slotId") ||
      !Object.hasOwn(slot, "valueId")
    ) {
      throw new GuideDecisionValidationError(
        "invalid-field",
        "Each command-intent slot must contain exactly slotId and valueId.",
      );
    }
    const slotId = boundedIdentifier(Reflect.get(slot, "slotId"), "slotId");
    const valueId = boundedIdentifier(Reflect.get(slot, "valueId"), "valueId");
    if (seenSlotIds.has(slotId)) {
      throw new GuideDecisionValidationError(
        "invalid-field",
        "Command-intent slot IDs must be unique.",
      );
    }
    seenSlotIds.add(slotId);
    return { slotId, valueId };
  });
}

export function validateInitialGuideModelDecision(
  input: unknown,
): InitialGuideModelDecision {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Reflect.get(input, "kind") !== "execute" ||
    !Object.hasOwn(input, "affordanceId")
  ) {
    return validateGuideDecision(input);
  }

  const actualKeys = Object.keys(input);
  if (
    actualKeys.length !== semanticExecuteKeys.length ||
    actualKeys.some(
      (key) => !(semanticExecuteKeys as readonly string[]).includes(key),
    )
  ) {
    throw new GuideDecisionValidationError(
      "unknown-field",
      "A semantic execute decision must contain exactly its intent fields.",
    );
  }

  const decision = validateGuideDecision({
    kind: "execute",
    command: "look",
    intentSummary: Reflect.get(input, "intentSummary"),
    confidence: Reflect.get(input, "confidence"),
  });
  if (decision.kind !== "execute") {
    throw new GuideDecisionValidationError(
      "invalid-field",
      "Only an execute proposal may select an affordance.",
    );
  }

  const affordanceId = boundedIdentifier(
    Reflect.get(input, "affordanceId"),
    "affordanceId",
  );
  const slots = validateIntentSlots(Reflect.get(input, "slots"));

  return {
    kind: "execute",
    affordanceId,
    slots,
    intentSummary: decision.intentSummary,
    confidence: decision.confidence,
  };
}
