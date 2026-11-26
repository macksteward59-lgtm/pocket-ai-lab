/**
 * Pluggable rate limiting. The in-memory store works for a single
 * long-running process (a dedicated server, or one warm serverless
 * instance). It does NOT coordinate across multiple serverless instances --
 * a platform that runs several concurrent instances needs a shared store
 * (Redis, Upstash, Cloudflare KV/Durable Objects, DynamoDB, etc.) implementing
 * the same interface. That is a deliberate seam, not an oversight: this
 * package has no network access to pick one for you.
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimitStore {
  /** Atomically checks and increments. Returns whether this request is allowed under `limit` per `windowMs`. */
  take(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitResult>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async take(key: string, limit: number, windowMs: number, now: number = Date.now()): Promise<RateLimitResult> {
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count++;
    return { allowed: true };
  }
}
