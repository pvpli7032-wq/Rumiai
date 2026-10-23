import { db } from '@rumiai/backend/infrastructure/database/client';
import { isUniqueViolation } from '@rumiai/backend/infrastructure/auth/user-identity';

export class CharacterEngagementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CharacterEngagementError';
  }
}

async function readableCharacter(characterId: string, userId: string) {
  const character = await db.character.findUnique({
    where: { id: characterId },
    select: { id: true, isPublic: true, reviewStatus: true, creatorId: true },
  });
  if (!character) throw new CharacterEngagementError('Character not found', 404);
  if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== userId) {
    throw new CharacterEngagementError('Private character access forbidden', 403);
  }
  return character;
}

export async function likeCharacter(userId: string, characterId: string) {
  const character = await readableCharacter(characterId, userId);
  try {
    const likeCount = await db.$transaction(async tx => {
      await tx.characterLike.create({data: {userId, characterId: character.id}});
      const updated = await tx.character.update({where: {id: character.id}, data: {likeCount: {increment: 1}}, select: {likeCount: true}});
      return updated.likeCount;
    });
    return {success: true, hasLiked: true, likeCount};
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const current = await db.character.findUnique({where: {id: character.id}, select: {likeCount: true}});
    return {success: true, hasLiked: true, likeCount: current?.likeCount ?? 0};
  }
}

export async function unlikeCharacter(userId: string, characterId: string) {
  const likeCount = await db.$transaction(async tx => {
    const removed = await tx.characterLike.deleteMany({where: {userId, characterId}});
    if (removed.count === 0) {
      const current = await tx.character.findUnique({where: {id: characterId}, select: {likeCount: true}});
      return current?.likeCount ?? null;
    }
    const updated = await tx.character.update({where: {id: characterId}, data: {likeCount: {decrement: 1}}, select: {likeCount: true}});
    if (updated.likeCount < 0) {
      const fixed = await tx.character.update({where: {id: characterId}, data: {likeCount: 0}, select: {likeCount: true}});
      return fixed.likeCount;
    }
    return updated.likeCount;
  });
  if (likeCount === null) throw new CharacterEngagementError('Character not found', 404);
  return {success: true, hasLiked: false, likeCount};
}

export async function bookmarkCharacter(userId: string, characterId: string) {
  const character = await readableCharacter(characterId, userId);
  try { await db.characterBookmark.create({data: {userId, characterId: character.id}}); }
  catch (error) { if (!isUniqueViolation(error)) throw error; }
  return {success: true, hasBookmarked: true};
}

export async function unbookmarkCharacter(userId: string, characterId: string) {
  await db.characterBookmark.deleteMany({where: {userId, characterId}});
  return {success: true, hasBookmarked: false};
}
