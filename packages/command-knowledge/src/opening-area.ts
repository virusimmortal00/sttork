import {
  canonicalizeCommand,
  type CanonicalCommand,
} from "../../contracts/src/index.js";

export const OPENING_AREA_KNOWLEDGE_VERSION = 7;
export const MAX_OBSERVED_OBJECTS = 32;
export const MAX_OBSERVED_OBJECT_LENGTH = 80;
export const OBSERVED_OBJECT_VALUE_ID_PREFIX = "observed-object:";
export const MAX_OBSERVED_OBJECT_VALUE_ID_LENGTH =
  OBSERVED_OBJECT_VALUE_ID_PREFIX.length + MAX_OBSERVED_OBJECT_LENGTH;
export const OPENING_OBJECT_SLOT_ID = "object";

export type OpeningCommandVerb =
  | "look"
  | "inventory"
  | "north"
  | "south"
  | "east"
  | "west"
  | "up"
  | "down"
  | "examine"
  | "open"
  | "read"
  | "take";

export type PendingOpeningObjectAction = "examine" | "open" | "read" | "take";

export interface PendingOpeningObjectActionIntent {
  readonly action: PendingOpeningObjectAction;
}

export interface PendingOpeningContentObjectIntent {
  readonly kind: "content-object";
}

export type PendingOpeningReadExamineAction = "examine" | "read";

export interface PendingOpeningReadExamineChoiceIntent {
  readonly kind: "read-examine-choice";
  readonly objectValueId: string;
  readonly allowedActions: readonly ["examine", "read"];
}

export type PendingOpeningObjectIntent =
  | PendingOpeningObjectActionIntent
  | PendingOpeningContentObjectIntent
  | PendingOpeningReadExamineChoiceIntent;

export interface OpeningObservedObjectOption {
  readonly id: string;
  readonly label: string;
}

export interface OpeningCommandSlotDefinition {
  readonly slotId: typeof OPENING_OBJECT_SLOT_ID;
  readonly allowedValueIds: readonly string[];
}

export interface OpeningCommandIntentSlot {
  readonly slotId: string;
  readonly valueId: string;
}

export interface OpeningCommandIntent {
  readonly affordanceId: string;
  readonly slots: readonly OpeningCommandIntentSlot[];
}

export interface OpeningCommandRule {
  readonly id: string;
  readonly verb: OpeningCommandVerb;
  readonly aliases: readonly string[];
  readonly objectRequired: boolean;
  readonly grammar: string;
  readonly semanticDescription: string;
  readonly riskTier: 1 | 2 | 3;
  readonly semanticFallbackAllowed: boolean;
  readonly slots: readonly OpeningCommandSlotDefinition[];
}

export interface OpeningCommandKnowledge {
  readonly version: typeof OPENING_AREA_KNOWLEDGE_VERSION;
  readonly rules: readonly OpeningCommandRule[];
  readonly observedObjects: readonly string[];
  readonly observedObjectOptions: readonly OpeningObservedObjectOption[];
  readonly sourceIds: readonly string[];
}

export type OpeningCommandComparisonResolution =
  | {
      readonly kind: "resolved";
      readonly sourceIds: readonly [string] | readonly [string, string];
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "not-comparison" };

export type CommandGroundingFailureCode =
  | "unsupported-grammar"
  | "missing-object"
  | "unobserved-object"
  | "not-grounded-in-utterance"
  | "not-direct-action-request"
  | "unknown-affordance"
  | "invalid-intent"
  | "missing-slot"
  | "unexpected-slot"
  | "unknown-slot-value";

export type CommandGroundingResult =
  | {
      readonly ok: true;
      readonly command: CanonicalCommand;
      readonly ruleId: string;
    }
  | {
      readonly ok: false;
      readonly code: CommandGroundingFailureCode;
    };

export type OpeningCommandIntentResolution =
  | {
      readonly ok: true;
      readonly command: CanonicalCommand;
      readonly ruleId: string;
      readonly riskTier: 1 | 2 | 3;
      readonly semanticFallbackAllowed: boolean;
      readonly selectedObject?: OpeningObservedObjectOption;
    }
  | {
      readonly ok: false;
      readonly code: CommandGroundingFailureCode;
    };

type OpeningCommandRuleTemplate = Omit<OpeningCommandRule, "slots">;

const RULES: readonly OpeningCommandRuleTemplate[] = [
  {
    id: "grammar.look",
    verb: "look",
    aliases: [
      "look",
      "look around",
      "what do i see around me",
      "what do i see in front of me",
    ],
    objectRequired: false,
    grammar: "look",
    semanticDescription:
      "Describe the player's current location and visible surroundings.",
    riskTier: 1,
    semanticFallbackAllowed: true,
  },
  {
    id: "grammar.inventory",
    verb: "inventory",
    aliases: ["inventory", "check inventory", "what am i carrying"],
    objectRequired: false,
    grammar: "inventory",
    semanticDescription: "List the possessions the player currently carries.",
    riskTier: 1,
    semanticFallbackAllowed: true,
  },
  ...(["north", "south", "east", "west", "up", "down"] as const).map(
    (direction): OpeningCommandRuleTemplate => ({
      id: `grammar.direction.${direction}`,
      verb: direction,
      aliases: [direction, `go ${direction}`, `head ${direction}`],
      objectRequired: false,
      grammar: direction,
      semanticDescription: `Move in the ${direction} direction.`,
      riskTier: 3,
      semanticFallbackAllowed: false,
    }),
  ),
  {
    id: "grammar.examine",
    verb: "examine",
    aliases: ["examine", "inspect", "look at", "x"],
    objectRequired: true,
    grammar: "examine <observed object>",
    semanticDescription:
      "Inspect one currently observed object without taking it, including its visible writing or content.",
    riskTier: 2,
    semanticFallbackAllowed: true,
  },
  {
    id: "grammar.open",
    verb: "open",
    aliases: ["open"],
    objectRequired: true,
    grammar: "open <observed object>",
    semanticDescription: "Open one currently observed object.",
    riskTier: 3,
    semanticFallbackAllowed: false,
  },
  {
    id: "grammar.read",
    verb: "read",
    aliases: ["read"],
    objectRequired: true,
    grammar: "read <observed object>",
    semanticDescription:
      "Invoke the parser's READ action on one currently observed object only when the player explicitly says read; this action may implicitly take the object.",
    riskTier: 3,
    semanticFallbackAllowed: false,
  },
  {
    id: "grammar.take",
    verb: "take",
    aliases: ["take", "get", "pick up"],
    objectRequired: true,
    grammar: "take <observed object>",
    semanticDescription: "Take one currently observed object.",
    riskTier: 3,
    semanticFallbackAllowed: false,
  },
];

