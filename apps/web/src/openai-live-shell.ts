import {
  ScriptedNarrationPort,
  VoiceAudioController,
  type VoiceAudioState,
} from "../../../packages/audio/src/index.js";
import {
  createOpeningObjectProjection,
  projectOpeningObjectsFromEvent,
} from "../../../packages/command-knowledge/src/index.js";
import type { SemanticEvent } from "../../../packages/contracts/src/index.js";
import { EventSequence } from "../../../packages/events/src/index.js";
import {
  initialExperienceProjection,
  reduceExperienceProjection,
  selectOpeningNarrationText,
  type ExperienceProjectionState,
} from "../../../packages/experience/src/index.js";
import { SemanticTurnCoordinator } from "../../../packages/session/src/index.js";
import {
  BrowserDorkWorkerFactory,
  type DorkBrowserWorkerLike,
} from "../../../spikes/dork-worker/browser-worker-transport.js";
import { DORK_WORKER_BINDING } from "../../../spikes/dork-worker/dork-worker-binding.js";
import { DorkWorkerEngine } from "../../../spikes/dork-worker/dork-worker-engine.js";

import {
  BrowserMicrophoneCapturePort,
  InMemoryCapturedAudioStore,
  OpenAiLiveGuideModel,
  OpenAiLivePlaybackPort,
  OpenAiLiveTranscriber,
} from "./openai-live-audio.js";
import {
  OpenAiLiveVoicePreferenceSession,
  OPENAI_TTS_VOICES,
  openAiSpeechPreferenceForRole,
  type OpenAiLiveVoicePreferences,
  type OpenAiTtsVoice,
} from "./openai-live-preferences.js";
import { applyActionLogPresentation } from "./action-log-presentation.js";
import { createModalController } from "./modal-controller.js";
import { OptionalEventLogPresentation } from "./optional-event-log-presentation.js";
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

const STORY_ID = "zork1-release-119";
const STORY_SHA256 =
  "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79";
const STORY_URL = "/vendor/zork1/zork1.z3";
const STORY_OPENING_INTERACTION_ID = "story-opening";
const LIVE_CAPTURE_MEDIA_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export type LiveStartupErrorCode =
  | "secure-context-required"
  | "browser-cryptography-unavailable"
  | "microphone-unavailable"
  | "audio-recording-unavailable"
  | "startup-failed";

export interface LiveBrowserCapabilities {
  readonly isSecureContext: boolean;
  readonly subtle: unknown;
  readonly getUserMedia: unknown;
  readonly mediaRecorder: unknown;
  readonly supportedCaptureMediaType: boolean;
}

export interface LiveBrowserPreflight {
  readonly readiness: "ready" | "degraded" | "failed";
  readonly secureContext: boolean;
  readonly voiceAvailable: boolean;
  readonly storyAuthenticationAvailable: boolean;
  readonly audioRecordingAvailable: boolean;
  readonly errorCode?: Exclude<LiveStartupErrorCode, "startup-failed">;
  readonly statusText: string;
}

interface LiveSmokeEvidence {
  status: "starting" | "ready" | "degraded" | "failed";
  secureContext: boolean;
  voiceAvailable: boolean;
  storyAuthenticationAvailable: boolean;
  audioRecordingAvailable: boolean;
  turns: number;
  finalRevision: number;
  speechRequests?: number;
  eventTypes: readonly string[];
  transcriptHidden: boolean;
  debugHidden: boolean;
  workerEnvironment?: {
    readonly workerGlobalScope: boolean;
    readonly documentAbsent: boolean;
    readonly windowAbsent: boolean;
  };
  errorCode?: LiveStartupErrorCode;
}

declare global {
  interface Window {
    __OPENAI_LIVE_SMOKE__?: LiveSmokeEvidence;
  }
}

interface DisableableControl {
  disabled: boolean;
}

interface LiveStatusElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

