import type {Prisma} from '@prisma/client';
import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {normalizeRelationshipLevels, relationshipMeter, type RelationshipPolicy} from '@rumiai/contracts/conversations/relationship';

export async function readRelationshipPolicy(): Promise<RelationshipPolicy> {
  const [romance, intimacy, romancePerReply, intimacyPerReply] = await Promise.all([
    readSettingValue('relationship.romanceLevels'), readSettingValue('relationship.intimacyLevels'),
    readSettingValue<number>('relationship.romancePerReply'), readSettingValue<number>('relationship.intimacyPerReply'),
  ]);
  return {romanceLevels: normalizeRelationshipLevels(romance), intimacyLevels: normalizeRelationshipLevels(intimacy), romancePerReply, intimacyPerReply};
}

/** Private mode instructions are consumed only on the server, never sent in the public policy. */
export async function buildRelationshipContext(conversation: {relationshipMode: boolean; relationshipStatus: string | null; romance: number; intimacy: number}) {
  if (!conversation.relationshipMode) return '';
  const [policy, prompt] = await Promise.all([readRelationshipPolicy(), readSettingValue<string>('prompt.relationshipMode')]);
  const romance = relationshipMeter(conversation.romance, policy.romanceLevels);
  const intimacy = relationshipMeter(conversation.intimacy, policy.intimacyLevels);
  return [
    '本会话已开启关系模式。', prompt,
    conversation.relationshipStatus ? '用户选择的关系状态：' + conversation.relationshipStatus : '',
    romance.name ? '当前浪漫等级：' + romance.name : '',
    intimacy.name ? '当前亲密等级：' + intimacy.name : '',
  ].filter(Boolean).join('\n');
}


export async function recordRelationshipGrowth(tx: Prisma.TransactionClient, input: {conversationId: string; requestId: string; messageId: string}, policy: RelationshipPolicy) {
  if (policy.romancePerReply === 0 && policy.intimacyPerReply === 0) return;
  const conversation = await tx.conversation.findUnique({where: {id: input.conversationId}, select: {relationshipMode: true, romance: true, intimacy: true}});
  if (!conversation?.relationshipMode) return;
  const existing = await tx.conversationRelationshipEvent.findUnique({where: {conversationId_requestId: {conversationId: input.conversationId, requestId: input.requestId}}, select: {id: true}});
  if (existing) return;
  const romanceAfter = conversation.romance + policy.romancePerReply;
  const intimacyAfter = conversation.intimacy + policy.intimacyPerReply;
  await tx.conversationRelationshipEvent.create({data: {
    ...input, romanceDelta: policy.romancePerReply, intimacyDelta: policy.intimacyPerReply, romanceAfter, intimacyAfter,
  }});
  await tx.conversation.update({where: {id: input.conversationId}, data: {romance: romanceAfter, intimacy: intimacyAfter}});
}

/** Call only after the conversation owner has been authorized by the route. */
export async function readRelationshipHistory(conversationId: string) {
  return db.conversationRelationshipEvent.findMany({
    where: {conversationId}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 10,
    select: {id: true, messageId: true, romanceDelta: true, intimacyDelta: true, romanceAfter: true, intimacyAfter: true, createdAt: true},
  });
}