function normalizeWords(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripArticle(value: string): string {
  return value.replace(/^(?:a|an|the)\s+/u, "");
}

function includesPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${phrase} `);
}

function appearsMultiStep(value: string): boolean {
  return /[;\n]|\b(?:and|or|then|after that|followed by)\b/iu.test(value);
}

function containsQuotedDiscussion(value: string): boolean {
  const trimmed = value.trimStart();
  return (
    (trimmed.length > 0 && !/^[\p{L}\p{N}]/u.test(trimmed)) ||
    /["“”«»‹›`()[\]{}「」『』〝〞＂]/u.test(value) ||
    /^\s*>/u.test(value) ||
    /(?:^|\s)'[^']+'(?:\s|$)/u.test(value) ||
    /‘[^’]+’/u.test(value)
  );
}

function containsConditionalOrExcludedTarget(value: string): boolean {
  return /\b(?:if|unless|except|without|rather than|but not|anything but|no|none|neither|not)\b/iu.test(
    value,
  );
}

function matchesDirectRuleRequest(
  value: string,
  rule: OpeningCommandRuleTemplate,
  object: string,
): boolean {
  const aliases = [rule.verb, ...rule.aliases].map(normalizeWords);
  const suffixes = ["", " please", " for me", " now"];
  const directMatch = aliases.some((alias) => {
    if (!rule.objectRequired) {
      return suffixes.some((suffix) => value === `${alias}${suffix}`);
    }
    if (!value.startsWith(`${alias} `)) return false;
    let argument = value.slice(alias.length + 1);
    for (const suffix of suffixes.slice(1)) {
      if (argument.endsWith(suffix)) {
        argument = argument.slice(0, -suffix.length);
        break;
      }
    }
    const unarticledArgument = stripArticle(argument);
    if (
      /^(?:about|regarding|concerning|word|phrase|command)\b/u.test(
        unarticledArgument,
      )
    ) {
      return false;
    }
    return [object, `the ${object}`, `a ${object}`, `an ${object}`].includes(
      argument,
    );
  });
  if (directMatch) return true;
  if (rule.verb !== "take") return false;
  return [object, `the ${object}`, `a ${object}`, `an ${object}`].some(
    (candidateObject) =>
      suffixes.some(
        (suffix) => value === `pick ${candidateObject} up${suffix}`,
      ),
  );
}

function directOpeningActionBody(playerUtterance: string): string | undefined {
  if (containsQuotedDiscussion(playerUtterance)) return undefined;
  const normalized = normalizeWords(playerUtterance).replace(
    /^(?:yes|okay|ok|sure)\s+/u,
    "",
  );
  if (containsConditionalOrExcludedTarget(normalized)) return undefined;

  const directSecondPerson =
    /^(?:(?:please|kindly) )?(?:can|could|would|will) you (?:(?:please|kindly) )?(.+)$/u.exec(
      normalized,
    );
  if (directSecondPerson?.[1] !== undefined) {
    return directSecondPerson[1];
  }

  const explicitDelegation =
    /^(?:i(?:'d| d| would) like|i (?:want|need)) you to (?:(?:please|kindly) )?(.+)$/u.exec(
      normalized,
    );
  if (explicitDelegation?.[1] !== undefined) {
    return explicitDelegation[1];
  }

  const firstPersonIntent =
    /^(?:i(?:'d| d| would) like to|i (?:want|need) to) (?:(?:please|kindly) )?(.+)$/u.exec(
      normalized,
    );
  if (firstPersonIntent?.[1] !== undefined) {
    return firstPersonIntent[1];
  }

  if (/\?/u.test(playerUtterance)) return undefined;
  const imperative = normalized.replace(
    /^(?:(?:please|kindly|now|just)\s+)+/u,
    "",
  );
  const collaborativeImperative = /^(?:let's|lets) (.+)$/u.exec(normalized);
  return collaborativeImperative?.[1] ?? imperative;
}

function directlyRequestsOpeningAction(
  playerUtterance: string,
  rule: OpeningCommandRuleTemplate,
  object: string,
): boolean {
  const withoutTakingSuffix = " without taking it";
  const normalizedUtterance = normalizeWords(playerUtterance);
  const qualifiedCandidate = normalizedUtterance.replace(
    /(?: please| for me| now)$/u,
    "",
  );
  const safelyQualifiedExamine =
    rule.verb === "examine" &&
    [object, `the ${object}`, `a ${object}`, `an ${object}`]
      .flatMap((reference) =>
        [rule.verb, ...rule.aliases].map(
          (alias) =>
            `${normalizeWords(alias)} ${reference}${withoutTakingSuffix}`,
        ),
      )
      .some((request) => qualifiedCandidate.endsWith(request));
  const actionUtterance = safelyQualifiedExamine
    ? playerUtterance.replace(
        /\s+without taking it(?=\s*,?\s*(?:(?:please|for me|now)\s*)?[?!.]?\s*$)/iu,
        "",
      )
    : playerUtterance;
  const actionBody = directOpeningActionBody(actionUtterance);
  return (
    actionBody !== undefined &&
    matchesDirectRuleRequest(actionBody, rule, object)
  );
}

const pendingObjectActions: readonly PendingOpeningObjectAction[] = [
  "examine",
  "open",
  "read",
  "take",
];

export const PENDING_OPENING_READ_EXAMINE_ACTIONS: readonly [
  "examine",
  "read",
] = Object.freeze(["examine", "read"]);

const pendingOpeningContentObjectIntent: PendingOpeningContentObjectIntent =
  Object.freeze({ kind: "content-object" });

function pendingIntentHasExactKeys(
  value: object,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => typeof key === "string" && expectedKeys.includes(key))
  );
}

function validPendingObjectValueId(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > MAX_OBSERVED_OBJECT_VALUE_ID_LENGTH ||
    !value.startsWith(OBSERVED_OBJECT_VALUE_ID_PREFIX)
  ) {
    return false;
  }
  const label = value.slice(OBSERVED_OBJECT_VALUE_ID_PREFIX.length);
  return (
    label.length > 0 &&
    label.length <= MAX_OBSERVED_OBJECT_LENGTH &&
    label === stripArticle(normalizeWords(label))
  );
}

