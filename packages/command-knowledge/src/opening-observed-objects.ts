import type { SemanticEvent } from "../../contracts/src/index.js";

export const OPENING_OBJECT_PROJECTION_VERSION = 2;
export const MAX_OPENING_ENGINE_OUTPUT_LENGTH = 32_768;

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

export interface OpeningObjectProjection {
  readonly version: typeof OPENING_OBJECT_PROJECTION_VERSION;
  /** Every reviewed object disclosed on the current save branch. */
  readonly observedObjects: readonly OpeningObservedObject[];
  /** Reviewed objects offered as referents in the current scene. */
  readonly currentObjects: readonly OpeningObservedObject[];
  /** A committed movement whose engine output has not yet been projected. */
  readonly pendingMovementRevision: number | null;
}

interface ReviewedDisclosure {
  readonly exactLine: string;
  readonly objects: readonly OpeningObservedObject[];
}

function reviewedDisclosure(
  exactLine: string,
  objects: readonly OpeningObservedObject[],
): ReviewedDisclosure {
  return Object.freeze({ exactLine, objects: Object.freeze([...objects]) });
}

const reviewedDisclosures: readonly ReviewedDisclosure[] = Object.freeze([
  reviewedDisclosure(OPENING_WEST_OF_HOUSE_DESCRIPTION, ["house", "door"]),
  reviewedDisclosure(OPENING_MAILBOX_HERE_DESCRIPTION, ["mailbox"]),
  reviewedDisclosure(OPENING_MAILBOX_REVEALED_DESCRIPTION, [
    "mailbox",
    "leaflet",
  ]),
]);

const openingMovementCommands: ReadonlySet<string> = new Set([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

function freezeProjection(
  observed: ReadonlySet<OpeningObservedObject>,
  current: ReadonlySet<OpeningObservedObject>,
  pendingMovementRevision: number | null,
): OpeningObjectProjection {
  return Object.freeze({
    version: OPENING_OBJECT_PROJECTION_VERSION,
    observedObjects: Object.freeze(
      OPENING_OBSERVED_OBJECTS.filter((object) => observed.has(object)),
    ),
    currentObjects: Object.freeze(
      OPENING_OBSERVED_OBJECTS.filter((object) => current.has(object)),
    ),
    pendingMovementRevision,
  });
}

function validObjectList(objects: readonly OpeningObservedObject[]): boolean {
  const expected = OPENING_OBSERVED_OBJECTS.filter((object) =>
    objects.includes(object),
  );
  return (
    expected.length === objects.length &&
    expected.every((object, index) => objects[index] === object)
  );
}

function assertProjection(
  projection: OpeningObjectProjection,
): asserts projection is OpeningObjectProjection {
  if (
    projection.version !== OPENING_OBJECT_PROJECTION_VERSION ||
    !Array.isArray(projection.observedObjects) ||
    !validObjectList(projection.observedObjects) ||
    !Array.isArray(projection.currentObjects) ||
    !validObjectList(projection.currentObjects) ||
    projection.currentObjects.some(
      (object) => !projection.observedObjects.includes(object),
    ) ||
    (projection.pendingMovementRevision !== null &&
      (!Number.isSafeInteger(projection.pendingMovementRevision) ||
        projection.pendingMovementRevision < 0))
  ) {
    throw new TypeError("Opening object projection is invalid.");
  }
}

export function createOpeningObjectProjection(): OpeningObjectProjection {
  return freezeProjection(new Set(), new Set(), null);
}

function sameObjects(
  objects: ReadonlySet<OpeningObservedObject>,
  expected: readonly OpeningObservedObject[],
): boolean {
  return (
    objects.size === expected.length &&
    expected.every((object) => objects.has(object))
  );
}

function projectReviewedEngineOutput(
  projection: OpeningObjectProjection,
  exactEngineOutput: string,
  clearCurrent: boolean,
  pendingMovementRevision: number | null,
): OpeningObjectProjection {
  const observed = new Set(projection.observedObjects);
  const current = clearCurrent
    ? new Set<OpeningObservedObject>()
    : new Set(projection.currentObjects);

  if (exactEngineOutput.length <= MAX_OPENING_ENGINE_OUTPUT_LENGTH) {
    const lines = new Set(exactEngineOutput.split("\n"));
    for (const disclosure of reviewedDisclosures) {
      if (!lines.has(disclosure.exactLine)) continue;
      for (const object of disclosure.objects) {
        observed.add(object);
        current.add(object);
      }
    }
  }

  if (
    sameObjects(observed, projection.observedObjects) &&
    sameObjects(current, projection.currentObjects) &&
    pendingMovementRevision === projection.pendingMovementRevision
  ) {
    return projection;
  }
  return freezeProjection(observed, current, pendingMovementRevision);
}

export function projectOpeningObjectsFromEngineOutput(
  projection: OpeningObjectProjection,
  exactEngineOutput: string,
): OpeningObjectProjection {
  assertProjection(projection);
  if (typeof exactEngineOutput !== "string") {
    throw new TypeError("Exact engine output must be a string.");
  }
  return projectReviewedEngineOutput(
    projection,
    exactEngineOutput,
    false,
    projection.pendingMovementRevision,
  );
}

export function projectOpeningObjectsFromEvent(
  projection: OpeningObjectProjection,
  event: SemanticEvent,
): OpeningObjectProjection {
  assertProjection(projection);
  if (event.type === "engine.command.committed") {
    if (!openingMovementCommands.has(event.payload.command)) return projection;
    if (projection.pendingMovementRevision === event.payload.revision) {
      return projection;
    }
    return freezeProjection(
      new Set(projection.observedObjects),
      new Set(projection.currentObjects),
      event.payload.revision,
    );
  }
  if (event.type !== "engine.output") return projection;

  const clearsCurrent =
    projection.pendingMovementRevision !== null &&
    event.payload.revision >= projection.pendingMovementRevision;
  return projectReviewedEngineOutput(
    projection,
    event.payload.exactText,
    clearsCurrent,
    clearsCurrent ? null : projection.pendingMovementRevision,
  );
}
