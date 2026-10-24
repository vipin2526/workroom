/* Sliding-window limiter for callers that must be limited per principal,
 * room, or IP. Returns a retry hint instead of throwing so callers can map
 * the result to their own transport (HTTP 429 or a socket error frame). */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 0 when the call is allowed, otherwise whole seconds until a retry. */
  take(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5_000) this.prune(now);
    return 0;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, hits] of this.hits) {
      if (!hits.some((at) => at > cutoff)) this.hits.delete(key);
    }
  }
}