function validPendingReadExamineActions(
  value: unknown,
): value is readonly ["examine", "read"] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "examine" &&
    value[1] === "read" &&
    Reflect.ownKeys(value).every((key) =>
      ["0", "1", "length"].includes(String(key)),
    )
  );
}

export function isPendingOpeningObjectIntent(
  value: unknown,
): value is PendingOpeningObjectIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (pendingIntentHasExactKeys(value, ["action"])) {
    return pendingObjectActions.includes(
      Reflect.get(value, "action") as PendingOpeningObjectAction,
    );
  }
  if (pendingIntentHasExactKeys(value, ["kind"])) {
    return Reflect.get(value, "kind") === "content-object";
  }
  return (
    pendingIntentHasExactKeys(value, [
      "kind",
      "objectValueId",
      "allowedActions",
    ]) &&
    Reflect.get(value, "kind") === "read-examine-choice" &&
    validPendingObjectValueId(Reflect.get(value, "objectValueId")) &&
    validPendingReadExamineActions(Reflect.get(value, "allowedActions"))
  );
}

export function createPendingOpeningContentObjectIntent(): PendingOpeningContentObjectIntent {
  return pendingOpeningContentObjectIntent;
}

export function createPendingOpeningReadExamineChoiceIntent(
  selectedObject: OpeningObservedObjectOption,
): PendingOpeningReadExamineChoiceIntent {
  if (
    typeof selectedObject !== "object" ||
    selectedObject === null ||
    !pendingIntentHasExactKeys(selectedObject, ["id", "label"]) ||
    !validPendingObjectValueId(selectedObject.id) ||
    selectedObject.id !==
      `${OBSERVED_OBJECT_VALUE_ID_PREFIX}${stripArticle(normalizeWords(selectedObject.label))}`
  ) {
    throw new TypeError(
      "Pending choice requires one canonical observed object.",
    );
  }
  return Object.freeze({
    kind: "read-examine-choice",
    objectValueId: selectedObject.id,
    allowedActions: PENDING_OPENING_READ_EXAMINE_ACTIONS,
  });
}

export function inferPendingOpeningObjectIntent(
  playerUtterance: string,
): PendingOpeningObjectIntent | undefined {
  const normalized = normalizeWords(playerUtterance);
  if (normalized.length === 0 || appearsMultiStep(playerUtterance)) {
    return undefined;
  }

  if (/^what does (?:the )?.+ say$/u.test(normalized)) {
    return createPendingOpeningContentObjectIntent();
  }

  const actions = new Set<PendingOpeningObjectAction>();
  if (/\bpick (?:it|that|this) up\b/u.test(normalized)) {
    actions.add("take");
  }
  for (const rule of RULES) {
    if (
      !rule.objectRequired ||
      !pendingObjectActions.includes(rule.verb as PendingOpeningObjectAction)
    ) {
      continue;
    }
    if (
      rule.aliases.some((alias) =>
        includesPhrase(normalized, normalizeWords(alias)),
      )
    ) {
      actions.add(rule.verb as PendingOpeningObjectAction);
    }
  }

  if (actions.size !== 1) return undefined;
  const action = [...actions][0]!;
  const rule = RULES.find((candidate) => candidate.verb === action);
  const directlyRequestsUnresolvedObject =
    rule !== undefined &&
    (["it", "this", "that"] as const).some((pronoun) =>
      directlyRequestsOpeningAction(playerUtterance, rule, pronoun),
    );
  if (
    !directlyRequestsUnresolvedObject &&
    !(action === "take" && /^pick (?:it|that|this) up$/u.test(normalized))
  ) {
    return undefined;
  }
  return Object.freeze({ action });
}

export function groundPendingOpeningObjectReply(
  intent: PendingOpeningObjectIntent,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  if (!isPendingOpeningObjectIntent(intent) || !("action" in intent)) {
    return { ok: false, code: "unsupported-grammar" };
  }
  const object = stripArticle(normalizeWords(playerUtterance));
  if (object.length === 0 || !knowledge.observedObjects.includes(object)) {
    return { ok: false, code: "unobserved-object" };
  }
  return {
    ok: true,
    command: canonicalizeCommand(`${intent.action} ${object}`),
    ruleId: `grammar.${intent.action}`,
  };
}

export type PendingOpeningContentObjectReplyResolution =
  | {
      readonly ok: true;
      readonly selectedObject: OpeningObservedObjectOption;
    }
  | {
      readonly ok: false;
      readonly code: CommandGroundingFailureCode;
    };

export function resolvePendingOpeningContentObjectReply(
  intent: PendingOpeningObjectIntent,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): PendingOpeningContentObjectReplyResolution {
  if (
    !isPendingOpeningObjectIntent(intent) ||
    !("kind" in intent) ||
    intent.kind !== "content-object"
  ) {
    return { ok: false, code: "unsupported-grammar" };
  }
  if (appearsMultiStep(playerUtterance)) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }
  const object = stripArticle(normalizeWords(playerUtterance));
  const selectedObject = knowledge.observedObjectOptions.find(
    (option) => option.label === object,
  );
  if (selectedObject === undefined) {
    return { ok: false, code: "unobserved-object" };
  }
  return { ok: true, selectedObject };
}

