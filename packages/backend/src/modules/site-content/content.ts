import {SiteContentError} from '@rumiai/backend/modules/site-content/errors';

export const SITE_CONTENT_TYPES = ['BANNER', 'TAG', 'BADGE', 'SECTION', 'NAVIGATION', 'PAGE', 'BRANDING'] as const;
export type SiteContentType = typeof SITE_CONTENT_TYPES[number];
const fields: Record<SiteContentType, readonly string[]> = {
  BANNER: ['placement', 'title', 'description', 'href', 'gradientFrom', 'gradientTo', 'imageUrl', 'sortOrder', 'isActive'],
  TAG: ['key', 'label', 'group', 'filterRow', 'sortOrder', 'isActive'],
  BADGE: ['emoji', 'label', 'sortOrder', 'isActive'],
  SECTION: ['key', 'emoji', 'title', 'source', 'tagKey', 'sortOrder', 'isActive'],
  NAVIGATION: ['placement', 'label', 'href', 'sortOrder', 'isActive'],
  PAGE: ['slug', 'kind', 'title', 'summary', 'blocks', 'sortOrder', 'isActive', 'startsAt', 'endsAt'],
  BRANDING: ['brandName', 'logoUrl', 'accentFrom', 'accentTo', 'footerNote', 'isActive'],
};
function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SiteContentError('站点内容格式不正确。');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, allowEmpty = false) {
  if (typeof value !== 'string' || value.trim().length > max || !allowEmpty && !value.trim()) throw new SiteContentError(`${label}格式无效。`);
  return value.trim();
}
function order(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100_000) throw new SiteContentError('排序须为 0–100000 的整数。');
  return value;
}
function active(value: unknown) {if (typeof value !== 'boolean') throw new SiteContentError('发布状态无效。'); return value;}
function key(value: unknown) {const result = text(value, '配置键', 40); if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(result)) throw new SiteContentError('配置键仅支持字母、数字、下划线和连字符。'); return result;}
function siteHref(value:unknown,label:string){const href=text(value,label,200);if(!href.startsWith('/')||href.startsWith('//')||href.includes('\\')||/[\u0000-\u001f]/.test(href))throw new SiteContentError(`${label}必须指向站内路径。`);return href;}

