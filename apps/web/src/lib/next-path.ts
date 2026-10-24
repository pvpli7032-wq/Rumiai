/**
 * Where to send someone after they sign in.
 *
 * Signing in used to always land on `/`, which the locale middleware bounces to the
 * marketing page — so clicking a character while signed out, then logging in, dropped
 * you on the landing page instead of the chat you asked for. The destination is carried
 * in `?next=`.
 *
 * It comes from the URL, so it is only ever allowed to be a path on this site: a value
 * like `//evil.example` or `https://evil.example` would otherwise turn our login form
 * into an open redirect.
 */
export const DEFAULT_AFTER_LOGIN = '/discover';

const BACKSLASH = String.fromCharCode(92);

/** Bouncing back to the auth pages would loop. */
const AUTH_PAGES = /^\/(login|register)(\/|\?|$)/;

/**
 * A backslash or control character can be normalised into an authority by some clients.
 * Checked by codepoint rather than a regex literal so the escaping is unambiguous.
 */
function hasUnsafeChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === BACKSLASH || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_AFTER_LOGIN;

  let candidate = value;
  try {
    candidate = decodeURIComponent(value);
  } catch {
    // Keep the raw value; the checks below still apply.
  }

  // Must be a path on this site. `//host` is protocol-relative, and hasUnsafeChar rules
  // out the backslash forms alongside control characters.
  if (!candidate.startsWith('/')) return DEFAULT_AFTER_LOGIN;
  if (candidate.startsWith('//')) return DEFAULT_AFTER_LOGIN;
  if (hasUnsafeChar(candidate)) return DEFAULT_AFTER_LOGIN;
  if (AUTH_PAGES.test(candidate)) return DEFAULT_AFTER_LOGIN;

  return candidate;
}

/**
 * The login URL that comes back to wherever the reader is now. Client-side only — every
 * caller is a gate inside a `use client` page.
 */
export function loginWithNext(): string {
  if (typeof window === 'undefined') return '/login';
  const here = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(here)}`;
}

/**
 * The `?next=` destination for the page being viewed, already validated.
 *
 * Read from `window.location` rather than `useSearchParams()` on purpose: that hook opts
 * the page out of static prerendering unless it sits inside a Suspense boundary, and
 * `next build` fails on /login and /register without one. The value is only needed inside
 * a submit handler, which is always client-side, so no hook is required.
 */
export function afterLoginTarget(): string {
  if (typeof window === 'undefined') return DEFAULT_AFTER_LOGIN;
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

/** Route through the optional onboarding gate while preserving the reader's intended page. */
export function onboardingTarget(next = afterLoginTarget()): string {
  const destination = safeNextPath(next);
  return `/onboarding?next=${encodeURIComponent(destination.startsWith('/onboarding') ? DEFAULT_AFTER_LOGIN : destination)}`;
}

/** Destination used when onboarding is disabled, completed or skipped. */
export function afterOnboardingTarget(): string {
  if (typeof window === 'undefined') return DEFAULT_AFTER_LOGIN;
  const destination = safeNextPath(new URLSearchParams(window.location.search).get('next'));
  return destination.startsWith('/onboarding') ? DEFAULT_AFTER_LOGIN : destination;
}