export function groundPendingOpeningReadExamineChoiceReply(
  intent: PendingOpeningObjectIntent,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  if (
    !isPendingOpeningObjectIntent(intent) ||
    !("kind" in intent) ||
    intent.kind !== "read-examine-choice"
  ) {
    return { ok: false, code: "unsupported-grammar" };
  }
  if (appearsMultiStep(playerUtterance)) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }

  const selectedObject = knowledge.observedObjectOptions.find(
    (option) => option.id === intent.objectValueId,
  );
  if (selectedObject === undefined) {
    return { ok: false, code: "unobserved-object" };
  }

  const actionBody = directOpeningActionBody(playerUtterance);
  const bareSuffixes = ["", " please", " for me", " now"];
  const matchingActions = intent.allowedActions.filter((action) => {
    const rule = RULES.find((candidate) => candidate.verb === action);
    return (
      rule !== undefined &&
      ((actionBody !== undefined &&
        bareSuffixes.some((suffix) => actionBody === `${action}${suffix}`)) ||
        [selectedObject.label, "it", "this", "that"].some((reference) =>
          directlyRequestsOpeningAction(playerUtterance, rule, reference),
        ))
    );
  });
  if (matchingActions.length !== 1) {
    return {
      ok: false,
      code:
        actionBody === undefined
          ? "not-direct-action-request"
          : "not-grounded-in-utterance",
    };
  }
  const action = matchingActions[0] as PendingOpeningReadExamineAction;
  return {
    ok: true,
    command: canonicalizeCommand(`${action} ${selectedObject.label}`),
    ruleId: `grammar.${action}`,
  };
}

export function createOpeningCommandKnowledge(input: {
  readonly observedObjects: readonly string[];
}): OpeningCommandKnowledge {
  if (input.observedObjects.length > MAX_OBSERVED_OBJECTS) {
    throw new RangeError(
      `Opening command knowledge accepts at most ${MAX_OBSERVED_OBJECTS} observed objects.`,
    );
  }
  const observedObjects = [
    ...new Set(
      input.observedObjects
        .map((object) => {
          if (
            typeof object !== "string" ||
            object.length > MAX_OBSERVED_OBJECT_LENGTH ||
            /\p{Cc}/u.test(object)
          ) {
            throw new TypeError(
              "Observed object names must be bounded strings.",
            );
          }
          const normalized = stripArticle(normalizeWords(object));
          if (normalized.length > MAX_OBSERVED_OBJECT_LENGTH) {
            throw new TypeError(
              "Normalized observed object names must remain bounded.",
            );
          }
          return normalized;
        })
        .filter((object) => object.length > 0),
    ),
  ].sort();

  const observedObjectOptions = observedObjects.map((label) =>
    Object.freeze({
      id: `${OBSERVED_OBJECT_VALUE_ID_PREFIX}${label}`,
      label,
    }),
  );
  const allowedObjectValueIds = Object.freeze(
    observedObjectOptions.map((option) => option.id),
  );
  const rules = RULES.map((rule) => {
    const slots: readonly OpeningCommandSlotDefinition[] = rule.objectRequired
      ? Object.freeze([
          Object.freeze({
            slotId: OPENING_OBJECT_SLOT_ID,
            allowedValueIds: allowedObjectValueIds,
          }),
        ])
      : Object.freeze([]);
    return Object.freeze({
      ...rule,
      aliases: Object.freeze([...rule.aliases]),
      slots,
    });
  });
  return Object.freeze({
    version: OPENING_AREA_KNOWLEDGE_VERSION,
    rules: Object.freeze(rules),
    observedObjects: Object.freeze(observedObjects),
    observedObjectOptions: Object.freeze(observedObjectOptions),
    sourceIds: Object.freeze(RULES.map((rule) => rule.id)),
  });
}

function findRule(command: string): {
  readonly rule: OpeningCommandRuleTemplate;
  readonly object: string;
} | null {
  for (const rule of RULES) {
    const commandAliases = [rule.verb, ...rule.aliases]
      .map(normalizeWords)
      .sort((left, right) => right.length - left.length);
    for (const alias of commandAliases) {
      if (command === alias && !rule.objectRequired) {
        return { rule, object: "" };
      }
      if (rule.objectRequired && command.startsWith(`${alias} `)) {
        return {
          rule,
          object: stripArticle(command.slice(alias.length + 1)),
        };
      }
    }
  }
  return null;
}

function compileParsedOpeningCommand(
  parsed: NonNullable<ReturnType<typeof findRule>>,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  if (!parsed.rule.objectRequired) {
    return {
      ok: true,
      command: canonicalizeCommand(parsed.rule.verb),
      ruleId: parsed.rule.id,
    };
  }
  if (parsed.object.length === 0) {
    return { ok: false, code: "missing-object" };
  }
  if (!knowledge.observedObjects.includes(parsed.object)) {
    return { ok: false, code: "unobserved-object" };
  }
  return {
    ok: true,
    command: canonicalizeCommand(`${parsed.rule.verb} ${parsed.object}`),
    ruleId: parsed.rule.id,
  };
}

function exactObjectKeys(
  value: object,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => typeof key === "string" && expectedKeys.includes(key))
  );
}

function validIntentIdentifier(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/\p{Cc}/u.test(value)
  );
}

