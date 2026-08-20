import {
  ScriptedCapturePort,
  ScriptedNarrationPort,
  ScriptedPlaybackPort,
  ScriptedTranscriber,
  VirtualAudioClock,
  VoiceAudioController,
  type ScriptedClip,
  type VoiceAudioState,
} from "../../../packages/audio/src/index.js";
import type { SemanticEvent } from "../../../packages/contracts/src/index.js";
import { EventSequence } from "../../../packages/events/src/index.js";
import {
  initialExperienceProjection,
  reduceExperienceProjection,
  selectOpeningNarrationText,
  type ExperienceProjectionState,
} from "../../../packages/experience/src/index.js";
import { FakeGuideModel } from "../../../packages/guide-core/src/index.js";
import { SemanticTurnCoordinator } from "../../../packages/session/src/index.js";
import {
  BrowserDorkWorkerFactory,
  type DorkBrowserWorkerLike,
} from "../../../spikes/dork-worker/browser-worker-transport.js";
import { DORK_WORKER_BINDING } from "../../../spikes/dork-worker/dork-worker-binding.js";
import { DorkWorkerEngine } from "../../../spikes/dork-worker/dork-worker-engine.js";

import { applyActionLogPresentation } from "./action-log-presentation.js";
import { createModalController } from "./modal-controller.js";
import { OptionalEventLogPresentation } from "./optional-event-log-presentation.js";
import {
  clientProjectionSoakEventCount,
  type ClientProjectionSoakEvidence,
  runClientProjectionSoak,
} from "./optional-event-log-soak.js";
import {
  ROLE_INTRODUCTION,
  ROLE_INTRODUCTION_INTERACTION_ID,
} from "./role-introduction.js";
import { SpokenTranscriptPresentation } from "./spoken-transcript-presentation.js";
import {
  applyStoryStartPresentation,
  openingActivationFailureDisposition,
  openingPreparationDisposition,
  type StoryStartPhase,
  type StoryStartPresentationElements,
} from "./story-start-presentation.js";
import {
  authoritativeVoiceStatePresentation,
  applyCommandCuePresentation,
  applyVoiceStatePresentation,
  statusTextForVoiceAudioState,
  type VoiceStatePresentationElements,
} from "./voice-state-presentation.js";

const STORY_ID = "minimal-zmachine-story";
const STORY_SHA256 =
  "67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389";
const STORY_URL = "/fixtures/stories/minimal/artifact/minimal.z3";
const STORY_OPENING_INTERACTION_ID = "story-opening";

const clips: readonly ScriptedClip[] = [
  {
    clipId: "north",
    durationMs: 720,
    transcript: { text: "please head north", confidence: 0.99 },
  },
  {
    clipId: "ambiguous",
    durationMs: 560,
    transcript: { text: "open it", confidence: 0.96 },
  },
  {
    clipId: "help",
    durationMs: 610,
    transcript: { text: "what can I do?", confidence: 0.98 },
  },
  { clipId: "silence", durationMs: 500 },
];

interface SmokeEvidence {
  status: "starting" | "ready" | "failed";
  turns: number;
  finalRevision: number;
  eventTypes: readonly string[];
  playback: readonly { readonly role: string; readonly text: string }[];
  transcriptHidden: boolean;
  debugHidden: boolean;
  workerEnvironment?: {
    readonly workerGlobalScope: boolean;
    readonly documentAbsent: boolean;
    readonly windowAbsent: boolean;
  };
  projectionSoak?:
    | { readonly status: "running" }
    | ClientProjectionSoakEvidence
    | { readonly status: "failed"; readonly error: string };
  error?: string;
}

