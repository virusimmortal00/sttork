export class FakeClock {
  #milliseconds: number;

  public constructor(initialTime: string | number = 0) {
    const milliseconds =
      typeof initialTime === "number" ? initialTime : Date.parse(initialTime);
    if (!Number.isFinite(milliseconds)) {
      throw new RangeError("FakeClock requires a valid initial time");
    }
    this.#milliseconds = milliseconds;
  }

  public now = (): string => new Date(this.#milliseconds).toISOString();

  public advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("FakeClock can advance only by a non-negative time");
    }
    this.#milliseconds += milliseconds;
  }
}
