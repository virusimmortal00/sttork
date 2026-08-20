import type { SemanticEvent } from "../../../packages/contracts/src/index.js";
import {
  initialExperienceProjection,
  reduceExperienceProjection,
  type ExperienceProjectionState,
  type TranscriptItemProjection,
} from "../../../packages/experience/src/index.js";

interface PageControls {
  readonly older: HTMLButtonElement;
  readonly newer: HTMLButtonElement;
  readonly status: HTMLElement;
}

export interface OptionalEventLogElements {
  readonly transcriptList: HTMLOListElement;
  readonly transcriptPage: PageControls;
  readonly debugContent: HTMLElement;
  readonly debugPage: PageControls;
}

export interface OptionalEventLogPresentationOptions {
  readonly elements: OptionalEventLogElements;
  readonly events: () => readonly SemanticEvent[];
}

interface TranscriptRenderState {
  readonly key: string;
  readonly rows: ReadonlyMap<string, HTMLLIElement>;
}

const transcriptRenderStates = new WeakMap<object, TranscriptRenderState>();

function transcriptRenderKey(
  transcript: readonly TranscriptItemProjection[],
): string {
  return transcript
    .map(
      (item) =>
        `${item.id}\u0000${item.throughSequence}\u0000${item.role}\u0000${item.text}`,
    )
    .join("\u0001");
}

export function applyTranscriptPresentation(
  transcript: readonly TranscriptItemProjection[],
  element: HTMLOListElement,
): void {
  const key = transcriptRenderKey(transcript);
  const previous = transcriptRenderStates.get(element);
  if (previous?.key === key) return;

  const rows = new Map<string, HTMLLIElement>();
  const ordered = transcript.map((item) => {
    const row =
      previous?.rows.get(item.id) ?? element.ownerDocument.createElement("li");
    row.dataset.projectionId = item.id;
    row.dataset.role = item.role;
    const text = `${item.role}: ${item.text}`;
    if (row.textContent !== text) row.textContent = text;
    rows.set(item.id, row);
    return row;
  });
  element.replaceChildren(...ordered);
  transcriptRenderStates.set(element, { key, rows });
}

export function clearTranscriptPresentation(element: HTMLOListElement): void {
  element.replaceChildren();
  transcriptRenderStates.delete(element);
}

function transcriptSourceSequence(event: SemanticEvent): number | undefined {
  switch (event.type) {
    case "transcript.final":
    case "experience.role-introduction":
    case "guide.clarification":
    case "guide.explanation":
    case "guide.cannot_comply":
    case "engine.command.requested":
    case "engine.output":
    case "system.error":
      return event.sequence;
    default:
      return undefined;
  }
}

function projectionBefore(
  events: readonly SemanticEvent[],
  beforeSequence: number,
): ExperienceProjectionState {
  let projection = initialExperienceProjection();
  for (const event of events) {
    if (event.sequence >= beforeSequence) break;
    projection = reduceExperienceProjection(projection, event);
  }
  return projection;
}