export function resolveOpeningCommandIntent(
  intent: unknown,
  knowledge: OpeningCommandKnowledge,
): OpeningCommandIntentResolution {
  if (
    typeof intent !== "object" ||
    intent === null ||
    Array.isArray(intent) ||
    !exactObjectKeys(intent, ["affordanceId", "slots"])
  ) {
    return { ok: false, code: "invalid-intent" };
  }
  const affordanceId = Reflect.get(intent, "affordanceId") as unknown;
  const slots = Reflect.get(intent, "slots") as unknown;
  if (!validIntentIdentifier(affordanceId, 160) || !Array.isArray(slots)) {
    return { ok: false, code: "invalid-intent" };
  }

  const rulePolicy = RULES.find((rule) => rule.id === affordanceId);
  const selectedRule = knowledge.rules.find((rule) => rule.id === affordanceId);
  if (
    rulePolicy === undefined ||
    selectedRule === undefined ||
    !knowledge.sourceIds.includes(rulePolicy.id)
  ) {
    return { ok: false, code: "unknown-affordance" };
  }

  if (!rulePolicy.objectRequired) {
    if (slots.length !== 0) {
      return { ok: false, code: "unexpected-slot" };
    }
    return {
      ok: true,
      command: canonicalizeCommand(rulePolicy.verb),
      ruleId: rulePolicy.id,
      riskTier: rulePolicy.riskTier,
      semanticFallbackAllowed: rulePolicy.semanticFallbackAllowed,
    };
  }

  if (slots.length === 0) {
    return { ok: false, code: "missing-slot" };
  }
  if (slots.length > 1) {
    return { ok: false, code: "unexpected-slot" };
  }
  const slot = slots[0];
  if (
    typeof slot !== "object" ||
    slot === null ||
    Array.isArray(slot) ||
    !exactObjectKeys(slot, ["slotId", "valueId"])
  ) {
    return { ok: false, code: "unexpected-slot" };
  }
  const slotId = Reflect.get(slot, "slotId") as unknown;
  const valueId = Reflect.get(slot, "valueId") as unknown;
  const definition = selectedRule.slots[0];
  if (
    selectedRule.slots.length !== 1 ||
    definition === undefined ||
    slotId !== definition.slotId
  ) {
    return { ok: false, code: "unexpected-slot" };
  }
  if (
    !validIntentIdentifier(valueId, MAX_OBSERVED_OBJECT_VALUE_ID_LENGTH) ||
    !definition.allowedValueIds.includes(valueId)
  ) {
    return { ok: false, code: "unknown-slot-value" };
  }
  const selectedObject = knowledge.observedObjectOptions.find(
    (option) => option.id === valueId,
  );
  if (selectedObject === undefined) {
    return { ok: false, code: "unknown-slot-value" };
  }

  return {
    ok: true,
    command: canonicalizeCommand(`${rulePolicy.verb} ${selectedObject.label}`),
    ruleId: rulePolicy.id,
    riskTier: rulePolicy.riskTier,
    semanticFallbackAllowed: rulePolicy.semanticFallbackAllowed,
    selectedObject,
  };
}

export function openingObjectSelectionMentioned(
  selectedObject: OpeningObservedObjectOption,
  playerUtterance: string,
): boolean {
  if (
    typeof selectedObject !== "object" ||
    selectedObject === null ||
    !exactObjectKeys(selectedObject, ["id", "label"]) ||
    !validIntentIdentifier(
      selectedObject.id,
      MAX_OBSERVED_OBJECT_VALUE_ID_LENGTH,
    ) ||
    typeof selectedObject.label !== "string" ||
    typeof playerUtterance !== "string"
  ) {
    return false;
  }
  const label = stripArticle(normalizeWords(selectedObject.label));
  return (
    label.length > 0 && includesPhrase(normalizeWords(playerUtterance), label)
  );
}

