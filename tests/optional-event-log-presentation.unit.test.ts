import type { SemanticEvent } from "../packages/contracts/src/index.js";
import { EventSequence } from "../packages/events/src/index.js";
import {
  EXPERIENCE_TRANSCRIPT_LIMIT,
  projectExperience,
  reduceExperienceProjection,
} from "../packages/experience/src/index.js";
import { describe, expect, it } from "vitest";

import { OptionalEventLogPresentation } from "../apps/web/src/optional-event-log-presentation.js";
import { clientProjectionSoakEventCount } from "../apps/web/src/optional-event-log-soak.js";

interface FakeElement {
  readonly dataset: Record<string, string>;
  readonly children: FakeElement[];
  readonly listeners: Map<string, () => void>;
  readonly ownerDocument: { createElement(tag: string): FakeElement };
  textContent: string | null;
  disabled: boolean;
  replaceWrites: number;
  addEventListener(type: string, listener: () => void): void;
  replaceChildren(...children: FakeElement[]): void;
  click(): void;
}

function fakeDocument(): FakeElement["ownerDocument"] {
  const document = {
    createElement: (): FakeElement => fakeElement(document),
  };
  return document;
}

function fakeElement(document = fakeDocument()): FakeElement {
  const children: FakeElement[] = [];
  const listeners = new Map<string, () => void>();
  return {
    dataset: {},
    children,
    listeners,
    ownerDocument: document,
    textContent: null,
    disabled: false,
    replaceWrites: 0,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    replaceChildren(...nextChildren) {
      this.replaceWrites += 1;
      children.splice(0, children.length, ...nextChildren);
    },
    click() {
      listeners.get("click")?.();
    },
  };
}

function transcriptEvents(count: number): readonly SemanticEvent[] {
  let id = 0;
  const sequence = new EventSequence({
    sessionId: "presentation-session",
    now: () => "2026-08-20T12:00:00.000Z",
    nextId: () => `event-${++id}`,
  });
  return Array.from({ length: count }, (_, index) =>
    sequence.append({
      type: "transcript.final",
      correlationId: `turn-${index + 1}`,
      visibility: "accessible",
      payload: {
        text: `utterance ${index + 1}`,
        confidence: 1,
        retention: "local-save" as const,
      },
    }),
  );
}

function fixture(events: readonly SemanticEvent[]) {
  const document = fakeDocument();
  const transcriptList = fakeElement(document);
  const transcriptOlder = fakeElement(document);
  const transcriptNewer = fakeElement(document);
  const transcriptStatus = fakeElement(document);
  const debugContent = fakeElement(document);
  const debugOlder = fakeElement(document);
  const debugNewer = fakeElement(document);
  const debugStatus = fakeElement(document);
  const projection = projectExperience(events);
  const subject = new OptionalEventLogPresentation(
    {
      elements: {
        transcriptList: transcriptList as unknown as HTMLOListElement,
        transcriptPage: {
          older: transcriptOlder as unknown as HTMLButtonElement,
          newer: transcriptNewer as unknown as HTMLButtonElement,
          status: transcriptStatus as unknown as HTMLElement,
        },
        debugContent: debugContent as unknown as HTMLElement,
        debugPage: {
          older: debugOlder as unknown as HTMLButtonElement,
          newer: debugNewer as unknown as HTMLButtonElement,
          status: debugStatus as unknown as HTMLElement,
        },
      },
      events: () => events,
    },
    projection,
  );
  return {
    subject,
    projection,
    transcriptList,
    transcriptOlder,
    transcriptNewer,
    transcriptStatus,
    debugContent,
  };
}

describe("optional event log presentation", () => {
  it("accepts only bounded opt-in browser soak sizes", () => {
    expect(clientProjectionSoakEventCount("")).toBeUndefined();
    expect(clientProjectionSoakEventCount("?projection-soak")).toBe(50_000);
    expect(clientProjectionSoakEventCount("?projection-soak=1000")).toBe(1_000);
    expect(() =>
      clientProjectionSoakEventCount("?projection-soak=999"),
    ).toThrow(RangeError);
    expect(() =>
      clientProjectionSoakEventCount("?projection-soak=100001"),
    ).toThrow(RangeError);
  });

  it("does no transcript or debug rendering while the views are closed", () => {
    const events = transcriptEvents(2);
    const view = fixture(events);

    view.subject.update(view.projection);

    expect(view.transcriptList.replaceWrites).toBe(0);
    expect(view.transcriptList.children).toEqual([]);
    expect(view.debugContent.textContent).toBeNull();
  });

  it("reuses unchanged transcript rows while the latest page is open", () => {
    const events = transcriptEvents(2);
    const view = fixture(events);
    view.subject.setTranscriptOpen(true);
    const firstRow = view.transcriptList.children[0];

    view.subject.update(view.projection);
    expect(view.transcriptList.replaceWrites).toBe(1);

    const sequence = new EventSequence({
      sessionId: "later",
      firstSequence: 3,
      now: () => "2026-08-20T12:00:00.000Z",
      nextId: () => "event-3",
    });
    const next = sequence.append({
      type: "transcript.final",
      correlationId: "turn-3",
      visibility: "accessible",
      payload: {
        text: "utterance 3",
        confidence: 1,
        retention: "local-save" as const,
      },
    });
    const updated = reduceExperienceProjection(view.projection, next);
    view.subject.update(updated);

    expect(view.transcriptList.replaceWrites).toBe(2);
    expect(view.transcriptList.children[0]).toBe(firstRow);
    expect(view.transcriptList.children.at(-1)?.textContent).toBe(
      "player: utterance 3",
    );
  });

  it("pages through canonical transcript history with bounded DOM rows", () => {
    const total = EXPERIENCE_TRANSCRIPT_LIMIT + 17;
    const events = transcriptEvents(total);
    const view = fixture(events);

    view.subject.setTranscriptOpen(true);
    expect(view.transcriptList.children).toHaveLength(
      EXPERIENCE_TRANSCRIPT_LIMIT,
    );
    expect(view.transcriptList.children[0]?.textContent).toBe(
      "player: utterance 18",
    );
    expect(view.transcriptOlder.disabled).toBe(false);
    expect(view.transcriptNewer.disabled).toBe(true);

    view.transcriptOlder.click();
    expect(view.transcriptList.children).toHaveLength(17);
    expect(view.transcriptList.children[0]?.textContent).toBe(
      "player: utterance 1",
    );
    expect(view.transcriptStatus.textContent).toBe("Earlier transcript");
    expect(view.transcriptOlder.disabled).toBe(true);
    expect(view.transcriptNewer.disabled).toBe(false);

    view.transcriptNewer.click();
    expect(view.transcriptList.children).toHaveLength(
      EXPERIENCE_TRANSCRIPT_LIMIT,
    );
    expect(view.transcriptList.children[0]?.textContent).toBe(
      "player: utterance 18",
    );
  });

  it("disposes optional rows and serialized evidence when views close", () => {
    const events = transcriptEvents(4);
    const view = fixture(events);
    view.subject.setTranscriptOpen(true);
    view.subject.setDebugOpen(true);
    expect(view.transcriptList.children).toHaveLength(4);
    expect(view.debugContent.textContent).toContain('"events"');

    view.subject.setTranscriptOpen(false);
    view.subject.setDebugOpen(false);

    expect(view.transcriptList.children).toEqual([]);
    expect(view.debugContent.textContent).toBe("");
  });
});
