import type { SemanticEvent } from "../../../packages/contracts/src/index.js";
import { EventSequence } from "../../../packages/events/src/index.js";
import {
  EXPERIENCE_DEBUG_LIMIT,
  EXPERIENCE_SOURCE_EVENT_LIMIT,
  EXPERIENCE_TRANSCRIPT_LIMIT,
  initialExperienceProjection,
  reduceExperienceProjection,
} from "../../../packages/experience/src/index.js";

import { OptionalEventLogPresentation } from "./optional-event-log-presentation.js";

const DEFAULT_EVENT_COUNT = 50_000;
const MINIMUM_EVENT_COUNT = 1_000;
const MAXIMUM_EVENT_COUNT = 100_000;
const BATCH_SIZE = 1_000;
const LIFECYCLE_CYCLES = 20;
const PAGE_CYCLES = 8;

export interface ClientProjectionSoakEvidence {
  readonly status: "complete";
  readonly eventCount: number;
  readonly batchSize: number;
  readonly totalReductionMs: number;
  readonly slowestBatchMs: number;
  readonly optionalViewExerciseMs: number;
  readonly transcriptItems: number;
  readonly debugEntries: number;
  readonly sourceEventIds: number;
  readonly hiddenTranscriptRows: number;
  readonly hiddenDebugCharacters: number;
  readonly maximumTranscriptRows: number;
  readonly lifecycleCycles: number;
  readonly pageCycles: number;
  readonly detachedAfterCompletion: boolean;
  readonly heapDeltaBytes?: number;
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number };
}

