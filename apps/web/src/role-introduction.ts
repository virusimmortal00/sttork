import type { RoleIntroductionMessage } from "../../../packages/session/src/index.js";

export const ROLE_INTRODUCTION_INTERACTION_ID = "role-introduction";

export const ROLE_INTRODUCTION = [
  {
    role: "guide",
    text: "Hello traveler. I'm your Dungeon Guide. I can help you find the right words, explain your options, and offer hints when invited, without taking the adventure from you. Our Narrator will give voice to the world itself.",
  },
  {
    role: "narrator",
    text: "Greetings. I am the Narrator. I speak for each place, discovery, and consequence, exactly as the story reveals it. When you are ready, the threshold awaits.",
  },
] as const satisfies readonly RoleIntroductionMessage[];
