import type { SemanticEvent } from "../../contracts/src/index.js";

export const OBSERVED_WORLD_PROJECTION_VERSION = 3;
export const OPENING_OBJECT_PROJECTION_VERSION =
  OBSERVED_WORLD_PROJECTION_VERSION;
export const MAX_OPENING_ENGINE_OUTPUT_LENGTH = 32_768;
export const MAX_OBSERVED_WORLD_ENTITIES = 128;
export const MAX_OBSERVED_WORLD_SOURCES = 8;
const trustedObservedWorldProjections = new WeakSet<object>();

export const OPENING_OBSERVED_OBJECTS = [
  "house",
  "door",
  "mailbox",
  "leaflet",
] as const;

export type OpeningObservedObject = (typeof OPENING_OBSERVED_OBJECTS)[number];

export const OPENING_WEST_OF_HOUSE_DESCRIPTION =
  "You are standing in an open field west of a white house, with a boarded front door.";
export const OPENING_MAILBOX_HERE_DESCRIPTION =
  "There is a small mailbox here.";
export const OPENING_MAILBOX_REVEALED_DESCRIPTION =
  "Opening the small mailbox reveals a leaflet.";

export interface ObservedWorldEntity {
  readonly id: string;
  readonly label: string;
  readonly firstSeenRevision: number;
  readonly lastSeenRevision: number;
  readonly sourceEventIds: readonly string[];
  readonly sourceLines: readonly string[];
}

export interface ObservedWorldPendingCommand {
  readonly command: string;
  readonly revision: number;
  readonly sourceEventId: string;
  readonly correlationId: string;
}

export interface ObservedWorldObjectFocus {
  readonly objectId: string;
  readonly command: string;
  readonly revision: number;
  readonly sourceEventIds: readonly string[];
}

export interface ObservedWorldProjection {
  readonly version: typeof OBSERVED_WORLD_PROJECTION_VERSION;
  readonly entities: readonly ObservedWorldEntity[];
  /** Every source-backed entity disclosed on the current save branch. */
  readonly observedObjects: readonly string[];
  /** Source-backed entities available as referents in the current scene. */
  readonly currentObjects: readonly string[];
  readonly engineRevision: number | null;
  readonly pendingCommand: ObservedWorldPendingCommand | null;
  readonly recentObjectFocus: ObservedWorldObjectFocus | null;
  /** Compatibility field for the former opening-only projection. */
  readonly pendingMovementRevision: number | null;
}

/** @deprecated Use ObservedWorldProjection. */
export type OpeningObjectProjection = ObservedWorldProjection;

interface ReviewedDisclosure {
  readonly exactLine: string;
  readonly objects: readonly string[];
}

const reviewedDisclosures: readonly ReviewedDisclosure[] = Object.freeze([
  Object.freeze({
    exactLine: OPENING_WEST_OF_HOUSE_DESCRIPTION,
    objects: Object.freeze(["house", "door"]),
  }),
  Object.freeze({
    exactLine: OPENING_MAILBOX_HERE_DESCRIPTION,
    objects: Object.freeze(["mailbox"]),
  }),
  Object.freeze({
    exactLine: OPENING_MAILBOX_REVEALED_DESCRIPTION,
    objects: Object.freeze(["mailbox", "leaflet"]),
  }),
]);

const movementCommands: ReadonlySet<string> = new Set([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

const nounPhraseBoundaries = new Set([
  "and",
  "are",
  "at",
  "can",
  "from",
  "has",
  "have",
  "heads",
  "here",
  "in",
  "is",
  "lies",
  "of",
  "on",
  "rests",
  "sits",
  "stands",
  "that",
  "there",
  "through",
  "to",
  "waits",
  "which",
  "with",
]);
const determiners = new Set(["a", "an", "one", "some", "the"]);
const rejectedEntityHeads = new Set([
  "anything",
  "area",
  "direction",
  "here",
  "nothing",
  "place",
  "something",
  "there",
  "way",
]);

function entityId(label: string): string {
  return `observed-object:${label}`;
}

function compareEntityLabels(left: string, right: string): number {
  const leftOpeningIndex = OPENING_OBSERVED_OBJECTS.indexOf(
    left as OpeningObservedObject,
  );
  const rightOpeningIndex = OPENING_OBSERVED_OBJECTS.indexOf(
    right as OpeningObservedObject,
  );
  if (leftOpeningIndex >= 0 || rightOpeningIndex >= 0) {
    if (leftOpeningIndex < 0) return 1;
    if (rightOpeningIndex < 0) return -1;
    return leftOpeningIndex - rightOpeningIndex;
  }
  return left.localeCompare(right);
}

function boundedSources(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].slice(-MAX_OBSERVED_WORLD_SOURCES));
}