function firstTranscriptSequence(
  events: readonly SemanticEvent[],
): number | undefined {
  for (const event of events) {
    const sequence = transcriptSourceSequence(event);
    if (sequence !== undefined) return sequence;
  }
  return undefined;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export class OptionalEventLogPresentation {
  readonly #elements: OptionalEventLogElements;
  readonly #events: () => readonly SemanticEvent[];
  #projection: ExperienceProjectionState;
  #transcriptOpen = false;
  #debugOpen = false;
  #transcriptCutoffs: number[] = [];
  #debugCutoffs: number[] = [];
  #firstTranscriptSequence: number | undefined;
  #firstDebugSequence: number | undefined;

  public constructor(
    options: OptionalEventLogPresentationOptions,
    initialProjection: ExperienceProjectionState,
  ) {
    this.#elements = options.elements;
    this.#events = options.events;
    this.#projection = initialProjection;
    options.elements.transcriptPage.older.addEventListener("click", () =>
      this.#showOlderTranscript(),
    );
    options.elements.transcriptPage.newer.addEventListener("click", () =>
      this.#showNewerTranscript(),
    );
    options.elements.debugPage.older.addEventListener("click", () =>
      this.#showOlderDebug(),
    );
    options.elements.debugPage.newer.addEventListener("click", () =>
      this.#showNewerDebug(),
    );
  }

  public update(projection: ExperienceProjectionState): void {
    this.#projection = projection;
    if (this.#transcriptOpen && this.#transcriptCutoffs.length === 0) {
      this.#renderTranscript(projection);
    }
    if (this.#debugOpen && this.#debugCutoffs.length === 0) {
      this.#renderDebug(projection);
    }
  }

  public setTranscriptOpen(open: boolean): void {
    if (this.#transcriptOpen === open) return;
    this.#transcriptOpen = open;
    this.#transcriptCutoffs = [];
    if (!open) {
      clearTranscriptPresentation(this.#elements.transcriptList);
      return;
    }
    const events = this.#events();
    this.#firstTranscriptSequence = firstTranscriptSequence(events);
    this.#renderTranscript(this.#projection);
  }

  public setDebugOpen(open: boolean): void {
    if (this.#debugOpen === open) return;
    this.#debugOpen = open;
    this.#debugCutoffs = [];
    if (!open) {
      setText(this.#elements.debugContent, "");
      return;
    }
    this.#firstDebugSequence = this.#events()[0]?.sequence;
    this.#renderDebug(this.#projection);
  }

  #showOlderTranscript(): void {
    if (!this.#transcriptOpen) return;
    const current = this.#transcriptProjection();
    const cutoff = current.transcript[0]?.introducedAtSequence;
    if (
      cutoff === undefined ||
      this.#firstTranscriptSequence === undefined ||
      cutoff <= this.#firstTranscriptSequence
    ) {
      return;
    }
    this.#transcriptCutoffs.push(cutoff);
    this.#renderTranscript(this.#transcriptProjection());
  }

  #showNewerTranscript(): void {
    if (!this.#transcriptOpen || this.#transcriptCutoffs.length === 0) return;
    this.#transcriptCutoffs.pop();
    this.#renderTranscript(this.#transcriptProjection());
  }

  #showOlderDebug(): void {
    if (!this.#debugOpen) return;
    const current = this.#debugProjection();
    const cutoff = current.debug[0]?.sequence;
    if (
      cutoff === undefined ||
      this.#firstDebugSequence === undefined ||
      cutoff <= this.#firstDebugSequence
    ) {
      return;
    }
    this.#debugCutoffs.push(cutoff);
    this.#renderDebug(this.#debugProjection());
  }

  #showNewerDebug(): void {
    if (!this.#debugOpen || this.#debugCutoffs.length === 0) return;
    this.#debugCutoffs.pop();
    this.#renderDebug(this.#debugProjection());
  }

  #transcriptProjection(): ExperienceProjectionState {
    const cutoff = this.#transcriptCutoffs.at(-1);
    return cutoff === undefined
      ? this.#projection
      : projectionBefore(this.#events(), cutoff);
  }

  #debugProjection(): ExperienceProjectionState {
    const cutoff = this.#debugCutoffs.at(-1);
    return cutoff === undefined
      ? this.#projection
      : projectionBefore(this.#events(), cutoff);
  }

  #renderTranscript(projection: ExperienceProjectionState): void {
    applyTranscriptPresentation(
      projection.transcript,
      this.#elements.transcriptList,
    );
    const first = projection.transcript[0]?.introducedAtSequence;
    this.#elements.transcriptPage.older.disabled =
      first === undefined ||
      this.#firstTranscriptSequence === undefined ||
      first <= this.#firstTranscriptSequence;
    this.#elements.transcriptPage.newer.disabled =
      this.#transcriptCutoffs.length === 0;
    setText(
      this.#elements.transcriptPage.status,
      this.#transcriptCutoffs.length === 0
        ? "Most recent transcript"
        : "Earlier transcript",
    );
  }

  #renderDebug(projection: ExperienceProjectionState): void {
    const text = JSON.stringify(
      {
        throughSequence: projection.throughSequence,
        events: projection.debug,
      },
      null,
      2,
    );
    setText(this.#elements.debugContent, text);
    const first = projection.debug[0]?.sequence;
    this.#elements.debugPage.older.disabled =
      first === undefined ||
      this.#firstDebugSequence === undefined ||
      first <= this.#firstDebugSequence;
    this.#elements.debugPage.newer.disabled = this.#debugCutoffs.length === 0;
    setText(
      this.#elements.debugPage.status,
      this.#debugCutoffs.length === 0 ? "Most recent events" : "Earlier events",
    );
  }
}
