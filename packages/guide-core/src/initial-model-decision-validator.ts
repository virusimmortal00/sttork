import type { GuideDecision } from "../../contracts/src/index.js";

import {
  GuideDecisionValidationError,
  validateGuideDecision,
} from "./decision-validator.js";

type ExecuteDecision = Extract<GuideDecision, { readonly kind: "execute" }>;

export type InitialGuideModelDecision =
  | (ExecuteDecision & { readonly affordanceId?: string })
  | Exclude<GuideDecision, ExecuteDecision>;

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

  const entries = Object.entries(input).filter(
    ([key]) => key !== "affordanceId",
  );
  const decision = validateGuideDecision(Object.fromEntries(entries));
  if (decision.kind !== "execute") {
    throw new GuideDecisionValidationError(
      "invalid-field",
      "Only an execute proposal may select an affordance.",
    );
  }

  const affordanceId = Reflect.get(input, "affordanceId") as unknown;
  if (
    typeof affordanceId !== "string" ||
    affordanceId.length === 0 ||
    affordanceId.length > 160 ||
    /\p{Cc}/u.test(affordanceId)
  ) {
    throw new GuideDecisionValidationError(
      "invalid-field",
      "affordanceId must be a bounded command-knowledge identifier.",
    );
  }

  return { ...decision, affordanceId };
}