function boundedLines(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].slice(-2));
}

function normalizeEntityLabel(value: string): string | undefined {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim();
  return normalized.length > 0 &&
    normalized.length <= 80 &&
    !rejectedEntityHeads.has(normalized)
    ? normalized
    : undefined;
}

function nounPhraseHeads(clause: string): readonly string[] {
  const tokens = clause
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}'-]+/gu);
  if (tokens === null) return [];
  const results: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!determiners.has(tokens[index]!)) continue;
    let head: string | undefined;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor]!;
      if (determiners.has(token) || nounPhraseBoundaries.has(token)) break;
      head = token;
    }
    const normalized =
      head === undefined ? undefined : normalizeEntityLabel(head);
    if (normalized !== undefined) results.push(normalized);
  }
  return Object.freeze([...new Set(results)]);
}

function locativeNounPhraseLabels(clause: string): readonly string[] {
  const normalized = clause
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim()
    .replace(/^(?:a|an|one|some|the)\s+/u, "")
    .split(/\s+(?:here|that|which|with)\b/u, 1)[0]
    ?.trim();
  if (normalized === undefined || normalized.length === 0) return [];
  const tokens: string[] = normalized.match(/[\p{L}\p{N}'-]+/gu) ?? [];
  if (tokens.length === 0 || tokens.length > 8) return [];

  const labels = [normalized];
  const ofIndex = tokens.lastIndexOf("of");
  if (ofIndex > 0 && ofIndex < tokens.length - 1) {
    labels.push(tokens[ofIndex - 1]!, tokens[tokens.length - 1]!);
  } else {
    labels.push(tokens[tokens.length - 1]!);
  }
  return Object.freeze(
    [...new Set(labels)]
      .map(normalizeEntityLabel)
      .filter((label): label is string => label !== undefined),
  );
}

/**
 * Extracts only bounded noun heads from physical presentation clauses in exact
 * engine prose. This creates referents, never facts or success guarantees.
 */
export function observedEntityLabelsFromEngineOutput(
  exactEngineOutput: string,
): readonly { readonly label: string; readonly sourceLine: string }[] {
  if (
    typeof exactEngineOutput !== "string" ||
    exactEngineOutput.length > MAX_OPENING_ENGINE_OUTPUT_LENGTH
  ) {
    return Object.freeze([]);
  }
  const mentions: { label: string; sourceLine: string }[] = [];
  const add = (label: string, sourceLine: string) => {
    const normalized = normalizeEntityLabel(label);
    if (
      normalized !== undefined &&
      !mentions.some((mention) => mention.label === normalized)
    ) {
      mentions.push(Object.freeze({ label: normalized, sourceLine }));
    }
  };

  for (const rawLine of exactEngineOutput.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line === ">" || line.startsWith('"')) continue;
    const reviewed = reviewedDisclosures.find(
      (disclosure) => disclosure.exactLine === line,
    );
    reviewed?.objects.forEach((object) => add(object, line));

    for (const sentence of line.match(/[^.!?]+[.!?]?/gu) ?? [line]) {
      const sourceLine = sentence.trim();
      const locativePresentation =
        /^(?:on|in|at|under|above|beside|near|behind|before)\b.+?\b(?:is|are)\s+(.+)$/iu.exec(
          sourceLine,
        )?.[1];
      const presentation =
        /^(?:there (?:is|are)|you (?:can )?see)\s+(.+)$/iu.exec(
          sourceLine,
        )?.[1] ??
        /^(.+?)\s+(?:stands?|lies?|sits?|rests?|hangs?|waits?)\b/iu.exec(
          sourceLine,
        )?.[1] ??
        /^Opening\b.+\breveals?\s+(.+)$/u.exec(sourceLine)?.[1];
      if (locativePresentation !== undefined) {
        locativeNounPhraseLabels(locativePresentation).forEach((label) =>
          add(label, sourceLine),
        );
      } else if (presentation !== undefined) {
        nounPhraseHeads(presentation).forEach((label) =>
          add(label, sourceLine),
        );
      }
    }
  }
  return Object.freeze(mentions.slice(0, MAX_OBSERVED_WORLD_ENTITIES));
}

function freezeProjection(input: {
  entities: readonly ObservedWorldEntity[];
  currentObjects: ReadonlySet<string>;
  engineRevision: number | null;
  pendingCommand: ObservedWorldPendingCommand | null;
  recentObjectFocus: ObservedWorldObjectFocus | null;
}): ObservedWorldProjection {
  const entities = Object.freeze(
    [...input.entities]
      .sort((left, right) => compareEntityLabels(left.label, right.label))
      .slice(0, MAX_OBSERVED_WORLD_ENTITIES)
      .map((entity) =>
        Object.freeze({
          ...entity,
          sourceEventIds: boundedSources(entity.sourceEventIds),
          sourceLines: boundedLines(entity.sourceLines),
        }),
      ),
  );
  const observedObjects = Object.freeze(entities.map((entity) => entity.label));
  const currentObjects = Object.freeze(
    observedObjects.filter((label) => input.currentObjects.has(label)),
  );
  const projection = Object.freeze({
    version: OBSERVED_WORLD_PROJECTION_VERSION,
    entities,
    observedObjects,
    currentObjects,
    engineRevision: input.engineRevision,
    pendingCommand:
      input.pendingCommand === null
        ? null
        : Object.freeze({ ...input.pendingCommand }),
    recentObjectFocus:
      input.recentObjectFocus === null
        ? null
        : Object.freeze({
            ...input.recentObjectFocus,
            sourceEventIds: boundedSources(
              input.recentObjectFocus.sourceEventIds,
            ),
          }),
    pendingMovementRevision:
      input.pendingCommand !== null &&
      movementCommands.has(input.pendingCommand.command)
        ? input.pendingCommand.revision
        : null,
  });
  trustedObservedWorldProjections.add(projection);
  return projection;
}

function assertProjection(
  projection: ObservedWorldProjection,
): asserts projection is ObservedWorldProjection {
  if (
    projection.version !== OBSERVED_WORLD_PROJECTION_VERSION ||
    !Array.isArray(projection.entities) ||
    !Array.isArray(projection.observedObjects) ||
    !Array.isArray(projection.currentObjects) ||
    projection.currentObjects.some(
      (object) => !projection.observedObjects.includes(object),
    ) ||
    projection.entities.some(
      (entity) =>
        entity.id !== entityId(entity.label) ||
        normalizeEntityLabel(entity.label) !== entity.label ||
        !Array.isArray(entity.sourceEventIds) ||
        entity.sourceEventIds.length === 0 ||
        !Array.isArray(entity.sourceLines) ||
        entity.sourceLines.length === 0,
    ) ||
    (projection.recentObjectFocus !== null &&
      !projection.entities.some(
        (entity) => entity.id === projection.recentObjectFocus?.objectId,
      ))
  ) {
    throw new TypeError("Observed world projection is invalid.");
  }
}

export function isObservedWorldProjection(
  value: unknown,
): value is ObservedWorldProjection {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedObservedWorldProjections.has(value)
  ) {
    return false;
  }
  try {
    assertProjection(value as ObservedWorldProjection);
    return true;
  } catch {
    return false;
  }
}

