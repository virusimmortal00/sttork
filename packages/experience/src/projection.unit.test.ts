import type { SemanticEvent } from "@zork-voice/contracts";
import { EventSequence } from "@zork-voice/events";
import { describe, expect, it } from "vitest";

import {
  EXPERIENCE_ACTION_LOG_LIMIT,
  initialExperienceProjection,
  projectExperience,
  reduceExperienceProjection,
} from "./projection.js";

function fixtureEvents(): readonly SemanticEvent[] {
  let id = 0;
  const sequence = new EventSequence({
    sessionId: "session",
    now: () => "2026-08-18T20:00:00.000Z",
    nextId: () => `event-${++id}`,
  });
  return [
    sequence.append({
      type: "audio.capture.started",
      correlationId: "turn",
      visibility: "accessible",
      payload: { captureId: "capture", mode: "push-to-talk" },
    }),
    sequence.append({
      type: "audio.capture.ended",
      correlationId: "turn",
      visibility: "accessible",
      payload: { captureId: "capture", durationMs: 500, outcome: "submitted" },
    }),
    sequence.append({
      type: "transcript.final",
      correlationId: "turn",
      visibility: "accessible",
      payload: { text: "go north", confidence: 0.99, retention: "local-save" },
    }),
    sequence.append({
      type: "engine.command.requested",
      correlationId: "turn",
      visibility: "debug",
      payload: { requestId: "request", expectedRevision: 0, command: "north" },
    }),
    sequence.append({
      type: "engine.command.committed",
      correlationId: "turn",
      causationId: "event-4",
      visibility: "debug",
      payload: {
        requestId: "request",
        previousRevision: 0,
        revision: 1,
        command: "north",
        boundary: "input-requested" as const,
      },
    }),
    sequence.append({
      type: "engine.output",
      correlationId: "turn",
      causationId: "event-5",
      visibility: "accessible",
      payload: {
        revision: 1,
        exactText: "North Room\n\n> ",
        boundary: "input-requested" as const,
        retention: "local-save",
      },
    }),
    sequence.append({
      type: "narration.requested",
      correlationId: "turn",
      causationId: "event-6",
      visibility: "debug",
      payload: {
        narrationId: "narration",
        role: "narrator",
        text: "North Room\n\n> ",
        sourceEventId: "event-6",
        retention: "session-only",
      },
    }),
    sequence.append({
      type: "audio.playback.started",
      correlationId: "turn",
      causationId: "event-6",
      visibility: "accessible",
      payload: {
        narrationId: "narration",
        role: "narrator",
        sourceEventId: "event-6",
      },
    }),
    sequence.append({
      type: "audio.playback.ended",
      correlationId: "turn",
      causationId: "event-6",
      visibility: "accessible",
      payload: {
        narrationId: "narration",
        role: "narrator",
        outcome: "complete",
      },
    }),
  ] as readonly SemanticEvent[];
}

function appendOpeningPreparation(sequence: EventSequence) {
  const output = sequence.append({
    type: "engine.output",
    correlationId: "story-start",
    visibility: "accessible",
    payload: {
      revision: 0,
      exactText: "ZORK I\n\nWest of House\nYou are standing in an open field.",
      boundary: "input-requested" as const,
      retention: "local-save" as const,
    },
  });
  const requested = sequence.append({
    type: "narration.requested",
    correlationId: "story-start",
    causationId: output.id,
    visibility: "debug",
    payload: {
      narrationId: "opening-narration",
      role: "narrator" as const,
      text: output.payload.exactText,
      sourceEventId: output.id,
      retention: "session-only" as const,
    },
  });
  return { output, requested } as const;
}