function hasVisibleContentCue(playerUtterance: string): boolean {
  const normalized = normalizeWords(playerUtterance);
  return (
    /\b(?:say|says|written|writing|words|text|contents?|contain(?:s|ed|ing)?|information|inscription|printed)\b/u.test(
      normalized,
    ) ||
    /\bwhat(?:'s| s| is) (?:in|inside|on) (?:a |an |the )?.+$/u.test(normalized)
  );
}

function mentionedOpeningObjects(
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): readonly OpeningObservedObjectOption[] {
  const normalizedUtterance = ` ${normalizeWords(playerUtterance)} `;
  const mentions = knowledge.observedObjectOptions.flatMap((option) => {
    const label = stripArticle(normalizeWords(option.label));
    if (label.length === 0) return [];
    const needle = ` ${label} `;
    const spans: { readonly start: number; readonly end: number }[] = [];
    let offset = 0;
    while (offset < normalizedUtterance.length) {
      const start = normalizedUtterance.indexOf(needle, offset);
      if (start < 0) break;
      spans.push({ start, end: start + needle.length });
      offset = start + 1;
    }
    return spans.map((span) => ({ option, label, ...span }));
  });

  const unshadowedIds = new Set(
    mentions
      .filter(
        (mention) =>
          !mentions.some(
            (other) =>
              other.option.id !== mention.option.id &&
              other.label.length > mention.label.length &&
              other.start <= mention.start &&
              other.end >= mention.end,
          ),
      )
      .map((mention) => mention.option.id),
  );
  return knowledge.observedObjectOptions.filter((option) =>
    unshadowedIds.has(option.id),
  );
}

export function openingObjectSelectionUniquelyMentioned(
  selectedObject: OpeningObservedObjectOption,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): boolean {
  const mentionedObjects = mentionedOpeningObjects(playerUtterance, knowledge);
  return (
    mentionedObjects.length === 1 &&
    mentionedObjects[0]?.id === selectedObject.id
  );
}

export function openingObjectObservationDirectlyRequested(
  selectedObject: OpeningObservedObjectOption,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): boolean {
  if (
    !openingObjectSelectionUniquelyMentioned(
      selectedObject,
      playerUtterance,
      knowledge,
    ) ||
    containsQuotedDiscussion(playerUtterance) ||
    containsConditionalOrExcludedTarget(playerUtterance) ||
    appearsMultiStep(playerUtterance)
  ) {
    return false;
  }

  const normalized = normalizeWords(playerUtterance);
  const directActionBody = directOpeningActionBody(playerUtterance);
  const examineRule = RULES.find((rule) => rule.id === "grammar.examine");
  if (
    directActionBody !== undefined &&
    examineRule !== undefined &&
    [examineRule.verb, ...examineRule.aliases]
      .map(normalizeWords)
      .some(
        (alias) =>
          directActionBody === alias ||
          directActionBody.startsWith(`${alias} `),
      )
  ) {
    return directlyRequestsOpeningAction(
      playerUtterance,
      examineRule,
      selectedObject.label,
    );
  }

  const objectForms = [
    selectedObject.label,
    `the ${selectedObject.label}`,
    `a ${selectedObject.label}`,
    `an ${selectedObject.label}`,
  ].map(normalizeWords);
  const questionFrames = objectForms.flatMap((object) => [
    `what does ${object} look like`,
    `what is ${object} like`,
    `what's ${object} like`,
    `how does ${object} look`,
    `how does ${object} appear`,
    `what can you tell me about ${object}`,
    `what could you tell me about ${object}`,
    `what details can you give me about ${object}`,
    `how would you describe ${object}`,
    `what can i see on ${object}`,
  ]);
  if (questionFrames.includes(normalized)) return true;

  if (directActionBody !== undefined) {
    let boundedBody = directActionBody;
    for (const suffix of [" please", " for me", " now"] as const) {
      if (boundedBody.endsWith(suffix)) {
        boundedBody = boundedBody.slice(0, -suffix.length);
        break;
      }
    }
    const directFrames = objectForms.flatMap((object) => [
      `look at ${object}`,
      `look closely at ${object}`,
      `look more closely at ${object}`,
      `look closer at ${object}`,
      `look over ${object}`,
      `take a look at ${object}`,
      `take a closer look at ${object}`,
      `take a good look at ${object}`,
      `get a closer look at ${object}`,
      `get a better look at ${object}`,
      `have a look at ${object}`,
      `have a closer look at ${object}`,
      `check out ${object}`,
      `check ${object} out`,
      `see what ${object} looks like`,
      `examine ${object}`,
      `inspect ${object}`,
      `observe ${object}`,
      `view ${object}`,
      `study ${object}`,
      `describe ${object}`,
      `show me ${object}`,
      `show me what ${object} looks like`,
      `tell me about ${object}`,
      `tell me more about ${object}`,
      `tell me what ${object} looks like`,
      `tell me what you see on ${object}`,
      `give me a description of ${object}`,
      `give me details about ${object}`,
      `know more about ${object}`,
    ]);
    if (directFrames.includes(boundedBody)) return true;
  }
  return false;
}

function hasExplicitOpeningCommand(
  playerUtterance: string,
  selectedObject: OpeningObservedObjectOption,
  knowledge: OpeningCommandKnowledge,
): boolean {
  if (!openingObjectSelectionMentioned(selectedObject, playerUtterance)) {
    return false;
  }
  const actionBody = directOpeningActionBody(playerUtterance);
  if (actionBody === undefined) return false;
  return knowledge.rules.some((rule) =>
    [rule.verb, ...rule.aliases]
      .map(normalizeWords)
      .some(
        (alias) => actionBody === alias || actionBody.startsWith(`${alias} `),
      ),
  );
}

export function identifyNonlexicalOpeningContentRequest(
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): OpeningObservedObjectOption | undefined {
  if (
    typeof playerUtterance !== "string" ||
    appearsMultiStep(playerUtterance) ||
    !hasVisibleContentCue(playerUtterance)
  ) {
    return undefined;
  }
  const mentionedObjects = mentionedOpeningObjects(playerUtterance, knowledge);
  if (mentionedObjects.length !== 1) return undefined;
  const selectedObject = mentionedObjects[0]!;
  if (hasExplicitOpeningCommand(playerUtterance, selectedObject, knowledge)) {
    return undefined;
  }
  return selectedObject;
}

export function identifyOpeningReadExamineClarificationChoice(
  choices: unknown,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): OpeningObservedObjectOption | undefined {
  if (
    !Array.isArray(choices) ||
    choices.length !== 2 ||
    choices.some(
      (choice) => typeof choice !== "string" || /\p{Cc}/u.test(choice),
    )
  ) {
    return undefined;
  }

  const parsed = choices.map((choice) => {
    const normalizedChoice = normalizeWords(choice);
    const match = /^(examine|read) (?:a |an |the )?(.+)$/u.exec(
      normalizedChoice,
    );
    const action = match?.[1];
    const object = match?.[2];
    if ((action !== "examine" && action !== "read") || object === undefined) {
      return undefined;
    }
    for (const option of knowledge.observedObjectOptions) {
      if (object === option.label) {
        return { action, option };
      }
    }
    return undefined;
  });
  const first = parsed[0];
  const second = parsed[1];
  if (
    first === undefined ||
    second === undefined ||
    first.action === second.action ||
    first.option.id !== second.option.id
  ) {
    return undefined;
  }
  const mentionedObjects = mentionedOpeningObjects(playerUtterance, knowledge);
  if (
    mentionedObjects.length !== 1 ||
    mentionedObjects[0]?.id !== first.option.id
  ) {
    return undefined;
  }
  return first.option;
}

function resolveReadExamineAmbiguityCandidate(
  proposal: unknown,
  knowledge: OpeningCommandKnowledge,
):
  | {
      readonly command: CanonicalCommand;
      readonly ruleId: "grammar.examine" | "grammar.read";
      readonly selectedObject: OpeningObservedObjectOption;
    }
  | undefined {
  if (typeof proposal === "string") {
    let grounding: CommandGroundingResult;
    try {
      grounding = groundOpeningCommand(proposal, proposal, knowledge);
    } catch {
      return undefined;
    }
    if (
      !grounding.ok ||
      (grounding.ruleId !== "grammar.read" &&
        grounding.ruleId !== "grammar.examine")
    ) {
      return undefined;
    }
    const selectedObject = knowledge.observedObjectOptions.find(
      (option) =>
        grounding.command ===
        `${grounding.ruleId === "grammar.read" ? "read" : "examine"} ${option.label}`,
    );
    if (selectedObject === undefined) return undefined;
    return {
      command: grounding.command,
      ruleId: grounding.ruleId,
      selectedObject,
    };
  }

  const resolution = resolveOpeningCommandIntent(proposal, knowledge);
  if (
    !resolution.ok ||
    (resolution.ruleId !== "grammar.read" &&
      resolution.ruleId !== "grammar.examine") ||
    resolution.selectedObject === undefined
  ) {
    return undefined;
  }
  return {
    command: resolution.command,
    ruleId: resolution.ruleId,
    selectedObject: resolution.selectedObject,
  };
}

export function identifyNonlexicalOpeningReadExamineAmbiguity(
  proposal: unknown,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): OpeningObservedObjectOption | undefined {
  const candidate = resolveReadExamineAmbiguityCandidate(proposal, knowledge);
  if (candidate === undefined) return undefined;

  const lexicalGrounding = groundOpeningCommand(
    candidate.command,
    playerUtterance,
    knowledge,
  );
  const mentionedObjects = mentionedOpeningObjects(playerUtterance, knowledge);
  if (
    lexicalGrounding.ok ||
    lexicalGrounding.code !== "not-grounded-in-utterance" ||
    mentionedObjects.length !== 1 ||
    mentionedObjects[0]?.id !== candidate.selectedObject.id ||
    (candidate.ruleId === "grammar.examine" &&
      !hasVisibleContentCue(playerUtterance))
  ) {
    return undefined;
  }

  return candidate.selectedObject;
}

export function identifyNonlexicalOpeningReadAmbiguity(
  proposal: unknown,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): OpeningObservedObjectOption | undefined {
  if (
    resolveReadExamineAmbiguityCandidate(proposal, knowledge)?.ruleId !==
    "grammar.read"
  ) {
    return undefined;
  }
  return identifyNonlexicalOpeningReadExamineAmbiguity(
    proposal,
    playerUtterance,
    knowledge,
  );
}

export function groundOpeningCommand(
  proposedCommand: unknown,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  const candidate = canonicalizeCommand(proposedCommand);
  const normalizedCommand = normalizeWords(candidate);
  const parsed = findRule(normalizedCommand);
  if (parsed === null) {
    return { ok: false, code: "unsupported-grammar" };
  }

  const normalizedUtterance = normalizeWords(playerUtterance);
  const mentionsIntent =
    parsed.rule.aliases.some((alias) =>
      includesPhrase(normalizedUtterance, normalizeWords(alias)),
    ) ||
    (parsed.rule.verb === "take" &&
      /\bpick .+ up\b/u.test(normalizedUtterance) &&
      includesPhrase(normalizedUtterance, parsed.object));
  if (!mentionsIntent) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }
  if (
    (parsed.rule.riskTier === 3 || parsed.rule.id === "grammar.examine") &&
    !directlyRequestsOpeningAction(playerUtterance, parsed.rule, parsed.object)
  ) {
    return { ok: false, code: "not-direct-action-request" };
  }

  const compiled = compileParsedOpeningCommand(parsed, knowledge);
  if (!compiled.ok) return compiled;
  if (
    parsed.rule.objectRequired &&
    !includesPhrase(normalizedUtterance, parsed.object)
  ) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }
  return compiled;
}

