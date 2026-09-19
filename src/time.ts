/** Time only moves when the player moves. */
export const MIN_SCALE = 0.03;

export class TimeController {
  scale = MIN_SCALE;
  /** Forces the scale (tests / debugging). */
  override: number | null = null;
  private burst = 0;

  /** motion: roughly metres per second of head / hand movement. */
  update(realDt: number, motion: number): void {
    if (this.override !== null) {
      this.scale = this.override;
      return;
    }
    let target = Math.min(1, MIN_SCALE + Math.max(0, motion - 0.06) * 0.9);
    if (this.burst > 0) {
      this.burst -= realDt;
      target = Math.max(target, 0.75);
    }
    const rate = target > this.scale ? 14 : 5;
    this.scale += (target - this.scale) * (1 - Math.exp(-rate * realDt));
  }

  /** Shooting lets time lurch forward for a moment. */
  kick(seconds = 0.12): void {
    this.burst = Math.max(this.burst, seconds);
  }

  reset(): void {
    this.scale = MIN_SCALE;
    this.burst = 0;
  }
}
