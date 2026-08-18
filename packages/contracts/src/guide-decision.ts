export type MetaControl =
  | "stop-speaking"
  | "repeat-last"
  | "pause-session"
  | "resume-session"
  | "speech-slower"
  | "speech-faster"
  | "show-transcript"
  | "hide-transcript";

/** Canonical provider-neutral decision contract from docs/guide-agent.md. */
export type GuideDecision =
  | {
      readonly kind: "execute";
      readonly command: string;
      readonly intentSummary: string;
      readonly expectedEffect?: string;
      readonly confidence: number;
      readonly acknowledgement?: string;
      readonly remainingGoal?: string;
    }
  | {
      readonly kind: "clarify";
      readonly question: string;
      readonly choices?:
        readonly [string, string] | readonly [string, string, string];
      readonly ambiguity: string;
    }
  | {
      readonly kind: "explain";
      readonly response: string;
      readonly basis: "command-help" | "observed-memory" | "game-explanation";
      readonly sourceIds: readonly string[];
    }
  | {
      readonly kind: "request_hint";
      readonly puzzleContext: string;
      readonly requestedLevel: 1 | 2 | 3 | 4;
    }
  | {
      readonly kind: "session_control";
      readonly control: MetaControl;
    }
  | {
      readonly kind: "cannot_comply";
      readonly response: string;
      readonly reason:
        "not-observed" | "unsupported" | "unsafe" | "provider-limitation";
    };
