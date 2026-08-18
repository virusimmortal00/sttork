import type { GuideDecision } from "../../contracts/src/index.js";

import type { GuideModel, InitialGuideModelInput } from "./initial-guide.js";

export type FakeGuideResolver = (
  input: InitialGuideModelInput,
) => unknown | Promise<unknown>;

export class FakeGuideModel implements GuideModel {
  readonly #resolver: FakeGuideResolver;
  public calls = 0;

  public constructor(resolver: FakeGuideResolver) {
    this.#resolver = resolver;
  }

  public async decide(
    input: InitialGuideModelInput,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    this.calls += 1;
    return await this.#resolver(input);
  }

  public static returning(decision: GuideDecision): FakeGuideModel {
    return new FakeGuideModel(() => decision);
  }
}