export interface LivePreflightPresentationElements {
  readonly status: LiveStatusElement;
  readonly captureButton: DisableableControl;
  readonly transcriptPanel: { showModal(): void };
  readonly transcriptButton: {
    setAttribute(name: string, value: string): void;
  };
  readonly textForm: { hidden: boolean | string };
  readonly textInput: DisableableControl;
  readonly allControls: readonly DisableableControl[];
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
}

function hasSubtleCrypto(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "digest" in value &&
    typeof value.digest === "function"
  );
}

export function evaluateLiveBrowserPreflight(
  capabilities: LiveBrowserCapabilities,
): LiveBrowserPreflight {
  const storyAuthenticationAvailable = hasSubtleCrypto(capabilities.subtle);
  const audioRecordingAvailable =
    typeof capabilities.mediaRecorder === "function" &&
    capabilities.supportedCaptureMediaType;
  if (!capabilities.isSecureContext) {
    return {
      readiness: storyAuthenticationAvailable ? "degraded" : "failed",
      secureContext: false,
      voiceAvailable: false,
      storyAuthenticationAvailable,
      audioRecordingAvailable,
      errorCode: "secure-context-required",
      statusText: storyAuthenticationAvailable
        ? "Secure connection required for microphone. Use accessible text input."
        : "Secure connection required. Open this page over HTTPS in a supported browser.",
    };
  }
  if (!storyAuthenticationAvailable) {
    return {
      readiness: "failed",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: false,
      audioRecordingAvailable,
      errorCode: "browser-cryptography-unavailable",
      statusText:
        "Browser cryptography unavailable. Open this page in a supported browser.",
    };
  }
  if (typeof capabilities.getUserMedia !== "function") {
    return {
      readiness: "degraded",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: true,
      audioRecordingAvailable,
      errorCode: "microphone-unavailable",
      statusText: "Microphone unavailable. Use accessible text input.",
    };
  }
  if (!audioRecordingAvailable) {
    return {
      readiness: "degraded",
      secureContext: true,
      voiceAvailable: false,
      storyAuthenticationAvailable: true,
      audioRecordingAvailable: false,
      errorCode: "audio-recording-unavailable",
      statusText: "Audio recording unavailable. Use accessible text input.",
    };
  }
  return {
    readiness: "ready",
    secureContext: true,
    voiceAvailable: true,
    storyAuthenticationAvailable: true,
    audioRecordingAvailable: true,
    statusText: "Ready",
  };
}

export function applyFatalLiveStartupPresentation(
  statusText: string,
  status: LiveStatusElement | null,
  controls: readonly DisableableControl[],
): void {
  if (status !== null) {
    status.textContent = statusText;
    status.setAttribute("role", "alert");
  }
  for (const control of controls) control.disabled = true;
}

export function applyLivePreflightPresentation(
  preflight: LiveBrowserPreflight,
  elements: LivePreflightPresentationElements,
): boolean {
  if (!preflight.storyAuthenticationAvailable) {
    applyFatalLiveStartupPresentation(
      preflight.statusText,
      elements.status,
      elements.allControls,
    );
    return false;
  }

  elements.status.textContent = preflight.statusText;
  elements.captureButton.disabled = !preflight.voiceAvailable;
  if (!preflight.voiceAvailable) {
    elements.transcriptPanel.showModal();
    elements.transcriptButton.setAttribute("aria-expanded", "true");
    elements.textForm.hidden = false;
    elements.textInput.disabled = false;
  }
  return true;
}

function hasSupportedCaptureMediaType(value: unknown): boolean {
  if (typeof value !== "function" || !("isTypeSupported" in value)) {
    return false;
  }
  const isTypeSupported = value.isTypeSupported;
  if (typeof isTypeSupported !== "function") return false;
  return LIVE_CAPTURE_MEDIA_TYPES.some((mediaType) => {
    try {
      return isTypeSupported.call(value, mediaType) === true;
    } catch {
      return false;
    }
  });
}

