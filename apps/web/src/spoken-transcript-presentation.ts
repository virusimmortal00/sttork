// OpenAI's generated voices consistently read conversational prose faster than
// the conventional 170 WPM accessibility baseline. Keep the visual estimate a
// little ahead of the voice so captions do not trail audible playback.
const BASE_WORDS_PER_MINUTE = 210;
const MIN_WORD_INTERVAL_MS = 180;
const MAX_WORD_INTERVAL_MS = 560;
const LINE_SETTLE_MS = 260;
const ACTION_LINE_SETTLE_MS = 520;
const PLAYER_LINE_HOLD_MS = 850;
const COMMAND_LINE_HOLD_MS = 850;
// Let the CSS dissolve finish painting before the active DOM is moved into
// history. Clearing on the transition boundary can clip the final frame.
const ACTIVE_LINE_EXIT_MS = 560;
const HISTORY_LIMIT = 6;
export type SpokenVoiceRole = "guide" | "narrator";
export type SpokenTranscriptRole =
  SpokenVoiceRole | "action" | "command" | "player";

type PendingPresentationMode = "narration" | "command" | "player";

const COMMAND_TARGET_BOUNDARIES = new Set([
  "at",
  "from",
  "in",
  "into",
  "on",
  "to",
  "using",
  "with",
]);

type ScheduledHandle = number;

export interface SpokenTranscriptElements {
  readonly region: HTMLElement;
  readonly activeLine: HTMLElement;
  readonly history: HTMLOListElement;
}

export interface SpokenTranscriptOptions {
  readonly reducedMotion?: boolean;
  readonly now?: () => number;
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
    .filter((line) => line.length > 0 && line !== ">");
}

export function spokenCommandText(command: string): string {
  return command.trim().replace(/\s+/gu, " ");
}

export function spokenPlayerText(transcript: string): string {
  return transcript.trim().replace(/\s+/gu, " ");
}

export function spokenActionText(
  line: string,
  command: string | undefined,
): string {
  if (!/^\(Taken\)$/iu.test(line) || command === undefined) return line;
  const commandWords = spokenCommandText(command).split(" ");
  const targetWords = commandWords.slice(1);
  const boundaryIndex = targetWords.findIndex((word) =>
    COMMAND_TARGET_BOUNDARIES.has(word.toLocaleLowerCase("en-US")),
  );
  const target = targetWords
    .slice(0, boundaryIndex < 0 ? undefined : boundaryIndex)
    .join(" ");
  return target.length > 0 ? `Took ${target}.` : line;
}