export function validateSiteContent(type: SiteContentType, input: unknown) {
  const row = object(input);
  if (Object.keys(row).some(name => !fields[type].includes(name)) || fields[type].some(name => !Object.hasOwn(row, name))) throw new SiteContentError('内容字段与当前组件类型不匹配。');
  if (type === 'BANNER') {
    const placement = row.placement;
    if (placement !== 'HERO' && placement !== 'SIDEBAR') throw new SiteContentError('请选择有效的横幅位置。');
    const href = text(row.href, '跳转链接', 200);
    if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\') || /[\u0000-\u001f]/.test(href)) throw new SiteContentError('横幅只能跳转到站内路径。');
    for (const color of [row.gradientFrom, row.gradientTo]) if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new SiteContentError('横幅颜色须为六位十六进制颜色。');
    const imageUrl = row.imageUrl === null || row.imageUrl === '' ? null : text(row.imageUrl, '横幅图片', 300);
    if (imageUrl && !(/^\/brand\/[A-Za-z0-9_.-]{1,120}$/.test(imageUrl) || /^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(imageUrl))) throw new SiteContentError('图片只能引用站内品牌资源或上传文件。');
    return {placement, title: text(row.title, '横幅标题', 80), description: text(row.description, '横幅说明', 180, true), href, gradientFrom: row.gradientFrom as string, gradientTo: row.gradientTo as string, imageUrl, sortOrder: order(row.sortOrder), isActive: active(row.isActive)};
  }
  if (type === 'TAG') {
    const filterRow = row.filterRow === null || row.filterRow === '' ? null : row.filterRow;
    if (filterRow !== null && filterRow !== 'type' && filterRow !== 'role') throw new SiteContentError('筛选位置仅支持类型或题材。');
    return {key: key(row.key), label: text(row.label, '分类名称', 48), group: text(row.group, '分类分组', 40), filterRow, sortOrder: order(row.sortOrder), isActive: active(row.isActive)};
  }
  if (type === 'BADGE') return {emoji: text(row.emoji, '徽章符号', 24), label: text(row.label, '徽章名称', 48), sortOrder: order(row.sortOrder), isActive: active(row.isActive)};
  if (type === 'NAVIGATION') {
    if (row.placement !== 'HEADER' && row.placement !== 'FOOTER') throw new SiteContentError('导航位置无效。');
    const href = text(row.href, '导航链接', 200);
    if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\') || /[\u0000-\u001f]/.test(href)) throw new SiteContentError('导航只能使用站内路径。');
    return {placement: row.placement, label: text(row.label, '导航名称', 40), href, sortOrder: order(row.sortOrder), isActive: active(row.isActive)};
  }
  if (type === 'PAGE') {
    const slug = text(row.slug,'页面路径',60);
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) throw new SiteContentError('页面路径仅支持小写字母、数字和连字符。');
    if (row.kind !== 'PAGE' && row.kind !== 'ANNOUNCEMENT') throw new SiteContentError('页面类型无效。');
    if (!Array.isArray(row.blocks) || row.blocks.length > 30) throw new SiteContentError('页面最多配置 30 个已支持内容组件。');
    const blocks = row.blocks.map((value, index) => {
      const block = object(value);
      if (block.type === 'PARAGRAPH' && Object.keys(block).every(name => ['type','text'].includes(name))) return {type: 'PARAGRAPH', text: text(block.text, `第${index+1}段文字`, 3000)};
      if (block.type === 'HEADING' && Object.keys(block).every(name => ['type','text','level'].includes(name)) && [2,3].includes(Number(block.level))) return {type: 'HEADING', text: text(block.text, `第${index+1}个标题`, 100), level: Number(block.level)};
      if (block.type === 'LINK' && Object.keys(block).every(name => ['type','text','href'].includes(name))) {
        const href = siteHref(block.href, `第${index+1}个链接`);
        return {type: 'LINK', text: text(block.text, `第${index+1}个链接文字`, 100), href};
      }
      if (block.type === 'NOTICE' && Object.keys(block).every(name => ['type','text','tone'].includes(name)) && ['INFO','WARNING'].includes(String(block.tone))) return {type: 'NOTICE', text: text(block.text, `第${index+1}条提示`, 1000), tone: block.tone};
      if (block.type === 'BUTTON' && Object.keys(block).every(name => ['type','text','href','variant'].includes(name)) && ['PRIMARY','SECONDARY'].includes(String(block.variant))) return {type:'BUTTON',text:text(block.text,`第${index+1}个按钮文字`,80),href:siteHref(block.href,`第${index+1}个按钮链接`),variant:block.variant};
      if (block.type === 'IMAGE' && Object.keys(block).every(name => ['type','src','alt','caption'].includes(name))) {
        const src=text(block.src,`第${index+1}张图片`,300);
        if(!(/^\/brand\/[A-Za-z0-9_.-]{1,120}$/.test(src)||/^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(src)))throw new SiteContentError('页面图片只能引用站内品牌资源或站点素材。');
        return {type:'IMAGE',src,alt:text(block.alt,`第${index+1}张图片替代文字`,160),caption:text(block.caption,`第${index+1}张图片说明`,240,true)};
      }
      if (block.type === 'LIST' && Object.keys(block).every(name => ['type','ordered','items'].includes(name)) && typeof block.ordered==='boolean' && Array.isArray(block.items) && block.items.length>=1 && block.items.length<=20) {
        return {type:'LIST',ordered:block.ordered,items:block.items.map((item,itemIndex)=>text(item,`第${index+1}个列表第${itemIndex+1}项`,240))};
      }
      if (block.type === 'CARD_GRID' && Object.keys(block).every(name => ['type','heading','cards'].includes(name)) && Array.isArray(block.cards) && block.cards.length>=1 && block.cards.length<=6) {
        const cards=block.cards.map((value,cardIndex)=>{
          const card=object(value);
          if(Object.keys(card).some(name=>!['title','description','href','actionLabel'].includes(name))||Object.keys(card).length!==4)throw new SiteContentError(`第${index+1}个卡片网格中的第${cardIndex+1}张卡片字段无效。`);
          return {title:text(card.title,`第${index+1}个网格卡片标题`,80),description:text(card.description,`第${index+1}个网格卡片说明`,300,true),href:siteHref(card.href,`第${index+1}个网格卡片链接`),actionLabel:text(card.actionLabel,`第${index+1}个网格卡片按钮`,40)};
        });
        return {type:'CARD_GRID',heading:text(block.heading,`第${index+1}个卡片网格标题`,80),cards};
      }
      throw new SiteContentError(`第${index+1}个组件类型或字段无效。`);
    });
    const totalText=blocks.reduce((sum,block)=>sum+(typeof block.text==='string'?block.text.length:block.type==='CARD_GRID'?(block.heading?.length??0)+(block.cards??[]).reduce((cardSum,card)=>cardSum+card.title.length+card.description.length+card.actionLabel.length,0):block.type==='IMAGE'?(block.alt?.length??0)+(block.caption?.length??0):block.type==='LIST'?(block.items??[]).reduce((listSum,item)=>listSum+item.length,0):0),0);
    if (totalText > 20_000) throw new SiteContentError('页面文字总量不能超过 20000 字。');
    const startsAt = date(row.startsAt, '生效时间'), endsAt = date(row.endsAt, '结束时间');
    if (startsAt && endsAt && endsAt <= startsAt) throw new SiteContentError('页面结束时间必须晚于生效时间。');
    return {slug, kind: row.kind, title: text(row.title, '页面标题', 100), summary: text(row.summary, '页面摘要', 240, true), blocks, sortOrder: order(row.sortOrder), isActive: active(row.isActive), startsAt, endsAt};
  }
  if (type === 'BRANDING') {
    for (const color of [row.accentFrom,row.accentTo]) if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new SiteContentError('主题颜色须为六位十六进制颜色。');
    const logoUrl = row.logoUrl === null || row.logoUrl === '' ? null : text(row.logoUrl, '品牌图标', 300);
    if (logoUrl && !(/^\/brand\/[A-Za-z0-9_.-]{1,120}$/.test(logoUrl) || /^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(logoUrl))) throw new SiteContentError('品牌图标只能引用站内品牌资源或上传文件。');
    return {brandName: text(row.brandName, '品牌名称', 40), logoUrl, accentFrom: row.accentFrom as string, accentTo: row.accentTo as string, footerNote: text(row.footerNote, '页脚说明', 240, true) || null, isActive: active(row.isActive)};
  }
  const source = row.source;
  if (!['FOR_YOU', 'EXCLUSIVE', 'POPULAR', 'NEWEST', 'TAG'].includes(String(source))) throw new SiteContentError('首页展示区数据来源无效。');
  const tagKey = row.tagKey === null || row.tagKey === '' ? null : key(row.tagKey);
  if (source === 'TAG' && !tagKey || source !== 'TAG' && tagKey) throw new SiteContentError('标签展示区须选择分类，其他展示区不能绑定分类。');
  return {key: key(row.key), emoji: text(row.emoji, '展示区符号', 24), title: text(row.title, '展示区标题', 60), source, tagKey, sortOrder: order(row.sortOrder), isActive: active(row.isActive)};
}

