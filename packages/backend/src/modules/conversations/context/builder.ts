import {db} from '@rumiai/backend/infrastructure/database/client';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';
import {responseOptions} from './settings';
export interface ContextSource {kind: 'persona' | 'privateOverride' | 'style' | 'length' | 'worldbook'; id: string; label: string}
export async function buildAdvancedContext(userId: string, conversationId: string, trigger: string, reservedChars = 0) {
  const conversation = await db.conversation.findFirst({where: {id: conversationId, userId}, include: {persona: true}});
  if (!conversation) return {text: '', sources: [] as ContextSource[], truncated: false};
  const [budget, styles, lengths, booksEnabled, bookBudget] = await Promise.all([
    readSettingValue<number>('memory.contextBudgetTokens'), responseOptions('chat.responseStyles'), responseOptions('chat.responseLengths'),
    readSettingValue<boolean>('chat.worldbooks.enabled'), readSettingValue<number>('chat.worldbooks.contextMaxChars'),
  ]);
  let remaining = Math.max(0, budget - reservedChars), truncated = false;
  const parts: string[] = [], sources: ContextSource[] = [];
  const append = (value: string, source: ContextSource) => {
    if (value.length > remaining) {truncated = true; return false;}
    parts.push(value); sources.push(source); remaining -= value.length; return true;
  };
  if (conversation.persona?.userId === userId) append('用户本次扮演的身份：' + conversation.persona.name + '\n' + conversation.persona.description, {kind: 'persona', id: conversation.persona.id, label: conversation.persona.name});
  if (conversation.personalCharacterOverride) append('仅本会话的角色设定补充（不改变公开角色）：\n' + conversation.personalCharacterOverride, {kind: 'privateOverride', id: conversationId, label: '私人角色设定'});
  for (const [kind, selected, options] of [['style', conversation.responseStyle, styles], ['length', conversation.responseLength, lengths]] as const) {
    const option = options.find(item => item.key === selected);
    if (option) append(option.instruction, {kind, id: option.key, label: option.label});
  }
  if (booksEnabled && bookBudget > 0 && remaining > 0) {
    const include = {worldbook: {include: {entries: {where: {enabled: true}}}}} as const;
    const [direct, character] = await Promise.all([
      db.conversationWorldbook.findMany({where: {conversationId}, include}),
      db.characterWorldbook.findMany({where: {characterId: conversation.characterId}, include}),
    ]);
    const books = [...new Map([...direct, ...character].map(binding => [binding.worldbook.id, binding.worldbook])).values()].filter(book => book.enabled && (book.userId === userId || book.isPublic));
    const haystack = trigger.toLocaleLowerCase(), hits = books.flatMap(book => book.entries.filter(entry => {
      try {const words = JSON.parse(entry.keywordsJson); return Array.isArray(words) && words.some(word => typeof word === 'string' && word.trim() && haystack.includes(word.toLocaleLowerCase()));} catch {return false;}
    }).map(entry => ({book, entry}))).sort((a, b) => b.entry.priority - a.entry.priority || a.entry.id.localeCompare(b.entry.id));
    let used = 0;
    for (const {book, entry} of hits) {
      const value = '场景背景资料（不代表用户已经经历）：\n' + entry.content;
      if (used + value.length > bookBudget) {truncated = true; continue;}
      if (append(value, {kind: 'worldbook', id: entry.id, label: book.name})) used += value.length;
    }
  }
  return {text: parts.join('\n\n'), sources, truncated};
}
export async function recordContextUse(conversationId: string, requestId: string, data: {sources: ContextSource[]; truncated: boolean; memoryFactIds?: string[]}) {
  await db.conversationContextUse.upsert({where: {conversationId_requestId: {conversationId, requestId}}, create: {conversationId, requestId, sourcesJson: JSON.stringify(data)}, update: {}});
}
export async function readContextUse(userId: string, conversationId: string, requestId?: string) {
  const owned = await db.conversation.findFirst({where: {id: conversationId, userId}, select: {id: true}});
  if (!owned) return null;
  const record = await db.conversationContextUse.findFirst({where: {conversationId, ...(requestId ? {requestId} : {})}, orderBy: {createdAt: 'desc'}});
  return record ? {...record, sources: JSON.parse(record.sourcesJson), sourcesJson: undefined} : null;
}