export function spokenNarrationLineRole(
  line: string,
  sourceRole: SpokenVoiceRole,
): SpokenTranscriptRole {
  return sourceRole === "narrator" && /^\([^()\r\n]+\)$/u.test(line)
    ? "action"
    : sourceRole;
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
  readonly #now: () => number;
  #handle: ScheduledHandle | undefined;
  #scheduledCallback: (() => void) | undefined;
  #remainingDelayMs = 0;
  #scheduledAtMs = 0;
  #paused = false;
  #generation = 0;
  #lines: readonly string[] = [];
  #lineIndex = -1;
  #activeWords: readonly string[] = [];
  #wordElements: readonly HTMLElement[] = [];
  #revealedWords = 0;
  #role: SpokenTranscriptRole = "narrator";
  #activeRole: SpokenTranscriptRole = "narrator";
  #activeCommandContext: string | undefined;
  #pendingCommandContext: string | undefined;
  #lastNarrationCommandContext: string | undefined;
  #retainActiveInHistory = true;
  #pendingStarts: Array<{
    readonly text: string;
    readonly rate: number;
    readonly role: SpokenTranscriptRole;
    readonly retainInHistory: boolean;
    readonly mode: PendingPresentationMode;
    readonly commandContext: string | undefined;
    outcome: "complete" | "interrupted" | "failed" | undefined;
  }> = [];

  public constructor(
    elements: SpokenTranscriptElements,
    options: SpokenTranscriptOptions = {},
  ) {
    this.#elements = elements;
    this.#reducedMotion = options.reducedMotion ?? false;
    this.#now = options.now ?? (() => Date.now());
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.#cancelScheduled =
      options.cancelScheduled ?? ((handle) => window.clearTimeout(handle));
  }

  public start(
    text: string,
    rate: number,
    role: SpokenVoiceRole = "narrator",
  ): void {
    const commandContext = this.#pendingCommandContext;
    this.#pendingCommandContext = undefined;
    this.#lastNarrationCommandContext = commandContext;
    this.#queueOrStart(text, rate, role, true, "narration", commandContext);
  }

  public replay(
    text: string,
    rate: number,
    role: SpokenVoiceRole = "narrator",
  ): void {
    this.#queueOrStart(
      text,
      rate,
      role,
      false,
      "narration",
      this.#lastNarrationCommandContext,
    );
  }

  public showPlayer(transcript: string): void {
    const text = spokenPlayerText(transcript);
    if (text.length === 0) return;
    this.#queueOrStart(text, 1, "player", true, "player", undefined);
  }

  public pause(): void {
    if (this.#paused) return;
    this.#paused = true;
    if (this.#handle === undefined) return;
    const elapsed = Math.max(0, this.#now() - this.#scheduledAtMs);
    this.#remainingDelayMs = Math.max(0, this.#remainingDelayMs - elapsed);
    this.#cancelScheduled(this.#handle);
    this.#handle = undefined;
  }

  public resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    if (this.#scheduledCallback === undefined) return;
    this.#armScheduled(this.#scheduledCallback, this.#remainingDelayMs);
  }

  #queueOrStart(
    text: string,
    rate: number,
    role: SpokenTranscriptRole,
    retainInHistory: boolean,
    mode: PendingPresentationMode,
    commandContext: string | undefined,
  ): void {
    const playbackState = this.#elements.region.dataset.playbackState;
    if (
      this.#lineIndex >= 0 &&
      (playbackState === "active" || playbackState === "settling")
    ) {
      this.#pendingStarts.push({
        text,
        rate,
        role,
        retainInHistory,
        mode,
        commandContext,
        outcome: undefined,
      });
      this.#updateSpeakerContinuity();
      return;
    }
    this.#startNow(text, rate, role, retainInHistory, mode, commandContext);
  }

  #startNow(
    text: string,
    rate: number,
    role: SpokenTranscriptRole,
    retainInHistory: boolean,
    mode: PendingPresentationMode,
    commandContext: string | undefined,
  ): void {
    const lines =
      mode === "narration"
        ? spokenNarrationLines(text)
        : [spokenCommandText(text)];
    if (lines.length === 0) return;
    this.#cancelTimer();
    this.#archiveActive();
    this.#lines = lines;
    this.#role = role;
    this.#activeRole = role;
    this.#activeCommandContext = commandContext;
    this.#retainActiveInHistory = retainInHistory;
    this.#lineIndex = 0;
    this.#elements.region.hidden = false;
    this.#elements.region.dataset.role = role;
    this.#elements.region.dataset.playbackState = "active";
    this.#elements.activeLine.dataset.role = role;
    if (mode === "command") {
      this.#renderActiveLine(lines[0] ?? "", true);
      this.#scheduleNext(
        () => this.#finishActive("complete"),
        COMMAND_LINE_HOLD_MS,
      );
      return;
    }
    if (mode === "player") {
      this.#renderActiveLine(lines[0] ?? "", true);
      this.#scheduleNext(
        () => this.#finishActive("complete"),
        PLAYER_LINE_HOLD_MS,
      );
      return;
    }
    this.#showLine(spokenWordIntervalMs(rate));
  }

  public showCommand(command: string): void {
    const text = spokenCommandText(command);
    if (text.length === 0) return;
    this.#pendingCommandContext = text;
    this.#queueOrStart(text, 1, "command", true, "command", undefined);
  }

  public finish(outcome: "complete" | "interrupted" | "failed"): void {
    if (this.#role === "player" || this.#role === "command") {
      this.#retainPendingNarrationOutcome(outcome);
      return;
    }
    this.#finishActive(outcome);
  }

  #finishActive(outcome: "complete" | "interrupted" | "failed"): void {
    if (this.#lineIndex < 0) return;
    if (this.#elements.region.dataset.playbackState === "settling") {
      this.#retainPendingNarrationOutcome(outcome);
      return;
    }
    this.#cancelTimer();
    this.#elements.region.dataset.playbackState = "settling";
    if (outcome !== "complete") {
      this.#removeUnrevealedWords();
      this.#transitionFinishedLine();
      return;
    }
    this.#revealActiveLine();
    while (this.#lineIndex < this.#lines.length - 1) {
      this.#archiveActive();
      this.#lineIndex += 1;
      this.#renderNarrationLine(this.#lines[this.#lineIndex] ?? "", true);
    }
    this.#transitionFinishedLine();
  }

  #retainPendingNarrationOutcome(
    outcome: "complete" | "interrupted" | "failed",
  ): void {
    const pending = this.#pendingStarts.find(
      (entry) => entry.mode === "narration" && entry.outcome === undefined,
    );
    if (pending !== undefined) pending.outcome = outcome;
  }

  #transitionFinishedLine(): void {
    this.#updateSpeakerContinuity();
    if (this.#reducedMotion) {
      this.#archiveFinishedLine(false);
      this.#startPending();
      return;
    }
    this.#elements.activeLine.classList.add("is-leaving");
    this.#scheduleNext(() => {
      this.#archiveFinishedLine(true);
      this.#startPending();
    }, ACTIVE_LINE_EXIT_MS);
  }

  #archiveFinishedLine(animateHistoryEntry: boolean): void {
    this.#archiveActive(animateHistoryEntry);
    this.#lines = [];
    this.#lineIndex = -1;
    this.#elements.region.dataset.playbackState = "settled";
  }

  #startPending(): void {
    const pending = this.#pendingStarts.shift();
    if (pending === undefined) return;
    this.#startNow(
      pending.text,
      pending.rate,
      pending.role,
      pending.retainInHistory,
      pending.mode,
      pending.commandContext,
    );
    if (pending.mode === "narration" && pending.outcome !== undefined) {
      this.finish(pending.outcome);
    }
  }

  #updateSpeakerContinuity(): void {
    const next = this.#pendingStarts[0];
    if (
      next !== undefined &&
      next.mode === "narration" &&
      this.#activeRole === this.#role &&
      next.role === this.#role
    ) {
      this.#elements.activeLine.classList.add("is-speaker-continuing");
      return;
    }
    this.#elements.activeLine.classList.remove("is-speaker-continuing");
  }

  #showLine(intervalMs: number): void {
    const line = this.#lines[this.#lineIndex];
    if (line === undefined) return;
    if (this.#reducedMotion) {
      this.#renderRemainingLines();
      return;
    }
    this.#renderNarrationLine(line, false);
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
    const content =
      this.#elements.activeLine.ownerDocument.createElement("span");
    content.className = "spoken-line__content";
    content.append(...this.#wordElements);
    this.#elements.activeLine.replaceChildren(content);
  }

  #renderNarrationLine(line: string, revealImmediately: boolean): void {
    const sourceRole =
      this.#role === "guide" || this.#role === "narrator"
        ? this.#role
        : "narrator";
    this.#activeRole = spokenNarrationLineRole(line, sourceRole);
    this.#elements.region.dataset.role = this.#activeRole;
    this.#elements.activeLine.dataset.role = this.#activeRole;
    this.#renderActiveLine(
      this.#activeRole === "action"
        ? spokenActionText(line, this.#activeCommandContext)
        : line,
      revealImmediately,
    );
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
        this.#scheduleNext(
          () => this.#advanceLine(intervalMs),
          this.#activeRole === "action"
            ? ACTION_LINE_SETTLE_MS
            : LINE_SETTLE_MS,
        );
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
      this.#renderNarrationLine(this.#lines[this.#lineIndex] ?? "", true);
      this.#archiveActive();
      this.#lineIndex += 1;
    }
    this.#renderNarrationLine(this.#lines[this.#lineIndex] ?? "", true);
  }

  #scheduleNext(callback: () => void, delayMs: number): void {
    this.#scheduledCallback = callback;
    this.#remainingDelayMs = delayMs;
    if (this.#paused) return;
    this.#armScheduled(callback, delayMs);
  }

  #armScheduled(callback: () => void, delayMs: number): void {
    const generation = this.#generation;
    this.#scheduledAtMs = this.#now();
    this.#handle = this.#schedule(() => {
      if (generation !== this.#generation) return;
      this.#handle = undefined;
      this.#scheduledCallback = undefined;
      this.#remainingDelayMs = 0;
      callback();
    }, delayMs);
  }

  #removeUnrevealedWords(): void {
    const visibleText = this.#activeWords
      .slice(0, this.#revealedWords)
      .join(" ");
    this.#activeWords = visibleText.length === 0 ? [] : visibleText.split(" ");
    this.#wordElements = [];
    const content =
      this.#elements.activeLine.ownerDocument.createElement("span");
    content.className = "spoken-line__content";
    content.textContent = visibleText;
    this.#elements.activeLine.replaceChildren(content);
  }

  #archiveActive(animateHistoryEntry = false): void {
    const text = this.#activeWords.slice(0, this.#revealedWords).join(" ");
    if (text.length > 0 && this.#retainActiveInHistory) {
      const row = this.#elements.history.ownerDocument.createElement("li");
      row.dataset.role = this.#activeRole;
      if (animateHistoryEntry) row.classList.add("is-arriving");
      const content = row.ownerDocument.createElement("span");
      content.className = "spoken-history__content";
      content.textContent = text;
      row.append(content);
      this.#elements.history.prepend(row);
      while (this.#elements.history.children.length > HISTORY_LIMIT) {
        this.#elements.history.lastElementChild?.remove();
      }
      this.#elements.history.scrollTop = 0;
    }
    this.#elements.activeLine.classList.remove("is-leaving");
    this.#elements.activeLine.classList.remove("is-speaker-continuing");
    this.#elements.activeLine.replaceChildren();
    this.#activeWords = [];
    this.#wordElements = [];
    this.#revealedWords = 0;
  }

  #cancelTimer(): void {
    this.#generation += 1;
    if (this.#handle !== undefined) this.#cancelScheduled(this.#handle);
    this.#handle = undefined;
    this.#scheduledCallback = undefined;
    this.#remainingDelayMs = 0;
    this.#paused = false;
  }
}
