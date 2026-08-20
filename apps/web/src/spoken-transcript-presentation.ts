const BASE_WORDS_PER_MINUTE = 170;
const MIN_WORD_INTERVAL_MS = 180;
const MAX_WORD_INTERVAL_MS = 560;
const LINE_SETTLE_MS = 260;
const HISTORY_LIMIT = 6;
export type SpokenTranscriptRole = "guide" | "narrator";

type ScheduledHandle = number;

export interface SpokenTranscriptElements {
  readonly region: HTMLElement;
  readonly activeLine: HTMLElement;
  readonly history: HTMLOListElement;
}

export interface SpokenTranscriptOptions {
  readonly reducedMotion?: boolean;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly cancelScheduled?: (handle: ScheduledHandle) => void;
}

export function spokenNarrationLines(text: string): readonly string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line.length > 0);
}

export function spokenWordIntervalMs(rate: number): number {
  const safeRate = Number.isFinite(rate)
    ? Math.min(1.25, Math.max(0.75, rate))
    : 1;
  return Math.min(
    MAX_WORD_INTERVAL_MS,
    Math.max(
      MIN_WORD_INTERVAL_MS,
      Math.round(60_000 / (BASE_WORDS_PER_MINUTE * safeRate)),
    ),
  );
}

export class SpokenTranscriptPresentation {
  readonly #elements: SpokenTranscriptElements;
  readonly #reducedMotion: boolean;
  readonly #schedule: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly #cancelScheduled: (handle: ScheduledHandle) => void;
  #handle: ScheduledHandle | undefined;
  #generation = 0;
  #lines: readonly string[] = [];
  #lineIndex = -1;
  #activeWords: readonly string[] = [];
  #wordElements: readonly HTMLElement[] = [];
  #revealedWords = 0;
  #role: SpokenTranscriptRole = "narrator";

  public constructor(
    elements: SpokenTranscriptElements,
    options: SpokenTranscriptOptions = {},
  ) {
    this.#elements = elements;
    this.#reducedMotion = options.reducedMotion ?? false;
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.#cancelScheduled =
      options.cancelScheduled ?? ((handle) => window.clearTimeout(handle));
  }

  public start(
    text: string,
    rate: number,
    role: SpokenTranscriptRole = "narrator",
  ): void {
    const lines = spokenNarrationLines(text);
    if (lines.length === 0) return;
    this.#cancelTimer();
    this.#archiveActive();
    this.#lines = lines;
    this.#role = role;
    this.#lineIndex = 0;
    this.#elements.region.hidden = false;
    this.#elements.region.dataset.role = role;
    this.#elements.region.dataset.playbackState = "active";
    this.#elements.activeLine.dataset.role = role;
    this.#showLine(spokenWordIntervalMs(rate));
  }

  public finish(outcome: "complete" | "interrupted" | "failed"): void {
    this.#cancelTimer();
    if (this.#lineIndex < 0) return;
    this.#elements.region.dataset.playbackState = "settled";
    if (outcome !== "complete") {
      this.#removeUnrevealedWords();
      return;
    }
    this.#revealActiveLine();
    while (this.#lineIndex < this.#lines.length - 1) {
      this.#archiveActive();
      this.#lineIndex += 1;
      this.#renderActiveLine(this.#lines[this.#lineIndex] ?? "", true);
    }
  }

  #showLine(intervalMs: number): void {
    const line = this.#lines[this.#lineIndex];
    if (line === undefined) return;
    if (this.#reducedMotion) {
      this.#renderRemainingLines();
      return;
    }
    this.#renderActiveLine(line, false);
    this.#scheduleNext(() => this.#advance(intervalMs), 0);
  }

  #renderActiveLine(line: string, revealImmediately: boolean): void {
    this.#activeWords = line.split(/\s+/u);
    this.#revealedWords = revealImmediately ? this.#activeWords.length : 0;
    this.#wordElements = this.#activeWords.map((word) => {
      const span =
        this.#elements.activeLine.ownerDocument.createElement("span");
      span.className = "spoken-word";
      if (revealImmediately) span.classList.add("is-visible");
      span.textContent = word;
      return span;
    });
    this.#elements.activeLine.replaceChildren(...this.#wordElements);
  }

  #revealWord(index: number): void {
    this.#wordElements[index]?.classList.add("is-visible");
    this.#revealedWords = Math.max(this.#revealedWords, index + 1);
  }

  #revealActiveLine(): void {
    for (const word of this.#wordElements) word.classList.add("is-visible");
    this.#revealedWords = this.#activeWords.length;
  }

  #advance(intervalMs: number): void {
    if (this.#revealedWords < this.#activeWords.length) {
      this.#revealWord(this.#revealedWords);
      if (this.#revealedWords < this.#activeWords.length) {
        this.#scheduleNext(() => this.#advance(intervalMs), intervalMs);
      } else if (this.#lineIndex < this.#lines.length - 1) {
        this.#scheduleNext(() => this.#advanceLine(intervalMs), LINE_SETTLE_MS);
      }
    }
  }

  #advanceLine(intervalMs: number): void {
    this.#archiveActive();
    this.#lineIndex += 1;
    this.#showLine(intervalMs);
  }

  #renderRemainingLines(): void {
    while (this.#lineIndex < this.#lines.length - 1) {
      this.#renderActiveLine(this.#lines[this.#lineIndex] ?? "", true);
      this.#archiveActive();
      this.#lineIndex += 1;
    }
    this.#renderActiveLine(this.#lines[this.#lineIndex] ?? "", true);
  }

  #scheduleNext(callback: () => void, delayMs: number): void {
    const generation = this.#generation;
    this.#handle = this.#schedule(() => {
      if (generation !== this.#generation) return;
      this.#handle = undefined;
      callback();
    }, delayMs);
  }

  #removeUnrevealedWords(): void {
    const visibleText = this.#activeWords
      .slice(0, this.#revealedWords)
      .join(" ");
    this.#activeWords = visibleText.length === 0 ? [] : visibleText.split(" ");
    this.#wordElements = [];
    this.#elements.activeLine.textContent = visibleText;
  }

  #archiveActive(): void {
    const text = this.#activeWords.slice(0, this.#revealedWords).join(" ");
    if (text.length > 0) {
      const row = this.#elements.history.ownerDocument.createElement("li");
      row.dataset.role = this.#role;
      row.textContent = text;
      this.#elements.history.prepend(row);
      while (this.#elements.history.children.length > HISTORY_LIMIT) {
        this.#elements.history.lastElementChild?.remove();
      }
      this.#elements.history.scrollTop = 0;
    }
    this.#elements.activeLine.replaceChildren();
    this.#activeWords = [];
    this.#wordElements = [];
    this.#revealedWords = 0;
  }

  #cancelTimer(): void {
    this.#generation += 1;
    if (this.#handle !== undefined) this.#cancelScheduled(this.#handle);
    this.#handle = undefined;
  }
}
