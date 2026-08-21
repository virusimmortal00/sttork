import type { NarrationRequest } from "../../../packages/session/src/index.js";
import { narrationSegments } from "../../../packages/session/src/index.js";

const OPENING_PREFETCH_LIMIT = 2;

export function deterministicOpeningPrefetchRequests(
  text: string,
): readonly NarrationRequest[] {
  return narrationSegments(text)
    .slice(0, OPENING_PREFETCH_LIMIT)
    .map((segment, index) => ({
      narrationId: `story-opening-prefetch-${index + 1}`,
      role: "narrator",
      text: segment,
      sourceEventId: "story-opening-prefetch",
      correlationId: "story-opening",
    }));
}