function liveBrowserPreflight(): LiveBrowserPreflight {
  const scope = globalThis as typeof globalThis & {
    readonly isSecureContext?: boolean;
    readonly MediaRecorder?: unknown;
  };
  return evaluateLiveBrowserPreflight({
    isSecureContext: scope.isSecureContext === true,
    subtle: scope.crypto?.subtle,
    getUserMedia: scope.navigator?.mediaDevices?.getUserMedia,
    mediaRecorder: scope.MediaRecorder,
    supportedCaptureMediaType: hasSupportedCaptureMediaType(
      scope.MediaRecorder,
    ),
  });
}

function sessionToken(): string {
  const token = document
    .querySelector<HTMLMetaElement>('meta[name="zork-voice-live-session"]')
    ?.content.trim();
  if (
    token === undefined ||
    token.length < 32 ||
    token.length > 160 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  ) {
    throw new Error("Live session initialization failed.");
  }
  return token;
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
  const settingsButton = required<HTMLButtonElement>("toggle-settings");
  const transcriptCloseButton = required<HTMLButtonElement>("close-transcript");
  const debugCloseButton = required<HTMLButtonElement>("close-debug");
  const settingsCloseButton = required<HTMLButtonElement>("close-settings");
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
  const settingsPanel = required<HTMLDialogElement>("settings-panel");
  const guideVoice = required<HTMLSelectElement>("guide-voice");
  const narratorVoice = required<HTMLSelectElement>("narrator-voice");
  const guideRate = required<HTMLInputElement>("guide-rate");
  const narratorRate = required<HTMLInputElement>("narrator-rate");
  const guideRateValue = required<HTMLOutputElement>("guide-rate-value");
  const narratorRateValue = required<HTMLOutputElement>("narrator-rate-value");
  const previewGuide = required<HTMLButtonElement>("preview-guide");
  const previewNarrator = required<HTMLButtonElement>("preview-narrator");
  const textForm = required<HTMLFormElement>("text-form");
  const textInput = required<HTMLInputElement>("text-input");
  const textSubmitButton = required<HTMLButtonElement>("text-submit");
  const allControls = Array.from(
    document.querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("button, input, select, textarea"),
  );
  const presentation: LivePreflightPresentationElements = {
    status,
    captureButton,
    transcriptPanel,
    transcriptButton,
    textForm,
    textInput,
    allControls,
  };
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
  const preflight = liveBrowserPreflight();

  function publishEvidence(evidence: LiveSmokeEvidence): void {
    window.__OPENAI_LIVE_SMOKE__ = evidence;
    document.body.dataset.smokeEvidence = JSON.stringify(evidence);
  }

  if (!preflight.storyAuthenticationAvailable) {
    applyLivePreflightPresentation(preflight, presentation);
    applyVoiceStatePresentation(
      "blocked",
      preflight.statusText,
      voicePresentation,
    );
    publishEvidence({
      status: "failed",
      secureContext: preflight.secureContext,
      voiceAvailable: false,
      storyAuthenticationAvailable: false,
      audioRecordingAvailable: preflight.audioRecordingAvailable,
      turns: 0,
      finalRevision: 0,
      eventTypes: [],
      transcriptHidden: !transcriptPanel.open,
      debugHidden: !debugPanel.open,
      errorCode: preflight.errorCode ?? "secure-context-required",
    });
    return;
  }
  const token = sessionToken();
  const voicePreferenceSession = new OpenAiLiveVoicePreferenceSession(
    localStorage,
  );

  for (const voice of OPENAI_TTS_VOICES) {
    guideVoice.add(new Option(voice, voice));
    narratorVoice.add(new Option(voice, voice));
  }

  function renderVoicePreferences(): void {
    const voicePreferences = voicePreferenceSession.current;
    guideVoice.value = voicePreferences.guideVoice;
    narratorVoice.value = voicePreferences.narratorVoice;
    guideRate.value = String(voicePreferences.guideRate);
    narratorRate.value = String(voicePreferences.narratorRate);
    guideRateValue.value = `${voicePreferences.guideRate.toFixed(2)}×`;
    narratorRateValue.value = `${voicePreferences.narratorRate.toFixed(2)}×`;
  }

  function updateVoicePreferences(
    update: Partial<OpenAiLiveVoicePreferences>,
  ): OpenAiLiveVoicePreferences {
    return voicePreferenceSession.update(update);
  }

  renderVoicePreferences();

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
        name: `openai-live-dork-${workerCount}`,
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
  let observedObjectProjection = createOpeningObjectProjection();

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
  const capturedAudio = new InMemoryCapturedAudioStore();
  const capture = new BrowserMicrophoneCapturePort({ store: capturedAudio });
  const transcriber = new OpenAiLiveTranscriber({
    store: capturedAudio,
    sessionToken: token,
    observedObjects: () => observedObjectProjection.currentObjects,
  });
  const guide = new OpenAiLiveGuideModel({ sessionToken: token });
  const playback = new OpenAiLivePlaybackPort({
    sessionToken: token,
    speechPreference: (role) =>
      openAiSpeechPreferenceForRole(voicePreferenceSession.current, role),
  });
  let previewPlayback: OpenAiLivePlaybackPort | undefined;
  let previewAbort: AbortController | undefined;
  let previewId = 0;
  const reducedMotion = (): boolean =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
            ? preflight.statusText
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
        spokenTranscript.start(
          narration.text,
          narration.role === "guide"
            ? voicePreferenceSession.current.guideRate
            : voicePreferenceSession.current.narratorRate,
          narration.role,
        );
      }
    } else if (event.type === "audio.playback.ended") {
      spokenTranscript.finish(event.payload.outcome);
    }
    observedObjectProjection = projectOpeningObjectsFromEvent(
      observedObjectProjection,
      event,
    );
    canonicalEvents.push(event);
    projection = reduceExperienceProjection(projection, event);
    renderProjection();
  }

  const coordinator = new SemanticTurnCoordinator({
    engine,
    guide,
    narrator: narration,
    events: new EventSequence({
      sessionId: "openai-live-session",
      now: () => new Date(Date.now()).toISOString(),
      nextId: () => `event-${++eventId}`,
    }),
    nextRequestId: () => `request-${++requestId}`,
    nextNarrationId: () => `narration-${++narrationId}`,
    publish,
  });

  const controller = new VoiceAudioController({
    turns: coordinator,
    capture,
    transcriber,
    narration,
    playback,
    nextInteractionId: () => `interaction-${++interactionId}`,
    nextCaptureId: () => `capture-${++captureId}`,
    observedObjects: () => observedObjectProjection.currentObjects,
    onState: (state: VoiceAudioState) => {
      const voiceState = authoritativeVoiceStatePresentation(
        state,
        statusTextForVoiceAudioState(
          state,
          storyStartPhase === "started"
            ? preflight.statusText
            : "Ready to start",
        ),
        projection,
      );
      applyVoiceStatePresentation(
        voiceState.state,
        voiceState.statusText,
        voicePresentation,
      );
      applyStoryStartPresentation(
        storyStartPhase,
        state,
        preflight.voiceAvailable,
        storyStartPresentation,
      );
      pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
    },
    onTurn: () => {
      turns += 1;
    },
  });

  async function updateEvidence(): Promise<void> {
    const state = await engine.inspectPublicState();
    publishEvidence({
      status: preflight.readiness,
      secureContext: preflight.secureContext,
      voiceAvailable: preflight.voiceAvailable,
      storyAuthenticationAvailable: preflight.storyAuthenticationAvailable,
      audioRecordingAvailable: preflight.audioRecordingAvailable,
      turns,
      finalRevision: state.revision,
      speechRequests: playback.synthesisRequests,
      eventTypes: canonicalEvents.map((event) => event.type),
      transcriptHidden: !transcriptPanel.open,
      debugHidden: !debugPanel.open,
      ...(factory.lastEnvironment === undefined
        ? {}
        : { workerEnvironment: factory.lastEnvironment }),
      ...(preflight.errorCode === undefined
        ? {}
        : { errorCode: preflight.errorCode }),
    });
  }

  async function toggleCapture(): Promise<void> {
    if (storyStartPhase !== "started") return;
    if (!preflight.voiceAvailable) {
      applyLivePreflightPresentation(preflight, presentation);
      textInput.focus();
      return;
    }
    if (controller.state === "listening") {
      await controller.finishCapture();
      await updateEvidence();
    } else if (
      controller.state === "ready" ||
      controller.state === "recoverable-error"
    ) {
      await controller.startCapture();
    }
  }

  function presentControllerState(): void {
    const state = controller.state;
    const voiceState = authoritativeVoiceStatePresentation(
      state,
      statusTextForVoiceAudioState(
        state,
        storyStartPhase === "started" ? preflight.statusText : "Ready to start",
      ),
      projection,
    );
    applyVoiceStatePresentation(
      voiceState.state,
      voiceState.statusText,
      voicePresentation,
    );
    applyStoryStartPresentation(
      storyStartPhase,
      state,
      preflight.voiceAvailable,
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
      preflight.voiceAvailable,
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
      await updateEvidence();
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
      preflight.voiceAvailable,
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
      await updateEvidence();
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
      await updateEvidence();
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
      preflight.voiceAvailable,
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
      await updateEvidence();
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
    previewAbort?.abort(new Error("Player stopped the voice sample."));
    previewAbort = undefined;
    await previewPlayback?.stop();
    if (storyStartPhase === "introducing") {
      introductionStopRequested = true;
      introductionAbort?.abort(new Error("Player stopped the introduction."));
    }
    if (storyStartPhase === "starting" || openingNarrationRetryActive) {
      openingStopRequested = true;
      openingAbort?.abort(new Error("Player stopped the story opening."));
    }
    await controller.stop();
    await updateEvidence();
  }

  async function previewVoice(
    role: "guide" | "narrator",
    port: OpenAiLivePlaybackPort,
    abort: AbortController,
  ): Promise<void> {
    previewGuide.disabled = true;
    previewNarrator.disabled = true;
    applyVoiceStatePresentation(
      "processing",
      `Preparing ${role} sample`,
      voicePresentation,
    );
    try {
      await port.play(
        {
          narrationId: `voice-preview-${++previewId}`,
          role,
          text:
            role === "guide"
              ? "I’m your Dungeon Guide. I can clarify your intent without taking over the adventure."
              : "West of House. You are standing in an open field west of a white house.",
          sourceEventId: "voice-settings",
          correlationId: "voice-settings",
        },
        abort.signal,
        {
          onStarted: () =>
            applyVoiceStatePresentation(
              role === "guide" ? "guide-speaking" : "narrator-speaking",
              `Playing ${role} sample`,
              voicePresentation,
            ),
        },
      );
    } finally {
      if (previewAbort === abort) {
        previewAbort = undefined;
        previewGuide.disabled = false;
        previewNarrator.disabled = false;
        presentControllerState();
      }
    }
  }

  function startVoicePreview(role: "guide" | "narrator"): void {
    if (
      controller.state !== "ready" &&
      controller.state !== "recoverable-error"
    ) {
      applyVoiceStatePresentation(
        "blocked",
        "Finish the current voice action first",
        voicePresentation,
      );
      return;
    }
    previewAbort?.abort(new Error("A new voice sample was requested."));
    void previewPlayback?.stop();
    const port = new OpenAiLivePlaybackPort({
      sessionToken: token,
      speechPreference: (previewRole) =>
        openAiSpeechPreferenceForRole(
          voicePreferenceSession.current,
          previewRole,
        ),
    });
    const abort = new AbortController();
    previewPlayback = port;
    previewAbort = abort;
    port.activateFromUserGesture();
    runControl(() => previewVoice(role, port, abort));
  }

  function runControl(operation: () => Promise<unknown>): void {
    void operation().catch(() => {
      applyVoiceStatePresentation("blocked", "Try again", voicePresentation);
    });
  }

  const modalOpenChanged = (): void => runControl(updateEvidence);
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
    dialog: settingsPanel,
    trigger: settingsButton,
    closeButton: settingsCloseButton,
    reducedMotion,
    onOpenChange: (open) => {
      if (!open) voicePreferenceSession.persist();
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

  projection = {
    ...projection,
    displayState: "ready",
    statusText: "Ready to start",
  };
  storyStartPresentation.shell.dataset.storyPhase = storyStartPhase;
  renderProjection();
  applyLivePreflightPresentation(preflight, presentation);
  if (transcriptPanel.open) optionalEventLog.setTranscriptOpen(true);
  presentControllerState();
  await updateEvidence();

  captureButton.addEventListener("click", () => {
    controller.activatePlaybackFromUserGesture();
    runControl(primaryAction);
  });
  stopButton.addEventListener("click", () => runControl(stopActive));
  pauseButton.addEventListener("click", () =>
    runControl(async () => {
      if (controller.state === "paused") await controller.resume();
      else await controller.pause();
      await updateEvidence();
    }),
  );
  repeatButton.addEventListener("click", () => {
    controller.activatePlaybackFromUserGesture();
    runControl(repeatLastNarration);
  });
  guideVoice.addEventListener("change", () => {
    updateVoicePreferences({ guideVoice: guideVoice.value as OpenAiTtsVoice });
    voicePreferenceSession.persist();
  });
  narratorVoice.addEventListener("change", () => {
    updateVoicePreferences({
      narratorVoice: narratorVoice.value as OpenAiTtsVoice,
    });
    voicePreferenceSession.persist();
  });
  guideRate.addEventListener("input", () => {
    const preferences = updateVoicePreferences({
      guideRate: Number(guideRate.value),
    });
    guideRateValue.value = `${preferences.guideRate.toFixed(2)}×`;
  });
  narratorRate.addEventListener("input", () => {
    const preferences = updateVoicePreferences({
      narratorRate: Number(narratorRate.value),
    });
    narratorRateValue.value = `${preferences.narratorRate.toFixed(2)}×`;
  });
  guideRate.addEventListener("change", () => voicePreferenceSession.persist());
  narratorRate.addEventListener("change", () =>
    voicePreferenceSession.persist(),
  );
  window.addEventListener("pagehide", () => voicePreferenceSession.persist());
  previewGuide.addEventListener("click", () => {
    startVoicePreview("guide");
  });
  previewNarrator.addEventListener("click", () => {
    startVoicePreview("narrator");
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
      await updateEvidence();
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
}

function publishStartupFailure(): void {
  const preflight = liveBrowserPreflight();
  const status = document.getElementById("status");
  const controls = Array.from(
    document.querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("button, input, select, textarea"),
  );
  applyFatalLiveStartupPresentation("Unable to start", status, controls);
  const activityIndicator = document.getElementById("activity-indicator");
  if (activityIndicator !== null) {
    activityIndicator.dataset.state = "blocked";
    activityIndicator.hidden = true;
  }
  const transcriptPanel = document.getElementById("transcript-panel");
  const debugPanel = document.getElementById("debug-panel");
  const evidence: LiveSmokeEvidence = {
    status: "failed",
    secureContext: preflight.secureContext,
    voiceAvailable: preflight.voiceAvailable,
    storyAuthenticationAvailable: preflight.storyAuthenticationAvailable,
    audioRecordingAvailable: preflight.audioRecordingAvailable,
    turns: 0,
    finalRevision: 0,
    eventTypes: [],
    transcriptHidden: !(transcriptPanel?.hasAttribute("open") ?? false),
    debugHidden: !(debugPanel?.hasAttribute("open") ?? false),
    errorCode: "startup-failed",
  };
  window.__OPENAI_LIVE_SMOKE__ = evidence;
  document.body.dataset.smokeEvidence = JSON.stringify(evidence);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void run().catch(publishStartupFailure);
}
