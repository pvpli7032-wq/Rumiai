import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';

/**
 * `username` is the unique @handle shown on creator cards; `displayName` is the
 * free-text name a user can change at will. Registration accepts either, so the
 * helpers below keep the two from being conflated — two people are allowed to
 * both call themselves "小明", but only one can hold the handle @xiaoming.
 */

/** Turn arbitrary text (a display name, or an email local-part) into a handle. */
export function slugifyHandle(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[_.\-]+|[_.\-]+$/g, '')
    .slice(0, 24);
  return base || 'user';
}

/** Handles are URL path segments; keep registration and profile edits aligned. */
export function validateUsername(value: string): string | null {
  if (!value || value.length > 100) return '用户名不能为空且不能超过 100 字。';
  if (value === '.' || value === '..' || /\s|[\\/%?#\u0000-\u001f\u007f]/u.test(value)) return '用户名不能包含空格、斜杠或 URL 保留字符。';
  return null;
}

/**
 * Find a free handle near `preferred`, appending a numeric suffix on collision.
 * Only use this for handles the app derived itself — when a user explicitly asks
 * for a handle, a collision must surface as 409 rather than silently renaming them.
 */
export async function allocateHandle(preferred: string): Promise<string> {
  const base = slugifyHandle(preferred);

  for (const candidate of [base, ...Array.from({ length: 8 }, (_, i) => `${base}_${i + 2}`)]) {
    const taken = await db.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Busy base name — stop probing and take a random handle.
  return `${base.slice(0, 16)}_${randomBytes(4).toString('hex')}`;
}

/** True for a Prisma unique-constraint violation, which callers should map to 409. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Shape a user row for API responses. `name` stays in the payload because the
 * whole client surface reads it, but it now prefers displayName over the handle.
 */
export function formatUser<T extends { username: string; displayName?: string | null; avatarUrl?: string | null }>(
  user: T
) {
  return {
    ...user,
    name: user.displayName ?? user.username,
    avatar_url: user.avatarUrl ?? null,
  };
}
