import {DEFAULT_ACCENT_FROM, DEFAULT_ACCENT_TO, DEFAULT_BRAND_LOGO, DEFAULT_BRAND_NAME} from '@/lib/site-content/brand-defaults';

export type ContentType = 'BANNER' | 'TAG' | 'BADGE' | 'SECTION' | 'NAVIGATION' | 'PAGE' | 'BRANDING';
export type ContentStatus = 'PUBLISHED' | 'UNPUBLISHED' | 'DRAFT' | 'SCHEDULED';
export type SiteContentRow = {id: string; content: Record<string, unknown> | null; status: ContentStatus; isPublished: boolean; scheduledAt: string | null; version: number; updatedAt: string | null};
export type Revision = {id: string; version: number; snapshot: Record<string, unknown>; reason: string; createdAt: string; actor: {username: string}};
export type ManagedSiteContent = Record<ContentType, {items: SiteContentRow[]}>;

export const contentTypes: {id: ContentType; label: string}[] = [
  {id: 'BANNER', label: '首页横幅'}, {id: 'TAG', label: '分类标签'}, {id: 'BADGE', label: '角色徽章'}, {id: 'SECTION', label: '首页展示区'},
  {id: 'NAVIGATION',label:'导航与页脚'}, {id: 'PAGE',label:'固定页面与公告'}, {id: 'BRANDING',label:'品牌与主题'},
];
export const defaults: Record<ContentType, Record<string, unknown>> = {
  BANNER: {placement: 'HERO', title: '', description: '', href: '/discover', gradientFrom: '#EA580C', gradientTo: '#9333EA', imageUrl: null, sortOrder: 0, isActive: true},
  TAG: {key: '', label: '', group: '', filterRow: null, sortOrder: 0, isActive: true},
  BADGE: {emoji: '✨', label: '', sortOrder: 0, isActive: true},
  SECTION: {key: '', emoji: '✨', title: '', source: 'FOR_YOU', tagKey: null, sortOrder: 0, isActive: true},
  NAVIGATION: {placement:'HEADER',label:'',href:'/announcements',sortOrder:0,isActive:true},
  PAGE: {slug:'',kind:'PAGE',title:'',summary:'',blocks:[{type:'PARAGRAPH',text:''}],sortOrder:0,isActive:true,startsAt:null,endsAt:null},
  BRANDING: {brandName:DEFAULT_BRAND_NAME,logoUrl:DEFAULT_BRAND_LOGO,accentFrom:DEFAULT_ACCENT_FROM,accentTo:DEFAULT_ACCENT_TO,footerNote:'',isActive:true},
};
export function summary(type: ContentType, value: Record<string, unknown>) {
  if (type === 'BANNER') return `${value.placement === 'HERO' ? '首页大图' : '侧栏'} · ${value.title || '未命名横幅'}`;
  if (type === 'TAG') return `${value.label || '未命名分类'} · ${value.key || '无键'}`;
  if (type === 'BADGE') return `${value.emoji || ''} ${value.label || '未命名徽章'}`;
  if (type==='SECTION') return `${value.emoji || ''} ${value.title || '未命名展示区'} · ${value.source || ''}`;
  if (type==='NAVIGATION') return `${value.placement==='HEADER'?'顶部导航':'页脚链接'} · ${value.label||'未命名链接'}`;
  if (type==='PAGE') return `${value.kind==='ANNOUNCEMENT'?'公告':'固定页面'} · ${value.title||'未命名页面'} · /pages/${value.slug||''}`;
  return `${value.brandName||'站点品牌'} · ${value.isActive?'已启用':'已停用'}`;
}
