import {
  canonicalizeCommand,
  type CanonicalCommand,
  type SemanticEvent,
} from "../../contracts/src/index.js";

import {
  createPendingOpeningContextualObjectActionChoiceIntent,
  createOpeningCommandKnowledge,
  isPendingOpeningObjectIntent,
  openingActionOptionsRequested,
  resolvePendingOpeningContextualObjectActionChoiceObject,
  type OpeningObservedObjectOption,
  type PendingOpeningContextualObjectAction,
  type PendingOpeningContextualObjectActionPair,
} from "./opening-area.js";
import {
  MAX_OPENING_ENGINE_OUTPUT_LENGTH,
  OPENING_OBSERVED_OBJECTS,
  OPENING_MAILBOX_HERE_DESCRIPTION,
  OPENING_MAILBOX_REVEALED_DESCRIPTION,
  OPENING_WEST_OF_HOUSE_DESCRIPTION,
  type OpeningObservedObject,
} from "./opening-observed-objects.js";

export const OPENING_SCENE_PROJECTION_VERSION = 2;
export const OPENING_SCENE_PROFILE_ID = "zork1-release-119-opening";
export const OPENING_SCENE_STORY_ID = "zork1-release-119";
export const OPENING_SCENE_STORY_SHA256 =
  "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79";
export const MAX_OPENING_SCENE_SOURCES = 16;

const trustedOpeningSceneProjections = new WeakSet<object>();

const WEST_OF_HOUSE_HEADING = "West of House";
export const OPENING_SCENE_ROOM_OUTPUT = `${WEST_OF_HOUSE_HEADING}\n${OPENING_WEST_OF_HOUSE_DESCRIPTION}\n${OPENING_MAILBOX_HERE_DESCRIPTION}\n\n>`;
export const OPENING_SCENE_BOOT_OUTPUT = `ZORK I: The Great Underground Empire\nInfocom interactive fiction - a fantasy story\nCopyright (c) 1981, 1982, 1983, 1984, 1985, 1986 Infocom, Inc. All rights reserved.\nZORK is a registered trademark of Infocom, Inc.\nRelease 119 / Serial number 880429\n\n${OPENING_SCENE_ROOM_OUTPUT}`;
export const OPENING_SCENE_MAILBOX_REVEAL_OUTPUT = `${OPENING_MAILBOX_REVEALED_DESCRIPTION}\n\n>`;
export const OPENING_SCENE_READ_MAILBOX_REFUSAL_OUTPUT =
  "How does one read a small mailbox?\n\n>";