export function groundObservedObjectContentQuestion(
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  if (appearsMultiStep(playerUtterance)) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }

  const match = /^what does (?:the )?(.+) say$/u.exec(
    normalizeWords(playerUtterance),
  );
  const object = match?.[1];
  if (object === undefined || object.length === 0) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }
  if (!knowledge.observedObjects.includes(object)) {
    return { ok: false, code: "unobserved-object" };
  }

  return {
    ok: true,
    command: canonicalizeCommand(`examine ${object}`),
    ruleId: "grammar.examine",
  };
}

const twoCommandMetaQuestionPatterns: readonly RegExp[] = [
  /^(?:what(?:'s| is) (?:the )?difference between|explain (?:the )?difference between) (\p{L}+) and (\p{L}+)$/u,
  /^(?:the )?difference between (\p{L}+) and (\p{L}+)$/u,
  /^how (?:exactly )?(?:do|does) (\p{L}+) and (\p{L}+) differ$/u,
  /^how (?:exactly )?(?:do|does) (\p{L}+) differ from (\p{L}+)$/u,
  /^compare (\p{L}+) (?:and|with|to|versus|vs) (\p{L}+)$/u,
  /^(\p{L}+) (?:versus|vs) (\p{L}+)$/u,
  /^should i (\p{L}+) or (\p{L}+)(?: (?:the )?(.+))?$/u,
  /^is (\p{L}+) (?:safer|better|worse|more useful|less risky) than (\p{L}+)(?: (?:for|with) (?:the )?(.+))?$/u,
  /^is (\p{L}+) different from (\p{L}+)(?: (?:for|with) (?:the )?(.+))?$/u,
];

interface ParsedOpeningCommandMetaQuestion {
  readonly verbs: readonly [string] | readonly [string, string];
  readonly target?: string;
}

function parseOpeningCommandMetaQuestion(
  normalized: string,
): ParsedOpeningCommandMetaQuestion | undefined {
  const unwrapped = normalized.replace(
    /^(?:(?:(?:can|could|would|will) you|please) )?(?:(?:please )?(?:tell|explain) me) /u,
    "",
  );
  for (const pattern of twoCommandMetaQuestionPatterns) {
    const match = pattern.exec(unwrapped);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return {
        verbs: [match[1], match[2]],
        ...(match[3] === undefined ? {} : { target: match[3] }),
      };
    }
  }

  const insteadOf =
    /^should i (\p{L}+) (?:the )?(.+) instead of (\p{L}+) (?:it|that|this|them|those|these)$/u.exec(
      normalized,
    );
  if (
    insteadOf?.[1] !== undefined &&
    insteadOf[2] !== undefined &&
    insteadOf[3] !== undefined
  ) {
    return {
      verbs: [insteadOf[1], insteadOf[3]],
      target: insteadOf[2],
    };
  }

  const singleCommandPatterns: readonly RegExp[] = [
    /^what does (\p{L}+) do(?: (?:with|to) (?:the )?(.+))?$/u,
    /^does (\p{L}+) (?:implicitly )?(?:take|move|open|change|affect) (?:the )?(.+)$/u,
    /^(?:should|can|could) i (\p{L}+)(?: (?:the )?(.+))?$/u,
    /^would it be (?:safer|better|worse) to (\p{L}+)(?: (?:the )?(.+))?$/u,
    /^what would happen if i (\p{L}+)(?: (?:the )?(.+))?$/u,
  ];
  for (const pattern of singleCommandPatterns) {
    const match = pattern.exec(normalized);
    if (match?.[1] !== undefined) {
      return {
        verbs: [match[1]],
        ...(match[2] === undefined ? {} : { target: match[2] }),
      };
    }
  }
  return undefined;
}

const inflectedCommandVerbs: Readonly<Record<string, OpeningCommandVerb>> = {
  examining: "examine",
  looking: "look",
  opening: "open",
  reading: "read",
  taking: "take",
};

function resolveMetaCommandRule(
  verb: string,
  knowledge: OpeningCommandKnowledge,
): OpeningCommandRule | undefined {
  const canonicalVerb = inflectedCommandVerbs[verb] ?? verb;
  return knowledge.rules.find(
    (rule) =>
      rule.verb === canonicalVerb ||
      rule.aliases.some(
        (alias) => normalizeWords(alias) === normalizeWords(canonicalVerb),
      ),
  );
}

function validMetaQuestionTarget(
  target: string | undefined,
  knowledge: OpeningCommandKnowledge,
): boolean {
  if (target === undefined) return true;
  const normalizedTarget = stripArticle(normalizeWords(target));
  return (
    /^(?:it|that|this|them|those|these)$/u.test(normalizedTarget) ||
    knowledge.observedObjects.includes(normalizedTarget)
  );
}

function mentionedMetaCommandSourceIds(
  normalized: string,
  knowledge: OpeningCommandKnowledge,
): readonly string[] {
  return knowledge.rules
    .filter((rule) =>
      [rule.verb, ...rule.aliases].some((alias) =>
        includesPhrase(normalized, normalizeWords(alias)),
      ),
    )
    .map((rule) => rule.id);
}

export function resolveOpeningCommandComparisonQuestion(
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): OpeningCommandComparisonResolution {
  const normalized = normalizeWords(playerUtterance);
  if (
    !/\b(?:difference|differ|compare|versus|vs)\b/u.test(normalized) &&
    !/^(?:should|can|could) i\b/u.test(normalized) &&
    !/^what does \p{L}+ do\b/u.test(normalized) &&
    !/^does \p{L}+ (?:implicitly )?(?:take|move|open|change|affect)\b/u.test(
      normalized,
    ) &&
    !/^is \p{L}+ (?:safer|better|worse|more useful|less risky) than\b/u.test(
      normalized,
    ) &&
    !/^is \p{L}+ different from\b/u.test(normalized) &&
    !/^would it be (?:safer|better|worse) to\b/u.test(normalized) &&
    !/^what would happen if i\b/u.test(normalized)
  ) {
    return { kind: "not-comparison" };
  }
  if (/[;\n]|\b(?:then|after that|followed by)\b/iu.test(playerUtterance)) {
    return { kind: "invalid" };
  }

  const parsed = parseOpeningCommandMetaQuestion(normalized);
  if (parsed === undefined) {
    const mentionedSourceIds = mentionedMetaCommandSourceIds(
      normalized,
      knowledge,
    );
    const pairQuestion = /\b(?:difference|differ|compare|versus|vs)\b/u.test(
      normalized,
    );
    if (
      mentionedSourceIds.length === (pairQuestion ? 2 : 1) ||
      (!pairQuestion && mentionedSourceIds.length === 2)
    ) {
      return mentionedSourceIds.length === 1
        ? { kind: "resolved", sourceIds: [mentionedSourceIds[0]!] }
        : {
            kind: "resolved",
            sourceIds: [mentionedSourceIds[0]!, mentionedSourceIds[1]!],
          };
    }
    return { kind: "invalid" };
  }
  if (!validMetaQuestionTarget(parsed.target, knowledge)) {
    return { kind: "invalid" };
  }

  const selectedRules = parsed.verbs.map((verb) =>
    resolveMetaCommandRule(verb, knowledge),
  );
  if (selectedRules.some((rule) => rule === undefined)) {
    return { kind: "invalid" };
  }

  const selectedIds = new Set(selectedRules.map((rule) => rule!.id));
  if (selectedIds.size !== parsed.verbs.length) {
    return { kind: "invalid" };
  }
  const sourceIds = knowledge.rules
    .filter((rule) => selectedIds.has(rule.id))
    .map((rule) => rule.id);
  if (sourceIds.length !== parsed.verbs.length) {
    return { kind: "invalid" };
  }
  return sourceIds.length === 1
    ? { kind: "resolved", sourceIds: [sourceIds[0]!] }
    : {
        kind: "resolved",
        sourceIds: [sourceIds[0]!, sourceIds[1]!],
      };
}

export function openingCommandHelp(
  knowledge: OpeningCommandKnowledge,
  sourceIds?: readonly string[],
): string {
  if (sourceIds !== undefined) {
    if (
      sourceIds.length === 0 ||
      sourceIds.some(
        (sourceId) =>
          typeof sourceId !== "string" ||
          !knowledge.sourceIds.includes(sourceId),
      )
    ) {
      throw new TypeError("Command-help source IDs must be currently offered.");
    }

    const selectedIds = new Set(sourceIds);
    if (
      selectedIds.size === 2 &&
      selectedIds.has("grammar.examine") &&
      selectedIds.has("grammar.read")
    ) {
      return "EXAMINE inspects an observed object without taking it. READ asks the parser to read the object and may implicitly take it.";
    }

    const selectedRules = knowledge.rules.filter((rule) =>
      selectedIds.has(rule.id),
    );
    const ruleHelp = selectedRules
      .map((rule) => `${rule.verb.toUpperCase()}: ${rule.semanticDescription}`)
      .join(" ");
    const objectContext = selectedRules.some((rule) => rule.objectRequired)
      ? knowledge.observedObjects.length === 0
        ? " No observed objects are currently available for those commands."
        : ` Observed objects currently available: ${knowledge.observedObjects.join(", ")}.`
      : "";
    return `${ruleHelp}${objectContext}`;
  }

  const objectHelp =
    knowledge.observedObjects.length === 0
      ? ""
      : ` For things already mentioned—${knowledge.observedObjects.join(", ")}—you can try examine, open, read, or take.`;
  return `You can look, check inventory, or try a direction such as north, south, east, west, up, or down.${objectHelp}`;
}