function required(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Client projection soak failed: ${message}`);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function clientProjectionSoakEventCount(
  search: string,
): number | undefined {
  const value = new URLSearchParams(search).get("projection-soak");
  if (value === null) return undefined;
  if (value === "") return DEFAULT_EVENT_COUNT;
  const count = Number(value);
  if (
    !Number.isSafeInteger(count) ||
    count < MINIMUM_EVENT_COUNT ||
    count > MAXIMUM_EVENT_COUNT
  ) {
    throw new RangeError(
      `projection-soak must be an integer from ${MINIMUM_EVENT_COUNT} through ${MAXIMUM_EVENT_COUNT}`,
    );
  }
  return count;
}

export async function runClientProjectionSoak(
  eventCount = DEFAULT_EVENT_COUNT,
): Promise<ClientProjectionSoakEvidence> {
  const container = document.createElement("section");
  container.hidden = true;
  container.dataset.testSurface = "client-projection-soak";
  const transcriptList = document.createElement("ol");
  const transcriptOlder = document.createElement("button");
  const transcriptNewer = document.createElement("button");
  const transcriptStatus = document.createElement("span");
  const debugContent = document.createElement("pre");
  const debugOlder = document.createElement("button");
  const debugNewer = document.createElement("button");
  const debugStatus = document.createElement("span");
  container.append(
    transcriptList,
    transcriptOlder,
    transcriptStatus,
    transcriptNewer,
    debugContent,
    debugOlder,
    debugStatus,
    debugNewer,
  );
  document.body.append(container);

  const canonicalEvents: SemanticEvent[] = [];
  let projection = initialExperienceProjection();
  const presentation = new OptionalEventLogPresentation(
    {
      elements: {
        transcriptList,
        transcriptPage: {
          older: transcriptOlder,
          newer: transcriptNewer,
          status: transcriptStatus,
        },
        debugContent,
        debugPage: {
          older: debugOlder,
          newer: debugNewer,
          status: debugStatus,
        },
      },
      events: () => canonicalEvents,
    },
    projection,
  );
  let eventId = 0;
  const sequence = new EventSequence({
    sessionId: "client-projection-soak",
    now: () => "2026-08-20T12:00:00.000Z",
    nextId: () => `soak-event-${++eventId}`,
  });
  const performanceWithMemory = performance as PerformanceWithMemory;
  const heapBefore = performanceWithMemory.memory?.usedJSHeapSize;
  let totalReductionMs = 0;
  let slowestBatchMs = 0;
  let maximumTranscriptRows = 0;

  try {
    for (let start = 0; start < eventCount; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, eventCount);
      const batchStarted = performance.now();
      for (let index = start; index < end; index += 1) {
        const event = sequence.append({
          type: "transcript.final",
          correlationId: `soak-turn-${index + 1}`,
          visibility: "accessible",
          payload: {
            text: `utterance ${index + 1}`,
            confidence: 1,
            retention: "local-save" as const,
          },
        });
        canonicalEvents.push(event);
        projection = reduceExperienceProjection(projection, event);
        presentation.update(projection);
      }
      const batchDuration = performance.now() - batchStarted;
      totalReductionMs += batchDuration;
      slowestBatchMs = Math.max(slowestBatchMs, batchDuration);
      await nextFrame();
    }

    required(
      projection.transcript.length === EXPERIENCE_TRANSCRIPT_LIMIT,
      "transcript projection exceeded its limit",
    );
    required(
      projection.debug.length === EXPERIENCE_DEBUG_LIMIT,
      "debug projection exceeded its limit",
    );
    required(
      projection.sourceEventIds.length === EXPERIENCE_SOURCE_EVENT_LIMIT,
      "source references exceeded their limit",
    );
    const hiddenTranscriptRows = transcriptList.childElementCount;
    const hiddenDebugCharacters = debugContent.textContent?.length ?? 0;
    required(hiddenTranscriptRows === 0, "closed transcript rendered rows");
    required(hiddenDebugCharacters === 0, "closed debug view serialized JSON");

    const optionalViewStarted = performance.now();
    presentation.setTranscriptOpen(true);
    required(
      transcriptList.childElementCount === EXPERIENCE_TRANSCRIPT_LIMIT,
      "opening transcript did not render its bounded latest page",
    );
    const latestFirstRow = transcriptList.firstElementChild?.textContent;
    maximumTranscriptRows = Math.max(
      maximumTranscriptRows,
      transcriptList.childElementCount,
    );
    for (let cycle = 0; cycle < PAGE_CYCLES; cycle += 1) {
      transcriptOlder.click();
      maximumTranscriptRows = Math.max(
        maximumTranscriptRows,
        transcriptList.childElementCount,
      );
    }
    required(
      transcriptList.firstElementChild?.textContent !== latestFirstRow,
      "Older did not move to an earlier transcript page",
    );
    for (let cycle = 0; cycle < PAGE_CYCLES; cycle += 1) {
      transcriptNewer.click();
      maximumTranscriptRows = Math.max(
        maximumTranscriptRows,
        transcriptList.childElementCount,
      );
    }
    required(
      transcriptList.firstElementChild?.textContent === latestFirstRow,
      "Newer did not return to the latest transcript page",
    );
    required(
      maximumTranscriptRows <= EXPERIENCE_TRANSCRIPT_LIMIT,
      "paged transcript exceeded its DOM row limit",
    );
    presentation.setTranscriptOpen(false);

    for (let cycle = 0; cycle < LIFECYCLE_CYCLES; cycle += 1) {
      presentation.setTranscriptOpen(true);
      maximumTranscriptRows = Math.max(
        maximumTranscriptRows,
        transcriptList.childElementCount,
      );
      presentation.setTranscriptOpen(false);
      presentation.setDebugOpen(true);
      required(
        (debugContent.textContent?.length ?? 0) > 0,
        "opening debug did not serialize its bounded latest page",
      );
      presentation.setDebugOpen(false);
      required(
        transcriptList.childElementCount === 0,
        "closing transcript retained DOM rows",
      );
      required(
        (debugContent.textContent?.length ?? 0) === 0,
        "closing debug retained serialized JSON",
      );
    }
    const optionalViewExerciseMs = performance.now() - optionalViewStarted;

    container.remove();
    await nextFrame();
    const heapAfter = performanceWithMemory.memory?.usedJSHeapSize;
    return {
      status: "complete",
      eventCount,
      batchSize: BATCH_SIZE,
      totalReductionMs: Number(totalReductionMs.toFixed(2)),
      slowestBatchMs: Number(slowestBatchMs.toFixed(2)),
      optionalViewExerciseMs: Number(optionalViewExerciseMs.toFixed(2)),
      transcriptItems: projection.transcript.length,
      debugEntries: projection.debug.length,
      sourceEventIds: projection.sourceEventIds.length,
      hiddenTranscriptRows,
      hiddenDebugCharacters,
      maximumTranscriptRows,
      lifecycleCycles: LIFECYCLE_CYCLES,
      pageCycles: PAGE_CYCLES,
      detachedAfterCompletion: !container.isConnected,
      ...(heapBefore === undefined || heapAfter === undefined
        ? {}
        : { heapDeltaBytes: heapAfter - heapBefore }),
    };
  } finally {
    container.remove();
  }
}
