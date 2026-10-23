/** Transport-only decoding for dynamic account route segments. */
export function decodeAdminUserId(rawId: string): string | null {
  try {
    const userId = decodeURIComponent(rawId);
    return /^[A-Za-z0-9_-]{1,100}$/.test(userId) ? userId : null;
  } catch {
    return null;
  }
}