export function observedWorldCurrentEntity(
  projection: ObservedWorldProjection,
  label: string,
): ObservedWorldEntity | undefined {
  if (!isObservedWorldProjection(projection)) return undefined;
  const normalized = normalizeEntityLabel(label);
  if (
    normalized === undefined ||
    !projection.currentObjects.includes(normalized)
  ) {
    return undefined;
  }
  return projection.entities.find((entity) => entity.label === normalized);
}

export function observedWorldRecentEntity(
  projection: ObservedWorldProjection,
): ObservedWorldEntity | undefined {
  if (
    !isObservedWorldProjection(projection) ||
    projection.recentObjectFocus === null
  ) {
    return undefined;
  }
  return projection.entities.find(
    (entity) => entity.id === projection.recentObjectFocus?.objectId,
  );
}

export function createObservedWorldProjection(): ObservedWorldProjection {
  return freezeProjection({
    entities: [],
    currentObjects: new Set(),
    engineRevision: null,
    pendingCommand: null,
    recentObjectFocus: null,
  });
}

function projectOutput(
  projection: ObservedWorldProjection,
  exactText: string,
  revision: number,
  sourceEventId: string,
  replaceCurrent: boolean,
  pendingCommand: ObservedWorldPendingCommand | null,
  recentObjectFocus: ObservedWorldObjectFocus | null,
): ObservedWorldProjection {
  const mentions = observedEntityLabelsFromEngineOutput(exactText);
  if (
    mentions.length === 0 &&
    !replaceCurrent &&
    pendingCommand === projection.pendingCommand
  ) {
    return projection;
  }
  if (
    !replaceCurrent &&
    pendingCommand === projection.pendingCommand &&
    mentions.length > 0 &&
    mentions.every((mention) => {
      const existing = projection.entities.find(
        (entity) => entity.label === mention.label,
      );
      return (
        existing !== undefined &&
        projection.currentObjects.includes(mention.label) &&
        existing.lastSeenRevision === revision &&
        existing.sourceEventIds.includes(sourceEventId) &&
        existing.sourceLines.includes(mention.sourceLine)
      );
    })
  ) {
    return projection;
  }
  const entities = new Map(
    projection.entities.map((entity) => [entity.label, entity]),
  );
  const current = replaceCurrent
    ? new Set<string>()
    : new Set(projection.currentObjects);
  for (const mention of mentions) {
    const existing = entities.get(mention.label);
    entities.set(mention.label, {
      id: entityId(mention.label),
      label: mention.label,
      firstSeenRevision: existing?.firstSeenRevision ?? revision,
      lastSeenRevision: revision,
      sourceEventIds: [...(existing?.sourceEventIds ?? []), sourceEventId],
      sourceLines: [...(existing?.sourceLines ?? []), mention.sourceLine],
    });
    current.add(mention.label);
  }
  return freezeProjection({
    entities: [...entities.values()],
    currentObjects: current,
    engineRevision: revision,
    pendingCommand,
    recentObjectFocus,
  });
}

