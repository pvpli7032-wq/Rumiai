import {readCharacterContentLimits} from '@rumiai/backend/modules/settings/index';
import {CHARACTER_FIELDS, CHARACTER_LABELS, buildCharacterLimits, type CharacterLimits} from '@rumiai/contracts/characters/limits';
import {validateAvatarUrl} from '@rumiai/backend/modules/uploads/url-validation';

/**
 * 角色字段校验。
 *
 * 字数上限是运营参数，按请求从设置中心读（content.character.*），改完下一次提交就生效；
 * 技术上限与字段清单在 ./limits，服务端与前台共用。
 */
const aliases: Record<string, string> = { avatar_url: 'avatarUrl', is_public: 'isPublic', is_adult: 'isAdult', role_template: 'roleTemplate' };

/** 当前生效的角色字数上限。 */
export async function readCharacterLimits(): Promise<CharacterLimits> {
  const content = await readCharacterContentLimits();
  return buildCharacterLimits(key => {
    switch (key) {
      case 'content.character.nameMax': return content.name;
      case 'content.character.summaryMax': return content.tagline;
      case 'content.character.personaMax': return content.personality;
      case 'content.character.backgroundMax': return content.background;
      case 'content.character.openingMax': return content.greeting;
      default: return 0;
    }
  });
}

export async function validateCharacter(body: unknown, creating: boolean): Promise<{ data: Record<string, any>; error?: string }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { data: {}, error: '角色数据格式不正确。' };
  const limits = await readCharacterLimits();
  const raw = { ...body } as Record<string, unknown>;
  for (const [alias, key] of Object.entries(aliases)) if (raw[key] === undefined && raw[alias] !== undefined) raw[key] = raw[alias];
  const data: Record<string, any> = {};
  for (const key of CHARACTER_FIELDS) {
    const limit = limits[key];
    const value = raw[key];
    const required = key === 'name' || key === 'personality';
    if (value === undefined && !creating) continue;
    if (value === undefined && !required) continue;
    if (value === null && !required) { data[key] = key === 'background' ? '' : null; continue; }
    if (typeof value !== 'string') return { data: {}, error: `${CHARACTER_LABELS[key]}必须为文本。` };
    const text = value.trim();
    if (required && !text) return { data: {}, error: `请填写${CHARACTER_LABELS[key]}。` };
    if (value.length > limit) return { data: {}, error: `${CHARACTER_LABELS[key]}不能超过 ${limit} 字。` };
    if (key === 'avatarUrl' && text) {
      const avatarError = validateAvatarUrl(text);
      if (avatarError) return { data: {}, error: avatarError };
    }
    data[key] = text;
  }
  for (const key of ['isPublic', 'isAdult', 'isExclusive']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') return { data: {}, error: '可见性与内容标记必须为布尔值。' };
    data[key] = raw[key];
  }
  return { data };
}