const MOVEMENT_COMMANDS = new Set([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

export interface OpeningSceneStoryBinding {
  readonly id: string;
  readonly artifactSha256: string;
}

interface OpeningSceneRecord {
  readonly id: string;
  readonly sourceEventIds: readonly string[];
  readonly firstSeenRevision: number;
  readonly lastSeenRevision: number;
}

export interface OpeningSceneEntity extends OpeningSceneRecord {
  readonly label: OpeningObservedObject;
}

export interface OpeningSceneLocation extends OpeningSceneRecord {
  readonly label: string;
}

export type OpeningSceneRelationPredicate =
  "west-of" | "east-of-player" | "here" | "boarded" | "open";

export interface OpeningSceneRelation extends OpeningSceneRecord {
  readonly subjectId: string;
  readonly predicate: OpeningSceneRelationPredicate;
  readonly objectId?: string;
  readonly confidence: "observed" | "inferred";
  readonly statement: string;
}

export interface OpeningSceneAffordance {
  readonly id: string;
  readonly ruleId: string;
  readonly objectId?: string;
  readonly spokenExample: string;
  readonly riskTier: 1 | 2 | 3;
  readonly helpPriority: number;
  readonly sourceIds: readonly string[];
}

export interface OpeningScenePendingCommand {
  readonly command: string;
  readonly revision: number;
  readonly sourceEventId: string;
  readonly correlationId: string;
}

export interface OpeningSceneObjectFocus {
  readonly objectId: string;
  readonly command: string;
  readonly revision: number;
  readonly sourceEventIds: readonly string[];
}

export interface OpeningSceneProjection {
  readonly version: typeof OPENING_SCENE_PROJECTION_VERSION;
  readonly story: OpeningSceneStoryBinding;
  readonly profileId: typeof OPENING_SCENE_PROFILE_ID | null;
  readonly sessionId: string | null;
  readonly throughSequence: number;
  readonly throughEventId: string | null;
  readonly engineRevision: number | null;
  readonly entities: readonly OpeningSceneEntity[];
  readonly currentEntityIds: readonly string[];
  readonly locations: readonly OpeningSceneLocation[];
  readonly currentLocationId: string | null;
  readonly relations: readonly OpeningSceneRelation[];
  readonly currentRelationIds: readonly string[];
  readonly contextualAffordances: readonly OpeningSceneAffordance[];
  readonly pendingCommand: OpeningScenePendingCommand | null;
  readonly recentObjectFocus: OpeningSceneObjectFocus | null;
}

export interface OpeningSceneGuidance {
  readonly response: string;
  readonly basis: "command-help" | "observed-memory";
  readonly sourceIds: readonly string[];
}

export interface OpeningSceneObjectActionSuggestion {
  readonly selectedObject: OpeningObservedObjectOption;
  readonly suggestedActions: PendingOpeningContextualObjectActionPair;
  readonly sourceIds: readonly string[];
}

export interface OpeningSceneFocusedObservation {
  readonly command: CanonicalCommand;
  readonly selectedObject: OpeningObservedObjectOption;
  readonly sourceIds: readonly string[];
}

interface MutableRecord {
  id: string;
  sourceEventIds: string[];
  firstSeenRevision: number;
  lastSeenRevision: number;
}

interface MutableEntity extends MutableRecord {
  label: OpeningObservedObject;
}

interface MutableLocation extends MutableRecord {
  label: string;
}

interface MutableRelation extends MutableRecord {
  subjectId: string;
  predicate: OpeningSceneRelationPredicate;
  objectId?: string;
  confidence: "observed" | "inferred";
  statement: string;
}

function boundedIdentity(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 160 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${field} must be a bounded nonempty string.`);
  }
  return value;
}

function sceneEntityId(label: OpeningObservedObject): string {
  return `observed-object:${label}`;
}

function addSource(sourceEventIds: string[], eventId: string): string[] {
  if (sourceEventIds.includes(eventId)) return sourceEventIds;
  if (sourceEventIds.length === 0) return [eventId];
  return [sourceEventIds[0]!, eventId];
}

function entityMap(
  entities: readonly OpeningSceneEntity[],
): Map<string, MutableEntity> {
  return new Map(
    entities.map((entity) => [
      entity.id,
      {
        ...entity,
        sourceEventIds: [...entity.sourceEventIds],
      },
    ]),
  );
}

function locationMap(
  locations: readonly OpeningSceneLocation[],
): Map<string, MutableLocation> {
  return new Map(
    locations.map((location) => [
      location.id,
      {
        ...location,
        sourceEventIds: [...location.sourceEventIds],
      },
    ]),
  );
}

function relationMap(
  relations: readonly OpeningSceneRelation[],
): Map<string, MutableRelation> {
  return new Map(
    relations.map((relation) => [
      relation.id,
      {
        ...relation,
        sourceEventIds: [...relation.sourceEventIds],
      },
    ]),
  );
}

function upsertEntity(
  entities: Map<string, MutableEntity>,
  label: OpeningObservedObject,
  eventId: string,
  revision: number,
): string {
  const id = sceneEntityId(label);
  const existing = entities.get(id);
  entities.set(
    id,
    existing === undefined
      ? {
          id,
          label,
          sourceEventIds: [eventId],
          firstSeenRevision: revision,
          lastSeenRevision: revision,
        }
      : {
          ...existing,
          sourceEventIds: addSource(existing.sourceEventIds, eventId),
          lastSeenRevision: revision,
        },
  );
  return id;
}

function upsertLocation(
  locations: Map<string, MutableLocation>,
  eventId: string,
  revision: number,
): string {
  const id = "opening.location.west-of-house";
  const existing = locations.get(id);
  locations.set(
    id,
    existing === undefined
      ? {
          id,
          label: WEST_OF_HOUSE_HEADING,
          sourceEventIds: [eventId],
          firstSeenRevision: revision,
          lastSeenRevision: revision,
        }
      : {
          ...existing,
          sourceEventIds: addSource(existing.sourceEventIds, eventId),
          lastSeenRevision: revision,
        },
  );
  return id;
}

function upsertRelation(
  relations: Map<string, MutableRelation>,
  input: Omit<
    MutableRelation,
    "sourceEventIds" | "firstSeenRevision" | "lastSeenRevision"
  >,
  eventId: string,
  revision: number,
): string {
  const existing = relations.get(input.id);
  relations.set(
    input.id,
    existing === undefined
      ? {
          ...input,
          sourceEventIds: [eventId],
          firstSeenRevision: revision,
          lastSeenRevision: revision,
        }
      : {
          ...existing,
          ...input,
          sourceEventIds: addSource(existing.sourceEventIds, eventId),
          lastSeenRevision: revision,
        },
  );
  return input.id;
}

function frozenSources(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].slice(0, MAX_OPENING_SCENE_SOURCES),
  );
}

function buildAffordances(
  entities: readonly OpeningSceneEntity[],
  currentEntityIds: ReadonlySet<string>,
  relations: readonly OpeningSceneRelation[],
  currentRelationIds: ReadonlySet<string>,
): readonly OpeningSceneAffordance[] {
  const currentEntities = entities.filter((entity) =>
    currentEntityIds.has(entity.id),
  );
  const knowledge = createOpeningCommandKnowledge({
    observedObjects: currentEntities.map((entity) => entity.label),
  });
  const rule = (ruleId: string) =>
    knowledge.rules.find((candidate) => candidate.id === ruleId)!;
  const affordances: OpeningSceneAffordance[] = [];
  const add = (
    ruleId: string,
    spokenExample: string,
    helpPriority: number,
    entity?: OpeningSceneEntity,
  ) => {
    const selectedRule = rule(ruleId);
    affordances.push(
      Object.freeze({
        id: `${ruleId}:${entity?.id ?? "global"}`,
        ruleId,
        ...(entity === undefined ? {} : { objectId: entity.id }),
        spokenExample,
        riskTier: selectedRule.riskTier,
        helpPriority,
        sourceIds: frozenSources([ruleId, ...(entity?.sourceEventIds ?? [])]),
      }),
    );
  };

  add("grammar.look", "looking around", 40);
  add("grammar.inventory", "checking your inventory", 90);

  const mailboxOpen = relations.some(
    (relation) =>
      currentRelationIds.has(relation.id) &&
      relation.subjectId === sceneEntityId("mailbox") &&
      relation.predicate === "open",
  );
  for (const entity of currentEntities) {
    switch (entity.label) {
      case "leaflet":
        add("grammar.examine", "examining the leaflet", 5, entity);
        add("grammar.read", "reading the leaflet", 6, entity);
        break;
      case "mailbox":
        add("grammar.examine", "examining the mailbox", 10, entity);
        if (!mailboxOpen) {
          add("grammar.open", "opening the mailbox", 15, entity);
        }
        break;
      case "door":
        add("grammar.examine", "examining the boarded door", 20, entity);
        break;
      case "house":
        add("grammar.examine", "examining the house", 30, entity);
        break;
    }
  }

  return Object.freeze(
    affordances
      .sort(
        (left, right) =>
          left.helpPriority - right.helpPriority ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 12),
  );
}

function freezeProjection(input: {
  story: OpeningSceneStoryBinding;
  profileId: typeof OPENING_SCENE_PROFILE_ID | null;
  sessionId: string | null;
  throughSequence: number;
  throughEventId: string | null;
  engineRevision: number | null;
  entities: Iterable<MutableEntity | OpeningSceneEntity>;
  currentEntityIds: Iterable<string>;
  locations: Iterable<MutableLocation | OpeningSceneLocation>;
  currentLocationId: string | null;
  relations: Iterable<MutableRelation | OpeningSceneRelation>;
  currentRelationIds: Iterable<string>;
  pendingCommand: OpeningScenePendingCommand | null;
  recentObjectFocus: OpeningSceneObjectFocus | null;
}): OpeningSceneProjection {
  const entities = [...input.entities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entity) =>
      Object.freeze({
        ...entity,
        sourceEventIds: frozenSources(entity.sourceEventIds),
      }),
    );
  const locations = [...input.locations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((location) =>
      Object.freeze({
        ...location,
        sourceEventIds: frozenSources(location.sourceEventIds),
      }),
    );
  const relations = [...input.relations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((relation) =>
      Object.freeze({
        ...relation,
        sourceEventIds: frozenSources(relation.sourceEventIds),
      }),
    );
  const currentEntityIds = Object.freeze(
    [...new Set(input.currentEntityIds)].sort(),
  );
  const currentRelationIds = Object.freeze(
    [...new Set(input.currentRelationIds)].sort(),
  );
  const projection = Object.freeze({
    version: OPENING_SCENE_PROJECTION_VERSION,
    story: Object.freeze({ ...input.story }),
    profileId: input.profileId,
    sessionId: input.sessionId,
    throughSequence: input.throughSequence,
    throughEventId: input.throughEventId,
    engineRevision: input.engineRevision,
    entities: Object.freeze(entities),
    currentEntityIds,
    locations: Object.freeze(locations),
    currentLocationId: input.currentLocationId,
    relations: Object.freeze(relations),
    currentRelationIds,
    contextualAffordances:
      input.profileId === null
        ? Object.freeze([])
        : buildAffordances(
            entities,
            new Set(currentEntityIds),
            relations,
            new Set(currentRelationIds),
          ),
    pendingCommand:
      input.pendingCommand === null
        ? null
        : Object.freeze({ ...input.pendingCommand }),
    recentObjectFocus:
      input.recentObjectFocus === null
        ? null
        : Object.freeze({
            ...input.recentObjectFocus,
            sourceEventIds: frozenSources(
              input.recentObjectFocus.sourceEventIds,
            ),
          }),
  });
  trustedOpeningSceneProjections.add(projection);
  return projection;
}

export function createOpeningSceneProjection(
  story: OpeningSceneStoryBinding,
): OpeningSceneProjection {
  const boundedStory = {
    id: boundedIdentity(story.id, "Scene story id"),
    artifactSha256: boundedIdentity(
      story.artifactSha256,
      "Scene story artifact hash",
    ),
  };
  const profileId =
    boundedStory.id === OPENING_SCENE_STORY_ID &&
    boundedStory.artifactSha256 === OPENING_SCENE_STORY_SHA256
      ? OPENING_SCENE_PROFILE_ID
      : null;
  return freezeProjection({
    story: boundedStory,
    profileId,
    sessionId: null,
    throughSequence: 0,
    throughEventId: null,
    engineRevision: null,
    entities: [],
    currentEntityIds: [],
    locations: [],
    currentLocationId: null,
    relations: [],
    currentRelationIds: [],
    pendingCommand: null,
    recentObjectFocus: null,
  });
}

function validSceneSourceIds(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_OPENING_SCENE_SOURCES &&
    new Set(value).size === value.length &&
    value.every(
      (sourceId) =>
        typeof sourceId === "string" &&
        sourceId.length > 0 &&
        sourceId.length <= 160 &&
        !/\p{Cc}/u.test(sourceId),
    )
  );
}

function validSceneRecord(
  value: OpeningSceneRecord,
  engineRevision: number | null,
): boolean {
  return (
    validSceneSourceIds(value.sourceEventIds) &&
    Number.isSafeInteger(value.firstSeenRevision) &&
    value.firstSeenRevision >= 0 &&
    Number.isSafeInteger(value.lastSeenRevision) &&
    value.lastSeenRevision >= value.firstSeenRevision &&
    engineRevision !== null &&
    value.lastSeenRevision <= engineRevision
  );
}

const RELATION_SHAPES: Readonly<
  Record<
    string,
    Pick<
      OpeningSceneRelation,
      "subjectId" | "predicate" | "objectId" | "confidence" | "statement"
    >
  >
> = Object.freeze({
  "opening.relation.player-west-of-house": Object.freeze({
    subjectId: "player",
    predicate: "west-of",
    objectId: "observed-object:house",
    confidence: "observed",
    statement: "You are west of the house.",
  }),
  "opening.relation.house-east-of-player": Object.freeze({
    subjectId: "observed-object:house",
    predicate: "east-of-player",
    objectId: "player",
    confidence: "inferred",
    statement: "The house is east of you.",
  }),
  "opening.relation.door-boarded": Object.freeze({
    subjectId: "observed-object:door",
    predicate: "boarded",
    confidence: "observed",
    statement: "The house's front door is boarded.",
  }),
  "opening.relation.mailbox-here": Object.freeze({
    subjectId: "observed-object:mailbox",
    predicate: "here",
    confidence: "observed",
    statement: "The mailbox is here with you.",
  }),
  "opening.relation.leaflet-here": Object.freeze({
    subjectId: "observed-object:leaflet",
    predicate: "here",
    confidence: "observed",
    statement: "The leaflet is here with you.",
  }),
  "opening.relation.mailbox-open": Object.freeze({
    subjectId: "observed-object:mailbox",
    predicate: "open",
    confidence: "observed",
    statement: "The mailbox is open.",
  }),
});

/** Validates the local, story-bound scene snapshot before guide use. */
export function isOpeningSceneProjection(
  value: unknown,
): value is OpeningSceneProjection {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedOpeningSceneProjections.has(value)
  ) {
    return false;
  }
  const candidate = value as OpeningSceneProjection;
  if (
    candidate.version !== OPENING_SCENE_PROJECTION_VERSION ||
    candidate.profileId !== OPENING_SCENE_PROFILE_ID ||
    candidate.story?.id !== OPENING_SCENE_STORY_ID ||
    candidate.story.artifactSha256 !== OPENING_SCENE_STORY_SHA256 ||
    (candidate.sessionId !== null &&
      (typeof candidate.sessionId !== "string" ||
        candidate.sessionId.length === 0 ||
        candidate.sessionId.length > 160 ||
        /\p{Cc}/u.test(candidate.sessionId))) ||
    !Number.isSafeInteger(candidate.throughSequence) ||
    candidate.throughSequence < 0 ||
    (candidate.throughSequence === 0) !== (candidate.throughEventId === null) ||
    (candidate.throughSequence === 0) !== (candidate.sessionId === null) ||
    (candidate.throughEventId !== null &&
      (typeof candidate.throughEventId !== "string" ||
        candidate.throughEventId.length === 0 ||
        candidate.throughEventId.length > 160 ||
        /\p{Cc}/u.test(candidate.throughEventId))) ||
    (candidate.engineRevision !== null &&
      (!Number.isSafeInteger(candidate.engineRevision) ||
        candidate.engineRevision < 0)) ||
    !Array.isArray(candidate.entities) ||
    !Array.isArray(candidate.currentEntityIds) ||
    !Array.isArray(candidate.locations) ||
    !Array.isArray(candidate.relations) ||
    !Array.isArray(candidate.currentRelationIds) ||
    !Array.isArray(candidate.contextualAffordances) ||
    (candidate.recentObjectFocus !== null &&
      (typeof candidate.recentObjectFocus !== "object" ||
        !Number.isSafeInteger(candidate.recentObjectFocus.revision) ||
        candidate.recentObjectFocus.revision < 0 ||
        candidate.recentObjectFocus.revision >
          (candidate.engineRevision ?? -1) ||
        typeof candidate.recentObjectFocus.command !== "string" ||
        candidate.recentObjectFocus.command.length === 0 ||
        candidate.recentObjectFocus.command.length > 160 ||
        /\p{Cc}/u.test(candidate.recentObjectFocus.command) ||
        !validSceneSourceIds(candidate.recentObjectFocus.sourceEventIds)))
  ) {
    return false;
  }

  const east = candidate.relations.find(
    (relation) => relation.id === "opening.relation.house-east-of-player",
  );
  const west = candidate.relations.find(
    (relation) => relation.id === "opening.relation.player-west-of-house",
  );
  if (
    east !== undefined &&
    (west === undefined ||
      east.firstSeenRevision !== west.firstSeenRevision ||
      east.lastSeenRevision !== west.lastSeenRevision ||
      JSON.stringify(east.sourceEventIds) !==
        JSON.stringify(west.sourceEventIds) ||
      (candidate.currentRelationIds.includes(east.id) &&
        !candidate.currentRelationIds.includes(west.id)))
  ) {
    return false;
  }

  const entityIds = new Set<string>();
  for (const entity of candidate.entities) {
    if (
      !OPENING_OBSERVED_OBJECTS.includes(entity.label) ||
      entity.id !== sceneEntityId(entity.label) ||
      entityIds.has(entity.id) ||
      !validSceneRecord(entity, candidate.engineRevision)
    ) {
      return false;
    }
    entityIds.add(entity.id);
  }
  if (
    new Set(candidate.currentEntityIds).size !==
      candidate.currentEntityIds.length ||
    candidate.currentEntityIds.some((id) => !entityIds.has(id))
  ) {
    return false;
  }
  if (
    candidate.recentObjectFocus !== null &&
    !entityIds.has(candidate.recentObjectFocus.objectId)
  ) {
    return false;
  }

  if (
    candidate.locations.length > 1 ||
    candidate.locations.some(
      (location) =>
        location.id !== "opening.location.west-of-house" ||
        location.label !== WEST_OF_HOUSE_HEADING ||
        !validSceneRecord(location, candidate.engineRevision),
    ) ||
    (candidate.currentLocationId !== null &&
      !candidate.locations.some(
        (location) => location.id === candidate.currentLocationId,
      ))
  ) {
    return false;
  }

  const relationIds = new Set<string>();
  for (const relation of candidate.relations) {
    const shape = RELATION_SHAPES[relation.id];
    if (
      shape === undefined ||
      relationIds.has(relation.id) ||
      relation.subjectId !== shape.subjectId ||
      relation.predicate !== shape.predicate ||
      relation.objectId !== shape.objectId ||
      relation.confidence !== shape.confidence ||
      relation.statement !== shape.statement ||
      !validSceneRecord(relation, candidate.engineRevision)
    ) {
      return false;
    }
    relationIds.add(relation.id);
  }
  if (
    new Set(candidate.currentRelationIds).size !==
      candidate.currentRelationIds.length ||
    candidate.currentRelationIds.some((id) => !relationIds.has(id)) ||
    candidate.currentRelationIds.some((id) => {
      const relation = candidate.relations.find((item) => item.id === id)!;
      const subjectIsCurrent =
        relation.subjectId === "player" ||
        !relation.subjectId.startsWith("observed-object:") ||
        candidate.currentEntityIds.includes(relation.subjectId);
      const objectIsCurrent =
        relation.objectId === undefined ||
        relation.objectId === "player" ||
        !relation.objectId.startsWith("observed-object:") ||
        candidate.currentEntityIds.includes(relation.objectId);
      const spatialLocationIsCurrent =
        (relation.predicate !== "west-of" &&
          relation.predicate !== "east-of-player") ||
        candidate.currentLocationId === "opening.location.west-of-house";
      return !subjectIsCurrent || !objectIsCurrent || !spatialLocationIsCurrent;
    })
  ) {
    return false;
  }

  const expectedAffordances = buildAffordances(
    candidate.entities,
    new Set(candidate.currentEntityIds),
    candidate.relations,
    new Set(candidate.currentRelationIds),
  );
  if (
    JSON.stringify(candidate.contextualAffordances) !==
    JSON.stringify(expectedAffordances)
  ) {
    return false;
  }

  return (
    candidate.pendingCommand === null ||
    (typeof candidate.pendingCommand.command === "string" &&
      candidate.pendingCommand.command.length > 0 &&
      candidate.pendingCommand.command.length <= 160 &&
      !/\p{Cc}/u.test(candidate.pendingCommand.command) &&
      Number.isSafeInteger(candidate.pendingCommand.revision) &&
      candidate.pendingCommand.revision >= 0 &&
      (candidate.engineRevision === null ||
        candidate.pendingCommand.revision > candidate.engineRevision) &&
      typeof candidate.pendingCommand.sourceEventId === "string" &&
      candidate.pendingCommand.sourceEventId.length > 0 &&
      candidate.pendingCommand.sourceEventId.length <= 160 &&
      !/\p{Cc}/u.test(candidate.pendingCommand.sourceEventId) &&
      typeof candidate.pendingCommand.correlationId === "string" &&
      candidate.pendingCommand.correlationId.length > 0 &&
      candidate.pendingCommand.correlationId.length <= 160 &&
      !/\p{Cc}/u.test(candidate.pendingCommand.correlationId))
  );
}

function commandObjectId(command: string): string | undefined {
  for (const label of ["house", "door", "mailbox", "leaflet"] as const) {
    for (const verb of ["examine", "open", "read", "take"] as const) {
      if (command === `${verb} ${label}`) return sceneEntityId(label);
    }
  }
  return undefined;
}

function placementChangingCommandObjectId(command: string): string | undefined {
  return /^(?:read|take) /u.test(command)
    ? commandObjectId(command)
    : undefined;
}

export function projectOpeningSceneFromEvent(
  projection: OpeningSceneProjection,
  event: SemanticEvent,
): OpeningSceneProjection {
  if (!trustedOpeningSceneProjections.has(projection)) {
    throw new TypeError("Opening scene projection is not reducer-produced.");
  }
  if (
    projection.sessionId !== null &&
    event.sessionId !== projection.sessionId
  ) {
    return projection;
  }
  if (
    event.sequence < projection.throughSequence ||
    (event.sequence === projection.throughSequence &&
      event.id === projection.throughEventId)
  ) {
    return projection;
  }
  if (event.sequence <= projection.throughSequence) return projection;

  let pendingCommand = projection.pendingCommand;
  let recentObjectFocus = projection.recentObjectFocus;
  let engineRevision = projection.engineRevision;
  const entities = entityMap(projection.entities);
  const locations = locationMap(projection.locations);
  const relations = relationMap(projection.relations);
  let currentEntityIds = new Set(projection.currentEntityIds);
  let currentRelationIds = new Set(projection.currentRelationIds);
  let currentLocationId = projection.currentLocationId;

  if (event.type === "engine.command.committed") {
    if (
      engineRevision !== null &&
      event.payload.previousRevision === engineRevision &&
      event.payload.revision === engineRevision + 1
    ) {
      pendingCommand = {
        command: event.payload.command,
        revision: event.payload.revision,
        sourceEventId: event.id,
        correlationId: event.correlationId,
      };
    }
  } else if (event.type === "engine.output") {
    const staleRevision =
      engineRevision !== null && event.payload.revision <= engineRevision;
    if (!staleRevision) {
      const matchingCommand =
        pendingCommand?.revision === event.payload.revision &&
        pendingCommand.correlationId === event.correlationId &&
        pendingCommand.sourceEventId === event.causationId
          ? pendingCommand
          : null;
      const preservesCurrentMailbox =
        matchingCommand?.command === "read mailbox" &&
        event.payload.exactText === OPENING_SCENE_READ_MAILBOX_REFUSAL_OUTPUT;
      const clearsWholeScene =
        (event.payload.revision > 0 && matchingCommand === null) ||
        (matchingCommand !== null &&
          MOVEMENT_COMMANDS.has(matchingCommand.command));
      const invalidatedObjectId =
        matchingCommand === null || preservesCurrentMailbox
          ? undefined
          : placementChangingCommandObjectId(matchingCommand.command);
      if (clearsWholeScene) {
        currentEntityIds = new Set();
        currentRelationIds = new Set();
        currentLocationId = null;
        recentObjectFocus = null;
      } else if (invalidatedObjectId !== undefined) {
        currentEntityIds.delete(invalidatedObjectId);
        for (const relation of relations.values()) {
          if (
            relation.subjectId === invalidatedObjectId ||
            relation.objectId === invalidatedObjectId
          ) {
            currentRelationIds.delete(relation.id);
          }
        }
      }

      engineRevision = event.payload.revision;
      const mayProjectReviewedFacts =
        projection.profileId === OPENING_SCENE_PROFILE_ID &&
        event.payload.exactText.length <= MAX_OPENING_ENGINE_OUTPUT_LENGTH;
      if (mayProjectReviewedFacts) {
        const isBoot = event.payload.revision === 0 && matchingCommand === null;
        const canDescribeScene =
          isBoot ||
          matchingCommand?.command === "look" ||
          (matchingCommand !== null &&
            MOVEMENT_COMMANDS.has(matchingCommand.command));
        const westOfHouseSignature =
          canDescribeScene &&
          event.payload.exactText ===
            (isBoot ? OPENING_SCENE_BOOT_OUTPUT : OPENING_SCENE_ROOM_OUTPUT);
        if (westOfHouseSignature) {
          const houseId = upsertEntity(
            entities,
            "house",
            event.id,
            event.payload.revision,
          );
          const doorId = upsertEntity(
            entities,
            "door",
            event.id,
            event.payload.revision,
          );
          currentEntityIds.add(houseId);
          currentEntityIds.add(doorId);
          currentLocationId = upsertLocation(
            locations,
            event.id,
            event.payload.revision,
          );
          currentRelationIds.add(
            upsertRelation(
              relations,
              {
                id: "opening.relation.player-west-of-house",
                subjectId: "player",
                predicate: "west-of",
                objectId: houseId,
                confidence: "observed",
                statement: "You are west of the house.",
              },
              event.id,
              event.payload.revision,
            ),
          );
          currentRelationIds.add(
            upsertRelation(
              relations,
              {
                id: "opening.relation.house-east-of-player",
                subjectId: houseId,
                predicate: "east-of-player",
                objectId: "player",
                confidence: "inferred",
                statement: "The house is east of you.",
              },
              event.id,
              event.payload.revision,
            ),
          );
          currentRelationIds.add(
            upsertRelation(
              relations,
              {
                id: "opening.relation.door-boarded",
                subjectId: doorId,
                predicate: "boarded",
                confidence: "observed",
                statement: "The house's front door is boarded.",
              },
              event.id,
              event.payload.revision,
            ),
          );
          const mailboxId = upsertEntity(
            entities,
            "mailbox",
            event.id,
            event.payload.revision,
          );
          currentEntityIds.add(mailboxId);
          currentRelationIds.add(
            upsertRelation(
              relations,
              {
                id: "opening.relation.mailbox-here",
                subjectId: mailboxId,
                predicate: "here",
                confidence: "observed",
                statement: "The mailbox is here with you.",
              },
              event.id,
              event.payload.revision,
            ),
          );
        }

        if (
          matchingCommand?.command === "open mailbox" &&
          event.payload.exactText === OPENING_SCENE_MAILBOX_REVEAL_OUTPUT
        ) {
          const mailboxId = upsertEntity(
            entities,
            "mailbox",
            event.id,
            event.payload.revision,
          );
          const leafletId = upsertEntity(
            entities,
            "leaflet",
            event.id,
            event.payload.revision,
          );
          currentEntityIds.add(mailboxId);
          currentEntityIds.add(leafletId);
          for (const [id, subjectId, statement] of [
            [
              "opening.relation.mailbox-here",
              mailboxId,
              "The mailbox is here with you.",
            ],
            [
              "opening.relation.leaflet-here",
              leafletId,
              "The leaflet is here with you.",
            ],
          ] as const) {
            currentRelationIds.add(
              upsertRelation(
                relations,
                {
                  id,
                  subjectId,
                  predicate: "here",
                  confidence: "observed",
                  statement,
                },
                event.id,
                event.payload.revision,
              ),
            );
          }
          currentRelationIds.add(
            upsertRelation(
              relations,
              {
                id: "opening.relation.mailbox-open",
                subjectId: mailboxId,
                predicate: "open",
                confidence: "observed",
                statement: "The mailbox is open.",
              },
              event.id,
              event.payload.revision,
            ),
          );
        }

        if (preservesCurrentMailbox) {
          const mailboxId = upsertEntity(
            entities,
            "mailbox",
            event.id,
            event.payload.revision,
          );
          currentEntityIds.add(mailboxId);
          currentRelationIds.add(
            upsertRelation(
              relations,
              {
                id: "opening.relation.mailbox-here",
                subjectId: mailboxId,
                predicate: "here",
                confidence: "observed",
                statement: "The mailbox is here with you.",
              },
              event.id,
              event.payload.revision,
            ),
          );
        }
      }
      if (!clearsWholeScene) {
        const focusedObjectId =
          matchingCommand === null
            ? undefined
            : commandObjectId(matchingCommand.command);
        recentObjectFocus =
          focusedObjectId !== undefined && entities.has(focusedObjectId)
            ? {
                objectId: focusedObjectId,
                command: matchingCommand!.command,
                revision: event.payload.revision,
                sourceEventIds: [matchingCommand!.sourceEventId, event.id],
              }
            : null;
      }
      if (
        pendingCommand !== null &&
        event.payload.revision >= pendingCommand.revision
      ) {
        pendingCommand = null;
      }
    }
  }

  return freezeProjection({
    story: projection.story,
    profileId: projection.profileId,
    sessionId: projection.sessionId ?? event.sessionId,
    throughSequence: event.sequence,
    throughEventId: event.id,
    engineRevision,
    entities: entities.values(),
    currentEntityIds,
    locations: locations.values(),
    currentLocationId,
    relations: relations.values(),
    currentRelationIds,
    pendingCommand,
    recentObjectFocus,
  });
}

export function openingSceneCurrentObjectLabels(
  projection: OpeningSceneProjection,
): readonly string[] {
  const currentIds = new Set(projection.currentEntityIds);
  return Object.freeze(
    projection.entities
      .filter((entity) => currentIds.has(entity.id))
      .map((entity) => entity.label),
  );
}

/**
 * Resolves a tightly bounded deictic observation question against the last
 * successfully completed object action. The engine still determines what the
 * requested EXAMINE reveals; this focus never becomes an observed fact.
 */
export function resolveOpeningSceneFocusedObservationRequest(
  utterance: string,
  projection: OpeningSceneProjection,
): OpeningSceneFocusedObservation | undefined {
  if (
    !isOpeningSceneProjection(projection) ||
    typeof utterance !== "string" ||
    projection.recentObjectFocus === null
  ) {
    return undefined;
  }
  const normalized = normalizedUtterance(utterance);
  const refersToReverseSurface = [
    "is there anything on the back",
    "is there something on the back",
    "is anything on the back",
    "is anything written on the back",
    "is anything printed on the back",
    "what is on the back",
    "what's on the back",
    "does it have anything on the back",
    "is there anything on the other side",
    "is anything on the other side",
    "what is on the other side",
    "what's on the other side",
  ].includes(normalized);
  if (!refersToReverseSurface) return undefined;

  const focusedEntity = projection.entities.find(
    (entity) => entity.id === projection.recentObjectFocus?.objectId,
  );
  if (focusedEntity === undefined) return undefined;
  return Object.freeze({
    command: canonicalizeCommand(`examine ${focusedEntity.label}`),
    selectedObject: Object.freeze({
      id: focusedEntity.id,
      label: focusedEntity.label,
    }),
    sourceIds: frozenSources([
      "grammar.examine",
      ...projection.recentObjectFocus.sourceEventIds,
    ]),
  });
}

const CONTEXTUAL_OBJECT_ACTION_BY_RULE_ID: Readonly<
  Record<string, PendingOpeningContextualObjectAction | undefined>
> = Object.freeze({
  "grammar.examine": "examine",
  "grammar.open": "open",
  "grammar.read": "read",
  "grammar.take": "take",
});

/**
 * Returns one exact reducer-derived suggestion pair for a current object.
 * Suggestions describe likely actions only; the global grammar remains the
 * authority for grounding a player's explicit action.
 */
export function resolveOpeningSceneObjectActionSuggestion(
  projection: OpeningSceneProjection,
  objectValueId: string,
): OpeningSceneObjectActionSuggestion | undefined {
  if (!isOpeningSceneProjection(projection)) return undefined;
  const currentEntity = projection.entities.find(
    (entity) =>
      entity.id === objectValueId &&
      projection.currentEntityIds.includes(entity.id),
  );
  if (currentEntity === undefined) return undefined;

  const knowledge = createOpeningCommandKnowledge({
    observedObjects: openingSceneCurrentObjectLabels(projection),
  });
  const selectedObject = knowledge.observedObjectOptions.find(
    (option) => option.id === currentEntity.id,
  );
  if (selectedObject === undefined) return undefined;

  const affordances = projection.contextualAffordances.filter(
    (affordance) =>
      affordance.objectId === currentEntity.id &&
      CONTEXTUAL_OBJECT_ACTION_BY_RULE_ID[affordance.ruleId] !== undefined,
  );
  const actions = affordances.map(
    (affordance) => CONTEXTUAL_OBJECT_ACTION_BY_RULE_ID[affordance.ruleId]!,
  );
  if (actions.length !== 2 || new Set(actions).size !== 2) return undefined;

  const pending = createPendingOpeningContextualObjectActionChoiceIntent(
    selectedObject,
    actions as [
      PendingOpeningContextualObjectAction,
      PendingOpeningContextualObjectAction,
    ],
  );
  const orderedAffordances = pending.suggestedActions.map((action) =>
    affordances.find((affordance) => affordance.ruleId === `grammar.${action}`),
  );
  if (orderedAffordances.some((affordance) => affordance === undefined)) {
    return undefined;
  }

  return Object.freeze({
    selectedObject: Object.freeze({ ...selectedObject }),
    suggestedActions: pending.suggestedActions,
    sourceIds: frozenSources(
      orderedAffordances.flatMap((affordance) => affordance!.sourceIds),
    ),
  });
}

/** Revalidates session-only focus against the exact current scene pair. */
export function resolvePendingOpeningContextualObjectActionChoiceForScene(
  projection: OpeningSceneProjection,
  intent: unknown,
): OpeningSceneObjectActionSuggestion | undefined {
  if (
    !isOpeningSceneProjection(projection) ||
    !isPendingOpeningObjectIntent(intent) ||
    !("kind" in intent) ||
    intent.kind !== "contextual-object-action-choice"
  ) {
    return undefined;
  }
  const knowledge = createOpeningCommandKnowledge({
    observedObjects: openingSceneCurrentObjectLabels(projection),
  });
  const selectedObject =
    resolvePendingOpeningContextualObjectActionChoiceObject(intent, knowledge);
  if (selectedObject === undefined) return undefined;
  const suggestion = resolveOpeningSceneObjectActionSuggestion(
    projection,
    selectedObject.id,
  );
  return suggestion !== undefined &&
    suggestion.suggestedActions.every(
      (action, index) => intent.suggestedActions[index] === action,
    )
    ? suggestion
    : undefined;
}

function normalizedUtterance(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’]/gu, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function formatChoices(values: readonly string[]): string {
  if (values.length === 0) return "looking around";
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

function navigationTarget(
  utterance: string,
  projection: OpeningSceneProjection,
): OpeningSceneEntity | undefined {
  const normalized = normalizedUtterance(utterance);
  const current = new Set(projection.currentEntityIds);
  return projection.entities.find((entity) => {
    if (!current.has(entity.id)) return false;
    const targets = [entity.label, `the ${entity.label}`];
    return targets.some((target) =>
      [
        `walk to ${target}`,
        `walk over to ${target}`,
        `go to ${target}`,
        `go over to ${target}`,
        `move to ${target}`,
        `head to ${target}`,
      ].includes(normalized),
    );
  });
}

function directionQuestionTarget(
  utterance: string,
  projection: OpeningSceneProjection,
): OpeningSceneEntity | undefined {
  const normalized = normalizedUtterance(utterance);
  return projection.entities.find((entity) => {
    const targets = [entity.label, `the ${entity.label}`];
    return targets.some((target) =>
      [
        `in which direction is ${target}`,
        `in which direction is ${target} again`,
        `in which direction was ${target}`,
        `in which direction was ${target} again`,
        `which direction is ${target}`,
        `which direction was ${target}`,
        `which way is ${target}`,
        `which way was ${target}`,
        `where is ${target}`,
        `where was ${target}`,
      ].includes(normalized),
    );
  });
}

export function resolveOpeningSceneGuidance(
  utterance: string,
  projection: OpeningSceneProjection,
): OpeningSceneGuidance | undefined {
  if (!isOpeningSceneProjection(projection)) return undefined;

  const target = navigationTarget(utterance, projection);
  if (target !== undefined) {
    const here = projection.relations.find(
      (relation) =>
        projection.currentRelationIds.includes(relation.id) &&
        relation.subjectId === target.id &&
        relation.predicate === "here",
    );
    if (here !== undefined) {
      const attempts = projection.contextualAffordances.filter(
        (affordance) =>
          affordance.objectId === target.id &&
          (affordance.ruleId === "grammar.examine" ||
            affordance.ruleId === "grammar.open"),
      );
      const phrases = attempts.map((attempt) =>
        attempt.ruleId === "grammar.examine" ? "examining it" : "opening it",
      );
      return Object.freeze({
        response: `The ${target.label} is already here. You can try ${formatChoices(phrases)}.`,
        basis: "observed-memory",
        sourceIds: frozenSources([
          ...here.sourceEventIds,
          ...attempts.flatMap((attempt) => attempt.sourceIds),
        ]),
      });
    }
  }

  if (openingActionOptionsRequested(utterance)) {
    const attempts = projection.contextualAffordances.slice(0, 3);
    return Object.freeze({
      response: `You can try ${formatChoices(attempts.map((attempt) => attempt.spokenExample))}. The game will decide what works.`,
      basis: "command-help",
      sourceIds: frozenSources(
        attempts.flatMap((attempt) => attempt.sourceIds),
      ),
    });
  }

  const directionTarget = directionQuestionTarget(utterance, projection);
  if (directionTarget !== undefined) {
    const east = projection.relations.find(
      (relation) =>
        projection.currentRelationIds.includes(relation.id) &&
        relation.subjectId === directionTarget.id &&
        relation.predicate === "east-of-player",
    );
    if (east !== undefined) {
      return Object.freeze({
        response:
          "The game said you were west of the house, so the house is east of you.",
        basis: "observed-memory",
        sourceIds: frozenSources(east.sourceEventIds),
      });
    }
    return Object.freeze({
      response: `I don't have a current, observed direction for the ${directionTarget.label}. Try LOOK to reorient.`,
      basis: "observed-memory",
      sourceIds: frozenSources([
        ...directionTarget.sourceEventIds,
        "grammar.look",
      ]),
    });
  }

  return undefined;
}
