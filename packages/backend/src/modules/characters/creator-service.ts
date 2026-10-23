import { db } from '@rumiai/backend/infrastructure/database/client';
import { validateCharacter } from '@rumiai/backend/modules/characters/validation';
import { readMembershipBenefit, recordMembershipUsageInTransaction } from '@rumiai/backend/modules/memberships/service';
import {readSettingValue} from '@rumiai/backend/modules/settings/service';
import { createHash } from 'node:crypto';

export class CreatorCharacterError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CreatorCharacterError';
  }
}

export async function createCreatorCharacter(actorId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CreatorCharacterError('角色数据格式不正确。', 400);
  const validated = await validateCharacter(input, true);
  if (validated.error) throw new CreatorCharacterError(validated.error, 400);
  const body = {...input as Record<string, unknown>, ...validated.data};
  const {name, tagline, personality, background, greeting, tags, badges, isExclusive} = body;
  const requestedPublic = body.isPublic ?? body.is_public;
  const copyrightStatement = body.copyrightStatement;
  if (requestedPublic === true && (typeof copyrightStatement !== 'string' || !copyrightStatement.trim())) {
    throw new CreatorCharacterError('申请公开前请填写角色及素材版权声明。', 400);
  }
  if (typeof name !== 'string' || !name || typeof personality !== 'string' || !personality) {
    throw new CreatorCharacterError('Name and personality are required', 400);
  }

  const avatarUrl = body.avatarUrl ?? body.avatar_url;
  const roleTemplate = body.roleTemplate ?? body.role_template ?? null;
  const scenario = body.scenario ?? null;
  const isAdult = (body.isAdult ?? body.is_adult) === true;
  const relationshipStatus = body.relationshipStatus ?? body.relationship_status ?? null;
  const meter = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, Math.round(value))) : 0;
  const membershipLimit = await readMembershipBenefit(actorId, 'CHARACTER_CREATE_LIMIT');
  const publicCap = Math.trunc(await readSettingValue<number>('content.character.maxOwned'));
  const memberCap = membershipLimit ? Math.trunc(membershipLimit.value) : 0;
  const effectiveLimit = publicCap > 0 ? Math.max(publicCap, memberCap) : 0;
  const character = await db.$transaction(async tx => {
    const current = await tx.character.count({where: {creatorId: actorId}});
    if (effectiveLimit > 0 && current >= effectiveLimit) throw new CreatorCharacterError('已达到角色创建总上限。', 403);
    const created = await tx.character.create({
    data: {
      name, tagline: typeof tagline === 'string' && tagline ? tagline : null, personality,
      background: typeof background === 'string' ? background : '',
      greeting: typeof greeting === 'string' && greeting ? greeting : `你好，我是${name}。想聊些什么？`,
      avatarUrl: typeof avatarUrl === 'string' && avatarUrl ? avatarUrl : null,
      creatorId: actorId, isPublic: false, publicationRequested: requestedPublic === true,
      reviewStatus: requestedPublic === true ? 'PENDING' : 'DRAFT',
      copyrightStatement: typeof copyrightStatement === 'string' && copyrightStatement ? copyrightStatement : null,
      tags: typeof tags === 'string' && tags ? tags : null, badges: typeof badges === 'string' && badges ? badges : null,
      isExclusive: isExclusive === true, roleTemplate, scenario, isAdult, relationshipStatus,
      initialRomance: meter(body.initialRomance ?? body.initial_romance),
      initialIntimacy: meter(body.initialIntimacy ?? body.initial_intimacy),
    },
    });
    // The entitlement is an extension above the public cap. Creating within the
    // public allowance must not consume it; when publicCap is zero the entitlement
    // is intentionally ineffective and cannot make a free user worse off.
    if (membershipLimit && publicCap > 0 && current >= publicCap) await recordMembershipUsageInTransaction(tx, {orderNo: membershipLimit.orderNo, userId: actorId, benefitCode: 'CHARACTER_CREATE_LIMIT', idempotencyKey: createHash('sha256').update(`character-create:${created.id}`).digest('hex')});
    return created;
  });
  return {character};
}

export async function updateCreatorCharacter(actorId: string, characterId: string, input: unknown) {
  const validated = await validateCharacter(input, false);
  if (validated.error) throw new CreatorCharacterError(validated.error, 400);
  const { isPublic: requested, ...content } = validated.data;
  return db.$transaction(async tx => {
    const character = await tx.character.findUnique({ where: { id: characterId } });
    if (!character) throw new CreatorCharacterError('Not found', 404);
    if (character.creatorId !== actorId) throw new CreatorCharacterError('Forbidden', 403);

    const publishing = requested ?? character.publicationRequested;
    const copyright = 'copyrightStatement' in content ? content.copyrightStatement : character.copyrightStatement;
    if (publishing && !copyright?.trim()) throw new CreatorCharacterError('申请公开前请填写角色及素材版权声明。', 400);

    const changed = Object.entries(content).some(([key, value]) => value !== (character as Record<string, unknown>)[key]);
    const resubmit = publishing && (changed || requested === true && !character.isPublic);
    return tx.character.update({
      where: { id: characterId },
      data: {
        ...content,
        ...(requested === false
          ? { isPublic: false, publicationRequested: false, reviewStatus: 'DRAFT', reviewReason: null, reviewedAt: null, reviewedBy: null }
          : resubmit
            ? { isPublic: false, publicationRequested: true, reviewStatus: 'PENDING', reviewReason: null, reviewedAt: null, reviewedBy: null }
            : {}),
      },
    });
  });
}

export async function deleteCreatorCharacter(actorId: string, characterId: string) {
  return db.$transaction(async tx => {
    const character = await tx.character.findUnique({ where: { id: characterId }, select: { id: true, creatorId: true } });
    if (!character) throw new CreatorCharacterError('Not found', 404);
    if (character.creatorId !== actorId) throw new CreatorCharacterError('Forbidden', 403);
    await tx.character.delete({ where: { id: characterId } });
    return { success: true };
  });
}