describe("experience projection", () => {
  it("replays exact attributed transcript and audio delivery state", () => {
    const events = fixtureEvents();
    const projection = projectExperience(events);
    expect(projection.displayState).toBe("ready");
    expect(projection.statusText).toBe("Ready");
    expect(projection.activeCommand).toBeUndefined();
    expect(projection.actionLog).toEqual([
      {
        requestId: "request",
        correlationId: "turn",
        command: "north",
        phase: "committed",
        sourceEventIds: ["event-5"],
        throughSequence: 5,
      },
    ]);
    expect(projection.throughSequence).toBe(9);
    expect(
      projection.transcript.map(({ role, text, command, delivery }) => ({
        role,
        text,
        command,
        delivery,
      })),
    ).toEqual([
      {
        role: "player",
        text: "go north",
        command: undefined,
        delivery: "complete",
      },
      { role: "system", text: "north", command: "north", delivery: "complete" },
      {
        role: "game",
        text: "North Room\n\n> ",
        command: undefined,
        delivery: "complete",
      },
    ]);
    expect(projectExperience(events)).toEqual(projection);
    expect(projection.debug).toHaveLength(events.length);
  });

  it("rejects replay out of sequence", () => {
    const [first] = fixtureEvents();
    if (first === undefined) throw new Error("missing fixture event");
    const once = reduceExperienceProjection(
      initialExperienceProjection(),
      first,
    );
    expect(() => reduceExperienceProjection(once, first)).toThrow(
      "must be reduced in sequence order",
    );
  });

  it("returns to ready when an active capture is cancelled", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "cancelled-capture",
      now: () => "2026-08-19T06:42:00.000Z",
      nextId: () => `cancelled-event-${++id}`,
    });
    const projection = projectExperience([
      sequence.append({
        type: "audio.capture.started",
        correlationId: "cancelled-turn",
        visibility: "accessible",
        payload: { captureId: "capture", mode: "push-to-talk" as const },
      }),
      sequence.append({
        type: "audio.capture.ended",
        correlationId: "cancelled-turn",
        visibility: "accessible",
        payload: {
          captureId: "capture",
          durationMs: 0,
          outcome: "cancelled" as const,
        },
      }),
    ]);

    expect(projection.displayState).toBe("ready");
    expect(projection.statusText).toBe("Ready");
  });

  it.each([
    {
      outcome: "complete" as const,
      expectedState: "ready" as const,
      expectedStatus: "Ready",
    },
    {
      outcome: "interrupted" as const,
      expectedState: "ready" as const,
      expectedStatus: "Ready",
    },
    {
      outcome: "failed" as const,
      expectedState: "blocked" as const,
      expectedStatus: "Action needed",
    },
  ])(
    "projects $outcome playback with an actionable terminal state",
    ({ outcome, expectedState, expectedStatus }) => {
      let id = 0;
      const sequence = new EventSequence({
        sessionId: `playback-${outcome}`,
        now: () => "2026-08-19T19:00:00.000Z",
        nextId: () => `playback-${outcome}-event-${++id}`,
      });
      const { output, requested } = appendOpeningPreparation(sequence);
      const ready = sequence.append({
        type: "narration.ready",
        correlationId: "story-start",
        causationId: requested.id,
        visibility: "debug",
        payload: {
          narrationId: "opening-narration",
          role: "narrator" as const,
        },
      });
      const started = sequence.append({
        type: "audio.playback.started",
        correlationId: "story-start",
        causationId: output.id,
        visibility: "accessible",
        payload: {
          narrationId: "opening-narration",
          role: "narrator" as const,
          sourceEventId: output.id,
        },
      });
      const ended = sequence.append({
        type: "audio.playback.ended",
        correlationId: "story-start",
        causationId: output.id,
        visibility: "accessible",
        payload: {
          narrationId: "opening-narration",
          role: "narrator" as const,
          outcome,
        },
      });
      const projection = projectExperience([
        output,
        requested,
        ready,
        started,
        ended,
      ]);

      expect(projection.displayState).toBe(expectedState);
      expect(projection.statusText).toBe(expectedStatus);
      expect(projection.storyStartPhase).toBe("started");
    },
  );

  it.each([
    {
      code: "playback-authorization-required",
      expectedStatus: "Tap Repeat to enable audio",
    },
    {
      code: "budget-exhausted",
      expectedStatus: "Request limit reached",
    },
    { code: "transport-failed", expectedStatus: "Action needed" },
  ])(
    "projects playback failure $code with actionable safe status text",
    ({ code, expectedStatus }) => {
      let id = 0;
      const sequence = new EventSequence({
        sessionId: `playback-failure-${code}`,
        now: () => "2026-08-19T19:05:00.000Z",
        nextId: () => `playback-failure-event-${++id}`,
      });
      const ended = sequence.append({
        type: "audio.playback.ended",
        correlationId: "failed-playback",
        causationId: "narration-source",
        visibility: "accessible",
        payload: {
          narrationId: "failed-narration",
          role: "narrator" as const,
          outcome: "failed" as const,
        },
      });
      const error = sequence.append({
        type: "system.error",
        correlationId: "failed-playback",
        causationId: ended.id,
        visibility: "accessible",
        payload: {
          stage: "narration" as const,
          code,
          recoverable: true,
          engineCommitState: "confirmed" as const,
        },
      });

      expect(projectExperience([ended, error])).toMatchObject({
        displayState: "blocked",
        statusText: expectedStatus,
      });
    },
  );

  it.each([
    {
      eventType: "narration.cancelled" as const,
      expectedState: "ready" as const,
      expectedStatus: "Ready",
      expectedDelivery: "interrupted" as const,
    },
    {
      eventType: "narration.failed" as const,
      expectedState: "blocked" as const,
      expectedStatus: "Action needed",
      expectedDelivery: "failed" as const,
    },
  ])(
    "ends the opening gate on matching $eventType",
    ({ eventType, expectedState, expectedStatus, expectedDelivery }) => {
      let id = 0;
      const sequence = new EventSequence({
        sessionId: `opening-${eventType}`,
        now: () => "2026-08-19T19:10:00.000Z",
        nextId: () => `opening-${eventType}-event-${++id}`,
      });
      const { output, requested } = appendOpeningPreparation(sequence);
      const active = projectExperience([output, requested]);
      const terminal =
        eventType === "narration.cancelled"
          ? sequence.append({
              type: eventType,
              correlationId: "story-start",
              causationId: requested.id,
              visibility: "accessible",
              payload: {
                narrationId: "opening-narration",
                role: "narrator" as const,
                reason: "player-cancelled" as const,
              },
            })
          : sequence.append({
              type: eventType,
              correlationId: "story-start",
              causationId: requested.id,
              visibility: "accessible",
              payload: {
                narrationId: "opening-narration",
                role: "narrator" as const,
                recoverable: true as const,
              },
            });
      const projected = reduceExperienceProjection(active, terminal);

      expect(active).toMatchObject({
        displayState: "processing",
        statusText: "Preparing story",
        storyStartPhase: "starting",
        storyStartSource: {
          outputEventId: output.id,
          correlationId: "story-start",
          narration: {
            id: "opening-narration",
            requestEventId: requested.id,
          },
        },
      });
      expect(projected).toMatchObject({
        displayState: expectedState,
        statusText: expectedStatus,
        storyStartPhase: "started",
        transcript: [{ delivery: expectedDelivery }],
      });
      expect(projectExperience([output, requested, terminal])).toEqual(
        projected,
      );
    },
  );

  it("does not end the opening gate for an unrelated narrator terminal", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "opening-unrelated-terminal",
      now: () => "2026-08-19T19:12:00.000Z",
      nextId: () => `opening-unrelated-event-${++id}`,
    });
    const { output, requested } = appendOpeningPreparation(sequence);
    const active = projectExperience([output, requested]);
    const projected = reduceExperienceProjection(
      active,
      sequence.append({
        type: "narration.failed",
        correlationId: "story-start",
        causationId: requested.id,
        visibility: "accessible",
        payload: {
          narrationId: "different-narration",
          role: "narrator" as const,
          recoverable: true as const,
        },
      }),
    );

    expect(projected).toMatchObject({
      displayState: "processing",
      statusText: "Preparing story",
      storyStartPhase: "starting",
    });
  });

  it("replays a failed opening narration to the same blocked projection", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "opening-playback-failure",
      now: () => "2026-08-19T19:15:00.000Z",
      nextId: () => `opening-event-${++id}`,
    });
    const { output, requested } = appendOpeningPreparation(sequence);
    const ready = sequence.append({
      type: "narration.ready",
      correlationId: "story-start",
      causationId: requested.id,
      visibility: "debug",
      payload: {
        narrationId: "opening-narration",
        role: "narrator" as const,
      },
    });
    const started = sequence.append({
      type: "audio.playback.started",
      correlationId: "story-start",
      causationId: output.id,
      visibility: "accessible",
      payload: {
        narrationId: "opening-narration",
        role: "narrator" as const,
        sourceEventId: output.id,
      },
    });
    const failed = sequence.append({
      type: "audio.playback.ended",
      correlationId: "story-start",
      causationId: output.id,
      visibility: "accessible",
      payload: {
        narrationId: "opening-narration",
        role: "narrator" as const,
        outcome: "failed" as const,
      },
    });
    const prefix = [output, requested, ready, started] as const;
    const incrementallyProjected = reduceExperienceProjection(
      projectExperience(prefix),
      failed,
    );
    const replayed = projectExperience([...prefix, failed]);

    expect(replayed).toEqual(incrementallyProjected);
    expect(replayed).toMatchObject({
      displayState: "blocked",
      statusText: "Action needed",
      storyStartPhase: "started",
    });
    expect(replayed.transcript).toMatchObject([
      {
        role: "game",
        text: output.payload.exactText,
        delivery: "failed",
      },
    ]);
  });

  it("projects a canonical command until matching narrator playback ends", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "command-cue",
      now: () => "2026-08-19T18:00:00.000Z",
      nextId: () => `command-event-${++id}`,
    });
    const requested = sequence.append({
      type: "engine.command.requested",
      correlationId: "command-turn",
      visibility: "debug",
      payload: {
        requestId: "command-request",
        expectedRevision: 0,
        command: "examine leaflet",
      },
    });
    let projection = reduceExperienceProjection(
      initialExperienceProjection(),
      requested,
    );
    expect(projection.activeCommand).toEqual({
      requestId: "command-request",
      correlationId: "command-turn",
      command: "examine leaflet",
      phase: "requested",
      sourceEventIds: [requested.id],
      throughSequence: requested.sequence,
    });
    expect(projection.actionLog).toEqual([]);

    const committed = sequence.append({
      type: "engine.command.committed",
      correlationId: "command-turn",
      causationId: requested.id,
      visibility: "debug",
      payload: {
        requestId: "command-request",
        previousRevision: 0,
        revision: 1,
        command: "examine leaflet",
        boundary: "input-requested" as const,
      },
    });
    projection = reduceExperienceProjection(projection, committed);
    expect(projection.activeCommand).toMatchObject({
      phase: "committed",
      sourceEventIds: [requested.id, committed.id],
      throughSequence: committed.sequence,
    });

    const output = sequence.append({
      type: "engine.output",
      correlationId: "command-turn",
      causationId: committed.id,
      visibility: "accessible",
      payload: {
        revision: 1,
        exactText: "Welcome to Zork!",
        boundary: "input-requested" as const,
        retention: "local-save" as const,
      },
    });
    projection = reduceExperienceProjection(projection, output);
    expect(projection.activeCommand?.command).toBe("examine leaflet");

    const narrationRequested = sequence.append({
      type: "narration.requested",
      correlationId: "command-turn",
      causationId: output.id,
      visibility: "debug",
      payload: {
        narrationId: "narrator-narration",
        role: "narrator" as const,
        text: "Welcome to Zork!",
        sourceEventId: output.id,
        retention: "session-only" as const,
      },
    });
    projection = reduceExperienceProjection(projection, narrationRequested);
    expect(projection.activeCommand?.narrationId).toBe("narrator-narration");

    const guideEnded = sequence.append({
      type: "audio.playback.ended",
      correlationId: "command-turn",
      visibility: "accessible",
      payload: {
        narrationId: "guide-narration",
        role: "guide" as const,
        outcome: "complete" as const,
      },
    });
    projection = reduceExperienceProjection(projection, guideEnded);
    expect(projection.activeCommand?.command).toBe("examine leaflet");

    const narratorEnded = sequence.append({
      type: "audio.playback.ended",
      correlationId: "command-turn",
      causationId: output.id,
      visibility: "accessible",
      payload: {
        narrationId: "narrator-narration",
        role: "narrator" as const,
        outcome: "complete" as const,
      },
    });
    projection = reduceExperienceProjection(projection, narratorEnded);
    expect(projection.activeCommand).toBeUndefined();
  });

  it("clears stale or failed command cues without a timer", () => {
    function requestedProjection(): {
      readonly sequence: EventSequence;
      readonly projection: ReturnType<typeof projectExperience>;
    } {
      let id = 0;
      const sequence = new EventSequence({
        sessionId: "command-clear",
        now: () => "2026-08-19T18:15:00.000Z",
        nextId: () => `clear-event-${++id}`,
      });
      return {
        sequence,
        projection: projectExperience([
          sequence.append({
            type: "engine.command.requested",
            correlationId: "clear-turn",
            visibility: "debug",
            payload: {
              requestId: "clear-request",
              expectedRevision: 0,
              command: "open mailbox",
            },
          }),
        ]),
      };
    }

    function narratorPendingProjection(): ReturnType<
      typeof requestedProjection
    > {
      const pending = requestedProjection();
      const requestEventId =
        pending.projection.activeCommand?.sourceEventIds[0];
      if (requestEventId === undefined) throw new Error("missing command cue");
      const committed = pending.sequence.append({
        type: "engine.command.committed",
        correlationId: "clear-turn",
        causationId: requestEventId,
        visibility: "debug",
        payload: {
          requestId: "clear-request",
          previousRevision: 0,
          revision: 1,
          command: "open mailbox",
          boundary: "input-requested" as const,
        },
      });
      const committedProjection = reduceExperienceProjection(
        pending.projection,
        committed,
      );
      const output = pending.sequence.append({
        type: "engine.output",
        correlationId: "clear-turn",
        causationId: committed.id,
        visibility: "accessible",
        payload: {
          revision: 1,
          exactText: "Opening the small mailbox reveals a leaflet.",
          boundary: "input-requested" as const,
          retention: "local-save" as const,
        },
      });
      const outputProjection = reduceExperienceProjection(
        committedProjection,
        output,
      );
      return {
        sequence: pending.sequence,
        projection: reduceExperienceProjection(
          outputProjection,
          pending.sequence.append({
            type: "narration.requested",
            correlationId: "clear-turn",
            causationId: output.id,
            visibility: "debug",
            payload: {
              narrationId: "narration",
              role: "narrator" as const,
              text: "Opening the small mailbox reveals a leaflet.",
              sourceEventId: output.id,
              retention: "session-only" as const,
            },
          }),
        ),
      };
    }

    const rejected = requestedProjection();
    expect(
      reduceExperienceProjection(
        rejected.projection,
        rejected.sequence.append({
          type: "engine.command.rejected",
          correlationId: "clear-turn",
          visibility: "accessible",
          payload: {
            requestId: "clear-request",
            revision: 0,
            command: "open mailbox",
            reason: "stale-revision",
          },
        }),
      ).activeCommand,
    ).toBeUndefined();

    const reusedRequestId = requestedProjection();
    let reusedProjection = reduceExperienceProjection(
      reusedRequestId.projection,
      reusedRequestId.sequence.append({
        type: "engine.command.committed",
        correlationId: "another-turn",
        visibility: "debug",
        payload: {
          requestId: "clear-request",
          previousRevision: 0,
          revision: 1,
          command: "open mailbox",
          boundary: "input-requested" as const,
        },
      }),
    );
    expect(reusedProjection.activeCommand?.phase).toBe("requested");
    reusedProjection = reduceExperienceProjection(
      reusedProjection,
      reusedRequestId.sequence.append({
        type: "engine.command.rejected",
        correlationId: "another-turn",
        visibility: "accessible",
        payload: {
          requestId: "clear-request",
          revision: 1,
          command: "open mailbox",
          reason: "duplicate",
        },
      }),
    );
    expect(reusedProjection.activeCommand?.phase).toBe("requested");

    const failedNarration = narratorPendingProjection();
    expect(
      reduceExperienceProjection(
        failedNarration.projection,
        failedNarration.sequence.append({
          type: "narration.failed",
          correlationId: "clear-turn",
          visibility: "accessible",
          payload: {
            narrationId: "narration",
            role: "narrator" as const,
            recoverable: true as const,
          },
        }),
      ).activeCommand,
    ).toBeUndefined();

    const wrongNarration = narratorPendingProjection();
    expect(
      reduceExperienceProjection(
        wrongNarration.projection,
        wrongNarration.sequence.append({
          type: "audio.playback.ended",
          correlationId: "clear-turn",
          causationId: "other-output",
          visibility: "accessible",
          payload: {
            narrationId: "narration",
            role: "narrator" as const,
            outcome: "complete" as const,
          },
        }),
      ).activeCommand?.command,
    ).toBe("open mailbox");

    const uncertainEngine = requestedProjection();
    expect(
      reduceExperienceProjection(
        uncertainEngine.projection,
        uncertainEngine.sequence.append({
          type: "system.error",
          correlationId: "clear-turn",
          visibility: "accessible",
          payload: {
            stage: "engine" as const,
            code: "engine-outcome-uncertain",
            recoverable: true,
            engineCommitState: "unknown" as const,
          },
        }),
      ).activeCommand,
    ).toBeUndefined();

    const unrelatedError = requestedProjection();
    expect(
      reduceExperienceProjection(
        unrelatedError.projection,
        unrelatedError.sequence.append({
          type: "system.error",
          correlationId: "another-turn",
          visibility: "accessible",
          payload: {
            stage: "engine" as const,
            code: "engine-outcome-uncertain",
            recoverable: true,
            engineCommitState: "unknown" as const,
          },
        }),
      ).activeCommand?.command,
    ).toBe("open mailbox");

    const notSubmitted = requestedProjection();
    expect(
      reduceExperienceProjection(
        notSubmitted.projection,
        notSubmitted.sequence.append({
          type: "system.error",
          correlationId: "clear-turn",
          visibility: "accessible",
          payload: {
            stage: "coordinator" as const,
            code: "turn-failed-before-submit",
            recoverable: true,
            engineCommitState: "not-submitted" as const,
          },
        }),
      ).activeCommand,
    ).toBeUndefined();

    const paused = requestedProjection();
    expect(
      reduceExperienceProjection(
        paused.projection,
        paused.sequence.append({
          type: "session.paused",
          correlationId: "clear-turn",
          visibility: "accessible",
          payload: { reason: "player-request" as const },
        }),
      ).activeCommand,
    ).toBeUndefined();

    const nextTextTurn = requestedProjection();
    expect(
      reduceExperienceProjection(
        nextTextTurn.projection,
        nextTextTurn.sequence.append({
          type: "transcript.final",
          correlationId: "next-text-turn",
          visibility: "accessible",
          payload: {
            text: "what can I do?",
            confidence: 1,
            retention: "local-save" as const,
          },
        }),
      ).activeCommand,
    ).toBeUndefined();

    const nextCapture = requestedProjection();
    expect(
      reduceExperienceProjection(
        nextCapture.projection,
        nextCapture.sequence.append({
          type: "audio.capture.started",
          correlationId: "next-turn",
          visibility: "accessible",
          payload: {
            captureId: "next-capture",
            mode: "push-to-talk" as const,
          },
        }),
      ).activeCommand,
    ).toBeUndefined();
  });

  it("reconstructs a recovered command cue from the canonical commit", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "command-recovery",
      now: () => "2026-08-19T18:30:00.000Z",
      nextId: () => `recovery-event-${++id}`,
    });
    let projection = projectExperience([
      sequence.append({
        type: "engine.command.requested",
        correlationId: "recovery-turn",
        visibility: "debug",
        payload: {
          requestId: "recovery-request",
          expectedRevision: 0,
          command: "north",
        },
      }),
    ]);
    const uncertain = sequence.append({
      type: "system.error",
      correlationId: "recovery-turn",
      visibility: "accessible",
      payload: {
        stage: "engine" as const,
        code: "engine-outcome-uncertain",
        recoverable: true,
        engineCommitState: "unknown" as const,
      },
    });
    projection = reduceExperienceProjection(projection, uncertain);
    expect(projection.activeCommand).toBeUndefined();

    const recovered = sequence.append({
      type: "system.recovered",
      correlationId: "recovery-turn",
      causationId: uncertain.id,
      visibility: "debug",
      payload: {
        stage: "engine" as const,
        requestId: "recovery-request",
        revision: 1,
      },
    });
    projection = reduceExperienceProjection(projection, recovered);
    projection = reduceExperienceProjection(
      projection,
      sequence.append({
        type: "engine.command.committed",
        correlationId: "recovery-turn",
        causationId: recovered.id,
        visibility: "debug",
        payload: {
          requestId: "recovery-request",
          previousRevision: 0,
          revision: 1,
          command: "north",
          boundary: "input-requested" as const,
        },
      }),
    );
    expect(projection.activeCommand).toMatchObject({
      requestId: "recovery-request",
      correlationId: "recovery-turn",
      command: "north",
      phase: "committed",
    });
    expect(projection.actionLog).toMatchObject([
      {
        requestId: "recovery-request",
        command: "north",
        phase: "committed",
        sourceEventIds: ["recovery-event-4"],
      },
    ]);

    projection = reduceExperienceProjection(
      projection,
      sequence.append({
        type: "engine.command.committed",
        correlationId: "recovery-turn",
        causationId: recovered.id,
        visibility: "debug",
        payload: {
          requestId: "recovery-request",
          previousRevision: 0,
          revision: 1,
          command: "north",
          boundary: "input-requested" as const,
        },
      }),
    );
    expect(projection.actionLog).toHaveLength(1);
    expect(projection.actionLog[0]?.sourceEventIds).toEqual([
      "recovery-event-4",
      "recovery-event-5",
    ]);
  });

  it("keeps a newest-first bounded command history after transient cues clear", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "action-log",
      now: () => "2026-08-19T20:00:00.000Z",
      nextId: () => `action-event-${++id}`,
    });
    const events: SemanticEvent[] = [];
    for (let index = 1; index <= EXPERIENCE_ACTION_LOG_LIMIT + 2; index += 1) {
      const correlationId = `action-turn-${index}`;
      const requestId = `action-request-${index}`;
      const command = `examine object ${index}`;
      const requested = sequence.append({
        type: "engine.command.requested",
        correlationId,
        visibility: "debug",
        payload: { requestId, expectedRevision: index - 1, command },
      });
      events.push(
        requested,
        sequence.append({
          type: "engine.command.committed",
          correlationId,
          causationId: requested.id,
          visibility: "debug",
          payload: {
            requestId,
            previousRevision: index - 1,
            revision: index,
            command,
            boundary: "input-requested" as const,
          },
        }),
      );
    }

    const projection = projectExperience(events);
    expect(projection.actionLog).toHaveLength(EXPERIENCE_ACTION_LOG_LIMIT);
    expect(projection.actionLog.map(({ command }) => command)).toEqual(
      Array.from(
        { length: EXPERIENCE_ACTION_LOG_LIMIT },
        (_, offset) =>
          `examine object ${EXPERIENCE_ACTION_LOG_LIMIT + 2 - offset}`,
      ),
    );

    const nextCapture = sequence.append({
      type: "audio.capture.started",
      correlationId: "later-turn",
      visibility: "accessible",
      payload: { captureId: "later-capture", mode: "push-to-talk" as const },
    });
    const afterCueClear = reduceExperienceProjection(projection, nextCapture);
    expect(afterCueClear.activeCommand).toBeUndefined();
    expect(afterCueClear.actionLog).toEqual(projection.actionLog);

    const paused = reduceExperienceProjection(
      afterCueClear,
      sequence.append({
        type: "session.paused",
        correlationId: "later-turn",
        visibility: "accessible",
        payload: { reason: "player-request" as const },
      }),
    );
    const afterNarrationFailure = reduceExperienceProjection(
      paused,
      sequence.append({
        type: "narration.failed",
        correlationId: "later-turn",
        visibility: "accessible",
        payload: {
          narrationId: "failed-narration",
          role: "narrator" as const,
          recoverable: true as const,
        },
      }),
    );
    expect(paused.actionLog).toEqual(projection.actionLog);
    expect(afterNarrationFailure.actionLog).toEqual(projection.actionLog);
  });

  it("does not persist rejected or uncertain attempts as completed actions", () => {
    let id = 0;
    const sequence = new EventSequence({
      sessionId: "action-outcomes",
      now: () => "2026-08-19T20:15:00.000Z",
      nextId: () => `outcome-event-${++id}`,
    });
    const events: SemanticEvent[] = [];
    const rejectedRequest = sequence.append({
      type: "engine.command.requested",
      correlationId: "rejected-turn",
      visibility: "debug",
      payload: {
        requestId: "rejected-request",
        expectedRevision: 0,
        command: "open mailbox",
      },
    });
    events.push(
      rejectedRequest,
      sequence.append({
        type: "engine.command.rejected",
        correlationId: "rejected-turn",
        causationId: rejectedRequest.id,
        visibility: "accessible",
        payload: {
          requestId: "rejected-request",
          revision: 0,
          command: "open mailbox",
          reason: "stale_revision",
        },
      }),
    );
    const uncertainRequest = sequence.append({
      type: "engine.command.requested",
      correlationId: "uncertain-turn",
      visibility: "debug",
      payload: {
        requestId: "uncertain-request",
        expectedRevision: 0,
        command: "north",
      },
    });
    events.push(
      uncertainRequest,
      sequence.append({
        type: "system.error",
        correlationId: "uncertain-turn",
        causationId: uncertainRequest.id,
        visibility: "accessible",
        payload: {
          stage: "engine" as const,
          code: "engine-outcome-uncertain",
          recoverable: true,
          engineCommitState: "unknown" as const,
        },
      }),
    );
    const cancelledRequest = sequence.append({
      type: "engine.command.requested",
      correlationId: "cancelled-turn",
      visibility: "debug",
      payload: {
        requestId: "cancelled-request",
        expectedRevision: 0,
        command: "take leaflet",
      },
    });
    events.push(
      cancelledRequest,
      sequence.append({
        type: "system.error",
        correlationId: "cancelled-turn",
        causationId: cancelledRequest.id,
        visibility: "accessible",
        payload: {
          stage: "engine" as const,
          code: "cancelled-before-engine-submit",
          recoverable: true,
          engineCommitState: "not-submitted" as const,
        },
      }),
    );
    const projection = projectExperience(events);

    expect(projection.actionLog).toEqual([]);
    expect(projection.activeCommand).toBeUndefined();
  });
});
