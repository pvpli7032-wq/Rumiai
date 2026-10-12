export const CHARACTER_LIMITS = { name: 40, tagline: 100, personality: 1000, background: 8000, greeting: 2000, scenario: 2000, roleTemplate: 1000, tags: 512, badges: 128, avatarUrl: 2048, copyrightStatement: 1000 } as const;
const labels: Record<string, string> = { name: '角色名称', tagline: '简介', personality: '人设', background: '背景', greeting: '开场白', scenario: '场景', roleTemplate: '扮演指引', tags: '标签', badges: '徽章', avatarUrl: '头像地址', copyrightStatement: '版权声明' };
const aliases: Record<string, string> = { avatar_url: 'avatarUrl', is_public: 'isPublic', is_adult: 'isAdult', role_template: 'roleTemplate' };
export function validateCharacter(body: unknown, creating: boolean): { data: Record<string, any>; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { data: {}, error: '角色数据格式不正确。' };
  const raw = { ...body } as Record<string, unknown>;
  for (const [alias, key] of Object.entries(aliases)) if (raw[key] === undefined && raw[alias] !== undefined) raw[key] = raw[alias];
  const data: Record<string, any> = {};
  for (const [key, limit] of Object.entries(CHARACTER_LIMITS)) {
    const value = raw[key];
    const required = key === 'name' || key === 'personality';
    if (value === undefined && !creating) continue;
    if (value === undefined && !required) continue;
    if (value === null && !required) { data[key] = key === 'background' ? '' : null; continue; }
    if (typeof value !== 'string') return { data: {}, error: `${labels[key]}必须为文本。` };
    const text = value.trim();
    if (required && !text) return { data: {}, error: `请填写${labels[key]}。` };
    if (value.length > limit) return { data: {}, error: `${labels[key]}不能超过 ${limit} 字。` };
    if (key === 'avatarUrl' && text) {
      let valid = /^\/(?:uploads|brand)\/[a-zA-Z0-9_./-]+$/.test(text) && !text.includes('..');
      try { valid ||= ['http:', 'https:'].includes(new URL(text).protocol); } catch {}
      if (!valid) return { data: {}, error: '头像地址须为 HTTP/HTTPS 图片地址或本地上传素材。' };
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
