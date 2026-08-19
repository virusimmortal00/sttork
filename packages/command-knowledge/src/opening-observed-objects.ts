import type { SemanticEvent } from "../../contracts/src/index.js";

export const OPENING_OBJECT_PROJECTION_VERSION = 1;
export const MAX_OPENING_ENGINE_OUTPUT_LENGTH = 32_768;

const openingObservedObjectNames = [
  "house",
  "door",
  "mailbox",
  "leaflet",
] as const;

export type OpeningObservedObject = (typeof openingObservedObjectNames)[number];

export interface OpeningObjectProjection {
  readonly version: typeof OPENING_OBJECT_PROJECTION_VERSION;
  readonly observedObjects: readonly OpeningObservedObject[];
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
  reviewedDisclosure(
    "You are standing in an open field west of a white house, with a boarded front door.",
    ["house", "door"],
  ),
  reviewedDisclosure("There is a small mailbox here.", ["mailbox"]),
  reviewedDisclosure("Opening the small mailbox reveals a leaflet.", [
    "mailbox",
    "leaflet",
  ]),
]);

function freezeProjection(
  observed: ReadonlySet<OpeningObservedObject>,
): OpeningObjectProjection {
  return Object.freeze({
    version: OPENING_OBJECT_PROJECTION_VERSION,
    observedObjects: Object.freeze(
      openingObservedObjectNames.filter((object) => observed.has(object)),
    ),
  });
}

function assertProjection(
  projection: OpeningObjectProjection,
): asserts projection is OpeningObjectProjection {
  if (
    projection.version !== OPENING_OBJECT_PROJECTION_VERSION ||
    !Array.isArray(projection.observedObjects) ||
    projection.observedObjects.length > openingObservedObjectNames.length ||
    projection.observedObjects.some(
      (object, index) =>
        !openingObservedObjectNames.includes(object) ||
        projection.observedObjects.indexOf(object) !== index,
    )
  ) {
    throw new TypeError("Opening object projection is invalid.");
  }
}

export function createOpeningObjectProjection(): OpeningObjectProjection {
  return freezeProjection(new Set());
}

export function projectOpeningObjectsFromEngineOutput(
  projection: OpeningObjectProjection,
  exactEngineOutput: string,
): OpeningObjectProjection {
  assertProjection(projection);
  if (typeof exactEngineOutput !== "string") {
    throw new TypeError("Exact engine output must be a string.");
  }
  if (exactEngineOutput.length > MAX_OPENING_ENGINE_OUTPUT_LENGTH) {
    return projection;
  }

  const lines = new Set(exactEngineOutput.split("\n"));
  const observed = new Set(projection.observedObjects);
  for (const disclosure of reviewedDisclosures) {
    if (!lines.has(disclosure.exactLine)) continue;
    for (const object of disclosure.objects) observed.add(object);
  }

  if (observed.size === projection.observedObjects.length) return projection;
  return freezeProjection(observed);
}

export function projectOpeningObjectsFromEvent(
  projection: OpeningObjectProjection,
  event: SemanticEvent,
): OpeningObjectProjection {
  if (event.type !== "engine.output") return projection;
  return projectOpeningObjectsFromEngineOutput(
    projection,
    event.payload.exactText,
  );
}
