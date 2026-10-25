import {normalizeReaderPreferences, validateReaderPreferences, validateShortcuts} from '@rumiai/contracts/accounts/preferences';
import { db } from '@rumiai/backend/infrastructure/database/client';
import {mayAttachAccountUpload} from '@rumiai/backend/modules/uploads/read-service';
import {validateAvatarUrl} from '@rumiai/backend/modules/uploads/url-validation';
import { formatUser, isUniqueViolation, validateUsername } from '@rumiai/backend/infrastructure/auth/user-identity';

const USER_PROFILE_SELECT = {
  id: true, username: true, displayName: true, email: true, avatarUrl: true, tier: true, coins: true,
  streakCount: true, lastCheckin: true, bannedWords: true, readingMode: true, shortcuts: true, readerPreferencesJson: true, createdAt: true,
  _count: {select: {characters: {where: {reviewStatus: {not: 'DELETED'}}}}},
} as const;

export class AccountProfileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AccountProfileError';
  }
}

export async function readOwnProfile(userId: string) {
  const user = await db.user.findUnique({where: {id: userId}, select: USER_PROFILE_SELECT});
  if (!user) throw new AccountProfileError('User not found', 404);
  const {_count, ...profile} = user;
  return formatUser({...profile, characterCount: _count.characters});
}

export async function updateOwnProfile(userId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountProfileError('Profile data is invalid', 400);
  const body = input as Record<string, unknown>;
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : typeof body.name === 'string' ? body.name.trim() : undefined;
  const username = typeof body.username === 'string' ? body.username.trim() : undefined;
  const rawAvatarUrl = body.avatarUrl !== undefined ? body.avatarUrl : body.avatar_url;
  let avatarUrl: string | null | undefined;
  if (rawAvatarUrl !== undefined) {
    if (rawAvatarUrl === null || rawAvatarUrl === '') avatarUrl = null;
    else {
      const avatarError = validateAvatarUrl(rawAvatarUrl);
      if (avatarError) throw new AccountProfileError(avatarError, 400);
      avatarUrl = (rawAvatarUrl as string).trim();
      if (avatarUrl.startsWith('/uploads/') && !await mayAttachAccountUpload(userId, avatarUrl, {allowSiteOwned: true})) {
        throw new AccountProfileError('头像上传素材不属于此账号或站点。', 403);
      }
    }
  }
  const rawBannedWords = body.bannedWords ?? body.banned_words;
  const bannedWords = typeof rawBannedWords === 'string' ? rawBannedWords.slice(0, 4_000) : undefined;
  const rawReadingMode = body.readingMode ?? body.reading_mode;
  let readingMode = typeof rawReadingMode === 'boolean' ? rawReadingMode : undefined;
  let readerPreferencesJson: string | undefined;
  if (body.readerPreferences !== undefined || readingMode !== undefined) {
    const existing = await db.user.findUnique({where: {id: userId}, select: {readerPreferencesJson: true, readingMode: true}});
    const base = normalizeReaderPreferences(existing?.readerPreferencesJson, existing?.readingMode);
    if (body.readerPreferences !== undefined) {
      const invalid = validateReaderPreferences(body.readerPreferences);
      if (invalid) throw new AccountProfileError(invalid, 400);
      Object.assign(base, body.readerPreferences);
      readingMode = base.fontSize !== 'standard';
    } else base.fontSize = readingMode ? 'large' : 'standard';
    readerPreferencesJson = JSON.stringify(base);
  }

  let shortcuts: string | undefined;
  if (body.shortcuts !== undefined) {
    const invalid = validateShortcuts(body.shortcuts);
    if (invalid) throw new AccountProfileError(invalid, 400);
    const value = typeof body.shortcuts === 'string' ? JSON.parse(body.shortcuts) : body.shortcuts;
    shortcuts = JSON.stringify(value.map((item: {label: string; text: string}) => ({label: item.label.trim(), text: item.text.trim()})));
  }

  if (username !== undefined && username.length === 0) throw new AccountProfileError('Username cannot be empty', 400);
  if (username !== undefined) { const usernameError = validateUsername(username); if (usernameError) throw new AccountProfileError(usernameError, 400); }
  if (displayName !== undefined && (displayName.length === 0 || displayName.length > 100)) throw new AccountProfileError('昵称须为 1–100 字。', 400);

  try {
    const user = await db.user.update({
      where: {id: userId},
      data: {
        accountVersion: {increment: 1},
        ...(username !== undefined && {username}),
        ...(displayName !== undefined && {displayName}),
        ...(avatarUrl !== undefined && {avatarUrl}),
        ...(bannedWords !== undefined && {bannedWords}),
        ...(readingMode !== undefined && {readingMode}),
        ...(shortcuts !== undefined && {shortcuts}),
        ...(readerPreferencesJson !== undefined && {readerPreferencesJson}),
      },
      select: USER_PROFILE_SELECT,
    });
    const {_count, ...profile} = user;
    return formatUser({...profile, characterCount: _count.characters});
  } catch (error) {
    if (isUniqueViolation(error)) throw new AccountProfileError('Username already in use', 409);
    throw error;
  }
}