export function projectObservedWorldFromEngineOutput(
  projection: ObservedWorldProjection,
  exactEngineOutput: string,
): ObservedWorldProjection {
  assertProjection(projection);
  return projectOutput(
    projection,
    exactEngineOutput,
    projection.engineRevision ?? 0,
    "unattributed-engine-output",
    false,
    projection.pendingCommand,
    projection.recentObjectFocus,
  );
}

export function projectObservedWorldFromEvent(
  projection: ObservedWorldProjection,
  event: SemanticEvent,
): ObservedWorldProjection {
  assertProjection(projection);
  if (event.type === "engine.command.committed") {
    return freezeProjection({
      entities: projection.entities,
      currentObjects: new Set(projection.currentObjects),
      engineRevision: projection.engineRevision,
      pendingCommand: {
        command: event.payload.command,
        revision: event.payload.revision,
        sourceEventId: event.id,
        correlationId: event.correlationId,
      },
      recentObjectFocus: projection.recentObjectFocus,
    });
  }
  if (event.type !== "engine.output") return projection;

  const pending = projection.pendingCommand;
  const matching =
    pending !== null &&
    pending.revision === event.payload.revision &&
    pending.sourceEventId === event.causationId &&
    pending.correlationId === event.correlationId
      ? pending
      : null;
  const replaceCurrent =
    event.payload.revision === 0 ||
    (matching === null && pending !== null) ||
    (matching !== null &&
      (movementCommands.has(matching.command) || matching.command === "look"));
  const objectCommand =
    matching === null
      ? undefined
      : /^(?:examine|open|read|take) (.+)$/u.exec(matching.command);
  const focusedLabel =
    objectCommand?.[1] === undefined
      ? undefined
      : normalizeEntityLabel(objectCommand[1]);
  const focusedEntity =
    focusedLabel === undefined
      ? undefined
      : projection.entities.find((entity) => entity.label === focusedLabel);
  const recentObjectFocus =
    focusedEntity === undefined || matching === null
      ? null
      : {
          objectId: focusedEntity.id,
          command: matching.command,
          revision: event.payload.revision,
          sourceEventIds: [matching.sourceEventId, event.id],
        };
  return projectOutput(
    projection,
    event.payload.exactText,
    event.payload.revision,
    event.id,
    replaceCurrent,
    null,
    recentObjectFocus,
  );
}

/** @deprecated Use createObservedWorldProjection. */
export const createOpeningObjectProjection = createObservedWorldProjection;
/** @deprecated Use projectObservedWorldFromEngineOutput. */
export const projectOpeningObjectsFromEngineOutput =
  projectObservedWorldFromEngineOutput;
/** @deprecated Use projectObservedWorldFromEvent. */
export const projectOpeningObjectsFromEvent = projectObservedWorldFromEvent;