function date(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new SiteContentError(`${label}必须是有效 UTC 时间。`);
  return new Date(value);
}

export function parseSiteContentType(value: string): SiteContentType {
  if ((SITE_CONTENT_TYPES as readonly string[]).includes(value)) return value as SiteContentType;
  throw new SiteContentError('未知的站点内容类型。', 404);
}
export function readSiteContentCommand(input: unknown, needsVersion: boolean) {
  const body = object(input);
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new SiteContentError('请填写 1–500 字操作理由。');
  if (!['SAVE', 'SCHEDULE', 'PUBLISH', 'UNPUBLISH', 'DELETE_DRAFT'].includes(String(body.action))) throw new SiteContentError('站点内容操作无效。');
  if (needsVersion && (!Number.isSafeInteger(body.version) || (body.version as number) < 0)) throw new SiteContentError('版本信息无效，请刷新后重试。');
  let scheduledAt: Date | null = null;
  if (body.action === 'SCHEDULE') {
    if (typeof body.scheduledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.scheduledAt) || !Number.isFinite(Date.parse(body.scheduledAt))) throw new SiteContentError('定时发布时间必须是有效 UTC 时间。');
    scheduledAt = new Date(body.scheduledAt);
    if (scheduledAt <= new Date()) throw new SiteContentError('定时发布时间必须晚于当前时间。');
  }
  return {body, reason: body.reason.trim(), expectedVersion: needsVersion ? body.version as number : 0, action: String(body.action) as 'SAVE'|'SCHEDULE'|'PUBLISH'|'UNPUBLISH'|'DELETE_DRAFT', scheduledAt};
}