declare global {
  interface Window {
    __VOICE_SHELL_SMOKE__?: SmokeEvidence;
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function run(): Promise<void> {
  const status = required<HTMLElement>("status");
  const activityIndicator = required<HTMLElement>("activity-indicator");
  const commandCue = required<HTMLOutputElement>("command-cue");
  const actionLog = required<HTMLOListElement>("action-log");
  const primaryCue = required<HTMLElement>("primary-cue");
  const captureButton = required<HTMLButtonElement>("capture");
  const stopButton = required<HTMLButtonElement>("stop");
  const pauseButton = required<HTMLButtonElement>("pause");
  const repeatButton = required<HTMLButtonElement>("repeat");
  const transcriptButton = required<HTMLButtonElement>("toggle-transcript");
  const debugButton = required<HTMLButtonElement>("toggle-debug");
  const transcriptCloseButton = required<HTMLButtonElement>("close-transcript");
  const debugCloseButton = required<HTMLButtonElement>("close-debug");
  const transcriptPanel = required<HTMLDialogElement>("transcript-panel");
  const transcriptList = required<HTMLOListElement>("transcript-list");
  const spokenTranscript = new SpokenTranscriptPresentation(
    {
      region: required<HTMLElement>("spoken-transcript"),
      activeLine: required<HTMLElement>("spoken-line"),
      history: required<HTMLOListElement>("spoken-history"),
    },
    {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
    },
  );
  const debugPanel = required<HTMLDialogElement>("debug-panel");
  const debugContent = required<HTMLPreElement>("debug-content");
  const textForm = required<HTMLFormElement>("text-form");
  const textInput = required<HTMLInputElement>("text-input");
  const textSubmitButton = required<HTMLButtonElement>("text-submit");
  const voicePresentation: VoiceStatePresentationElements = {
    status,
    activityIndicator,
  };
  const storyStartPresentation: StoryStartPresentationElements = {
    shell: required<HTMLElement>("voice-shell"),
    primaryButton: captureButton,
    stopButton,
    pauseButton,
    repeatButton,
    textInput,
    textSubmitButton,
    primaryCue,
  };

  function publishEvidence(evidence: SmokeEvidence): void {
    window.__VOICE_SHELL_SMOKE__ = evidence;
    document.body.dataset.smokeEvidence = JSON.stringify(evidence);
  }

  const storyResponse = await fetch(STORY_URL, { cache: "no-store" });
  if (!storyResponse.ok) throw new Error("Story fetch failed.");
  const storyBytes = new Uint8Array(await storyResponse.arrayBuffer());
  if ((await sha256(storyBytes)) !== STORY_SHA256) {
    throw new Error("Story authentication failed.");
  }

  let workerCount = 0;
  let initialization = 0;
  let message = 0;
  const factory = new BrowserDorkWorkerFactory({
    createWorker: () => {
      workerCount += 1;
      return new Worker("/worker/spikes/dork-worker/browser-worker-entry.js", {
        type: "module",
        name: `voice-shell-dork-${workerCount}`,
      }) as unknown as DorkBrowserWorkerLike;
    },
    nextInitializationId: () => `initialize-${++initialization}`,
  });
  const engine = new DorkWorkerEngine({
    factory,
    storyBytes,
    binding: DORK_WORKER_BINDING,
    nextMessageId: () => `message-${++message}`,
  });
  const boot = await engine.boot({
    storyId: STORY_ID,
    artifactSha256: STORY_SHA256,
  });
  const openingNarrationText = selectOpeningNarrationText(boot);

  let projection: ExperienceProjectionState = initialExperienceProjection();
  const canonicalEvents: SemanticEvent[] = [];
  const optionalEventLog = new OptionalEventLogPresentation(
    {
      elements: {
        transcriptList,
        transcriptPage: {
          older: required<HTMLButtonElement>("transcript-older"),
          newer: required<HTMLButtonElement>("transcript-newer"),
          status: required<HTMLElement>("transcript-page-status"),
        },
        debugContent,
        debugPage: {
          older: required<HTMLButtonElement>("debug-older"),
          newer: required<HTMLButtonElement>("debug-newer"),
          status: required<HTMLElement>("debug-page-status"),
        },
      },
      events: () => canonicalEvents,
    },
    projection,
  );
  const narrationById = new Map<
    string,
    { readonly role: "guide" | "narrator"; readonly text: string }
  >();
  let turns = 0;
  let eventId = 0;
  let requestId = 0;
  let narrationId = 0;
  let interactionId = 0;
  let captureId = 0;
  let storyStartPhase: StoryStartPhase = "welcome";
  let introductionPromise: Promise<void> | undefined;
  let introductionAbort: AbortController | undefined;
  let introductionStopRequested = false;
  let storyStartPromise: Promise<void> | undefined;
  let openingAbort: AbortController | undefined;
  let openingStopRequested = false;
  let openingPreparationRetry = false;
  let openingPreparationFailed = false;
  let openingNarrationRetryActive = false;
  let openingNarrationRetryPromise: Promise<void> | undefined;
  const narration = new ScriptedNarrationPort();
  const clock = new VirtualAudioClock();
  const playback = new ScriptedPlaybackPort(clock);

  function renderProjection(): void {
    if (openingNarrationRetryActive) {
      applyVoiceStatePresentation(
        "processing",
        "Preparing opening narration",
        voicePresentation,
      );
    } else {
      applyVoiceStatePresentation(
        projection.displayState,
        projection.displayState === "ready"
          ? storyStartPhase === "started"
            ? projection.statusText
            : storyStartPhase === "starting"
              ? "Preparing story"
              : "Ready to start"
          : projection.statusText,
        voicePresentation,
      );
    }
    applyCommandCuePresentation(projection.activeCommand, commandCue);
    applyActionLogPresentation(
      projection.actionLog,
      projection.activeCommand,
      actionLog,
    );
    optionalEventLog.update(projection);
  }

  function publish(event: SemanticEvent): void {
    if (
      event.type === "narration.requested" &&
      (event.payload.role === "guide" || event.payload.role === "narrator")
    ) {
      if (!narrationById.has(event.payload.narrationId)) {
        while (narrationById.size >= 32) {
          const oldestId = narrationById.keys().next().value;
          if (oldestId === undefined) break;
          narrationById.delete(oldestId);
        }
      }
      narrationById.set(event.payload.narrationId, {
        role: event.payload.role,
        text: event.payload.text,
      });
    } else if (event.type === "audio.playback.started") {
      const narration = narrationById.get(event.payload.narrationId);
      if (narration !== undefined) {
        spokenTranscript.start(narration.text, 1, narration.role);
      }
    } else if (event.type === "audio.playback.ended") {
      spokenTranscript.finish(event.payload.outcome);
    }
    canonicalEvents.push(event);
    projection = reduceExperienceProjection(projection, event);
    renderProjection();
  }

  const guide = new FakeGuideModel((input) => {
    const utterance = input.playerUtterance.toLocaleLowerCase("en-US");
    if (utterance.includes("what can")) {
      return {
        kind: "explain",
        response: "provider prose is replaced",
        basis: "command-help",
        sourceIds: ["grammar.look", "grammar.direction.north"],
      };
    }
    if (utterance.includes("open it")) {
      return {
        kind: "clarify",
        question: "What would you like me to open?",
        ambiguity: "The pronoun has no unique observed referent.",
      };
    }
    return {
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    };
  });

  const coordinator = new SemanticTurnCoordinator({
    engine,
    guide,
    narrator: narration,
    events: new EventSequence({
      sessionId: "voice-shell-session",
      now: () => new Date(1_787_081_400_000 + eventId).toISOString(),
      nextId: () => `event-${++eventId}`,
    }),
    nextRequestId: () => `request-${++requestId}`,
    nextNarrationId: () => `narration-${++narrationId}`,
    publish,
  });

  const controller = new VoiceAudioController({
    turns: coordinator,
    capture: new ScriptedCapturePort(clips),
    transcriber: new ScriptedTranscriber(clips),
    narration,
    playback,
    nextInteractionId: () => `interaction-${++interactionId}`,
    nextCaptureId: () => `capture-${++captureId}`,
    observedObjects: () => ["token"],
    onState: (state: VoiceAudioState) => {
      const presentation = authoritativeVoiceStatePresentation(
        state,
        statusTextForVoiceAudioState(
          state,
          storyStartPhase === "started" ? "Ready" : "Ready to start",
        ),
        projection,
      );
      applyVoiceStatePresentation(
        presentation.state,
        presentation.statusText,
        voicePresentation,
      );
      applyStoryStartPresentation(
        storyStartPhase,
        state,
        true,
        storyStartPresentation,
      );
      pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
    },
    onTurn: () => {
      turns += 1;
    },
  });

  function updateEvidence(): void {
    void engine.inspectPublicState().then((state) => {
      publishEvidence({
        status: "ready",
        turns,
        finalRevision: state.revision,
        eventTypes: canonicalEvents.map((event) => event.type),
        playback: playback.records.map(({ role, text }) => ({ role, text })),
        transcriptHidden: !transcriptPanel.open,
        debugHidden: !debugPanel.open,
        ...(factory.lastEnvironment === undefined
          ? {}
          : { workerEnvironment: factory.lastEnvironment }),
      });
    });
  }

  async function toggleCapture(): Promise<void> {
    if (storyStartPhase !== "started") return;
    if (controller.state === "listening") {
      await controller.finishCapture();
      updateEvidence();
    } else if (
      controller.state === "ready" ||
      controller.state === "recoverable-error"
    ) {
      await controller.startCapture();
    }
  }

  function presentControllerState(): void {
    const state = controller.state;
    const presentation = authoritativeVoiceStatePresentation(
      state,
      statusTextForVoiceAudioState(
        state,
        storyStartPhase === "started" ? "Ready" : "Ready to start",
      ),
      projection,
    );
    applyVoiceStatePresentation(
      presentation.state,
      presentation.statusText,
      voicePresentation,
    );
    applyStoryStartPresentation(
      storyStartPhase,
      state,
      true,
      storyStartPresentation,
    );
    pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
  }

  function presentOpeningRetryState(): void {
    presentControllerState();
    applyVoiceStatePresentation(
      "blocked",
      projection.displayState === "blocked"
        ? projection.statusText
        : "Action needed",
      voicePresentation,
    );
  }

  async function startStory(): Promise<void> {
    if (storyStartPhase === "started") return;
    if (storyStartPromise !== undefined) return storyStartPromise;

    storyStartPhase = "starting";
    openingStopRequested = false;
    applyVoiceStatePresentation(
      "processing",
      "Preparing story",
      voicePresentation,
    );
    applyStoryStartPresentation(
      storyStartPhase,
      controller.state,
      true,
      storyStartPresentation,
    );
    const abort = new AbortController();
    openingAbort = abort;
    const operation = (async () => {
      const prepared = await coordinator.prepareOpening(
        {
          interactionId: STORY_OPENING_INTERACTION_ID,
          boot,
          narrationText: openingNarrationText,
        },
        abort.signal,
      );
      const disposition = openingPreparationDisposition(prepared.outcome);
      openingPreparationRetry = disposition.retryAvailable;
      openingPreparationFailed = disposition.failed;
      if (prepared.outcome === "ready") {
        const playing = controller.playPrepared(STORY_OPENING_INTERACTION_ID);
        if (openingStopRequested) await controller.stop();
        await playing;
      }
      storyStartPhase = "started";
      if (openingPreparationFailed) presentOpeningRetryState();
      else presentControllerState();
      updateEvidence();
    })();
    storyStartPromise = operation;
    try {
      await operation;
    } catch (error) {
      storyStartPromise = undefined;
      storyStartPhase = "story-ready";
      presentControllerState();
      if (
        openingActivationFailureDisposition(
          abort.signal.aborted,
          openingStopRequested,
        ) === "player-cancelled"
      ) {
        return;
      }
      throw error;
    } finally {
      if (openingAbort === abort) openingAbort = undefined;
    }
  }

  async function startIntroduction(): Promise<void> {
    if (storyStartPhase !== "welcome") return;
    if (introductionPromise !== undefined) return introductionPromise;
    storyStartPhase = "introducing";
    introductionStopRequested = false;
    applyVoiceStatePresentation(
      "processing",
      "Preparing your companions",
      voicePresentation,
    );
    applyStoryStartPresentation(
      storyStartPhase,
      controller.state,
      true,
      storyStartPresentation,
    );
    const abort = new AbortController();
    introductionAbort = abort;
    const operation = (async () => {
      const prepared = await coordinator.prepareRoleIntroduction(
        {
          interactionId: ROLE_INTRODUCTION_INTERACTION_ID,
          messages: ROLE_INTRODUCTION,
        },
        abort.signal,
      );
      if (prepared.outcome === "ready") {
        const playing = controller.playPrepared(
          ROLE_INTRODUCTION_INTERACTION_ID,
        );
        if (introductionStopRequested) await controller.stop();
        await playing;
      }
      storyStartPhase = "story-ready";
      presentControllerState();
      updateEvidence();
    })();
    introductionPromise = operation;
    try {
      await operation;
    } catch {
      storyStartPhase = "story-ready";
      presentControllerState();
    } finally {
      if (introductionAbort === abort) introductionAbort = undefined;
    }
  }

  async function primaryAction(): Promise<void> {
    if (storyStartPhase === "welcome") await startIntroduction();
    else if (storyStartPhase === "story-ready") await startStory();
    else if (storyStartPhase === "started") await toggleCapture();
  }

  async function repeatLastNarration(): Promise<void> {
    if (
      !openingPreparationRetry ||
      controller.hasRepeatablePlayback ||
      (controller.state !== "ready" && controller.state !== "recoverable-error")
    ) {
      await controller.repeat();
      updateEvidence();
      return;
    }
    if (openingNarrationRetryPromise !== undefined) {
      return openingNarrationRetryPromise;
    }

    openingNarrationRetryActive = true;
    applyVoiceStatePresentation(
      "processing",
      "Preparing opening narration",
      voicePresentation,
    );
    applyStoryStartPresentation(
      "started",
      "processing",
      true,
      storyStartPresentation,
    );
    pauseButton.disabled = true;
    repeatButton.disabled = true;
    const abort = new AbortController();
    openingAbort = abort;
    const operation = (async () => {
      const prepared = await coordinator.prepareOpening(
        {
          interactionId: STORY_OPENING_INTERACTION_ID,
          boot,
          narrationText: openingNarrationText,
        },
        abort.signal,
      );
      const disposition = openingPreparationDisposition(prepared.outcome);
      openingPreparationRetry = disposition.retryAvailable;
      openingPreparationFailed = disposition.failed;
      if (prepared.outcome === "ready") {
        openingNarrationRetryActive = false;
        const outcome = await controller.playPrepared(
          STORY_OPENING_INTERACTION_ID,
        );
        openingPreparationRetry = outcome === "not-prepared";
        openingPreparationFailed = outcome === "not-prepared";
      }
      openingNarrationRetryActive = false;
      if (openingPreparationFailed) presentOpeningRetryState();
      else presentControllerState();
      updateEvidence();
    })();
    openingNarrationRetryPromise = operation;
    try {
      await operation;
    } catch (error) {
      openingPreparationRetry = true;
      openingPreparationFailed = true;
      presentOpeningRetryState();
      throw error;
    } finally {
      openingNarrationRetryActive = false;
      openingNarrationRetryPromise = undefined;
      if (openingAbort === abort) openingAbort = undefined;
    }
  }

  async function stopActive(): Promise<void> {
    if (storyStartPhase === "introducing") {
      introductionStopRequested = true;
      introductionAbort?.abort(new Error("Player stopped the introduction."));
    }
    if (storyStartPhase === "starting" || openingNarrationRetryActive) {
      openingStopRequested = true;
      openingAbort?.abort(new Error("Player stopped the story opening."));
    }
    await controller.stop();
    updateEvidence();
  }

  function runControl(operation: () => Promise<unknown>): void {
    void operation().catch(() => {
      applyVoiceStatePresentation("blocked", "Try again", voicePresentation);
    });
  }

  const reducedMotion = (): boolean =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const modalOpenChanged = (): void => updateEvidence();
  createModalController({
    dialog: transcriptPanel,
    trigger: transcriptButton,
    closeButton: transcriptCloseButton,
    reducedMotion,
    onOpenChange: (open) => {
      optionalEventLog.setTranscriptOpen(open);
      modalOpenChanged();
    },
  });
  createModalController({
    dialog: debugPanel,
    trigger: debugButton,
    closeButton: debugCloseButton,
    reducedMotion,
    onOpenChange: (open) => {
      optionalEventLog.setDebugOpen(open);
      modalOpenChanged();
    },
  });

  captureButton.addEventListener("click", () => {
    controller.activatePlaybackFromUserGesture();
    runControl(primaryAction);
  });
  stopButton.addEventListener("click", () => {
    runControl(stopActive);
  });
  pauseButton.addEventListener("click", () => {
    runControl(async () => {
      if (controller.state === "paused") await controller.resume();
      else await controller.pause();
      updateEvidence();
    });
  });
  repeatButton.addEventListener("click", () => {
    controller.activatePlaybackFromUserGesture();
    runControl(repeatLastNarration);
  });
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (storyStartPhase !== "started") {
      captureButton.focus();
      return;
    }
    controller.activatePlaybackFromUserGesture();
    const text = textInput.value;
    textInput.value = "";
    runControl(async () => {
      await controller.submitText(text);
      updateEvidence();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.code === "KeyV" &&
      !event.repeat &&
      event.target === document.body
    ) {
      event.preventDefault();
      if (storyStartPhase === "started") {
        controller.activatePlaybackFromUserGesture();
        runControl(toggleCapture);
      }
    }
    if (
      event.code === "Escape" &&
      document.querySelector("dialog[open]") === null
    ) {
      runControl(stopActive);
    }
  });

  projection = {
    ...projection,
    displayState: "ready",
    statusText: "Ready to start",
  };
  storyStartPresentation.shell.dataset.storyPhase = storyStartPhase;
  renderProjection();
  presentControllerState();
  publishEvidence({
    status: "ready",
    turns: 0,
    finalRevision: 0,
    eventTypes: [],
    playback: [],
    transcriptHidden: true,
    debugHidden: true,
    ...(factory.lastEnvironment === undefined
      ? {}
      : { workerEnvironment: factory.lastEnvironment }),
  });
  const soakEventCount = clientProjectionSoakEventCount(window.location.search);
  if (soakEventCount !== undefined) {
    const baseEvidence = window.__VOICE_SHELL_SMOKE__!;
    publishEvidence({
      ...baseEvidence,
      projectionSoak: { status: "running" },
    });
    try {
      const projectionSoak = await runClientProjectionSoak(soakEventCount);
      publishEvidence({ ...baseEvidence, projectionSoak });
    } catch (error) {
      publishEvidence({
        ...baseEvidence,
        projectionSoak: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown failure",
        },
      });
    }
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  const status = document.getElementById("status");
  if (status !== null) status.textContent = "Unable to start";
  const activityIndicator = document.getElementById("activity-indicator");
  if (activityIndicator !== null) {
    activityIndicator.dataset.state = "blocked";
    activityIndicator.hidden = true;
  }
  const evidence: SmokeEvidence = {
    status: "failed",
    turns: 0,
    finalRevision: 0,
    eventTypes: [],
    playback: [],
    transcriptHidden: true,
    debugHidden: true,
    error: message,
  };
  window.__VOICE_SHELL_SMOKE__ = evidence;
  document.body.dataset.smokeEvidence = JSON.stringify(evidence);
});
