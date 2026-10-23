/**
 * Fixed-window rate limiting, held in this process's memory.
 *
 * Chat replies are billed against a shared daily provider quota, so one account
 * looping the endpoint could drain the whole platform's budget for the day. Uploads
 * write to disk. Both need a ceiling.
 *
 * Being per-process, this is correct for the single-instance deployment the app runs
 * today; behind several instances each would allow the full quota, so a shared store
 * (Redis, or a database table) has to replace the map before scaling out.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
let lastSweep = 0;

/** Drop expired entries occasionally so the map cannot grow without bound. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — suitable for a Retry-After header. */
  retryAfter: number;
};

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfter: 0 };
}

